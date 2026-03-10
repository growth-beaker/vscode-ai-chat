// Types — messages
export type {
  MessageRole,
  ChatContentPart,
  TextContentPart,
  ToolCallContentPart,
  ToolResultContentPart,
  ImageContentPart,
  FileContentPart,
  DataContentPart,
  ChatMessage,
} from "./types/messages.js";

// Types — threads
export type { ChatThread, ThreadSummary } from "./types/thread.js";

// Types — config
export type { ChatConfig } from "./types/config.js";

// Types — storage
export type { ThreadStorage } from "./types/storage.js";

// Types — usage
export type { TokenUsage, ThreadUsage } from "./types/usage.js";
export { aggregateUsage } from "./types/usage.js";

// Types — MCP
export type { MCPServerConfig } from "./types/mcp.js";

// Types — events
export type {
  // Webview → Host
  WebviewToHostEvent,
  SendMessageEvent,
  CancelGenerationEvent,
  SwitchThreadEvent,
  CreateThreadEvent,
  DeleteThreadEvent,
  ToolApprovalEvent,
  EditMessageEvent,
  BranchMessageEvent,
  ReloadMessageEvent,
  WebviewReadyEvent,
  SwitchModelEvent,
  SelectTemplateEvent,
  UserActionEvent,
  ExportThreadEvent,
  SlashCommandEvent,
  FileDropEvent,
  ContextMentionEvent,
  // Host → Webview
  HostToWebviewEvent,
  StreamStartEvent,
  StreamDeltaEvent,
  StreamEndEvent,
  StreamErrorEvent,
  ThreadStateEvent,
  ThreadListEvent,
  ToolCallEvent,
  ToolResultEvent,
  TemplateListEvent,
  ConfigUpdateEvent,
  ContextMentionResultEvent,
  SlashCommandListEvent,
  // Union
  PostMessageEvent,
} from "./types/events.js";

// Type guards
export { isPostMessageEvent, isWebviewToHostEvent, isHostToWebviewEvent } from "./guards.js";

// Bridge
export { createWebviewSender, createHostSender, parseEvent } from "./bridge.js";

// Export utilities
export { exportThreadAsJSON, exportThreadAsMarkdown } from "./export.js";

// Utilities
export { generateId, createThread, toThreadSummary } from "./utils.js";
