import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamingChatHandler } from "../streaming.js";
import type { HostToWebviewEvent, ChatMessage } from "@vscode-ai-chat/core";

vi.mock("ai", () => ({
  streamText: vi.fn(),
}));

import { streamText } from "ai";
const mockStreamText = vi.mocked(streamText);

/** Helper to create a mock streamText result with fullStream async iterable */
function createMockResult(chunks: Array<Record<string, unknown>> = []) {
  async function* makeStream() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }
  return {
    fullStream: makeStream(),
    text: Promise.resolve(""),
  } as unknown as ReturnType<typeof streamText>;
}

describe("Tool Execution", () => {
  let handler: StreamingChatHandler;
  let postedEvents: HostToWebviewEvent[];
  let postToWebview: (event: HostToWebviewEvent) => void;

  const userMessage: ChatMessage = {
    id: "m1",
    role: "user",
    content: [{ type: "text", text: "Read the file /foo.txt" }],
  };

  const mockModel = { modelId: "test-model" } as never;
  const mockTools = {
    readFile: {
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      execute: vi.fn(async ({ path }: { path: string }) => `Contents of ${path}`),
    },
  };

  beforeEach(() => {
    handler = new StreamingChatHandler();
    postedEvents = [];
    postToWebview = (event) => postedEvents.push(event);
    vi.clearAllMocks();
  });

  it("passes tools to streamText", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockResult();
    });

    await handler.handleSendMessage(
      [userMessage],
      { model: mockModel, tools: mockTools as never },
      postToWebview,
      "t1",
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: mockTools,
      }),
    );
  });

  it("streams tool-call and tool-result chunks to webview", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockResult([
        {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "readFile",
          args: { path: "/foo.txt" },
        },
        {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "readFile",
          result: "Contents of /foo.txt",
        },
        { type: "text-delta", textDelta: "The file contains: Contents of /foo.txt" },
      ]);
    });

    const result = await handler.handleSendMessage(
      [userMessage],
      { model: mockModel, tools: mockTools as never },
      postToWebview,
      "t1",
    );

    // Check streamed events
    const deltas = postedEvents.filter((e) => e.type === "streamDelta");
    expect(deltas).toHaveLength(3);

    // Tool call delta
    const toolCallDelta = deltas[0]!;
    expect(toolCallDelta).toMatchObject({
      type: "streamDelta",
      delta: {
        type: "tool-call",
        toolCallId: "tc1",
        toolName: "readFile",
        args: { path: "/foo.txt" },
      },
    });

    // Tool result delta
    const toolResultDelta = deltas[1]!;
    expect(toolResultDelta).toMatchObject({
      type: "streamDelta",
      delta: {
        type: "tool-result",
        toolCallId: "tc1",
        toolName: "readFile",
        result: "Contents of /foo.txt",
      },
    });

    // Text delta after tool use
    const textDelta = deltas[2]!;
    expect(textDelta).toMatchObject({
      type: "streamDelta",
      delta: {
        type: "text",
        text: "The file contains: Contents of /foo.txt",
      },
    });

    // Check returned message content
    expect(result.content).toHaveLength(3);
    expect(result.content[0]!.type).toBe("tool-call");
    expect(result.content[1]!.type).toBe("tool-result");
    expect(result.content[2]!.type).toBe("text");
  });

  it("uses default maxSteps of 5 when not configured", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockResult();
    });

    await handler.handleSendMessage(
      [userMessage],
      { model: mockModel, tools: mockTools as never },
      postToWebview,
      "t1",
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSteps: 5,
      }),
    );
  });

  it("uses custom maxSteps when configured", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockResult();
    });

    await handler.handleSendMessage(
      [userMessage],
      { model: mockModel, tools: mockTools as never, maxSteps: 10 },
      postToWebview,
      "t1",
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSteps: 10,
      }),
    );
  });

  it("works without tools (undefined)", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockResult([
        { type: "text-delta", textDelta: "No tools here" },
      ]);
    });

    const result = await handler.handleSendMessage(
      [userMessage],
      { model: mockModel },
      postToWebview,
      "t1",
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: undefined,
      }),
    );

    expect(result.content).toEqual([{ type: "text", text: "No tools here" }]);
  });

  it("handles multiple tool calls in sequence", async () => {
    mockStreamText.mockImplementation(() => {
      return createMockResult([
        { type: "tool-call", toolCallId: "tc1", toolName: "readFile", args: { path: "/a" } },
        { type: "tool-result", toolCallId: "tc1", toolName: "readFile", result: "A" },
        { type: "tool-call", toolCallId: "tc2", toolName: "readFile", args: { path: "/b" } },
        { type: "tool-result", toolCallId: "tc2", toolName: "readFile", result: "B" },
        { type: "text-delta", textDelta: "Done" },
      ]);
    });

    const result = await handler.handleSendMessage(
      [userMessage],
      { model: mockModel, tools: mockTools as never },
      postToWebview,
      "t1",
    );

    expect(result.content).toHaveLength(5);
    expect(result.content[0]!.type).toBe("tool-call");
    expect(result.content[1]!.type).toBe("tool-result");
    expect(result.content[2]!.type).toBe("tool-call");
    expect(result.content[3]!.type).toBe("tool-result");
    expect(result.content[4]!.type).toBe("text");
  });
});
