import { describe, it, expect } from "vitest";
import {
  isPostMessageEvent,
  isWebviewToHostEvent,
  isHostToWebviewEvent,
  generateId,
  createThread,
  toThreadSummary,
  type ChatMessage,
  type ChatContentPart,
  type ChatThread,
  type WebviewToHostEvent,
  type HostToWebviewEvent,
} from "../index.js";

describe("generateId", () => {
  it("returns a string", () => {
    expect(typeof generateId()).toBe("string");
  });

  it("returns unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("type guards", () => {
  describe("isWebviewToHostEvent", () => {
    it("accepts valid webview-to-host events", () => {
      const events: WebviewToHostEvent[] = [
        { type: "ready" },
        { type: "createThread" },
        { type: "cancelGeneration", threadId: "t1" },
        { type: "switchThread", threadId: "t1" },
        { type: "deleteThread", threadId: "t1" },
        {
          type: "sendMessage",
          threadId: "t1",
          message: { id: "m1", role: "user", content: [{ type: "text", text: "hi" }] },
        },
        { type: "toolApproval", toolCallId: "tc1", approved: true },
        { type: "editMessage", threadId: "t1", messageId: "m1", content: [] },
        { type: "branchMessage", threadId: "t1", messageId: "m1" },
        { type: "reloadMessage", threadId: "t1", messageId: "m1" },
        { type: "exportThread", threadId: "t1", format: "json" },
        { type: "slashCommand", threadId: "t1", command: "help", args: "" },
        { type: "fileDrop", threadId: "t1", files: [] },
        { type: "contextMention", threadId: "t1", mentionType: "file", query: "main" },
      ];
      for (const event of events) {
        expect(isWebviewToHostEvent(event)).toBe(true);
      }
    });

    it("rejects host-to-webview events", () => {
      const event: HostToWebviewEvent = { type: "streamStart", threadId: "t1", messageId: "m1" };
      expect(isWebviewToHostEvent(event)).toBe(false);
    });

    it("rejects non-objects", () => {
      expect(isWebviewToHostEvent(null)).toBe(false);
      expect(isWebviewToHostEvent(undefined)).toBe(false);
      expect(isWebviewToHostEvent("ready")).toBe(false);
      expect(isWebviewToHostEvent(42)).toBe(false);
    });

    it("rejects objects with unknown type", () => {
      expect(isWebviewToHostEvent({ type: "unknown" })).toBe(false);
    });
  });

  describe("isHostToWebviewEvent", () => {
    it("accepts valid host-to-webview events", () => {
      const events: HostToWebviewEvent[] = [
        { type: "streamStart", threadId: "t1", messageId: "m1" },
        {
          type: "streamDelta",
          threadId: "t1",
          messageId: "m1",
          delta: { type: "text", text: "hello" },
        },
        { type: "streamEnd", threadId: "t1", messageId: "m1" },
        { type: "streamError", threadId: "t1", error: "oops" },
        {
          type: "threadState",
          thread: {
            id: "t1",
            messages: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { type: "threadList", threads: [] },
        { type: "toolCall", threadId: "t1", toolCallId: "tc1", toolName: "read", args: {} },
        { type: "toolResult", threadId: "t1", toolCallId: "tc1", result: "ok" },
        { type: "configUpdate", config: { title: "Test" } },
        { type: "contextMentionResult", mentionType: "file", items: [] },
        { type: "slashCommandList", commands: [{ name: "help", description: "Show help" }] },
      ];
      for (const event of events) {
        expect(isHostToWebviewEvent(event)).toBe(true);
      }
    });

    it("rejects webview-to-host events", () => {
      expect(isHostToWebviewEvent({ type: "ready" })).toBe(false);
    });
  });

  describe("isPostMessageEvent", () => {
    it("accepts both directions", () => {
      expect(isPostMessageEvent({ type: "ready" })).toBe(true);
      expect(isPostMessageEvent({ type: "streamEnd", threadId: "t1", messageId: "m1" })).toBe(true);
    });

    it("rejects invalid values", () => {
      expect(isPostMessageEvent({ type: "nope" })).toBe(false);
      expect(isPostMessageEvent(null)).toBe(false);
    });
  });
});

describe("ChatMessage serialization", () => {
  it("round-trips through JSON", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: [
        { type: "text", text: "Hello" },
        { type: "tool-call", toolCallId: "tc1", toolName: "readFile", args: { path: "/foo" } },
        { type: "tool-result", toolCallId: "tc1", toolName: "readFile", result: "contents" },
        { type: "data", name: "code-diff", data: { before: "a", after: "b" } },
      ],
      createdAt: new Date("2026-01-01T00:00:00Z"),
      metadata: { model: "claude-sonnet" },
    };

    const serialized = JSON.stringify(msg);
    const deserialized = JSON.parse(serialized) as ChatMessage;

    expect(deserialized.id).toBe(msg.id);
    expect(deserialized.role).toBe(msg.role);
    expect(deserialized.content).toHaveLength(4);
    expect(deserialized.content[0]).toEqual({ type: "text", text: "Hello" });
    expect(deserialized.content[1]).toEqual({
      type: "tool-call",
      toolCallId: "tc1",
      toolName: "readFile",
      args: { path: "/foo" },
    });
    expect(deserialized.content[2]).toEqual({
      type: "tool-result",
      toolCallId: "tc1",
      toolName: "readFile",
      result: "contents",
    });
    expect(deserialized.content[3]).toEqual({
      type: "data",
      name: "code-diff",
      data: { before: "a", after: "b" },
    });
    expect(deserialized.metadata).toEqual({ model: "claude-sonnet" });
  });

  it("handles content part type discrimination", () => {
    const parts: ChatContentPart[] = [
      { type: "text", text: "hi" },
      { type: "tool-call", toolCallId: "tc1", toolName: "foo", args: {} },
      { type: "tool-result", toolCallId: "tc1", toolName: "foo", result: null },
      { type: "data", name: "card", data: {} },
    ];

    for (const part of parts) {
      switch (part.type) {
        case "text":
          expect(part.text).toBeDefined();
          break;
        case "tool-call":
          expect(part.toolCallId).toBeDefined();
          expect(part.toolName).toBeDefined();
          expect(part.args).toBeDefined();
          break;
        case "tool-result":
          expect(part.toolCallId).toBeDefined();
          expect(part.result).toBeDefined();
          break;
        case "data":
          expect(part.name).toBeDefined();
          expect(part.data).toBeDefined();
          break;
      }
    }
  });
});

describe("createThread", () => {
  it("creates a thread with a unique ID", () => {
    const thread = createThread();
    expect(thread.id).toBeDefined();
    expect(thread.messages).toEqual([]);
    expect(thread.createdAt).toBeInstanceOf(Date);
    expect(thread.updatedAt).toBeInstanceOf(Date);
  });

  it("accepts a custom ID", () => {
    const thread = createThread("custom-id");
    expect(thread.id).toBe("custom-id");
  });

  it("creates unique threads", () => {
    const t1 = createThread();
    const t2 = createThread();
    expect(t1.id).not.toBe(t2.id);
  });
});

describe("toThreadSummary", () => {
  it("uses thread title if available", () => {
    const thread: ChatThread = {
      id: "t1",
      title: "My Thread",
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const summary = toThreadSummary(thread);
    expect(summary.id).toBe("t1");
    expect(summary.title).toBe("My Thread");
  });

  it("derives title from first user message", () => {
    const thread: ChatThread = {
      id: "t1",
      messages: [
        {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const summary = toThreadSummary(thread);
    expect(summary.title).toBe("Hello world");
  });

  it("uses fallback title for empty threads", () => {
    const thread: ChatThread = {
      id: "t1",
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const summary = toThreadSummary(thread);
    expect(summary.title).toBe("New Thread");
  });

  it("truncates long titles to 50 chars", () => {
    const longText = "A".repeat(100);
    const thread: ChatThread = {
      id: "t1",
      messages: [
        {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: longText }],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const summary = toThreadSummary(thread);
    expect(summary.title.length).toBe(50);
  });
});
