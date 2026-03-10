import { describe, it, expect, vi } from "vitest";
import { createWebviewSender, createHostSender, parseEvent } from "../bridge.js";
import type { WebviewToHostEvent, HostToWebviewEvent } from "../types/events.js";

describe("createWebviewSender", () => {
  it("sends a ready event", () => {
    const post = vi.fn();
    const sender = createWebviewSender(post);
    sender.ready();
    expect(post).toHaveBeenCalledWith({ type: "ready" });
  });

  it("sends a sendMessage event with correct shape", () => {
    const post = vi.fn();
    const sender = createWebviewSender(post);
    const msg = {
      id: "m1",
      role: "user" as const,
      content: [{ type: "text" as const, text: "hi" }],
    };
    sender.sendMessage("t1", msg);
    expect(post).toHaveBeenCalledWith({ type: "sendMessage", threadId: "t1", message: msg });
  });

  it("sends cancelGeneration", () => {
    const post = vi.fn();
    const sender = createWebviewSender(post);
    sender.cancelGeneration("t1");
    expect(post).toHaveBeenCalledWith({ type: "cancelGeneration", threadId: "t1" });
  });

  it("sends thread management events", () => {
    const post = vi.fn();
    const sender = createWebviewSender(post);

    sender.createThread();
    expect(post).toHaveBeenCalledWith({ type: "createThread" });

    sender.switchThread("t2");
    expect(post).toHaveBeenCalledWith({ type: "switchThread", threadId: "t2" });

    sender.deleteThread("t3");
    expect(post).toHaveBeenCalledWith({ type: "deleteThread", threadId: "t3" });
  });

  it("sends toolApproval with optional feedback", () => {
    const post = vi.fn();
    const sender = createWebviewSender(post);

    sender.toolApproval("tc1", true);
    expect(post).toHaveBeenCalledWith({
      type: "toolApproval",
      toolCallId: "tc1",
      approved: true,
      feedback: undefined,
    });

    sender.toolApproval("tc2", false, "too risky");
    expect(post).toHaveBeenCalledWith({
      type: "toolApproval",
      toolCallId: "tc2",
      approved: false,
      feedback: "too risky",
    });
  });

  it("sends editMessage", () => {
    const post = vi.fn();
    const sender = createWebviewSender(post);
    sender.editMessage("t1", "m1", [{ type: "text", text: "edited" }]);
    expect(post).toHaveBeenCalledWith({
      type: "editMessage",
      threadId: "t1",
      messageId: "m1",
      content: [{ type: "text", text: "edited" }],
    });
  });

  it("sends branchMessage and reloadMessage", () => {
    const post = vi.fn();
    const sender = createWebviewSender(post);

    sender.branchMessage("t1", "m1");
    expect(post).toHaveBeenCalledWith({ type: "branchMessage", threadId: "t1", messageId: "m1" });

    sender.reloadMessage("t1", "m2");
    expect(post).toHaveBeenCalledWith({ type: "reloadMessage", threadId: "t1", messageId: "m2" });
  });
});

describe("createHostSender", () => {
  it("sends stream lifecycle events", () => {
    const post = vi.fn();
    const sender = createHostSender(post);

    sender.streamStart("t1", "m1");
    expect(post).toHaveBeenCalledWith({ type: "streamStart", threadId: "t1", messageId: "m1" });

    sender.streamDelta("t1", "m1", { type: "text", text: "hello" });
    expect(post).toHaveBeenCalledWith({
      type: "streamDelta",
      threadId: "t1",
      messageId: "m1",
      delta: { type: "text", text: "hello" },
    });

    sender.streamEnd("t1", "m1");
    expect(post).toHaveBeenCalledWith({ type: "streamEnd", threadId: "t1", messageId: "m1" });
  });

  it("sends streamError", () => {
    const post = vi.fn();
    const sender = createHostSender(post);
    sender.streamError("t1", "rate limit exceeded");
    expect(post).toHaveBeenCalledWith({
      type: "streamError",
      threadId: "t1",
      error: "rate limit exceeded",
    });
  });

  it("sends threadState", () => {
    const post = vi.fn();
    const sender = createHostSender(post);
    const thread = {
      id: "t1",
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    sender.threadState(thread);
    expect(post).toHaveBeenCalledWith({ type: "threadState", thread });
  });

  it("sends threadList", () => {
    const post = vi.fn();
    const sender = createHostSender(post);
    const threads = [{ id: "t1", title: "Chat 1", updatedAt: new Date() }];
    sender.threadList(threads);
    expect(post).toHaveBeenCalledWith({ type: "threadList", threads });
  });

  it("sends tool events", () => {
    const post = vi.fn();
    const sender = createHostSender(post);

    sender.toolCall("t1", "tc1", "readFile", { path: "/foo" });
    expect(post).toHaveBeenCalledWith({
      type: "toolCall",
      threadId: "t1",
      toolCallId: "tc1",
      toolName: "readFile",
      args: { path: "/foo" },
    });

    sender.toolResult("t1", "tc1", "file contents");
    expect(post).toHaveBeenCalledWith({
      type: "toolResult",
      threadId: "t1",
      toolCallId: "tc1",
      result: "file contents",
    });
  });

  it("sends configUpdate", () => {
    const post = vi.fn();
    const sender = createHostSender(post);
    sender.configUpdate({ title: "New Title", activeModel: "gpt-4o" });
    expect(post).toHaveBeenCalledWith({
      type: "configUpdate",
      config: { title: "New Title", activeModel: "gpt-4o" },
    });
  });
});

describe("parseEvent", () => {
  it("parses valid webview-to-host events", () => {
    const event: WebviewToHostEvent = { type: "ready" };
    expect(parseEvent(event)).toEqual(event);
  });

  it("parses valid host-to-webview events", () => {
    const event: HostToWebviewEvent = { type: "streamEnd", threadId: "t1", messageId: "m1" };
    expect(parseEvent(event)).toEqual(event);
  });

  it("returns null for unknown event types", () => {
    expect(parseEvent({ type: "bogus" })).toBeNull();
  });

  it("returns null for non-objects", () => {
    expect(parseEvent(null)).toBeNull();
    expect(parseEvent(undefined)).toBeNull();
    expect(parseEvent("string")).toBeNull();
    expect(parseEvent(123)).toBeNull();
  });

  it("returns null for objects without type", () => {
    expect(parseEvent({ foo: "bar" })).toBeNull();
  });
});
