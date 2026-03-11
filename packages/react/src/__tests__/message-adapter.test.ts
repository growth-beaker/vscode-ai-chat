import { describe, it, expect } from "vitest";
import { createElement } from "react";
import {
  toThreadMessageLike,
  fromAppendContent,
  createMessageConverter,
} from "../runtime/message-adapter.js";
import type { ChatMessage } from "@growthbeaker/ai-chat-core";

describe("toThreadMessageLike", () => {
  it("converts a text message", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "user",
      content: [{ type: "text", text: "Hello" }],
      createdAt: new Date("2026-01-01"),
    };
    const result = toThreadMessageLike(msg);
    expect(result.id).toBe("m1");
    expect(result.role).toBe("user");
    expect(result.createdAt).toEqual(new Date("2026-01-01"));
    expect(result.content).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("converts tool-call content parts", () => {
    const msg: ChatMessage = {
      id: "m2",
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "readFile",
          args: { path: "/foo" },
        },
      ],
    };
    const result = toThreadMessageLike(msg);
    const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(part.type).toBe("tool-call");
    expect(part.toolCallId).toBe("tc1");
    expect(part.toolName).toBe("readFile");
    expect(part.args).toEqual({ path: "/foo" });
  });

  it("converts tool-result content parts to tool-call with result", () => {
    const msg: ChatMessage = {
      id: "m3",
      role: "assistant",
      content: [
        {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "readFile",
          result: "file contents",
        },
      ],
    };
    const result = toThreadMessageLike(msg);
    const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(part.type).toBe("tool-call");
    expect(part.toolCallId).toBe("tc1");
    expect(part.result).toBe("file contents");
  });

  it("converts data content parts to text fallback without renderers", () => {
    const msg: ChatMessage = {
      id: "m4",
      role: "assistant",
      content: [
        {
          type: "data",
          name: "code-diff",
          data: { before: "a", after: "b" },
        },
      ],
    };
    const result = toThreadMessageLike(msg);
    const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(part.type).toBe("text");
    expect(part.text).toBe('[code-diff]: {"before":"a","after":"b"}');
  });

  it("handles mixed content", () => {
    const msg: ChatMessage = {
      id: "m5",
      role: "assistant",
      content: [
        { type: "text", text: "Let me read that file." },
        { type: "tool-call", toolCallId: "tc1", toolName: "readFile", args: { path: "/foo" } },
      ],
    };
    const result = toThreadMessageLike(msg);
    expect((result.content as unknown[]).length).toBe(2);
  });

  it("handles empty content", () => {
    const msg: ChatMessage = { id: "m6", role: "assistant", content: [] };
    const result = toThreadMessageLike(msg);
    expect(result.content).toEqual([]);
  });

  it("converts image with base64 data to image content part", () => {
    const msg: ChatMessage = {
      id: "m7",
      role: "user",
      content: [
        { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png", alt: "screenshot" },
      ],
    };
    const result = toThreadMessageLike(msg);
    const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(part.type).toBe("image");
    expect(part.image).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("converts image with URL to image content part", () => {
    const msg: ChatMessage = {
      id: "m8",
      role: "user",
      content: [
        { type: "image", url: "https://example.com/img.png", mimeType: "image/png" },
      ],
    };
    const result = toThreadMessageLike(msg);
    const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(part.type).toBe("image");
    expect(part.image).toBe("https://example.com/img.png");
  });

  it("converts image with no data or URL to empty image src", () => {
    const msg: ChatMessage = {
      id: "m9",
      role: "user",
      content: [
        { type: "image", mimeType: "image/png" },
      ],
    };
    const result = toThreadMessageLike(msg);
    const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(part.type).toBe("image");
    expect(part.image).toBe("");
  });

  it("converts file with text content to text content part", () => {
    const msg: ChatMessage = {
      id: "m10",
      role: "user",
      content: [
        { type: "file", name: "main.ts", mimeType: "text/typescript", size: 100, textContent: "const x = 1;" },
      ],
    };
    const result = toThreadMessageLike(msg);
    const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(part.type).toBe("text");
    expect(part.text).toContain("**main.ts:**");
    expect(part.text).toContain("const x = 1;");
    expect(part.text).toContain("```");
  });

  it("converts binary file to text content part with size", () => {
    const msg: ChatMessage = {
      id: "m11",
      role: "user",
      content: [
        { type: "file", name: "photo.jpg", mimeType: "image/jpeg", size: 2048 },
      ],
    };
    const result = toThreadMessageLike(msg);
    const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(part.type).toBe("text");
    expect(part.text).toContain("**photo.jpg**");
    expect(part.text).toContain("2.0 KB");
  });

  it("formats file sizes correctly", () => {
    // Bytes
    const msgBytes: ChatMessage = {
      id: "m12a",
      role: "user",
      content: [{ type: "file", name: "tiny.bin", mimeType: "application/octet-stream", size: 500 }],
    };
    const partBytes = (toThreadMessageLike(msgBytes).content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(partBytes.text).toContain("500 B");

    // KB
    const msgKB: ChatMessage = {
      id: "m12b",
      role: "user",
      content: [{ type: "file", name: "medium.bin", mimeType: "application/octet-stream", size: 5120 }],
    };
    const partKB = (toThreadMessageLike(msgKB).content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(partKB.text).toContain("5.0 KB");

    // MB
    const msgMB: ChatMessage = {
      id: "m12c",
      role: "user",
      content: [{ type: "file", name: "big.bin", mimeType: "application/octet-stream", size: 3 * 1024 * 1024 }],
    };
    const partMB = (toThreadMessageLike(msgMB).content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(partMB.text).toContain("3.0 MB");
  });
});

describe("fromAppendContent", () => {
  it("extracts text parts", () => {
    const content = [
      { type: "text", text: "Hello world" },
      { type: "text", text: "Second part" },
    ];
    const result = fromAppendContent(content);
    expect(result).toEqual([
      { type: "text", text: "Hello world" },
      { type: "text", text: "Second part" },
    ]);
  });

  it("filters out non-text parts", () => {
    const content = [
      { type: "text", text: "Hello" },
      { type: "image", url: "data:..." },
    ];
    const result = fromAppendContent(content);
    expect(result).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("returns empty array for empty input", () => {
    expect(fromAppendContent([])).toEqual([]);
  });
});

describe("createMessageConverter", () => {
  it("returns a converter function", () => {
    const converter = createMessageConverter();
    expect(typeof converter).toBe("function");
  });

  it("converts text messages like toThreadMessageLike", () => {
    const converter = createMessageConverter();
    const msg: ChatMessage = {
      id: "m1",
      role: "user",
      content: [{ type: "text", text: "Hello" }],
    };
    const result = converter(msg);
    expect(result.content).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("renders data parts with registered renderer as UIContentPart", () => {
    function DiffRenderer({ data }: { data: unknown }) {
      return createElement("div", null, JSON.stringify(data));
    }

    const converter = createMessageConverter({ "code-diff": DiffRenderer });
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: [
        {
          type: "data",
          name: "code-diff",
          data: { before: "a", after: "b" },
        },
      ],
    };
    const result = converter(msg);
    const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(part.type).toBe("ui");
    expect(part.display).toBeDefined();
  });

  it("falls back to text for unregistered data parts", () => {
    function OtherRenderer({ data }: { data: unknown }) {
      return createElement("div", null, String(data));
    }

    const converter = createMessageConverter({ "other-type": OtherRenderer });
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: [
        {
          type: "data",
          name: "code-diff",
          data: { before: "a" },
        },
      ],
    };
    const result = converter(msg);
    const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
    expect(part.type).toBe("text");
    expect(part.text).toBe('[code-diff]: {"before":"a"}');
  });

  it("handles mixed content with data parts", () => {
    function CardRenderer({ data }: { data: unknown }) {
      return createElement("div", null, String(data));
    }

    const converter = createMessageConverter({ card: CardRenderer });
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: [
        { type: "text", text: "Here is a card:" },
        { type: "data", name: "card", data: { title: "Test" } },
        { type: "data", name: "unknown-card", data: {} },
      ],
    };
    const result = converter(msg);
    const parts = result.content as unknown as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(3);
    expect(parts[0]!.type).toBe("text");
    expect(parts[1]!.type).toBe("ui");
    expect(parts[2]!.type).toBe("text");
  });
});
