import { describe, it, expect } from "vitest";
import { toCoreMessages } from "../message-converter.js";
import type { ChatMessage } from "@vscode-ai-chat/core";

describe("toCoreMessages", () => {
  it("converts a user text message", () => {
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", content: [{ type: "text", text: "Hello" }] },
    ];
    const result = toCoreMessages(messages);
    expect(result).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("converts a multi-part user message", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: [
          { type: "text", text: "Part 1" },
          { type: "text", text: "Part 2" },
        ],
      },
    ];
    const result = toCoreMessages(messages);
    expect(result).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Part 1" },
          { type: "text", text: "Part 2" },
        ],
      },
    ]);
  });

  it("converts a system message", () => {
    const messages: ChatMessage[] = [
      { id: "s1", role: "system", content: [{ type: "text", text: "Be helpful." }] },
    ];
    const result = toCoreMessages(messages);
    expect(result).toEqual([{ role: "system", content: "Be helpful." }]);
  });

  it("converts an assistant text message", () => {
    const messages: ChatMessage[] = [
      { id: "a1", role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
    ];
    const result = toCoreMessages(messages);
    expect(result).toEqual([{ role: "assistant", content: [{ type: "text", text: "Hi there!" }] }]);
  });

  it("converts assistant message with tool calls", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "readFile",
            args: { path: "/foo" },
          },
        ],
      },
    ];
    const result = toCoreMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "readFile",
          args: { path: "/foo" },
        },
      ],
    });
  });

  it("splits assistant tool-result parts into a separate tool message", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc1", toolName: "readFile", args: { path: "/foo" } },
          { type: "tool-result", toolCallId: "tc1", toolName: "readFile", result: "contents" },
        ],
      },
    ];
    const result = toCoreMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "tc1", toolName: "readFile", args: { path: "/foo" } },
      ],
    });
    expect(result[1]).toEqual({
      role: "tool",
      content: [
        { type: "tool-result", toolCallId: "tc1", toolName: "readFile", result: "contents" },
      ],
    });
  });

  it("handles a full conversation", () => {
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", content: [{ type: "text", text: "Hello" }] },
      { id: "m2", role: "assistant", content: [{ type: "text", text: "Hi!" }] },
      { id: "m3", role: "user", content: [{ type: "text", text: "Read /foo" }] },
    ];
    const result = toCoreMessages(messages);
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("handles empty messages array", () => {
    expect(toCoreMessages([])).toEqual([]);
  });

  it("converts user message with base64 image content", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: [
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png", alt: "screenshot" },
        ],
      },
    ];
    const result = toCoreMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    const content = (result[0] as { content: unknown[] }).content;
    expect(content[0]).toEqual(
      expect.objectContaining({
        type: "image",
        image: "iVBORw0KGgo=",
        mimeType: "image/png",
      }),
    );
  });

  it("converts user message with URL image content", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: [
          { type: "image", url: "https://example.com/img.png", mimeType: "image/png" },
        ],
      },
    ];
    const result = toCoreMessages(messages);
    const content = (result[0] as { content: unknown[] }).content;
    const imgPart = content[0] as Record<string, unknown>;
    expect(imgPart.type).toBe("image");
    expect(imgPart.image).toBeInstanceOf(URL);
    expect((imgPart.image as URL).href).toBe("https://example.com/img.png");
  });

  it("converts user message with text file content", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: [
          { type: "file", name: "code.ts", mimeType: "text/typescript", size: 14, textContent: "const x = 1;" },
        ],
      },
    ];
    const result = toCoreMessages(messages);
    // Single text part gets simplified to string
    expect(result[0]).toEqual({
      role: "user",
      content: "[File: code.ts]\nconst x = 1;",
    });
  });

  it("converts user message with binary file content", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: [
          { type: "file", name: "data.pdf", mimeType: "application/pdf", size: 4096, data: "JVBERi0xLjQ=" },
        ],
      },
    ];
    const result = toCoreMessages(messages);
    const content = (result[0] as { content: unknown[] }).content;
    expect(content[0]).toEqual(
      expect.objectContaining({
        type: "file",
        data: "JVBERi0xLjQ=",
        mimeType: "application/pdf",
      }),
    );
  });

  it("converts user message with mixed text and image", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", data: "base64data", mimeType: "image/jpeg" },
        ],
      },
    ];
    const result = toCoreMessages(messages);
    const content = (result[0] as { content: unknown[] }).content;
    expect(content).toHaveLength(2);
    expect((content[0] as Record<string, unknown>).type).toBe("text");
    expect((content[1] as Record<string, unknown>).type).toBe("image");
  });

  it("ignores file parts with no textContent and no data", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: [
          { type: "file", name: "empty.bin", mimeType: "application/octet-stream", size: 0 },
        ],
      },
    ];
    const result = toCoreMessages(messages);
    // No usable content - should produce empty content
    expect(result[0]).toEqual({ role: "user", content: "" });
  });

  it("ignores image parts with no data and no url", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: [
          { type: "image", mimeType: "image/png" },
        ],
      },
    ];
    const result = toCoreMessages(messages);
    expect(result[0]).toEqual({ role: "user", content: "" });
  });
});
