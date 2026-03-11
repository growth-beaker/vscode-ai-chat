import type { ChatContentPart, ChatMessage } from "./types/messages.js";
import type { ChatConfig } from "./types/config.js";
import type { ChatThread, ThreadSummary } from "./types/thread.js";
import type { WebviewToHostEvent, HostToWebviewEvent, PostMessageEvent } from "./types/events.js";
import { isPostMessageEvent } from "./guards.js";

/**
 * Creates a typed message sender for webview → host communication.
 * Used in the React webview layer.
 */
export function createWebviewSender(postMessage: (msg: WebviewToHostEvent) => void) {
  return {
    sendMessage(threadId: string, message: ChatMessage) {
      postMessage({ type: "sendMessage", threadId, message });
    },
    cancelGeneration(threadId: string) {
      postMessage({ type: "cancelGeneration", threadId });
    },
    switchThread(threadId: string) {
      postMessage({ type: "switchThread", threadId });
    },
    createThread() {
      postMessage({ type: "createThread" });
    },
    deleteThread(threadId: string) {
      postMessage({ type: "deleteThread", threadId });
    },
    toolApproval(toolCallId: string, approved: boolean, feedback?: string) {
      postMessage({ type: "toolApproval", toolCallId, approved, feedback });
    },
    editMessage(threadId: string, messageId: string, content: ChatContentPart[]) {
      postMessage({ type: "editMessage", threadId, messageId, content });
    },
    branchMessage(threadId: string, messageId: string) {
      postMessage({ type: "branchMessage", threadId, messageId });
    },
    reloadMessage(threadId: string, messageId: string) {
      postMessage({ type: "reloadMessage", threadId, messageId });
    },
    ready() {
      postMessage({ type: "ready" });
    },
  };
}

/**
 * Creates a typed message sender for host → webview communication.
 * Used in the extension host layer.
 */
export function createHostSender(postMessage: (msg: HostToWebviewEvent) => void) {
  return {
    streamStart(threadId: string, messageId: string) {
      postMessage({ type: "streamStart", threadId, messageId });
    },
    streamDelta(threadId: string, messageId: string, delta: ChatContentPart) {
      postMessage({ type: "streamDelta", threadId, messageId, delta });
    },
    streamEnd(threadId: string, messageId: string) {
      postMessage({ type: "streamEnd", threadId, messageId });
    },
    streamError(threadId: string, error: string, code?: string) {
      postMessage({ type: "streamError", threadId, error, code });
    },
    streamProgress(threadId: string, text: string, messageId?: string) {
      postMessage({ type: "streamProgress", threadId, text, messageId });
    },
    threadState(thread: ChatThread) {
      postMessage({ type: "threadState", thread });
    },
    threadList(threads: ThreadSummary[]) {
      postMessage({ type: "threadList", threads });
    },
    toolCall(threadId: string, toolCallId: string, toolName: string, args: unknown) {
      postMessage({ type: "toolCall", threadId, toolCallId, toolName, args });
    },
    toolResult(threadId: string, toolCallId: string, result: unknown) {
      postMessage({ type: "toolResult", threadId, toolCallId, result });
    },
    configUpdate(config: Partial<ChatConfig>) {
      postMessage({ type: "configUpdate", config });
    },
    inputHint(hint: string | null) {
      postMessage({ type: "inputHint", hint });
    },
  };
}

/**
 * Parse and validate an incoming postMessage event.
 * Returns null for unrecognized or malformed events.
 */
export function parseEvent(data: unknown): PostMessageEvent | null {
  if (!isPostMessageEvent(data)) {
    return null;
  }
  return data;
}
