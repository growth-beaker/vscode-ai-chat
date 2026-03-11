import type { ChatConfig, ChatContentPart, ChatThread, ThreadStorage, MCPServerConfig } from "@vscode-ai-chat/core";
import type { LanguageModel, CoreTool } from "ai";
import type { Memento } from "./storage/GlobalStateStorage.js";

/** Tool definitions — Record of named CoreTool instances from Vercel AI SDK */
export type ToolDefinitions = Record<string, CoreTool>;

/** Persistence configuration — shorthand strings or custom ThreadStorage */
export type PersistenceConfig =
  | { type: "globalState"; globalState: Memento }
  | { type: "filesystem"; storagePath: string }
  | { type: "custom"; storage: ThreadStorage };

/** Model factory map — keyed by model ID */
export type ModelMap = Record<string, () => LanguageModel>;

/** Tool approval configuration — array of tool names or a predicate function */
export type ToolApprovalConfig = string[] | ((toolName: string) => boolean);

/** Chat session template — pre-configured system prompt, tools, and model */
export interface ChatTemplate {
  /** Unique template identifier */
  id: string;
  /** Display label shown in template picker */
  label: string;
  /** System prompt for sessions using this template */
  systemPrompt: string;
  /** Tool definitions specific to this template */
  tools?: ToolDefinitions;
  /** Model override for this template */
  model?: LanguageModel;
}

/** Response context passed to slash command handlers for streaming output */
export interface SlashCommandContext {
  /** The ID of the active thread */
  threadId: string;
  /** Post a text response as a system message */
  respond: (text: string) => void;
  /** Post a structured content response as a system message */
  respondContent: (content: ChatContentPart[]) => void;
  /** Post a transient progress indicator */
  progress: (text: string) => void;
}

/** Slash command handler — receives command name and args, returns a response or modifies the thread */
export interface SlashCommandHandler {
  /** Command name (without the leading slash) */
  name: string;
  /** Short description shown in command picker */
  description: string;
  /**
   * Handle the slash command.
   * Return text to send as a system message, or void.
   * The context parameter provides methods for streaming responses.
   */
  execute: (args: string, context: SlashCommandContext) => Promise<string | void> | string | void;
}

/** Context mention provider — resolves @mentions to content */
export interface ContextMentionProvider {
  /** Resolve a @file mention query to matching items */
  resolveFile?: (query: string) => Promise<Array<{ label: string; description?: string; value: string }>>;
  /** Resolve a @workspace mention query */
  resolveWorkspace?: (query: string) => Promise<Array<{ label: string; description?: string; value: string }>>;
  /** Resolve a @symbol mention query */
  resolveSymbol?: (query: string) => Promise<Array<{ label: string; description?: string; value: string }>>;
}

/**
 * Result from an onMessage handler.
 * Return 'passthrough' to let the message flow to the LLM as normal.
 * Return { handled: true } to indicate the message was consumed (no LLM call).
 */
export type OnMessageResult = "passthrough" | { handled: true };

/** Configuration for ChatWebviewProvider */
export interface ChatProviderConfig {
  /**
   * The default LLM model to use.
   * Optional — omit for manual mode where you drive streaming yourself
   * via pushStreamStart/pushStreamDelta/pushStreamEnd.
   */
  model?: LanguageModel;
  /** Additional models for runtime switching, keyed by model ID */
  models?: ModelMap;
  /** System prompt */
  system?: string;
  /** Tool definitions (Vercel AI SDK CoreTool instances with zod schemas + execute functions) */
  tools?: ToolDefinitions;
  /** Maximum number of tool-use steps per generation (default: 5) */
  maxSteps?: number;
  /** Tools that require human approval before execution. Array of tool names or predicate function. */
  requiresApproval?: ToolApprovalConfig;
  /** UI configuration */
  ui?: ChatConfig;
  /** Persistence configuration. Omit for in-memory only. */
  persistence?: PersistenceConfig;
  /** MCP server configurations. Tools from these servers are merged with local tools. */
  mcpServers?: MCPServerConfig[];
  /** Chat session templates — pre-configured system prompts, tools, and models */
  templates?: ChatTemplate[];
  /** Slash commands available in the chat */
  slashCommands?: SlashCommandHandler[];
  /** Context mention provider for @file, @workspace, @symbol resolution */
  contextMentionProvider?: ContextMentionProvider;
  /**
   * Message interceptor — called when the user sends a message, before it reaches the LLM.
   * Return 'passthrough' to let the message proceed to the LLM as normal.
   * Return { handled: true } to consume the message (no LLM call).
   * Only called when model is configured (in manual mode, all messages are routed to the extension).
   */
  onMessage?: (message: string, thread: ChatThread) => OnMessageResult | Promise<OnMessageResult>;
  /**
   * Cancel callback — called when the user cancels a generation.
   * Use this to run custom cancellation logic (e.g. aborting an external SDK bridge).
   * The built-in LLM abort still runs automatically when a model is configured.
   */
  onCancel?: () => void | Promise<void>;
}
