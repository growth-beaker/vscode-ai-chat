import type { ChatThread, ThreadSummary } from "./thread.js";

/** Interface for persisting conversation threads */
export interface ThreadStorage {
  listThreads(): Promise<ThreadSummary[]>;
  loadThread(threadId: string): Promise<ChatThread | undefined>;
  saveThread(thread: ChatThread): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
}
