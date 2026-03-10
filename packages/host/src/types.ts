import type { ChatConfig, ThreadStorage, MCPServerConfig } from "@vscode-ai-chat/core";
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

/** Slash command handler — receives command name and args, returns a response or modifies the thread */
export interface SlashCommandHandler {
  /** Command name (without the leading slash) */
  name: string;
  /** Short description shown in command picker */
  description: string;
  /** Handle the slash command. Return text to send as a system message, or void. */
  execute: (args: string, context: { threadId: string }) => Promise<string | void> | string | void;
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

/** Configuration for ChatWebviewProvider */
export interface ChatProviderConfig {
  /** The default LLM model to use */
  model: LanguageModel;
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
}
