import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ChatThread, ThreadSummary, ThreadStorage } from "@growthbeaker/ai-chat-core";
import { toThreadSummary } from "@growthbeaker/ai-chat-core";

const INDEX_FILE = "threads.json";
const threadFile = (id: string) => `thread-${id}.json`;

/**
 * Persists threads as JSON files in a directory.
 * Better for large conversations that could exceed globalState size limits.
 */
export class FileSystemStorage implements ThreadStorage {
  constructor(private readonly storagePath: string) {}

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true });
  }

  async listThreads(): Promise<ThreadSummary[]> {
    try {
      const data = await fs.readFile(path.join(this.storagePath, INDEX_FILE), "utf-8");
      return JSON.parse(data) as ThreadSummary[];
    } catch {
      return [];
    }
  }

  async loadThread(threadId: string): Promise<ChatThread | undefined> {
    try {
      const data = await fs.readFile(path.join(this.storagePath, threadFile(threadId)), "utf-8");
      const thread = JSON.parse(data) as ChatThread;
      // Revive Date objects from JSON
      thread.createdAt = new Date(thread.createdAt);
      thread.updatedAt = new Date(thread.updatedAt);
      return thread;
    } catch {
      return undefined;
    }
  }

  async saveThread(thread: ChatThread): Promise<void> {
    await this.ensureDir();

    await fs.writeFile(
      path.join(this.storagePath, threadFile(thread.id)),
      JSON.stringify(thread),
      "utf-8",
    );

    const index = await this.listThreads();
    const summary = toThreadSummary(thread);
    const existing = index.findIndex((t) => t.id === thread.id);
    if (existing >= 0) {
      index[existing] = summary;
    } else {
      index.unshift(summary);
    }
    await fs.writeFile(path.join(this.storagePath, INDEX_FILE), JSON.stringify(index), "utf-8");
  }

  async deleteThread(threadId: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.storagePath, threadFile(threadId)));
    } catch {
      // File may not exist
    }

    const index = await this.listThreads();
    const filtered = index.filter((t) => t.id !== threadId);
    await this.ensureDir();
    await fs.writeFile(path.join(this.storagePath, INDEX_FILE), JSON.stringify(filtered), "utf-8");
  }
}
