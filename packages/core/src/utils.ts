import type { ChatThread, ThreadSummary } from "./types/thread.js";

/** Generate a unique ID for messages and threads */
export function generateId(): string {
  return crypto.randomUUID();
}

/** Create a new empty ChatThread */
export function createThread(id?: string): ChatThread {
  const now = new Date();
  return {
    id: id ?? generateId(),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Extract a lightweight ThreadSummary from a ChatThread */
export function toThreadSummary(thread: ChatThread): ThreadSummary {
  const firstUserMsg = thread.messages.find((m) => m.role === "user");
  const titleFromContent =
    firstUserMsg?.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ")
      .slice(0, 50) || undefined;

  return {
    id: thread.id,
    title: thread.title ?? titleFromContent ?? "New Thread",
    updatedAt: thread.updatedAt,
  };
}
