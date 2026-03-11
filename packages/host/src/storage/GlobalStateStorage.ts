import type { ChatThread, ThreadSummary, ThreadStorage } from "@growthbeaker/ai-chat-core";
import { toThreadSummary } from "@growthbeaker/ai-chat-core";

/** Minimal vscode.Memento interface to avoid hard dependency */
export interface Memento {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

const THREAD_INDEX_KEY = "chat:threads";
const threadKey = (id: string) => `chat:thread:${id}`;

/**
 * Persists threads using VS Code's globalState (vscode.Memento).
 * Good for small to medium conversations. Each thread is stored as a separate key.
 */
export class GlobalStateStorage implements ThreadStorage {
  constructor(private readonly globalState: Memento) {}

  async listThreads(): Promise<ThreadSummary[]> {
    return this.globalState.get<ThreadSummary[]>(THREAD_INDEX_KEY, []);
  }

  async loadThread(threadId: string): Promise<ChatThread | undefined> {
    return this.globalState.get<ChatThread>(threadKey(threadId));
  }

  async saveThread(thread: ChatThread): Promise<void> {
    await this.globalState.update(threadKey(thread.id), thread);

    const index = this.globalState.get<ThreadSummary[]>(THREAD_INDEX_KEY, []);
    const summary = toThreadSummary(thread);
    const existing = index.findIndex((t) => t.id === thread.id);
    if (existing >= 0) {
      index[existing] = summary;
    } else {
      index.unshift(summary);
    }
    await this.globalState.update(THREAD_INDEX_KEY, index);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.globalState.update(threadKey(threadId), undefined);

    const index = this.globalState.get<ThreadSummary[]>(THREAD_INDEX_KEY, []);
    await this.globalState.update(
      THREAD_INDEX_KEY,
      index.filter((t) => t.id !== threadId),
    );
  }
}
