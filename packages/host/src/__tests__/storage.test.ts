import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GlobalStateStorage, type Memento } from "../storage/GlobalStateStorage.js";
import { FileSystemStorage } from "../storage/FileSystemStorage.js";
import { createStorage } from "../storage/index.js";
import type { ChatThread } from "@growthbeaker/ai-chat-core";

function createTestThread(id: string, title?: string): ChatThread {
  return {
    id,
    title,
    messages: [{ id: "m1", role: "user", content: [{ type: "text", text: "Hello" }] }],
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
  };
}

// ── GlobalStateStorage ──────────────────────────────────────────

describe("GlobalStateStorage", () => {
  let store: Map<string, unknown>;
  let memento: Memento;
  let storage: GlobalStateStorage;

  beforeEach(() => {
    store = new Map();
    memento = {
      get<T>(key: string, defaultValue?: T): T {
        return (store.get(key) as T) ?? (defaultValue as T);
      },
      update(key: string, value: unknown) {
        if (value === undefined) {
          store.delete(key);
        } else {
          store.set(key, value);
        }
        return Promise.resolve();
      },
    };
    storage = new GlobalStateStorage(memento);
  });

  it("returns empty list when no threads saved", async () => {
    const threads = await storage.listThreads();
    expect(threads).toEqual([]);
  });

  it("saves and loads a thread", async () => {
    const thread = createTestThread("t1", "My Thread");
    await storage.saveThread(thread);

    const loaded = await storage.loadThread("t1");
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe("t1");
    expect(loaded!.messages).toHaveLength(1);
  });

  it("lists saved threads", async () => {
    await storage.saveThread(createTestThread("t1", "Thread 1"));
    await storage.saveThread(createTestThread("t2", "Thread 2"));

    const list = await storage.listThreads();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.id)).toContain("t1");
    expect(list.map((t) => t.id)).toContain("t2");
  });

  it("updates existing thread in index", async () => {
    const thread = createTestThread("t1", "Original");
    await storage.saveThread(thread);

    thread.title = "Updated";
    thread.updatedAt = new Date("2024-01-03");
    await storage.saveThread(thread);

    const list = await storage.listThreads();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe("Updated");
  });

  it("deletes a thread", async () => {
    await storage.saveThread(createTestThread("t1"));
    await storage.saveThread(createTestThread("t2"));

    await storage.deleteThread("t1");

    const list = await storage.listThreads();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("t2");

    const loaded = await storage.loadThread("t1");
    expect(loaded).toBeUndefined();
  });

  it("loadThread returns undefined for non-existent thread", async () => {
    const loaded = await storage.loadThread("nonexistent");
    expect(loaded).toBeUndefined();
  });
});

// ── FileSystemStorage ───────────────────────────────────────────

describe("FileSystemStorage", () => {
  let tmpDir: string;
  let storage: FileSystemStorage;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-ai-chat-test-"));
    storage = new FileSystemStorage(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list when no threads saved", async () => {
    const threads = await storage.listThreads();
    expect(threads).toEqual([]);
  });

  it("saves and loads a thread", async () => {
    const thread = createTestThread("t1", "My Thread");
    await storage.saveThread(thread);

    const loaded = await storage.loadThread("t1");
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe("t1");
    expect(loaded!.messages).toHaveLength(1);
  });

  it("revives Date objects from JSON", async () => {
    const thread = createTestThread("t1");
    await storage.saveThread(thread);

    const loaded = await storage.loadThread("t1");
    expect(loaded!.createdAt).toBeInstanceOf(Date);
    expect(loaded!.updatedAt).toBeInstanceOf(Date);
  });

  it("lists saved threads", async () => {
    await storage.saveThread(createTestThread("t1"));
    await storage.saveThread(createTestThread("t2"));

    const list = await storage.listThreads();
    expect(list).toHaveLength(2);
  });

  it("updates existing thread in index", async () => {
    const thread = createTestThread("t1", "Original");
    await storage.saveThread(thread);

    thread.title = "Updated";
    await storage.saveThread(thread);

    const list = await storage.listThreads();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe("Updated");
  });

  it("deletes a thread", async () => {
    await storage.saveThread(createTestThread("t1"));
    await storage.saveThread(createTestThread("t2"));

    await storage.deleteThread("t1");

    const list = await storage.listThreads();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("t2");

    const loaded = await storage.loadThread("t1");
    expect(loaded).toBeUndefined();
  });

  it("deleting non-existent thread does not throw", async () => {
    await expect(storage.deleteThread("nonexistent")).resolves.not.toThrow();
  });

  it("creates storage directory if it does not exist", async () => {
    const nested = path.join(tmpDir, "nested", "dir");
    const nestedStorage = new FileSystemStorage(nested);

    await nestedStorage.saveThread(createTestThread("t1"));
    const loaded = await nestedStorage.loadThread("t1");
    expect(loaded).toBeDefined();
  });
});

// ── createStorage factory ───────────────────────────────────────

describe("createStorage", () => {
  it("creates GlobalStateStorage for globalState config", () => {
    const memento: Memento = {
      get: vi.fn() as Memento["get"],
      update: vi.fn(() => Promise.resolve()),
    };
    const storage = createStorage({ type: "globalState", globalState: memento });
    expect(storage).toBeInstanceOf(GlobalStateStorage);
  });

  it("creates FileSystemStorage for filesystem config", () => {
    const storage = createStorage({ type: "filesystem", storagePath: "/tmp/test" });
    expect(storage).toBeInstanceOf(FileSystemStorage);
  });

  it("returns custom storage for custom config", () => {
    const custom = {
      listThreads: vi.fn(),
      loadThread: vi.fn(),
      saveThread: vi.fn(),
      deleteThread: vi.fn(),
    };
    const storage = createStorage({ type: "custom", storage: custom });
    expect(storage).toBe(custom);
  });
});
