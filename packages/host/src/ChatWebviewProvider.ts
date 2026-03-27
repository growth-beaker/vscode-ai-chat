import type {
  ChatMessage,
  ChatThread,
  ThreadSummary,
  ThreadStorage,
  HostToWebviewEvent,
  WebviewToHostEvent,
  FileContentPart,
  ImageContentPart,
} from "@growthbeaker/ai-chat-core";
import { createThread, toThreadSummary, exportThreadAsJSON, exportThreadAsMarkdown } from "@growthbeaker/ai-chat-core";
import { isWebviewToHostEvent } from "@growthbeaker/ai-chat-core";
import { generateHtml, generateNonce } from "./html.js";
import { StreamingChatHandler } from "./streaming.js";
import { createStorage } from "./storage/index.js";
import { MCPManager } from "./mcp.js";
import type { ChatProviderConfig, ChatTemplate, SlashCommandHandler, SlashCommandContext, OnMessageResult } from "./types.js";
import type { ChatContentPart, TokenUsage } from "@growthbeaker/ai-chat-core";

/**
 * Minimal VS Code types to avoid hard dependency on the vscode module at compile time.
 * The real vscode types are available at runtime when the extension loads.
 */
interface VSCodeWebviewView {
  webview: {
    options: { enableScripts?: boolean; localResourceRoots?: unknown[] };
    html: string;
    onDidReceiveMessage: (handler: (msg: unknown) => void) => { dispose(): void };
    postMessage: (msg: unknown) => PromiseLike<boolean>;
    asWebviewUri: (uri: unknown) => { toString(): string };
    cspSource: string;
  };
}

interface VSCodeUri {
  fsPath: string;
}

interface VSCodeUriStatic {
  joinPath(base: unknown, ...pathSegments: string[]): VSCodeUri;
}

/**
 * ChatWebviewProvider — the primary entry point for extension developers.
 *
 * Implements the VS Code WebviewViewProvider interface. Manages the webview
 * lifecycle, postMessage bridge, LLM streaming, and multi-thread state.
 */
export class ChatWebviewProvider {
  private view: VSCodeWebviewView | null = null;
  private disposables: Array<{ dispose(): void }> = [];
  private threads = new Map<string, ChatThread>();
  private activeThreadId: string;
  private streamingHandler = new StreamingChatHandler();
  private storage: ThreadStorage | null;
  private storageLoaded = false;
  private mcpManager: MCPManager | null = null;
  private mcpInitialized = false;
  private activeModel: import("ai").LanguageModel | undefined;
  private isReady = false;
  private readyResolvers: Array<() => void> = [];
  private pendingApprovals = new Map<
    string,
    { resolve: (result: { approved: boolean; feedback?: string }) => void }
  >();
  private templates = new Map<string, ChatTemplate>();
  private activeTemplate: ChatTemplate | null = null;
  private pendingUserActions = new Map<string, { resolve: (result: unknown) => void }>();
  private slashCommands = new Map<string, SlashCommandHandler>();
  private systemPrompt: string | undefined;

  constructor(
    private readonly extensionUri: unknown,
    private readonly config: ChatProviderConfig,
  ) {
    const initial = createThread();
    this.threads.set(initial.id, initial);
    this.activeThreadId = initial.id;
    this.activeModel = config.model;
    this.systemPrompt = config.system;
    this.storage = config.persistence ? createStorage(config.persistence) : null;
    if (config.mcpServers && config.mcpServers.length > 0) {
      this.mcpManager = new MCPManager();
    }
    if (config.templates) {
      for (const t of config.templates) {
        this.templates.set(t.id, t);
      }
    }
    if (config.slashCommands) {
      for (const cmd of config.slashCommands) {
        this.slashCommands.set(cmd.name, cmd);
      }
    }
  }

  /**
   * Called by VS Code when the webview view is resolved.
   * This is the WebviewViewProvider.resolveWebviewView implementation.
   */
  resolveWebviewView(webviewView: VSCodeWebviewView, _context?: unknown, _token?: unknown): void {
    this.view = webviewView;
    this.isReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView);

    const subscription = webviewView.webview.onDidReceiveMessage((msg: unknown) => {
      this.handleMessage(msg);
    });
    this.disposables.push(subscription);
  }

  /** Send a typed event to the webview */
  postToWebview(event: HostToWebviewEvent): void {
    this.view?.webview.postMessage(event);
  }

  /** Get the current active thread */
  getCurrentThread(): ChatThread {
    return this.threads.get(this.activeThreadId)!;
  }

  /** Get all threads */
  getAllThreads(): ChatThread[] {
    return Array.from(this.threads.values());
  }

  /** Get thread summaries for the thread list */
  getThreadSummaries(): ThreadSummary[] {
    return Array.from(this.threads.values())
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(toThreadSummary);
  }

  /** Whether the LLM is currently streaming a response */
  get isStreaming(): boolean {
    return this.streamingHandler.isStreaming;
  }

  /**
   * Returns a Promise that resolves when the webview has mounted and sent
   * its "ready" event. Resolves immediately if already ready.
   * Use this to avoid posting messages before the webview can process them.
   */
  waitForReady(): Promise<void> {
    if (this.isReady) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.readyResolvers.push(resolve);
    });
  }

  /** Handle an incoming message from the webview */
  private handleMessage(data: unknown): void {
    console.log("[vscode-ai-chat] Received message from webview:", JSON.stringify(data).slice(0, 200));

    if (!isWebviewToHostEvent(data)) {
      console.warn("[vscode-ai-chat] Message rejected by isWebviewToHostEvent guard");
      return;
    }

    const event = data as WebviewToHostEvent;
    console.log("[vscode-ai-chat] Dispatching event:", event.type);

    // Dispatch to handler — async handlers are caught to prevent unhandled rejections
    const maybePromise = this.dispatchEvent(event);
    if (maybePromise) {
      maybePromise.catch((error) => {
        console.error("[vscode-ai-chat] Unhandled error in event handler:", error);
      });
    }
  }

  private dispatchEvent(event: WebviewToHostEvent): Promise<void> | void {
    switch (event.type) {
      case "ready":
        return this.handleReady();
      case "sendMessage":
        return this.handleSendMessage(event.message);
      case "cancelGeneration":
        return this.handleCancelGeneration();
      case "createThread":
        return this.handleCreateThread();
      case "switchThread":
        return this.handleSwitchThread(event.threadId);
      case "deleteThread":
        return this.handleDeleteThread(event.threadId);
      case "switchModel":
        return this.handleSwitchModel(event.modelId);
      case "toolApproval":
        return this.handleToolApproval(event.toolCallId, event.approved, event.feedback);
      case "selectTemplate":
        return this.handleSelectTemplate(event.templateId);
      case "userAction":
        return this.handleUserAction(event.actionId, event.result);
      case "editMessage":
        return this.handleEditMessage(event.threadId, event.messageId, event.content);
      case "reloadMessage":
        return this.handleReloadMessage(event.messageId);
      case "exportThread":
        return this.handleExportThread(event.threadId, event.format);
      case "slashCommand":
        return this.handleSlashCommand(event.command, event.args);
      case "fileDrop":
        return this.handleFileDrop(event.files);
      case "contextMention":
        return this.handleContextMention(event.mentionType, event.query);
      default:
        break;
    }
  }

  private async handleReady(): Promise<void> {
    if (this.storage && !this.storageLoaded) {
      await this.loadFromStorage();
    }
    if (this.mcpManager && !this.mcpInitialized) {
      await this.initializeMCP();
    }
    this.postToWebview({
      type: "threadState",
      thread: this.getCurrentThread(),
    });
    this.postThreadList();

    // Send template list
    if (this.templates.size > 0) {
      this.postToWebview({
        type: "templateList",
        templates: Array.from(this.templates.values()).map((t) => ({
          id: t.id,
          label: t.label,
        })),
      });
    }

    // Send slash command list
    if (this.slashCommands.size > 0) {
      this.postSlashCommandList();
    }

    // Send config with available models
    if (this.config.models) {
      this.postToWebview({
        type: "configUpdate",
        config: {
          activeModel: this.config.ui?.activeModel ?? Object.keys(this.config.models)[0],
        },
      });
    }

    this.isReady = true;
    for (const resolve of this.readyResolvers) {
      resolve();
    }
    this.readyResolvers = [];
  }

  private async loadFromStorage(): Promise<void> {
    if (!this.storage) return;
    try {
      const summaries = await this.storage.listThreads();
      if (summaries.length > 0) {
        this.threads.clear();
        for (const summary of summaries) {
          const thread = await this.storage.loadThread(summary.id);
          if (thread) {
            this.threads.set(thread.id, thread);
          }
        }
        if (this.threads.size > 0) {
          // Switch to most recently updated thread
          const sorted = Array.from(this.threads.values()).sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          );
          this.activeThreadId = sorted[0]!.id;
        }
      }
    } catch {
      // Storage errors should not block the webview from loading
    }
    this.storageLoaded = true;
  }

  private async initializeMCP(): Promise<void> {
    if (!this.mcpManager || !this.config.mcpServers) return;
    try {
      await this.mcpManager.connect(this.config.mcpServers);
    } catch {
      // MCP errors should not block the chat from loading
    }
    this.mcpInitialized = true;
  }

  private async getMergedTools(): Promise<Record<string, import("ai").CoreTool> | undefined> {
    const localTools = this.config.tools;
    if (!this.mcpManager) return localTools;

    try {
      const mcpTools = await this.mcpManager.getTools();
      if (Object.keys(mcpTools).length === 0) return localTools;
      return { ...localTools, ...mcpTools };
    } catch {
      return localTools;
    }
  }

  private async handleSendMessage(message: ChatMessage): Promise<void> {
    console.log("[vscode-ai-chat] handleSendMessage called, message role:", message.role, "id:", message.id);
    const thread = this.getCurrentThread();
    console.log("[vscode-ai-chat] Current thread id:", thread.id, "messages count:", thread.messages.length);
    thread.messages.push(message);
    thread.updatedAt = new Date();

    // Post threadState immediately so the webview renders the user message
    // before any streaming starts (avoids race with onMessage hooks that
    // trigger pushStreamStart).
    this.postToWebview({ type: "threadState", thread });
    this.postThreadList();

    // Check onMessage hook before routing to LLM (runs in both managed and manual mode)
    if (this.config.onMessage) {
      const userText = message.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      let result: OnMessageResult;
      try {
        result = await this.config.onMessage(userText, thread);
      } catch (error) {
        console.error("[vscode-ai-chat] onMessage callback error:", error);
        // Persist the user message so it's not lost
        await this.persistThread(thread);
        this.postToWebview({
          type: "streamError",
          threadId: thread.id,
          error: `onMessage error: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }
      if (result !== "passthrough") {
        await this.persistThread(thread);
        return;
      }
    }

    // In manual mode (no model), just persist and notify — extension handles streaming
    if (!this.activeModel) {
      await this.persistThread(thread);
      this.postThreadList();
      return;
    }

    try {
      let tools = await this.getMergedTools();
      // Merge template tools if active
      if (this.activeTemplate?.tools) {
        tools = { ...tools, ...this.activeTemplate.tools };
      }
      if (tools && this.config.requiresApproval) {
        tools = this.wrapToolsForApproval(tools, thread.id);
      }
      const system = this.activeTemplate?.systemPrompt ?? this.systemPrompt;
      console.log("[vscode-ai-chat] Calling streamText with model:", (this.activeModel as Record<string, unknown>).modelId, "system prompt length:", system?.length ?? 0);
      const assistantMessage = await this.streamingHandler.handleSendMessage(
        thread.messages,
        {
          model: this.activeModel,
          system,
          tools,
          maxSteps: this.config.maxSteps,
          onToolResult: this.config.onToolResult,
        },
        (event) => {
          console.log("[vscode-ai-chat] Posting to webview:", event.type);
          this.postToWebview(event);
        },
        thread.id,
      );
      console.log("[vscode-ai-chat] Stream completed, assistant message id:", assistantMessage.id);
      thread.messages.push(assistantMessage);
      thread.updatedAt = new Date();
      await this.persistThread(thread);
      // Update thread list since title may derive from first message
      this.postThreadList();
    } catch (error) {
      console.error("[vscode-ai-chat] Error in handleSendMessage:", error);
    }
  }

  private async handleCancelGeneration(): Promise<void> {
    this.streamingHandler.cancel();
    if (this.config.onCancel) {
      await this.config.onCancel();
    }
  }

  private async handleCreateThread(): Promise<void> {
    const thread = createThread();
    this.threads.set(thread.id, thread);
    this.activeThreadId = thread.id;
    await this.persistThread(thread);

    this.postToWebview({
      type: "threadState",
      thread,
    });
    this.postThreadList();
  }

  private handleSwitchThread(threadId: string): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;

    // Cancel any in-progress generation
    if (this.streamingHandler.isStreaming) {
      this.streamingHandler.cancel();
    }

    this.activeThreadId = threadId;

    this.postToWebview({
      type: "threadState",
      thread,
    });
  }

  private async handleDeleteThread(threadId: string): Promise<void> {
    if (!this.threads.has(threadId)) return;

    // Don't delete the last thread
    if (this.threads.size <= 1) return;

    this.threads.delete(threadId);
    await this.storage?.deleteThread(threadId);

    // If we deleted the active thread, switch to the most recently updated one
    if (this.activeThreadId === threadId) {
      const remaining = Array.from(this.threads.values()).sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      );
      this.activeThreadId = remaining[0]!.id;

      this.postToWebview({
        type: "threadState",
        thread: remaining[0]!,
      });
    }

    this.postThreadList();
  }

  private handleSwitchModel(modelId: string): void {
    const factory = this.config.models?.[modelId];
    if (!factory) return;

    this.activeModel = factory();
    this.postToWebview({
      type: "configUpdate",
      config: { activeModel: modelId },
    });
  }

  private async handleEditMessage(
    _threadId: string,
    messageId: string,
    content: ChatContentPart[],
  ): Promise<void> {
    const thread = this.getCurrentThread();
    const msgIndex = thread.messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    // Cancel any in-progress generation
    if (this.streamingHandler.isStreaming) {
      this.streamingHandler.cancel();
    }

    // Update the message content and truncate everything after it
    thread.messages[msgIndex]!.content = content;
    thread.messages = thread.messages.slice(0, msgIndex + 1);
    thread.updatedAt = new Date();

    // Sync webview with the updated thread
    this.postToWebview({ type: "threadState", thread });
    await this.persistThread(thread);

    // If this was a user message, re-generate the assistant response
    if (thread.messages[msgIndex]!.role === "user") {
      await this.handleSendMessageFromHistory(thread);
    }
  }

  private async handleReloadMessage(messageId: string): Promise<void> {
    const thread = this.getCurrentThread();
    const msgIndex = thread.messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    // Cancel any in-progress generation
    if (this.streamingHandler.isStreaming) {
      this.streamingHandler.cancel();
    }

    // If this is an assistant message, truncate it and everything after
    // Then re-generate from the messages before it
    if (thread.messages[msgIndex]!.role === "assistant") {
      thread.messages = thread.messages.slice(0, msgIndex);
    } else {
      // For user messages, keep up to and including this message
      thread.messages = thread.messages.slice(0, msgIndex + 1);
    }
    thread.updatedAt = new Date();

    this.postToWebview({ type: "threadState", thread });
    await this.persistThread(thread);
    await this.handleSendMessageFromHistory(thread);
  }

  private async handleSendMessageFromHistory(thread: ChatThread): Promise<void> {
    // In manual mode, no auto-regeneration
    if (!this.activeModel) return;

    try {
      let tools = await this.getMergedTools();
      if (this.activeTemplate?.tools) {
        tools = { ...tools, ...this.activeTemplate.tools };
      }
      if (tools && this.config.requiresApproval) {
        tools = this.wrapToolsForApproval(tools, thread.id);
      }
      const system = this.activeTemplate?.systemPrompt ?? this.systemPrompt;
      const assistantMessage = await this.streamingHandler.handleSendMessage(
        thread.messages,
        {
          model: this.activeModel,
          system,
          tools,
          maxSteps: this.config.maxSteps,
          onToolResult: this.config.onToolResult,
        },
        (event) => this.postToWebview(event),
        thread.id,
      );
      thread.messages.push(assistantMessage);
      thread.updatedAt = new Date();
      await this.persistThread(thread);
      this.postThreadList();
    } catch (error) {
      console.error("[vscode-ai-chat] Error in handleSendMessageFromHistory:", error);
    }
  }

  private handleToolApproval(toolCallId: string, approved: boolean, feedback?: string): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (!pending) return;
    this.pendingApprovals.delete(toolCallId);
    pending.resolve({ approved, feedback });
  }

  private toolNeedsApproval(toolName: string): boolean {
    const config = this.config.requiresApproval;
    if (!config) return false;
    if (Array.isArray(config)) return config.includes(toolName);
    return config(toolName);
  }

  private wrapToolsForApproval(
    tools: Record<string, import("ai").CoreTool>,
    threadId: string,
  ): Record<string, import("ai").CoreTool> {
    const wrapped: Record<string, import("ai").CoreTool> = {};
    for (const [name, tool] of Object.entries(tools)) {
      if (!this.toolNeedsApproval(name)) {
        wrapped[name] = tool;
        continue;
      }

      const originalExecute = (tool as Record<string, unknown>).execute as
        | ((...args: unknown[]) => Promise<unknown>)
        | undefined;

      wrapped[name] = {
        ...tool,
        execute: async (...args: unknown[]) => {
          // Extract toolCallId from the call arguments
          // AI SDK passes { toolCallId, args } as first parameter to execute
          const callInfo = args[0] as Record<string, unknown>;
          const toolCallId = (callInfo?.toolCallId as string) ?? `tc-${Date.now()}`;
          const toolArgs = callInfo?.args ?? callInfo;

          // Post toolCall event to webview for approval
          this.postToWebview({
            type: "toolCall",
            threadId,
            toolCallId,
            toolName: name,
            args: toolArgs,
          });

          // Wait for approval from the webview
          const approvalResult = await new Promise<{
            approved: boolean;
            feedback?: string;
          }>((resolve) => {
            this.pendingApprovals.set(toolCallId, { resolve });
          });

          if (!approvalResult.approved) {
            const result = {
              denied: true,
              feedback: approvalResult.feedback ?? "Tool execution denied by user",
            };
            this.postToWebview({
              type: "toolResult",
              threadId,
              toolCallId,
              result,
            });
            return result;
          }

          // Execute the original tool
          if (originalExecute) {
            const result = await originalExecute(...args);
            this.postToWebview({
              type: "toolResult",
              threadId,
              toolCallId,
              result,
            });
            return result;
          }

          return { error: "No execute function defined for tool" };
        },
      } as import("ai").CoreTool;
    }
    return wrapped;
  }

  private handleSelectTemplate(templateId: string): void {
    const template = this.templates.get(templateId);
    if (!template) return;

    this.activeTemplate = template;
    if (template.model) {
      this.activeModel = template.model;
    }
  }

  /** Register a template at runtime */
  registerTemplate(template: ChatTemplate): void {
    this.templates.set(template.id, template);
    // Notify webview of updated template list
    if (this.view) {
      this.postToWebview({
        type: "templateList",
        templates: Array.from(this.templates.values()).map((t) => ({
          id: t.id,
          label: t.label,
        })),
      });
    }
  }

  /** Get all registered templates */
  getTemplates(): ChatTemplate[] {
    return Array.from(this.templates.values());
  }

  /** Get the currently active template */
  getActiveTemplate(): ChatTemplate | null {
    return this.activeTemplate;
  }

  private handleUserAction(actionId: string, result: unknown): void {
    const pending = this.pendingUserActions.get(actionId);
    if (!pending) return;
    this.pendingUserActions.delete(actionId);
    pending.resolve(result);
  }

  private handleExportThread(threadId: string, format: "json" | "markdown"): void {
    const thread = this.threads.get(threadId) ?? this.getCurrentThread();
    const exported = format === "json"
      ? exportThreadAsJSON(thread)
      : exportThreadAsMarkdown(thread);

    // Use VS Code API to save the file
    try {
      const vscode = require("vscode") as {
        window: {
          showSaveDialog: (options: unknown) => Promise<{ fsPath: string } | undefined>;
        };
        workspace: {
          fs: { writeFile: (uri: unknown, content: Uint8Array) => Promise<void> };
        };
        Uri: { file: (path: string) => unknown };
      };

      const ext = format === "json" ? "json" : "md";
      const title = thread.title ?? "conversation";
      const defaultName = `${title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50)}.${ext}`;

      vscode.window
        .showSaveDialog({
          defaultUri: vscode.Uri.file(defaultName),
          filters: {
            [format === "json" ? "JSON" : "Markdown"]: [ext],
          },
        })
        .then((uri) => {
          if (uri) {
            const encoder = new TextEncoder();
            vscode.workspace.fs.writeFile(uri, encoder.encode(exported));
          }
        });
    } catch {
      // If vscode module not available (testing), log the export
      console.log(`[vscode-ai-chat] Export (${format}):`, exported.slice(0, 200));
    }
  }

  private async handleSlashCommand(command: string, args: string): Promise<void> {
    const handler = this.slashCommands.get(command);
    if (!handler) {
      console.warn(`[vscode-ai-chat] Unknown slash command: /${command}`);
      return;
    }

    const context: SlashCommandContext = {
      threadId: this.activeThreadId,
      respond: (text: string) => {
        this.postSystemMessage([{ type: "text", text }]);
      },
      respondContent: (content: ChatContentPart[]) => {
        this.postSystemMessage(content);
      },
      progress: (text: string) => {
        this.postToWebview({
          type: "streamProgress",
          threadId: this.activeThreadId,
          text,
        });
      },
    };

    try {
      const result = await handler.execute(args, context);
      if (typeof result === "string" && result.length > 0) {
        // Post the result as a system message
        this.postSystemMessage([{ type: "text", text: result }]);
      }
    } catch (error) {
      console.error(`[vscode-ai-chat] Slash command /${command} error:`, error);
      this.postSystemMessage([{
        type: "text",
        text: `**Error running /${command}:** ${error instanceof Error ? error.message : String(error)}`,
      }]);
    }
  }

  private handleFileDrop(files: Array<{ name: string; mimeType: string; size: number; data: string }>): void {
    const thread = this.getCurrentThread();
    const contentParts: ChatContentPart[] = [];

    for (const file of files) {
      if (file.mimeType.startsWith("image/")) {
        contentParts.push({
          type: "image",
          data: file.data,
          mimeType: file.mimeType,
          alt: file.name,
        } as ImageContentPart);
      } else {
        // Try to decode text content for text-like files
        const isText = isTextMimeType(file.mimeType);
        const textContent = isText ? atob(file.data) : undefined;
        contentParts.push({
          type: "file",
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          textContent,
          data: isText ? undefined : file.data,
        } as FileContentPart);
      }
    }

    if (contentParts.length > 0) {
      const msg: ChatMessage = {
        id: `drop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "user",
        content: contentParts,
        createdAt: new Date(),
      };
      thread.messages.push(msg);
      thread.updatedAt = new Date();
      this.postToWebview({ type: "threadState", thread });
    }
  }

  private async handleContextMention(
    mentionType: "file" | "workspace" | "symbol",
    query: string,
  ): Promise<void> {
    const provider = this.config.contextMentionProvider;
    if (!provider) return;

    let items: Array<{ label: string; description?: string; value: string }> = [];

    try {
      switch (mentionType) {
        case "file":
          items = (await provider.resolveFile?.(query)) ?? [];
          break;
        case "workspace":
          items = (await provider.resolveWorkspace?.(query)) ?? [];
          break;
        case "symbol":
          items = (await provider.resolveSymbol?.(query)) ?? [];
          break;
      }
    } catch (error) {
      console.error(`[vscode-ai-chat] Context mention resolve error:`, error);
    }

    this.postToWebview({ type: "contextMentionResult", mentionType, items });
  }

  /** Register a slash command at runtime */
  registerSlashCommand(handler: SlashCommandHandler): void {
    this.slashCommands.set(handler.name, handler);
    this.postSlashCommandList();
  }

  /** Get all registered slash commands */
  getSlashCommands(): SlashCommandHandler[] {
    return Array.from(this.slashCommands.values());
  }

  /**
   * Inject a system message into the current chat thread from outside a chat session.
   * Workflows use this to post progress cards, approval requests, or result summaries.
   */
  postSystemMessage(content: ChatContentPart[]): void {
    const thread = this.getCurrentThread();
    const message: ChatMessage = {
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      content,
      createdAt: new Date(),
      metadata: { source: "system" },
    };
    thread.messages.push(message);
    thread.updatedAt = new Date();

    this.postToWebview({
      type: "threadState",
      thread,
    });
    this.persistThread(thread);
  }

  /**
   * Inject an assistant message into the current chat thread.
   * Unlike postSystemMessage, this creates a regular assistant message
   * without the system source metadata, so it renders like a normal
   * Claude response in the conversation.
   */
  postAssistantMessage(content: ChatContentPart[]): void {
    const thread = this.getCurrentThread();
    const message: ChatMessage = {
      id: `ast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      content,
      createdAt: new Date(),
    };
    thread.messages.push(message);
    thread.updatedAt = new Date();

    this.postToWebview({
      type: "threadState",
      thread,
    });
    this.persistThread(thread);
  }

  /**
   * Trigger an assistant response in manual mode by sending a prompt to the
   * onMessage hook, WITHOUT adding a user message to the thread or rendering
   * a user bubble in the chat.
   *
   * Use this when you need the assistant to respond without a preceding user
   * message (e.g., conversation kickoff after welcome content, auto-advancing
   * to the next step in a multi-step workflow).
   *
   * No-op if no onMessage hook is configured.
   */
  triggerAssistantResponse(prompt: string): void {
    if (!this.config.onMessage) return;

    const thread = this.getCurrentThread();

    // Sync webview state before onMessage triggers streaming
    this.postToWebview({ type: "threadState", thread });

    // Fire-and-forget — the hook routes to the bridge which handles
    // streaming via pushStreamStart/pushText/pushStreamEnd.
    // Wrap in .then() so sync throws from onMessage are caught by .catch().
    Promise.resolve()
      .then(() => this.config.onMessage!(prompt, thread))
      .catch((error) => {
        console.error("[vscode-ai-chat] triggerAssistantResponse onMessage error:", error);
        this.postToWebview({
          type: "streamError",
          threadId: thread.id,
          error: `onMessage error: ${error instanceof Error ? error.message : String(error)}`,
        });
      });
  }

  /**
   * Wait for the user to interact with a card (approve/reject/respond).
   * Returns a Promise that resolves when the user triggers a userAction event.
   */
  waitForUserAction(actionId: string): Promise<unknown> {
    return new Promise((resolve) => {
      this.pendingUserActions.set(actionId, { resolve });
    });
  }

  /** Get pending user action count (for testing) */
  get pendingUserActionCount(): number {
    return this.pendingUserActions.size;
  }

  /** Get pending approval count (for testing) */
  get pendingApprovalCount(): number {
    return this.pendingApprovals.size;
  }

  /** Get the list of available model IDs */
  getAvailableModelIds(): string[] {
    return this.config.models ? Object.keys(this.config.models) : [];
  }

  /** Get the currently active model (undefined in manual mode) */
  getActiveModel(): import("ai").LanguageModel | undefined {
    return this.activeModel;
  }

  // ── Manual streaming API ──────────────────────────────────────────
  // These methods allow extensions to drive the chat UI without going through streamText().
  // Use these in "manual mode" (no model configured) to push streaming content from
  // your own LLM backend, SDK bridge, or any other async data source.

  private manualStreamingMessageId: string | null = null;
  private manualStreamingContent: ChatContentPart[] = [];

  /**
   * Begin a new assistant message stream.
   * Call pushStreamDelta() to send content, then pushStreamEnd() to finish.
   * Returns the generated message ID.
   */
  pushStreamStart(): string {
    const messageId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.manualStreamingMessageId = messageId;
    this.manualStreamingContent = [];
    this.postToWebview({
      type: "streamStart",
      threadId: this.activeThreadId,
      messageId,
    });
    return messageId;
  }

  /**
   * Convenience shorthand for pushing a text delta.
   * Equivalent to pushStreamDelta({ type: "text", text }).
   */
  pushText(text: string): void {
    this.pushStreamDelta({ type: "text", text });
  }

  /**
   * Push a content delta to the current manual stream.
   * Typically called with { type: "text", text: "..." } for text chunks,
   * or use the pushText() shorthand for plain text.
   */
  pushStreamDelta(delta: ChatContentPart): void {
    if (!this.manualStreamingMessageId) {
      console.warn("[vscode-ai-chat] pushStreamDelta called without an active stream. Call pushStreamStart() first.");
      return;
    }
    // Accumulate content for persistence
    // Merge consecutive text deltas (same as webview-side logic)
    if (delta.type === "text" && this.manualStreamingContent.length > 0) {
      const last = this.manualStreamingContent[this.manualStreamingContent.length - 1]!;
      if (last.type === "text") {
        last.text += delta.text;
      } else {
        this.manualStreamingContent.push({ ...delta });
      }
    } else {
      this.manualStreamingContent.push({ ...delta });
    }
    this.postToWebview({
      type: "streamDelta",
      threadId: this.activeThreadId,
      messageId: this.manualStreamingMessageId,
      delta,
    });
  }

  /**
   * End the current manual stream and persist the completed message.
   */
  pushStreamEnd(usage?: TokenUsage): void {
    if (!this.manualStreamingMessageId) {
      console.warn("[vscode-ai-chat] pushStreamEnd called without an active stream.");
      return;
    }
    // Persist the completed assistant message to the thread
    const thread = this.getCurrentThread();
    const assistantMessage: ChatMessage = {
      id: this.manualStreamingMessageId,
      role: "assistant",
      content: this.manualStreamingContent,
      createdAt: new Date(),
    };
    thread.messages.push(assistantMessage);
    thread.updatedAt = new Date();
    this.persistThread(thread).catch((err) => {
      console.error("[vscode-ai-chat] Failed to persist manual stream message:", err);
    });
    this.postToWebview({
      type: "streamEnd",
      threadId: this.activeThreadId,
      messageId: this.manualStreamingMessageId,
      usage,
    });
    this.manualStreamingMessageId = null;
    this.manualStreamingContent = [];
  }

  /**
   * Signal an error in the current manual stream.
   * Optionally provide a classification code (e.g. "cancel", "auth", "rate-limit", "network")
   * so the webview can distinguish error types without parsing the message string.
   */
  pushStreamError(error: string, code?: string): void {
    // Persist partial content with error so it survives thread switches/reloads
    if (this.manualStreamingMessageId) {
      this.manualStreamingContent.push({ type: "text", text: `\n\n**Error:** ${error}` });
      const thread = this.getCurrentThread();
      const assistantMessage: ChatMessage = {
        id: this.manualStreamingMessageId,
        role: "assistant",
        content: this.manualStreamingContent,
        createdAt: new Date(),
      };
      thread.messages.push(assistantMessage);
      thread.updatedAt = new Date();
      this.persistThread(thread).catch((err) => {
        console.error("[vscode-ai-chat] Failed to persist manual stream error:", err);
      });
    }
    this.postToWebview({
      type: "streamError",
      threadId: this.activeThreadId,
      error,
      code,
    });
    this.manualStreamingMessageId = null;
    this.manualStreamingContent = [];
  }

  /**
   * Set a hint/placeholder in the composer input.
   * Use this after pushStreamEnd() to signal what the user should do next
   * (e.g. "Approve the changes above…" or "Provide your API key…").
   * Pass null to clear the hint and restore the default placeholder.
   */
  setInputHint(hint: string | null): void {
    this.postToWebview({
      type: "inputHint",
      hint,
    });
  }

  /**
   * Post a tool call card to the webview (manual mode).
   * Use this when your backend executes a tool and you want to show it in the chat.
   */
  pushToolCall(toolCallId: string, toolName: string, args: unknown): void {
    this.postToWebview({
      type: "toolCall",
      threadId: this.activeThreadId,
      toolCallId,
      toolName,
      args,
    });
  }

  /**
   * Post a tool result to the webview (manual mode).
   * Removes the pending tool call card from the UI.
   */
  pushToolResult(toolCallId: string, result: unknown): void {
    this.postToWebview({
      type: "toolResult",
      threadId: this.activeThreadId,
      toolCallId,
      result,
    });
  }

  /**
   * Post a tool call card and wait for user approval (manual mode).
   * Returns a Promise that resolves when the user approves or denies.
   * Use this for human-in-the-loop tool execution from external backends
   * (e.g. Claude Agent SDK, MCP tool servers).
   */
  requestToolApproval(
    toolCallId: string,
    toolName: string,
    args: unknown,
  ): Promise<{ approved: boolean; feedback?: string }> {
    this.postToWebview({
      type: "toolCall",
      threadId: this.activeThreadId,
      toolCallId,
      toolName,
      args,
    });
    return new Promise((resolve) => {
      this.pendingApprovals.set(toolCallId, { resolve });
    });
  }

  /**
   * Post a transient progress indicator to the chat.
   * Progress messages don't persist in the thread history.
   */
  pushProgress(text: string): void {
    this.postToWebview({
      type: "streamProgress",
      threadId: this.activeThreadId,
      text,
      messageId: this.manualStreamingMessageId ?? undefined,
    });
  }

  // ── Programmatic message & command API ──────────────────────────

  /**
   * Update the system prompt at runtime.
   * Takes effect on the next LLM request (does not affect in-flight streams).
   * Template system prompts still take priority when a template is active.
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * Programmatically send a user message as if the user typed it.
   * In managed mode (model configured), this triggers LLM streaming.
   * In manual mode, this adds the message to the thread for the extension to handle.
   */
  sendUserMessage(text: string): void {
    const message: ChatMessage = {
      id: `prog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      content: [{ type: "text", text }],
      createdAt: new Date(),
    };
    this.handleSendMessage(message);
  }

  /**
   * Programmatically execute a registered slash command.
   */
  executeSlashCommand(name: string, args: string = ""): void {
    this.handleSlashCommand(name, args);
  }

  private async persistThread(thread: ChatThread): Promise<void> {
    try {
      await this.storage?.saveThread(thread);
    } catch {
      // Persistence errors should not break the chat flow
    }
  }

  private postThreadList(): void {
    this.postToWebview({
      type: "threadList",
      threads: this.getThreadSummaries(),
    });
  }

  private postSlashCommandList(): void {
    this.postToWebview({
      type: "slashCommandList",
      commands: Array.from(this.slashCommands.values()).map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
      })),
    });
  }

  private getHtmlContent(webviewView: VSCodeWebviewView): string {
    const webview = webviewView.webview;
    const nonce = generateNonce();

    const Uri = this.getUriHelper();
    const scriptUri = webview
      .asWebviewUri(Uri.joinPath(this.extensionUri, "dist", "webview.js"))
      .toString();
    const styleUri = webview
      .asWebviewUri(Uri.joinPath(this.extensionUri, "dist", "webview.css"))
      .toString();

    return generateHtml({
      nonce,
      scriptUri,
      styleUri,
      cspSource: webview.cspSource,
      customCss: this.config.ui?.customCss,
    });
  }

  private getUriHelper(): VSCodeUriStatic {
    try {
      const vscode = require("vscode") as { Uri: VSCodeUriStatic };
      return vscode.Uri;
    } catch {
      return {
        joinPath(base: unknown, ...segments: string[]) {
          const basePath = (base as { fsPath: string }).fsPath ?? String(base);
          return { fsPath: [basePath, ...segments].join("/") };
        },
      };
    }
  }

  /** Clean up resources */
  dispose(): void {
    this.streamingHandler.cancel();
    this.mcpManager?.close();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml", "application/javascript", "application/typescript"];

function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}
