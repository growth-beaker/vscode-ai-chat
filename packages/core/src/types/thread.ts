import type { ChatMessage } from "./messages.js";

/** Thread metadata */
export interface ChatThread {
  id: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

/** Lightweight thread summary for list views */
export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: Date;
}
