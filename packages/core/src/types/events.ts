import type { ChatConfig } from "./config.js";
import type { ChatContentPart, ChatMessage } from "./messages.js";
import type { ChatThread, ThreadSummary } from "./thread.js";
import type { TokenUsage } from "./usage.js";

// ── Webview → Host events ───────────────────────────────────────────

export interface SendMessageEvent {
  type: "sendMessage";
  threadId: string;
  message: ChatMessage;
}

export interface CancelGenerationEvent {
  type: "cancelGeneration";
  threadId: string;
}

export interface SwitchThreadEvent {
  type: "switchThread";
  threadId: string;
}

export interface CreateThreadEvent {
  type: "createThread";
}

export interface DeleteThreadEvent {
  type: "deleteThread";
  threadId: string;
}

export interface ToolApprovalEvent {
  type: "toolApproval";
  toolCallId: string;
  approved: boolean;
  feedback?: string;
}

export interface EditMessageEvent {
  type: "editMessage";
  threadId: string;
  messageId: string;
  content: ChatContentPart[];
}

export interface BranchMessageEvent {
  type: "branchMessage";
  threadId: string;
  messageId: string;
}

export interface ReloadMessageEvent {
  type: "reloadMessage";
  threadId: string;
  messageId: string;
}

export interface WebviewReadyEvent {
  type: "ready";
}

export interface SwitchModelEvent {
  type: "switchModel";
  modelId: string;
}

export interface SelectTemplateEvent {
  type: "selectTemplate";
  templateId: string;
}

export interface UserActionEvent {
  type: "userAction";
  actionId: string;
  result: unknown;
}

export interface ExportThreadEvent {
  type: "exportThread";
  threadId: string;
  format: "json" | "markdown";
}

export interface SlashCommandEvent {
  type: "slashCommand";
  threadId: string;
  command: string;
  args: string;
}

export interface FileDropEvent {
  type: "fileDrop";
  threadId: string;
  files: Array<{
    name: string;
    mimeType: string;
    size: number;
    /** base64-encoded file content */
    data: string;
  }>;
}

export interface ContextMentionEvent {
  type: "contextMention";
  threadId: string;
  mentionType: "file" | "workspace" | "symbol";
  query: string;
}

/** All events sent from webview to extension host */
export type WebviewToHostEvent =
  | SendMessageEvent
  | CancelGenerationEvent
  | SwitchThreadEvent
  | CreateThreadEvent
  | DeleteThreadEvent
  | ToolApprovalEvent
  | EditMessageEvent
  | BranchMessageEvent
  | ReloadMessageEvent
  | WebviewReadyEvent
  | SwitchModelEvent
  | SelectTemplateEvent
  | UserActionEvent
  | ExportThreadEvent
  | SlashCommandEvent
  | FileDropEvent
  | ContextMentionEvent;

// ── Host → Webview events ───────────────────────────────────────────

export interface StreamStartEvent {
  type: "streamStart";
  threadId: string;
  messageId: string;
}

export interface StreamDeltaEvent {
  type: "streamDelta";
  threadId: string;
  messageId: string;
  delta: ChatContentPart;
}

export interface StreamEndEvent {
  type: "streamEnd";
  threadId: string;
  messageId: string;
  usage?: TokenUsage;
}

export interface StreamErrorEvent {
  type: "streamError";
  threadId: string;
  error: string;
  /** Optional error classification (e.g. "cancel", "auth", "rate-limit", "network") */
  code?: string;
}

export interface StreamProgressEvent {
  type: "streamProgress";
  threadId: string;
  messageId?: string;
  text: string;
}

export interface ThreadStateEvent {
  type: "threadState";
  thread: ChatThread;
}

export interface ThreadListEvent {
  type: "threadList";
  threads: ThreadSummary[];
}

export interface ToolCallEvent {
  type: "toolCall";
  threadId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolResultEvent {
  type: "toolResult";
  threadId: string;
  toolCallId: string;
  result: unknown;
}

export interface TemplateListEvent {
  type: "templateList";
  templates: Array<{ id: string; label: string }>;
}

export interface ConfigUpdateEvent {
  type: "configUpdate";
  config: Partial<ChatConfig>;
}

export interface ContextMentionResultEvent {
  type: "contextMentionResult";
  mentionType: "file" | "workspace" | "symbol";
  items: Array<{
    label: string;
    description?: string;
    /** The content to insert or attach */
    value: string;
  }>;
}

export interface SlashCommandListEvent {
  type: "slashCommandList";
  commands: Array<{
    name: string;
    description: string;
  }>;
}

export interface InputHintEvent {
  type: "inputHint";
  /** Placeholder text to show in the composer, or null to clear */
  hint: string | null;
}

/** All events sent from extension host to webview */
export type HostToWebviewEvent =
  | StreamStartEvent
  | StreamDeltaEvent
  | StreamEndEvent
  | StreamErrorEvent
  | StreamProgressEvent
  | ThreadStateEvent
  | ThreadListEvent
  | ToolCallEvent
  | ToolResultEvent
  | TemplateListEvent
  | ConfigUpdateEvent
  | ContextMentionResultEvent
  | SlashCommandListEvent
  | InputHintEvent;

// ── Union ───────────────────────────────────────────────────────────

/** Union of all postMessage events */
export type PostMessageEvent = WebviewToHostEvent | HostToWebviewEvent;
