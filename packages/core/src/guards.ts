import type { PostMessageEvent, WebviewToHostEvent, HostToWebviewEvent } from "./types/events.js";

const WEBVIEW_TO_HOST_TYPES = new Set([
  "sendMessage",
  "cancelGeneration",
  "switchThread",
  "createThread",
  "deleteThread",
  "toolApproval",
  "editMessage",
  "branchMessage",
  "reloadMessage",
  "ready",
  "switchModel",
  "selectTemplate",
  "userAction",
  "exportThread",
  "slashCommand",
  "fileDrop",
  "contextMention",
]);

const HOST_TO_WEBVIEW_TYPES = new Set([
  "streamStart",
  "streamDelta",
  "streamEnd",
  "streamError",
  "streamProgress",
  "threadState",
  "threadList",
  "toolCall",
  "toolResult",
  "templateList",
  "configUpdate",
  "contextMentionResult",
  "slashCommandList",
  "inputHint",
]);

/** Check if an unknown value is a valid PostMessageEvent */
export function isPostMessageEvent(value: unknown): value is PostMessageEvent {
  return isWebviewToHostEvent(value) || isHostToWebviewEvent(value);
}

/** Check if an unknown value is a WebviewToHostEvent */
export function isWebviewToHostEvent(value: unknown): value is WebviewToHostEvent {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.type === "string" && WEBVIEW_TO_HOST_TYPES.has(obj.type);
}

/** Check if an unknown value is a HostToWebviewEvent */
export function isHostToWebviewEvent(value: unknown): value is HostToWebviewEvent {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.type === "string" && HOST_TO_WEBVIEW_TYPES.has(obj.type);
}
