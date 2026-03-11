import type { ChatMessage } from "./types/messages.js";
import type { ChatThread, ThreadSummary } from "./types/thread.js";

/** Generate a unique ID for messages and threads */
export function generateId(): string {
  return crypto.randomUUID();
}

/** Options for creating a new ChatThread */
export interface CreateThreadOptions {
  /** Custom thread ID (auto-generated if omitted) */
  id?: string;
  /** Seed messages to pre-populate the thread */
  messages?: ChatMessage[];
  /** Thread title */
  title?: string;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

/** Create a new ChatThread, optionally pre-populated with messages */
export function createThread(idOrOptions?: string | CreateThreadOptions): ChatThread {
  const opts = typeof idOrOptions === "string" ? { id: idOrOptions } : idOrOptions ?? {};
  const now = new Date();
  return {
    id: opts.id ?? generateId(),
    title: opts.title,
    messages: opts.messages ?? [],
    createdAt: now,
    updatedAt: now,
    metadata: opts.metadata,
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
