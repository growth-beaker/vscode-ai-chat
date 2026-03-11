import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatWebviewProvider } from "../ChatWebviewProvider.js";
import type { HostToWebviewEvent } from "@vscode-ai-chat/core";

// Mock the 'ai' module
vi.mock("ai", () => ({
  streamText: vi.fn(() => ({
    text: Promise.resolve("mocked response"),
    fullStream: (async function* () {})(),
  })),
}));

import { streamText } from "ai";
const mockStreamText = vi.mocked(streamText);

/** Helper to create a mock streamText result with fullStream async iterable */
function createMockResult(chunks: Array<Record<string, unknown>> = []) {
  async function* makeStream() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }
  return {
    fullStream: makeStream(),
    text: Promise.resolve(""),
  } as unknown as ReturnType<typeof streamText>;
}

/** Create a mock webview view matching VS Code's interface */
function createMockWebviewView() {
  const postedMessages: unknown[] = [];
  const messageHandlers: Array<(msg: unknown) => void> = [];

  return {
    postedMessages,
    messageHandlers,
    webview: {
      options: {} as Record<string, unknown>,
      html: "",
      cspSource: "https://test-webview",
      onDidReceiveMessage: vi.fn((handler: (msg: unknown) => void) => {
        messageHandlers.push(handler);
        return { dispose: vi.fn() };
      }),
      postMessage: vi.fn((msg: unknown) => {
        postedMessages.push(msg);
        return Promise.resolve(true);
      }),
      asWebviewUri: vi.fn((uri: unknown) => ({
        toString: () => `https://webview${(uri as { fsPath: string }).fsPath}`,
      })),
    },
    simulateMessage(msg: unknown) {
      for (const handler of messageHandlers) {
        handler(msg);
      }
    },
  };
}

function createMockExtensionUri() {
  return { fsPath: "/mock/extension" };
}

function createMockModel() {
  return { modelId: "test-model" } as never;
}

describe("ChatWebviewProvider", () => {
  let provider: ChatWebviewProvider;
  let mockView: ReturnType<typeof createMockWebviewView>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamText.mockImplementation(() => {
      return createMockResult([
        { type: "text-delta", textDelta: "Hi!" },
      ]);
    });

    provider = new ChatWebviewProvider(createMockExtensionUri(), {
      model: createMockModel(),
      system: "You are helpful.",
    });
    mockView = createMockWebviewView();
    provider.resolveWebviewView(mockView);
  });

  describe("resolveWebviewView", () => {
    it("enables scripts", () => {
      expect(mockView.webview.options.enableScripts).toBe(true);
    });

    it("sets localResourceRoots", () => {
      expect(mockView.webview.options.localResourceRoots).toEqual([{ fsPath: "/mock/extension" }]);
    });

    it("sets HTML content with CSP", () => {
      expect(mockView.webview.html).toContain("<!DOCTYPE html>");
      expect(mockView.webview.html).toContain('<div id="root"></div>');
      expect(mockView.webview.html).toContain("Content-Security-Policy");
      expect(mockView.webview.html).not.toContain("unsafe-eval");
      expect(mockView.webview.html).not.toContain("unsafe-inline");
    });

    it("includes script and style URIs", () => {
      expect(mockView.webview.html).toContain("webview.js");
      expect(mockView.webview.html).toContain("webview.css");
    });

    it("registers a message handler", () => {
      expect(mockView.webview.onDidReceiveMessage).toHaveBeenCalledOnce();
    });
  });

  describe("handleMessage", () => {
    it("responds to ready event with threadState and threadList", () => {
      mockView.simulateMessage({ type: "ready" });

      expect(mockView.postedMessages).toHaveLength(2);
      const stateEvent = mockView.postedMessages[0] as HostToWebviewEvent;
      expect(stateEvent.type).toBe("threadState");
      if (stateEvent.type === "threadState") {
        expect(stateEvent.thread.messages).toEqual([]);
        expect(stateEvent.thread.id).toBeDefined();
      }
      const listEvent = mockView.postedMessages[1] as HostToWebviewEvent;
      expect(listEvent.type).toBe("threadList");
      if (listEvent.type === "threadList") {
        expect(listEvent.threads).toHaveLength(1);
      }
    });

    it("ignores unknown event types", () => {
      mockView.simulateMessage({ type: "unknown_event" });
      expect(mockView.postedMessages).toHaveLength(0);
    });

    it("ignores non-object messages", () => {
      mockView.simulateMessage("not an object");
      mockView.simulateMessage(null);
      mockView.simulateMessage(42);
      expect(mockView.postedMessages).toHaveLength(0);
    });

    it("handles sendMessage by streaming LLM response", async () => {
      mockView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      });

      await vi.waitFor(() => {
        expect(mockStreamText).toHaveBeenCalledOnce();
      });

      await vi.waitFor(() => {
        const thread = provider.getCurrentThread();
        expect(thread.messages).toHaveLength(2);
        expect(thread.messages[0]!.role).toBe("user");
        expect(thread.messages[1]!.role).toBe("assistant");
      });
    });

    it("posts streamStart, streamDelta, and streamEnd events", async () => {
      mockView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      });

      await vi.waitFor(() => {
        const types = mockView.postedMessages.map((m) => (m as HostToWebviewEvent).type);
        expect(types).toContain("streamStart");
        expect(types).toContain("streamDelta");
        expect(types).toContain("streamEnd");
      });
    });

    it("posts streamError on LLM failure", async () => {
      mockStreamText.mockImplementation(() => {
        async function* errorStream() {
          throw new Error("API error");
        }
        return {
          fullStream: errorStream(),
          text: Promise.resolve(""),
        } as unknown as ReturnType<typeof streamText>;
      });

      mockView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      });

      await vi.waitFor(() => {
        const errorEvents = mockView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "streamError",
        );
        expect(errorEvents).toHaveLength(1);
      });
    });

    it("passes system prompt and model to streamText", async () => {
      mockView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      });

      await vi.waitFor(() => {
        expect(mockStreamText).toHaveBeenCalledWith(
          expect.objectContaining({
            system: "You are helpful.",
            model: expect.objectContaining({ modelId: "test-model" }),
          }),
        );
      });
    });
  });

  describe("cancelGeneration", () => {
    it("handles cancelGeneration event", () => {
      mockView.simulateMessage({ type: "cancelGeneration", threadId: "t1" });
      // No error means success — cancel is a no-op when not streaming
    });
  });

  describe("postToWebview", () => {
    it("sends events to the webview", () => {
      provider.postToWebview({
        type: "streamStart",
        threadId: "t1",
        messageId: "m1",
      });

      expect(mockView.webview.postMessage).toHaveBeenCalledWith({
        type: "streamStart",
        threadId: "t1",
        messageId: "m1",
      });
    });
  });

  describe("dispose", () => {
    it("disposes subscriptions and cancels streaming", () => {
      provider.dispose();
    });
  });

  describe("thread management", () => {
    it("creates a new thread on createThread event", async () => {
      const originalThreadId = provider.getCurrentThread().id;
      mockView.simulateMessage({ type: "createThread" });

      await vi.waitFor(() => {
        const newThread = provider.getCurrentThread();
        expect(newThread.id).not.toBe(originalThreadId);
        expect(newThread.messages).toEqual([]);
        expect(provider.getAllThreads()).toHaveLength(2);

        const threadStateEvents = mockView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "threadState",
        );
        expect(threadStateEvents.length).toBeGreaterThanOrEqual(1);

        const threadListEvents = mockView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "threadList",
        );
        expect(threadListEvents.length).toBeGreaterThanOrEqual(1);
      });
    });

    it("switches to an existing thread", async () => {
      // Create a second thread
      mockView.simulateMessage({ type: "createThread" });

      await vi.waitFor(() => {
        expect(provider.getAllThreads()).toHaveLength(2);
      });

      const secondThreadId = provider.getCurrentThread().id;
      const allThreads = provider.getAllThreads();
      const firstThreadId = allThreads.find((t) => t.id !== secondThreadId)!.id;

      // Switch back to the first thread
      mockView.postedMessages.length = 0;
      mockView.simulateMessage({ type: "switchThread", threadId: firstThreadId });

      expect(provider.getCurrentThread().id).toBe(firstThreadId);

      const stateEvent = mockView.postedMessages.find(
        (m) => (m as HostToWebviewEvent).type === "threadState",
      ) as HostToWebviewEvent & { type: "threadState" };
      expect(stateEvent).toBeDefined();
      expect(stateEvent.thread.id).toBe(firstThreadId);
    });

    it("ignores switchThread for non-existent thread", () => {
      const currentId = provider.getCurrentThread().id;
      mockView.postedMessages.length = 0;
      mockView.simulateMessage({ type: "switchThread", threadId: "nonexistent" });

      expect(provider.getCurrentThread().id).toBe(currentId);
      const stateEvents = mockView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "threadState",
      );
      expect(stateEvents).toHaveLength(0);
    });

    it("deletes a thread and switches to another", async () => {
      // Create a second thread
      mockView.simulateMessage({ type: "createThread" });

      await vi.waitFor(() => {
        expect(provider.getAllThreads()).toHaveLength(2);
      });

      const secondThreadId = provider.getCurrentThread().id;

      mockView.postedMessages.length = 0;
      mockView.simulateMessage({ type: "deleteThread", threadId: secondThreadId });

      await vi.waitFor(() => {
        expect(provider.getAllThreads()).toHaveLength(1);
        expect(provider.getCurrentThread().id).not.toBe(secondThreadId);
      });
    });

    it("does not delete the last remaining thread", () => {
      const threadId = provider.getCurrentThread().id;
      mockView.postedMessages.length = 0;
      mockView.simulateMessage({ type: "deleteThread", threadId });

      expect(provider.getAllThreads()).toHaveLength(1);
      expect(provider.getCurrentThread().id).toBe(threadId);
    });

    it("deleting a non-active thread does not switch", async () => {
      mockView.simulateMessage({ type: "createThread" });

      await vi.waitFor(() => {
        expect(provider.getAllThreads()).toHaveLength(2);
      });

      const activeThreadId = provider.getCurrentThread().id;
      const otherThread = provider.getAllThreads().find((t) => t.id !== activeThreadId)!;

      mockView.postedMessages.length = 0;
      mockView.simulateMessage({ type: "deleteThread", threadId: otherThread.id });

      await vi.waitFor(() => {
        expect(provider.getAllThreads()).toHaveLength(1);
      });

      expect(provider.getCurrentThread().id).toBe(activeThreadId);
    });

    it("getThreadSummaries returns sorted summaries", async () => {
      mockView.simulateMessage({ type: "createThread" });

      await vi.waitFor(() => {
        expect(provider.getAllThreads()).toHaveLength(2);
      });

      const summaries = provider.getThreadSummaries();
      expect(summaries).toHaveLength(2);
      expect(summaries[0]!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        summaries[1]!.updatedAt.getTime(),
      );
      expect(summaries[0]!.title).toBeDefined();
    });

    it("updates thread list after sendMessage", async () => {
      mockView.postedMessages.length = 0;
      mockView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      });

      await vi.waitFor(() => {
        const threadListEvents = mockView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "threadList",
        );
        expect(threadListEvents.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe("model switching", () => {
    it("switches model on switchModel event", () => {
      const model2 = { modelId: "model-2" } as never;
      const multiModelProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        models: {
          "model-1": () => createMockModel(),
          "model-2": () => model2,
        },
      });
      const multiView = createMockWebviewView();
      multiModelProvider.resolveWebviewView(multiView);

      multiView.simulateMessage({ type: "switchModel", modelId: "model-2" });

      const configEvents = multiView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "configUpdate",
      );
      expect(configEvents.length).toBeGreaterThanOrEqual(1);
      const lastConfig = configEvents[configEvents.length - 1] as HostToWebviewEvent & {
        type: "configUpdate";
      };
      expect(lastConfig.config.activeModel).toBe("model-2");
      expect(multiModelProvider.getActiveModel()).toBe(model2);
    });

    it("ignores unknown model ID", () => {
      const multiModelProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        models: { "model-1": () => createMockModel() },
      });
      const multiView = createMockWebviewView();
      multiModelProvider.resolveWebviewView(multiView);

      const originalModel = multiModelProvider.getActiveModel();
      multiView.simulateMessage({ type: "switchModel", modelId: "nonexistent" });
      expect(multiModelProvider.getActiveModel()).toBe(originalModel);
    });

    it("returns available model IDs", () => {
      const multiModelProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        models: {
          "claude-sonnet": () => createMockModel(),
          "gpt-4o": () => createMockModel(),
        },
      });
      expect(multiModelProvider.getAvailableModelIds()).toEqual(["claude-sonnet", "gpt-4o"]);
    });

    it("returns empty array when no models configured", () => {
      expect(provider.getAvailableModelIds()).toEqual([]);
    });

    it("uses switched model for subsequent messages", async () => {
      const model2 = { modelId: "model-2" } as never;
      const multiModelProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        models: { "model-2": () => model2 },
      });
      const multiView = createMockWebviewView();
      multiModelProvider.resolveWebviewView(multiView);

      multiView.simulateMessage({ type: "switchModel", modelId: "model-2" });
      multiView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      });

      await vi.waitFor(() => {
        expect(mockStreamText).toHaveBeenCalledWith(
          expect.objectContaining({
            model: model2,
          }),
        );
      });
    });
  });

  describe("tool approval (HITL)", () => {
    it("wraps tools requiring approval and posts toolCall event", async () => {
      let executeResolve: (() => void) | undefined;
      const executeMock = vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            executeResolve = () => resolve({ success: true });
          }),
      );

      // Mock streamText to call the tool's execute function
      mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
        const tools = opts.tools as Record<string, { execute?: (...args: unknown[]) => unknown }>;
        const deleteTool = tools?.["deleteFile"];
        if (deleteTool?.execute) {
          // Simulate AI SDK calling the tool
          const executePromise = deleteTool.execute({
            toolCallId: "tc-1",
            args: { path: "/foo.txt" },
          });
          // Store promise so we can await it
          (opts as Record<string, unknown>).__executePromise = executePromise;
        }
        return createMockResult();
      });

      const approvalProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        tools: {
          deleteFile: {
            description: "Delete a file",
            parameters: {},
            execute: executeMock,
          } as never,
        },
        requiresApproval: ["deleteFile"],
      });
      const approvalView = createMockWebviewView();
      approvalProvider.resolveWebviewView(approvalView);

      approvalView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Delete foo.txt" }],
        },
      });

      // Wait for toolCall event to be posted
      await vi.waitFor(() => {
        const toolCallEvents = approvalView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "toolCall",
        );
        expect(toolCallEvents.length).toBeGreaterThanOrEqual(1);
        const tc = toolCallEvents[0] as HostToWebviewEvent & { type: "toolCall" };
        expect(tc.toolName).toBe("deleteFile");
        expect(tc.toolCallId).toBe("tc-1");
        expect(tc.args).toEqual({ path: "/foo.txt" });
      });

      // Should have a pending approval
      expect(approvalProvider.pendingApprovalCount).toBe(1);

      // Clean up
      executeResolve?.();
    });

    it("executes tool after approval is granted", async () => {
      let toolExecuteResolve: ((result: unknown) => void) | undefined;
      const executeMock = vi.fn(() => new Promise((resolve) => (toolExecuteResolve = resolve)));

      let wrappedExecutePromise: Promise<unknown> | undefined;
      mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
        const tools = opts.tools as Record<string, { execute?: (...args: unknown[]) => unknown }>;
        const tool = tools?.["deleteFile"];
        if (tool?.execute) {
          wrappedExecutePromise = tool.execute({
            toolCallId: "tc-2",
            args: { path: "/bar.txt" },
          }) as Promise<unknown>;
        }
        return createMockResult();
      });

      const approvalProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        tools: {
          deleteFile: {
            description: "Delete a file",
            parameters: {},
            execute: executeMock,
          } as never,
        },
        requiresApproval: ["deleteFile"],
      });
      const approvalView = createMockWebviewView();
      approvalProvider.resolveWebviewView(approvalView);

      approvalView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Delete bar.txt" }],
        },
      });

      // Wait for the toolCall event
      await vi.waitFor(() => {
        expect(approvalProvider.pendingApprovalCount).toBe(1);
      });

      // Approve the tool call
      approvalView.simulateMessage({
        type: "toolApproval",
        toolCallId: "tc-2",
        approved: true,
      });

      // The original execute should now be called
      await vi.waitFor(() => {
        expect(executeMock).toHaveBeenCalled();
      });

      // Resolve the original execute
      toolExecuteResolve?.({ deleted: true });

      // Wait for toolResult event
      await vi.waitFor(() => {
        const resultEvents = approvalView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "toolResult",
        );
        expect(resultEvents.length).toBeGreaterThanOrEqual(1);
        const result = resultEvents[0] as HostToWebviewEvent & { type: "toolResult" };
        expect(result.result).toEqual({ deleted: true });
      });

      await wrappedExecutePromise;
    });

    it("returns denial result when tool is denied", async () => {
      let wrappedExecutePromise: Promise<unknown> | undefined;
      mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
        const tools = opts.tools as Record<string, { execute?: (...args: unknown[]) => unknown }>;
        const tool = tools?.["deleteFile"];
        if (tool?.execute) {
          wrappedExecutePromise = tool.execute({
            toolCallId: "tc-3",
            args: { path: "/secret.txt" },
          }) as Promise<unknown>;
        }
        return createMockResult();
      });

      const approvalProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        tools: {
          deleteFile: {
            description: "Delete a file",
            parameters: {},
            execute: vi.fn(),
          } as never,
        },
        requiresApproval: ["deleteFile"],
      });
      const approvalView = createMockWebviewView();
      approvalProvider.resolveWebviewView(approvalView);

      approvalView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Delete secret.txt" }],
        },
      });

      await vi.waitFor(() => {
        expect(approvalProvider.pendingApprovalCount).toBe(1);
      });

      // Deny the tool call
      approvalView.simulateMessage({
        type: "toolApproval",
        toolCallId: "tc-3",
        approved: false,
        feedback: "Not allowed",
      });

      const result = await wrappedExecutePromise;
      expect(result).toEqual({
        denied: true,
        feedback: "Not allowed",
      });

      // toolResult should be posted with denial
      await vi.waitFor(() => {
        const resultEvents = approvalView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "toolResult",
        );
        expect(resultEvents.length).toBeGreaterThanOrEqual(1);
      });
    });

    it("does not wrap tools that do not require approval", async () => {
      const executeMock = vi.fn(async () => ({ result: "ok" }));

      mockStreamText.mockImplementation(() => {
        return createMockResult([
          { type: "text-delta", textDelta: "Sure" },
        ]);
      });

      const approvalProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        tools: {
          safeRead: {
            description: "Read a file",
            parameters: {},
            execute: executeMock,
          } as never,
          dangerousDelete: {
            description: "Delete a file",
            parameters: {},
            execute: executeMock,
          } as never,
        },
        requiresApproval: ["dangerousDelete"],
      });
      const approvalView = createMockWebviewView();
      approvalProvider.resolveWebviewView(approvalView);

      approvalView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Read a file" }],
        },
      });

      await vi.waitFor(() => {
        expect(mockStreamText).toHaveBeenCalled();
      });

      // Verify tools passed to streamText: safeRead should not be wrapped
      const callArgs = mockStreamText.mock.calls[0]![0] as Record<string, unknown>;
      const passedTools = callArgs.tools as Record<string, { execute?: unknown }>;
      // safeRead's execute should be the original (not wrapped)
      expect(passedTools["safeRead"]!.execute).toBe(executeMock);
      // dangerousDelete's execute should be different (wrapped)
      expect(passedTools["dangerousDelete"]!.execute).not.toBe(executeMock);
    });

    it("supports predicate function for requiresApproval", () => {
      const approvalProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        tools: {
          readFile: { description: "Read", parameters: {} } as never,
          deleteFile: { description: "Delete", parameters: {} } as never,
        },
        requiresApproval: (name: string) => name.startsWith("delete"),
      });

      // Just verify it constructs without error
      expect(approvalProvider).toBeDefined();
    });

    it("ignores toolApproval for unknown toolCallId", () => {
      mockView.simulateMessage({
        type: "toolApproval",
        toolCallId: "nonexistent",
        approved: true,
      });
      // No error means success
      expect(provider.pendingApprovalCount).toBe(0);
    });
  });

  describe("custom CSS", () => {
    it("includes custom CSS in HTML when configured", () => {
      const customProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        ui: { customCss: ".test { color: blue; }" },
      });
      const customView = createMockWebviewView();
      customProvider.resolveWebviewView(customView);

      expect(customView.webview.html).toContain(".test { color: blue; }");
    });
  });

  describe("chat session templates", () => {
    it("sends templateList on ready when templates are configured", () => {
      const templateProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        templates: [
          { id: "prd", label: "Create PRD", systemPrompt: "You are a PRD writer." },
          { id: "review", label: "Code Review", systemPrompt: "You are a code reviewer." },
        ],
      });
      const templateView = createMockWebviewView();
      templateProvider.resolveWebviewView(templateView);

      templateView.simulateMessage({ type: "ready" });

      const templateEvents = templateView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "templateList",
      );
      expect(templateEvents.length).toBeGreaterThanOrEqual(1);
      const tl = templateEvents[0] as HostToWebviewEvent & { type: "templateList" };
      expect(tl.templates).toHaveLength(2);
      expect(tl.templates[0]!.id).toBe("prd");
      expect(tl.templates[1]!.label).toBe("Code Review");
    });

    it("selectTemplate sets the active template", () => {
      const templateProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        templates: [{ id: "prd", label: "Create PRD", systemPrompt: "You are a PRD writer." }],
      });
      const templateView = createMockWebviewView();
      templateProvider.resolveWebviewView(templateView);

      templateView.simulateMessage({ type: "selectTemplate", templateId: "prd" });

      expect(templateProvider.getActiveTemplate()?.id).toBe("prd");
    });

    it("uses template system prompt for messages", async () => {
      const templateProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        system: "Default system",
        templates: [{ id: "prd", label: "Create PRD", systemPrompt: "You are a PRD writer." }],
      });
      const templateView = createMockWebviewView();
      templateProvider.resolveWebviewView(templateView);

      templateView.simulateMessage({ type: "selectTemplate", templateId: "prd" });
      templateView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Write a PRD" }],
        },
      });

      await vi.waitFor(() => {
        expect(mockStreamText).toHaveBeenCalledWith(
          expect.objectContaining({ system: "You are a PRD writer." }),
        );
      });
    });

    it("registerTemplate adds a template at runtime", () => {
      const templateProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
      });
      const templateView = createMockWebviewView();
      templateProvider.resolveWebviewView(templateView);

      templateProvider.registerTemplate({
        id: "new-template",
        label: "New Template",
        systemPrompt: "New prompt",
      });

      expect(templateProvider.getTemplates()).toHaveLength(1);
      expect(templateProvider.getTemplates()[0]!.id).toBe("new-template");

      // Should send templateList to webview
      const templateEvents = templateView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "templateList",
      );
      expect(templateEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("ignores selectTemplate for unknown template", () => {
      mockView.simulateMessage({ type: "selectTemplate", templateId: "nonexistent" });
      expect(provider.getActiveTemplate()).toBeNull();
    });
  });

  describe("workflow HITL bridge", () => {
    it("postSystemMessage injects a message and syncs webview", () => {
      provider.postSystemMessage([{ type: "text", text: "Build started" }]);

      const thread = provider.getCurrentThread();
      const lastMsg = thread.messages[thread.messages.length - 1]!;
      expect(lastMsg.role).toBe("assistant");
      expect(lastMsg.content).toEqual([{ type: "text", text: "Build started" }]);
      expect(lastMsg.metadata?.source).toBe("system");

      const stateEvents = mockView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "threadState",
      );
      expect(stateEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("postSystemMessage with data parts", () => {
      provider.postSystemMessage([{ type: "data", name: "progress", data: { step: 1, total: 5 } }]);

      const thread = provider.getCurrentThread();
      const lastMsg = thread.messages[thread.messages.length - 1]!;
      expect(lastMsg.content[0]!.type).toBe("data");
    });

    it("waitForUserAction resolves when userAction event arrives", async () => {
      const actionPromise = provider.waitForUserAction("approval-123");
      expect(provider.pendingUserActionCount).toBe(1);

      mockView.simulateMessage({
        type: "userAction",
        actionId: "approval-123",
        result: { approved: true },
      });

      const result = await actionPromise;
      expect(result).toEqual({ approved: true });
      expect(provider.pendingUserActionCount).toBe(0);
    });

    it("ignores userAction for unknown actionId", () => {
      mockView.simulateMessage({
        type: "userAction",
        actionId: "nonexistent",
        result: {},
      });
      expect(provider.pendingUserActionCount).toBe(0);
    });
  });

  describe("message editing", () => {
    it("handles editMessage by truncating and updating", async () => {
      // Add some messages first
      mockView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      });

      await vi.waitFor(() => {
        expect(provider.getCurrentThread().messages).toHaveLength(2);
      });

      mockView.postedMessages.length = 0;
      mockView.simulateMessage({
        type: "editMessage",
        threadId: "t1",
        messageId: "m1",
        content: [{ type: "text", text: "Hello edited" }],
      });

      await vi.waitFor(() => {
        const thread = provider.getCurrentThread();
        // After edit: the edited user message + new assistant response
        expect(thread.messages[0]!.content).toEqual([{ type: "text", text: "Hello edited" }]);
      });

      // Should have re-generated (called streamText again)
      await vi.waitFor(() => {
        expect(mockStreamText.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    });

    it("handles reloadMessage for assistant message", async () => {
      mockView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      });

      await vi.waitFor(() => {
        const msgs = provider.getCurrentThread().messages;
        expect(msgs).toHaveLength(2);
      });

      const assistantMsgId = provider.getCurrentThread().messages[1]!.id;
      mockView.postedMessages.length = 0;

      mockView.simulateMessage({
        type: "reloadMessage",
        threadId: "t1",
        messageId: assistantMsgId,
      });

      // Should re-generate
      await vi.waitFor(() => {
        expect(mockStreamText.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    });

    it("ignores editMessage for unknown messageId", () => {
      mockView.postedMessages.length = 0;
      mockView.simulateMessage({
        type: "editMessage",
        threadId: "t1",
        messageId: "nonexistent",
        content: [{ type: "text", text: "edited" }],
      });
      // No threadState event should be posted
      const stateEvents = mockView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "threadState",
      );
      expect(stateEvents).toHaveLength(0);
    });
  });

  describe("persistence", () => {
    function createMockStorage() {
      const threads = new Map<string, import("@vscode-ai-chat/core").ChatThread>();
      return {
        threads,
        listThreads: vi.fn(async () =>
          Array.from(threads.values()).map((t) => ({
            id: t.id,
            title: t.title ?? "Untitled",
            updatedAt: t.updatedAt,
          })),
        ),
        loadThread: vi.fn(async (id: string) => threads.get(id)),
        saveThread: vi.fn(async (thread: import("@vscode-ai-chat/core").ChatThread) => {
          threads.set(thread.id, thread);
        }),
        deleteThread: vi.fn(async (id: string) => {
          threads.delete(id);
        }),
      };
    }

    it("loads threads from storage on first ready event", async () => {
      const mockStorage = createMockStorage();
      mockStorage.threads.set("stored-t1", {
        id: "stored-t1",
        title: "Stored Thread",
        messages: [{ id: "m1", role: "user", content: [{ type: "text", text: "hi" }] }],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const persistentProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        persistence: { type: "custom", storage: mockStorage },
      });
      const persistentView = createMockWebviewView();
      persistentProvider.resolveWebviewView(persistentView);

      persistentView.simulateMessage({ type: "ready" });

      await vi.waitFor(() => {
        expect(mockStorage.listThreads).toHaveBeenCalled();
      });

      await vi.waitFor(() => {
        const stateEvents = persistentView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "threadState",
        );
        expect(stateEvents).toHaveLength(1);
        const state = stateEvents[0] as HostToWebviewEvent & { type: "threadState" };
        expect(state.thread.id).toBe("stored-t1");
      });
    });

    it("saves thread after sendMessage completes", async () => {
      const mockStorage = createMockStorage();
      const persistentProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        persistence: { type: "custom", storage: mockStorage },
      });
      const persistentView = createMockWebviewView();
      persistentProvider.resolveWebviewView(persistentView);

      persistentView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      });

      await vi.waitFor(() => {
        expect(mockStorage.saveThread).toHaveBeenCalled();
      });
    });

    it("saves thread on createThread", async () => {
      const mockStorage = createMockStorage();
      const persistentProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        persistence: { type: "custom", storage: mockStorage },
      });
      const persistentView = createMockWebviewView();
      persistentProvider.resolveWebviewView(persistentView);

      persistentView.simulateMessage({ type: "createThread" });

      await vi.waitFor(() => {
        expect(mockStorage.saveThread).toHaveBeenCalled();
      });
    });

    it("calls deleteThread on storage when deleting", async () => {
      const mockStorage = createMockStorage();
      const persistentProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        persistence: { type: "custom", storage: mockStorage },
      });
      const persistentView = createMockWebviewView();
      persistentProvider.resolveWebviewView(persistentView);

      // Create a second thread so deletion is allowed
      persistentView.simulateMessage({ type: "createThread" });
      const threadToDelete = persistentProvider.getCurrentThread().id;

      await vi.waitFor(() => {
        expect(mockStorage.saveThread).toHaveBeenCalled();
      });

      persistentView.simulateMessage({ type: "deleteThread", threadId: threadToDelete });

      await vi.waitFor(() => {
        expect(mockStorage.deleteThread).toHaveBeenCalledWith(threadToDelete);
      });
    });
  });

  describe("exportThread", () => {
    it("handles exportThread event for JSON format without error", () => {
      // Add a message to the thread so export has content
      const thread = provider.getCurrentThread();
      thread.messages.push({
        id: "m1",
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      });

      // Should not throw — the handler catches vscode require errors
      mockView.simulateMessage({
        type: "exportThread",
        threadId: thread.id,
        format: "json",
      });
    });

    it("handles exportThread event for markdown format without error", () => {
      const thread = provider.getCurrentThread();
      thread.messages.push({
        id: "m1",
        role: "assistant",
        content: [{ type: "text", text: "Hi there!" }],
      });

      mockView.simulateMessage({
        type: "exportThread",
        threadId: thread.id,
        format: "markdown",
      });
    });

    it("falls back to current thread when threadId is unknown", () => {
      const thread = provider.getCurrentThread();
      thread.messages.push({
        id: "m1",
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      });

      // Non-existent threadId should fall back to current thread
      mockView.simulateMessage({
        type: "exportThread",
        threadId: "nonexistent-thread",
        format: "json",
      });
      // No error means it exported the current thread
    });
  });

  describe("slashCommand", () => {
    it("executes a registered slash command", async () => {
      const executeMock = vi.fn(async () => "Command result");
      const cmdProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        slashCommands: [
          { name: "help", description: "Show help", execute: executeMock },
        ],
      });
      const cmdView = createMockWebviewView();
      cmdProvider.resolveWebviewView(cmdView);

      cmdView.simulateMessage({
        type: "slashCommand",
        threadId: "t1",
        command: "help",
        args: "topic",
      });

      await vi.waitFor(() => {
        expect(executeMock).toHaveBeenCalledWith("topic", expect.objectContaining({ threadId: expect.any(String) }));
      });
    });

    it("posts system message when slash command returns a string", async () => {
      const cmdProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        slashCommands: [
          { name: "ping", description: "Ping", execute: async () => "pong" },
        ],
      });
      const cmdView = createMockWebviewView();
      cmdProvider.resolveWebviewView(cmdView);

      cmdView.simulateMessage({
        type: "slashCommand",
        threadId: "t1",
        command: "ping",
        args: "",
      });

      await vi.waitFor(() => {
        const thread = cmdProvider.getCurrentThread();
        const lastMsg = thread.messages[thread.messages.length - 1];
        expect(lastMsg).toBeDefined();
        expect(lastMsg!.role).toBe("assistant");
        expect(lastMsg!.content[0]).toEqual({ type: "text", text: "pong" });
      });
    });

    it("ignores unknown slash commands", async () => {
      mockView.simulateMessage({
        type: "slashCommand",
        threadId: "t1",
        command: "nonexistent",
        args: "",
      });

      // No error, no messages added
      await vi.waitFor(() => {
        const thread = provider.getCurrentThread();
        expect(thread.messages).toHaveLength(0);
      });
    });

    it("posts error system message on slash command failure", async () => {
      const cmdProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        slashCommands: [
          {
            name: "fail",
            description: "Will fail",
            execute: async () => { throw new Error("boom"); },
          },
        ],
      });
      const cmdView = createMockWebviewView();
      cmdProvider.resolveWebviewView(cmdView);

      cmdView.simulateMessage({
        type: "slashCommand",
        threadId: "t1",
        command: "fail",
        args: "",
      });

      await vi.waitFor(() => {
        const thread = cmdProvider.getCurrentThread();
        const lastMsg = thread.messages[thread.messages.length - 1];
        expect(lastMsg).toBeDefined();
        expect(lastMsg!.content[0]).toEqual(
          expect.objectContaining({ type: "text", text: expect.stringContaining("boom") }),
        );
      });
    });

    it("registerSlashCommand adds a command at runtime", () => {
      provider.registerSlashCommand({
        name: "test",
        description: "Test command",
        execute: async () => "ok",
      });

      expect(provider.getSlashCommands()).toHaveLength(1);
      expect(provider.getSlashCommands()[0]!.name).toBe("test");

      // Should send slashCommandList to webview
      const cmdListEvents = mockView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "slashCommandList",
      );
      expect(cmdListEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("sends slashCommandList on ready when commands are configured", () => {
      const cmdProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        slashCommands: [
          { name: "help", description: "Show help", execute: async () => {} },
          { name: "clear", description: "Clear chat", execute: async () => {} },
        ],
      });
      const cmdView = createMockWebviewView();
      cmdProvider.resolveWebviewView(cmdView);

      cmdView.simulateMessage({ type: "ready" });

      const cmdListEvents = cmdView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "slashCommandList",
      );
      expect(cmdListEvents.length).toBeGreaterThanOrEqual(1);
      const listEvent = cmdListEvents[0] as HostToWebviewEvent & { type: "slashCommandList" };
      expect(listEvent.commands).toHaveLength(2);
      expect(listEvent.commands[0]!.name).toBe("help");
      expect(listEvent.commands[1]!.name).toBe("clear");
    });
  });

  describe("fileDrop", () => {
    it("creates a user message with image content for image files", () => {
      mockView.simulateMessage({
        type: "fileDrop",
        threadId: "t1",
        files: [
          {
            name: "screenshot.png",
            mimeType: "image/png",
            size: 4096,
            data: "iVBORw0KGgoAAAANS",
          },
        ],
      });

      const thread = provider.getCurrentThread();
      expect(thread.messages).toHaveLength(1);
      const msg = thread.messages[0]!;
      expect(msg.role).toBe("user");
      expect(msg.content[0]).toEqual(
        expect.objectContaining({
          type: "image",
          data: "iVBORw0KGgoAAAANS",
          mimeType: "image/png",
          alt: "screenshot.png",
        }),
      );
    });

    it("creates a user message with file content for text files", () => {
      // btoa("const x = 1;") = "Y29uc3QgeCA9IDE7"
      mockView.simulateMessage({
        type: "fileDrop",
        threadId: "t1",
        files: [
          {
            name: "code.ts",
            mimeType: "text/typescript",
            size: 14,
            data: btoa("const x = 1;"),
          },
        ],
      });

      const thread = provider.getCurrentThread();
      expect(thread.messages).toHaveLength(1);
      const msg = thread.messages[0]!;
      expect(msg.role).toBe("user");
      const filePart = msg.content[0]!;
      expect(filePart.type).toBe("file");
      if (filePart.type === "file") {
        expect(filePart.name).toBe("code.ts");
        expect(filePart.textContent).toBe("const x = 1;");
        expect(filePart.data).toBeUndefined();
      }
    });

    it("handles binary non-image files", () => {
      mockView.simulateMessage({
        type: "fileDrop",
        threadId: "t1",
        files: [
          {
            name: "archive.zip",
            mimeType: "application/zip",
            size: 8192,
            data: "UEsDBBQAAAA",
          },
        ],
      });

      const thread = provider.getCurrentThread();
      expect(thread.messages).toHaveLength(1);
      const filePart = thread.messages[0]!.content[0]!;
      expect(filePart.type).toBe("file");
      if (filePart.type === "file") {
        expect(filePart.textContent).toBeUndefined();
        expect(filePart.data).toBe("UEsDBBQAAAA");
      }
    });

    it("handles multiple files in one drop", () => {
      mockView.simulateMessage({
        type: "fileDrop",
        threadId: "t1",
        files: [
          { name: "photo.jpg", mimeType: "image/jpeg", size: 2048, data: "/9j/4AAQ" },
          { name: "readme.md", mimeType: "text/markdown", size: 256, data: btoa("# Hello") },
        ],
      });

      const thread = provider.getCurrentThread();
      expect(thread.messages).toHaveLength(1);
      const msg = thread.messages[0]!;
      expect(msg.content).toHaveLength(2);
      expect(msg.content[0]!.type).toBe("image");
      expect(msg.content[1]!.type).toBe("file");
    });

    it("posts threadState after file drop", () => {
      mockView.postedMessages.length = 0;
      mockView.simulateMessage({
        type: "fileDrop",
        threadId: "t1",
        files: [
          { name: "test.txt", mimeType: "text/plain", size: 5, data: btoa("hello") },
        ],
      });

      const stateEvents = mockView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "threadState",
      );
      expect(stateEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("does nothing for empty file list", () => {
      mockView.postedMessages.length = 0;
      mockView.simulateMessage({
        type: "fileDrop",
        threadId: "t1",
        files: [],
      });

      const thread = provider.getCurrentThread();
      expect(thread.messages).toHaveLength(0);
      const stateEvents = mockView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "threadState",
      );
      expect(stateEvents).toHaveLength(0);
    });

    it("recognizes application/json as text mime type", () => {
      mockView.simulateMessage({
        type: "fileDrop",
        threadId: "t1",
        files: [
          { name: "data.json", mimeType: "application/json", size: 20, data: btoa('{"key": "value"}') },
        ],
      });

      const thread = provider.getCurrentThread();
      const filePart = thread.messages[0]!.content[0]!;
      expect(filePart.type).toBe("file");
      if (filePart.type === "file") {
        expect(filePart.textContent).toBe('{"key": "value"}');
      }
    });
  });

  describe("contextMention", () => {
    it("sends contextMentionResult for file mentions", async () => {
      const mentionProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        contextMentionProvider: {
          resolveFile: async (_query) => [
            { label: "main.ts", description: "src/main.ts", value: "const x = 1;" },
          ],
        },
      });
      const mentionView = createMockWebviewView();
      mentionProvider.resolveWebviewView(mentionView);

      mentionView.simulateMessage({
        type: "contextMention",
        threadId: "t1",
        mentionType: "file",
        query: "main",
      });

      await vi.waitFor(() => {
        const resultEvents = mentionView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "contextMentionResult",
        );
        expect(resultEvents.length).toBeGreaterThanOrEqual(1);
        const result = resultEvents[0] as HostToWebviewEvent & { type: "contextMentionResult" };
        expect(result.mentionType).toBe("file");
        expect(result.items).toHaveLength(1);
        expect(result.items[0]!.label).toBe("main.ts");
      });
    });

    it("sends contextMentionResult for workspace mentions", async () => {
      const mentionProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        contextMentionProvider: {
          resolveWorkspace: async () => [
            { label: "project", value: "project info" },
          ],
        },
      });
      const mentionView = createMockWebviewView();
      mentionProvider.resolveWebviewView(mentionView);

      mentionView.simulateMessage({
        type: "contextMention",
        threadId: "t1",
        mentionType: "workspace",
        query: "proj",
      });

      await vi.waitFor(() => {
        const resultEvents = mentionView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "contextMentionResult",
        );
        expect(resultEvents.length).toBeGreaterThanOrEqual(1);
        const result = resultEvents[0] as HostToWebviewEvent & { type: "contextMentionResult" };
        expect(result.mentionType).toBe("workspace");
      });
    });

    it("sends contextMentionResult for symbol mentions", async () => {
      const mentionProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        contextMentionProvider: {
          resolveSymbol: async () => [
            { label: "MyClass", description: "class", value: "class MyClass {}" },
          ],
        },
      });
      const mentionView = createMockWebviewView();
      mentionProvider.resolveWebviewView(mentionView);

      mentionView.simulateMessage({
        type: "contextMention",
        threadId: "t1",
        mentionType: "symbol",
        query: "MyClass",
      });

      await vi.waitFor(() => {
        const resultEvents = mentionView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "contextMentionResult",
        );
        expect(resultEvents.length).toBeGreaterThanOrEqual(1);
      });
    });

    it("sends empty items when no provider is configured", async () => {
      // Default provider has no contextMentionProvider
      mockView.postedMessages.length = 0;
      mockView.simulateMessage({
        type: "contextMention",
        threadId: "t1",
        mentionType: "file",
        query: "test",
      });

      // Without a provider, it should not post any contextMentionResult
      // (the handler returns early when provider is undefined)
      await new Promise((r) => setTimeout(r, 50));
      const resultEvents = mockView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "contextMentionResult",
      );
      expect(resultEvents).toHaveLength(0);
    });

    it("sends empty items when provider method is undefined for mention type", async () => {
      const mentionProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        contextMentionProvider: {
          // Only resolveFile is defined; workspace and symbol are undefined
          resolveFile: async () => [{ label: "a", value: "b" }],
        },
      });
      const mentionView = createMockWebviewView();
      mentionProvider.resolveWebviewView(mentionView);

      mentionView.simulateMessage({
        type: "contextMention",
        threadId: "t1",
        mentionType: "workspace",
        query: "proj",
      });

      await vi.waitFor(() => {
        const resultEvents = mentionView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "contextMentionResult",
        );
        expect(resultEvents.length).toBeGreaterThanOrEqual(1);
        const result = resultEvents[0] as HostToWebviewEvent & { type: "contextMentionResult" };
        expect(result.items).toEqual([]);
      });
    });

    it("handles resolve errors gracefully", async () => {
      const mentionProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        contextMentionProvider: {
          resolveFile: async () => { throw new Error("resolve failed"); },
        },
      });
      const mentionView = createMockWebviewView();
      mentionProvider.resolveWebviewView(mentionView);

      mentionView.simulateMessage({
        type: "contextMention",
        threadId: "t1",
        mentionType: "file",
        query: "test",
      });

      await vi.waitFor(() => {
        const resultEvents = mentionView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "contextMentionResult",
        );
        expect(resultEvents.length).toBeGreaterThanOrEqual(1);
        const result = resultEvents[0] as HostToWebviewEvent & { type: "contextMentionResult" };
        expect(result.items).toEqual([]);
      });
    });
  });

  describe("manual mode (no model)", () => {
    it("creates provider without a model", () => {
      const manualProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        ui: { title: "Manual Chat" },
      });
      expect(manualProvider.getActiveModel()).toBeUndefined();
    });

    it("does not call streamText when sending a message in manual mode", async () => {
      const manualProvider = new ChatWebviewProvider(createMockExtensionUri(), {});
      const manualView = createMockWebviewView();
      manualProvider.resolveWebviewView(manualView);

      mockStreamText.mockClear();
      manualView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      });

      // Give it time to process
      await vi.waitFor(() => {
        const thread = manualProvider.getCurrentThread();
        expect(thread.messages).toHaveLength(1);
        expect(thread.messages[0]!.role).toBe("user");
      });

      // streamText should NOT have been called
      expect(mockStreamText).not.toHaveBeenCalled();
    });

    it("pushStreamStart/Delta/End sends correct events", () => {
      const manualProvider = new ChatWebviewProvider(createMockExtensionUri(), {});
      const manualView = createMockWebviewView();
      manualProvider.resolveWebviewView(manualView);

      const messageId = manualProvider.pushStreamStart();
      expect(messageId).toBeDefined();

      const startEvent = manualView.postedMessages.find(
        (m) => (m as HostToWebviewEvent).type === "streamStart",
      ) as HostToWebviewEvent & { type: "streamStart" };
      expect(startEvent).toBeDefined();
      expect(startEvent.messageId).toBe(messageId);

      manualProvider.pushStreamDelta({ type: "text", text: "Hello" });
      const deltaEvent = manualView.postedMessages.find(
        (m) => (m as HostToWebviewEvent).type === "streamDelta",
      ) as HostToWebviewEvent & { type: "streamDelta" };
      expect(deltaEvent).toBeDefined();
      expect(deltaEvent.delta).toEqual({ type: "text", text: "Hello" });

      manualProvider.pushStreamEnd({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
      const endEvent = manualView.postedMessages.find(
        (m) => (m as HostToWebviewEvent).type === "streamEnd",
      ) as HostToWebviewEvent & { type: "streamEnd" };
      expect(endEvent).toBeDefined();
      expect(endEvent.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    });

    it("pushStreamError sends error event and resets stream", () => {
      const manualProvider = new ChatWebviewProvider(createMockExtensionUri(), {});
      const manualView = createMockWebviewView();
      manualProvider.resolveWebviewView(manualView);

      manualProvider.pushStreamStart();
      manualProvider.pushStreamError("Something went wrong");

      const errorEvent = manualView.postedMessages.find(
        (m) => (m as HostToWebviewEvent).type === "streamError",
      ) as HostToWebviewEvent & { type: "streamError" };
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toBe("Something went wrong");

      // Delta after error should warn (no active stream)
      manualProvider.pushStreamDelta({ type: "text", text: "test" });
      // Should not add another streamDelta since stream was reset
      const deltas = manualView.postedMessages.filter(
        (m) => (m as HostToWebviewEvent).type === "streamDelta",
      );
      expect(deltas).toHaveLength(0);
    });

    it("pushProgress sends streamProgress event", () => {
      const manualProvider = new ChatWebviewProvider(createMockExtensionUri(), {});
      const manualView = createMockWebviewView();
      manualProvider.resolveWebviewView(manualView);

      manualProvider.pushProgress("Loading...");

      const progressEvent = manualView.postedMessages.find(
        (m) => (m as HostToWebviewEvent).type === "streamProgress",
      ) as HostToWebviewEvent & { type: "streamProgress" };
      expect(progressEvent).toBeDefined();
      expect(progressEvent.text).toBe("Loading...");
    });
  });

  describe("onMessage hook", () => {
    it("intercepts messages and prevents LLM call when handled", async () => {
      const onMessage = vi.fn().mockResolvedValue({ handled: true });
      const hookProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        onMessage,
      });
      const hookView = createMockWebviewView();
      hookProvider.resolveWebviewView(hookView);

      mockStreamText.mockClear();
      hookView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "intercepted" }],
        },
      });

      await vi.waitFor(() => {
        expect(onMessage).toHaveBeenCalledWith("intercepted", expect.any(Object));
      });

      // streamText should not have been called
      expect(mockStreamText).not.toHaveBeenCalled();
    });

    it("passes through to LLM when returning passthrough", async () => {
      const onMessage = vi.fn().mockResolvedValue("passthrough");
      const hookProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        onMessage,
      });
      const hookView = createMockWebviewView();
      hookProvider.resolveWebviewView(hookView);

      hookView.simulateMessage({
        type: "sendMessage",
        threadId: "t1",
        message: {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "pass through" }],
        },
      });

      await vi.waitFor(() => {
        expect(mockStreamText).toHaveBeenCalled();
      });
    });
  });

  describe("onCancel callback", () => {
    it("calls onCancel when generation is cancelled", async () => {
      const onCancel = vi.fn();
      const cancelProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        onCancel,
      });
      const cancelView = createMockWebviewView();
      cancelProvider.resolveWebviewView(cancelView);

      cancelView.simulateMessage({ type: "cancelGeneration", threadId: "t1" });

      await vi.waitFor(() => {
        expect(onCancel).toHaveBeenCalledOnce();
      });
    });
  });

  describe("programmatic API", () => {
    it("sendUserMessage triggers handleSendMessage", async () => {
      provider.sendUserMessage("Hello from code");

      await vi.waitFor(() => {
        const thread = provider.getCurrentThread();
        const userMessages = thread.messages.filter((m) => m.role === "user");
        expect(userMessages).toHaveLength(1);
        expect(userMessages[0]!.content[0]).toEqual({ type: "text", text: "Hello from code" });
      });
    });

    it("executeSlashCommand runs a registered command", async () => {
      const executeFn = vi.fn().mockResolvedValue("Command executed");
      provider.registerSlashCommand({
        name: "test",
        description: "Test command",
        execute: executeFn,
      });

      provider.executeSlashCommand("test", "some args");

      await vi.waitFor(() => {
        expect(executeFn).toHaveBeenCalledWith("some args", expect.objectContaining({
          threadId: expect.any(String),
          respond: expect.any(Function),
          respondContent: expect.any(Function),
          progress: expect.any(Function),
        }));
      });
    });
  });

  describe("slash command context", () => {
    it("provides respond, respondContent, and progress methods", async () => {
      const executeFn = vi.fn(async (_args: string, ctx: { respond: (t: string) => void; progress: (t: string) => void }) => {
        ctx.progress("Working...");
        ctx.respond("Done!");
      });

      const cmdProvider = new ChatWebviewProvider(createMockExtensionUri(), {
        model: createMockModel(),
        slashCommands: [
          { name: "test", description: "Test", execute: executeFn },
        ],
      });
      const cmdView = createMockWebviewView();
      cmdProvider.resolveWebviewView(cmdView);

      cmdView.simulateMessage({
        type: "slashCommand",
        threadId: "t1",
        command: "test",
        args: "",
      });

      await vi.waitFor(() => {
        const progressEvents = cmdView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "streamProgress",
        );
        expect(progressEvents.length).toBeGreaterThanOrEqual(1);
        expect((progressEvents[0] as HostToWebviewEvent & { type: "streamProgress" }).text).toBe("Working...");

        // The respond() call + return value both post system messages
        const threadStateEvents = cmdView.postedMessages.filter(
          (m) => (m as HostToWebviewEvent).type === "threadState",
        );
        expect(threadStateEvents.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
