import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamingChatHandler } from "../streaming.js";
import type { HostToWebviewEvent, ChatMessage } from "@growthbeaker/ai-chat-core";

// Mock the 'ai' module's streamText
vi.mock("ai", () => ({
  streamText: vi.fn(),
}));

import { streamText } from "ai";

const mockStreamText = vi.mocked(streamText);

/** Create a mock async iterable from an array of stream chunks */
async function* mockFullStream(chunks: Array<Record<string, unknown>>) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function createMockStreamResult(chunks: Array<Record<string, unknown>> = []) {
  return {
    fullStream: mockFullStream(chunks),
    text: Promise.resolve(""),
  } as unknown as ReturnType<typeof streamText>;
}

describe("StreamingChatHandler", () => {
  let handler: StreamingChatHandler;
  let postedEvents: HostToWebviewEvent[];
  let postToWebview: (event: HostToWebviewEvent) => void;

  const userMessage: ChatMessage = {
    id: "m1",
    role: "user",
    content: [{ type: "text", text: "Hello" }],
  };

  const mockModel = { modelId: "test-model" } as never;

  beforeEach(() => {
    handler = new StreamingChatHandler();
    postedEvents = [];
    postToWebview = (event) => postedEvents.push(event);
    vi.clearAllMocks();
  });

  it("posts streamStart at the beginning", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([
        { type: "text-delta", textDelta: "Hi!" },
      ]) as unknown as ReturnType<typeof streamText>;
    });

    await handler.handleSendMessage([userMessage], { model: mockModel }, postToWebview, "t1");

    expect(postedEvents[0]).toEqual({
      type: "streamStart",
      threadId: "t1",
      messageId: expect.any(String),
    });
  });

  it("posts streamDelta for text chunks", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([
        { type: "text-delta", textDelta: "Hello " },
        { type: "text-delta", textDelta: "world" },
      ]) as unknown as ReturnType<typeof streamText>;
    });

    await handler.handleSendMessage([userMessage], { model: mockModel }, postToWebview, "t1");

    const deltas = postedEvents.filter((e) => e.type === "streamDelta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({
      type: "streamDelta",
      delta: { type: "text", text: "Hello " },
    });
    expect(deltas[1]).toMatchObject({
      type: "streamDelta",
      delta: { type: "text", text: "world" },
    });
  });

  it("posts streamEnd on completion", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([]) as unknown as ReturnType<typeof streamText>;
    });

    await handler.handleSendMessage([userMessage], { model: mockModel }, postToWebview, "t1");

    const endEvents = postedEvents.filter((e) => e.type === "streamEnd");
    expect(endEvents).toHaveLength(1);
  });

  it("returns the complete assistant message", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([
        { type: "text-delta", textDelta: "Response" },
      ]) as unknown as ReturnType<typeof streamText>;
    });

    const result = await handler.handleSendMessage(
      [userMessage],
      { model: mockModel },
      postToWebview,
      "t1",
    );

    expect(result.role).toBe("assistant");
    expect(result.content).toEqual([{ type: "text", text: "Response" }]);
    expect(result.id).toBeDefined();
    expect(result.createdAt).toBeDefined();
  });

  it("merges consecutive text deltas in the returned message", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([
        { type: "text-delta", textDelta: "Hello " },
        { type: "text-delta", textDelta: "world" },
      ]) as unknown as ReturnType<typeof streamText>;
    });

    const result = await handler.handleSendMessage(
      [userMessage],
      { model: mockModel },
      postToWebview,
      "t1",
    );

    // Should merge into a single text part
    expect(result.content).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("handles tool-call chunks", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([
        {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "readFile",
          args: { path: "/foo" },
        },
      ]) as unknown as ReturnType<typeof streamText>;
    });

    const result = await handler.handleSendMessage(
      [userMessage],
      { model: mockModel },
      postToWebview,
      "t1",
    );

    const toolDelta = postedEvents.find(
      (e) => e.type === "streamDelta" && e.delta.type === "tool-call",
    );
    expect(toolDelta).toBeDefined();

    expect(result.content).toContainEqual({
      type: "tool-call",
      toolCallId: "tc1",
      toolName: "readFile",
      args: { path: "/foo" },
    });
  });

  it("posts streamError when fullStream throws", async () => {
    mockStreamText.mockImplementation(() => {
      async function* errorStream() {
        throw new Error("Rate limit exceeded");
      }
      return {
        fullStream: errorStream(),
        text: Promise.resolve(""),
      } as unknown as ReturnType<typeof streamText>;
    });

    await expect(
      handler.handleSendMessage([userMessage], { model: mockModel }, postToWebview, "t1"),
    ).rejects.toThrow("Rate limit exceeded");

    const errorEvents = postedEvents.filter((e) => e.type === "streamError");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toMatchObject({
      type: "streamError",
      error: "Rate limit exceeded",
    });
  });

  it("posts streamError when fullStream yields an error chunk", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([
        { type: "text-delta", textDelta: "partial" },
        { type: "error", error: new Error("Unauthorized: invalid API key") },
      ]) as unknown as ReturnType<typeof streamText>;
    });

    await expect(
      handler.handleSendMessage([userMessage], { model: mockModel }, postToWebview, "t1"),
    ).rejects.toThrow("Unauthorized: invalid API key");

    const errorEvents = postedEvents.filter((e) => e.type === "streamError");
    expect(errorEvents).toHaveLength(1);
    // Should be formatted as an API key error
    expect((errorEvents[0] as { error: string }).error).toContain("API key not configured");
  });

  it("posts streamError when fullStream yields an error chunk with string error", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([
        { type: "error", error: "Something went wrong" },
      ]) as unknown as ReturnType<typeof streamText>;
    });

    await expect(
      handler.handleSendMessage([userMessage], { model: mockModel }, postToWebview, "t1"),
    ).rejects.toThrow("Something went wrong");

    const errorEvents = postedEvents.filter((e) => e.type === "streamError");
    expect(errorEvents).toHaveLength(1);
  });

  it("passes config to streamText correctly", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([]) as unknown as ReturnType<typeof streamText>;
    });

    await handler.handleSendMessage(
      [userMessage],
      {
        model: mockModel,
        system: "Be helpful",
        maxSteps: 3,
      },
      postToWebview,
      "t1",
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        system: "Be helpful",
        maxSteps: 3,
      }),
    );
  });

  it("passes abort signal to streamText", async () => {
    mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
      expect(opts.abortSignal).toBeInstanceOf(AbortSignal);
      return createMockStreamResult([]) as unknown as ReturnType<typeof streamText>;
    });

    await handler.handleSendMessage([userMessage], { model: mockModel }, postToWebview, "t1");
  });

  it("cancel() aborts the current stream", async () => {
    mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
      const signal = opts.abortSignal as AbortSignal;
      // Create a fullStream that hangs until aborted
      async function* abortableStream() {
        await new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      return {
        fullStream: abortableStream(),
        text: Promise.resolve(""),
      } as unknown as ReturnType<typeof streamText>;
    });

    const promise = handler.handleSendMessage(
      [userMessage],
      { model: mockModel },
      postToWebview,
      "t1",
    );

    expect(handler.isStreaming).toBe(true);
    handler.cancel();

    const result = await promise;
    expect(result.metadata?.status).toBe("cancelled");
  });

  it("isStreaming is false when not streaming", () => {
    expect(handler.isStreaming).toBe(false);
  });

  it("isStreaming returns to false after an error", async () => {
    mockStreamText.mockImplementation(() => {
      async function* errorStream() {
        throw new Error("fail");
      }
      return {
        fullStream: errorStream(),
        text: Promise.resolve(""),
      } as unknown as ReturnType<typeof streamText>;
    });

    await expect(
      handler.handleSendMessage([userMessage], { model: mockModel }, postToWebview, "t1"),
    ).rejects.toThrow();

    expect(handler.isStreaming).toBe(false);
  });

  it("isStreaming returns to false after stream error chunk", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([
        { type: "error", error: "oops" },
      ]) as unknown as ReturnType<typeof streamText>;
    });

    await expect(
      handler.handleSendMessage([userMessage], { model: mockModel }, postToWebview, "t1"),
    ).rejects.toThrow();

    expect(handler.isStreaming).toBe(false);
  });

  it("ignores unknown chunk types", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([
        { type: "unknown-type", data: "something" },
      ]) as unknown as ReturnType<typeof streamText>;
    });

    const result = await handler.handleSendMessage(
      [userMessage],
      { model: mockModel },
      postToWebview,
      "t1",
    );

    const deltas = postedEvents.filter((e) => e.type === "streamDelta");
    expect(deltas).toHaveLength(0);
    expect(result.content).toEqual([]);
  });

  it("skips non-content chunks like finish and step-finish", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockStreamResult([
        { type: "text-delta", textDelta: "Hi" },
        { type: "step-finish", finishReason: "stop", usage: {} },
        { type: "text-delta", textDelta: " there" },
        { type: "finish", finishReason: "stop", usage: {} },
      ]) as unknown as ReturnType<typeof streamText>;
    });

    const result = await handler.handleSendMessage(
      [userMessage],
      { model: mockModel },
      postToWebview,
      "t1",
    );

    // Only text deltas should produce streamDelta events
    const deltas = postedEvents.filter((e) => e.type === "streamDelta");
    expect(deltas).toHaveLength(2);
    // Consecutive text deltas should be merged in the returned content
    expect(result.content).toEqual([{ type: "text", text: "Hi there" }]);
  });

  it("formats API key errors with a helpful message", async () => {
    mockStreamText.mockImplementation(() => {
      async function* errorStream() {
        throw new Error("ANTHROPIC_API_KEY is not set");
      }
      return {
        fullStream: errorStream(),
        text: Promise.resolve(""),
      } as unknown as ReturnType<typeof streamText>;
    });

    await expect(
      handler.handleSendMessage([userMessage], { model: mockModel }, postToWebview, "t1"),
    ).rejects.toThrow();

    const errorEvents = postedEvents.filter((e) => e.type === "streamError");
    expect(errorEvents).toHaveLength(1);
    const errorMsg = (errorEvents[0] as { error: string }).error;
    expect(errorMsg).toContain("API key not configured");
    expect(errorMsg).toContain("ANTHROPIC_API_KEY is not set");
  });
});
