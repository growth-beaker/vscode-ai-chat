/** Role enum matching assistant-ui expectations */
export type MessageRole = "user" | "assistant" | "system";

/** Text content part */
export interface TextContentPart {
  type: "text";
  text: string;
}

/** Tool call content part */
export interface ToolCallContentPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

/** Tool result content part */
export interface ToolResultContentPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
}

/** Image content part — base64 or URL */
export interface ImageContentPart {
  type: "image";
  /** base64-encoded image data (without data: prefix) */
  data?: string;
  /** Image URL (alternative to data) */
  url?: string;
  /** MIME type (e.g. "image/png", "image/jpeg") */
  mimeType: string;
  /** Alt text for accessibility */
  alt?: string;
}

/** File attachment content part — metadata + optional inline content */
export interface FileContentPart {
  type: "file";
  /** Original filename */
  name: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Text content for text-based files (code, markdown, CSV, etc.) */
  textContent?: string;
  /** base64-encoded binary content for non-text files */
  data?: string;
}

/** Custom data content part for extension-defined UI cards */
export interface DataContentPart {
  type: "data";
  name: string;
  data: unknown;
}

/** A single content part within a message */
export type ChatContentPart =
  | TextContentPart
  | ToolCallContentPart
  | ToolResultContentPart
  | ImageContentPart
  | FileContentPart
  | DataContentPart;

/** A complete message in the thread, compatible with ThreadMessageLike */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: ChatContentPart[];
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}
