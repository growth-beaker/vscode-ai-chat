import { describe, it, expect } from "vitest";
import { exportThreadAsJSON, exportThreadAsMarkdown } from "../export.js";
import type { ChatThread } from "../types/thread.js";
import type { ChatMessage } from "../types/messages.js";

function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: "t1",
    messages: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">): ChatMessage {
  return overrides;
}

describe("exportThreadAsJSON", () => {
  it("returns valid JSON for an empty thread", () => {
    const thread = makeThread();
    const json = exportThreadAsJSON(thread);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe("t1");
    expect(parsed.messages).toEqual([]);
  });

  it("preserves all message fields", () => {
    const thread = makeThread({
      title: "Test Thread",
      messages: [
        makeMessage({
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
          createdAt: new Date("2026-01-01T12:00:00Z"),
        }),
        makeMessage({
          id: "m2",
          role: "assistant",
          content: [{ type: "text", text: "Hi there!" }],
        }),
      ],
    });
    const parsed = JSON.parse(exportThreadAsJSON(thread));
    expect(parsed.title).toBe("Test Thread");
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].content[0].text).toBe("Hello");
    expect(parsed.messages[1].content[0].text).toBe("Hi there!");
  });

  it("includes tool-call and tool-result parts", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "tc1", toolName: "readFile", args: { path: "/foo" } },
            { type: "tool-result", toolCallId: "tc1", toolName: "readFile", result: "file contents" },
          ],
        }),
      ],
    });
    const parsed = JSON.parse(exportThreadAsJSON(thread));
    expect(parsed.messages[0].content[0].type).toBe("tool-call");
    expect(parsed.messages[0].content[0].toolName).toBe("readFile");
    expect(parsed.messages[0].content[1].type).toBe("tool-result");
    expect(parsed.messages[0].content[1].result).toBe("file contents");
  });

  it("includes image, file, and data parts", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "user",
          content: [
            { type: "image", data: "base64data", mimeType: "image/png", alt: "screenshot" },
            { type: "file", name: "code.ts", mimeType: "text/typescript", size: 1024, textContent: "const x = 1;" },
            { type: "data", name: "card", data: { title: "Test" } },
          ],
        }),
      ],
    });
    const parsed = JSON.parse(exportThreadAsJSON(thread));
    const parts = parsed.messages[0].content;
    expect(parts[0].type).toBe("image");
    expect(parts[0].alt).toBe("screenshot");
    expect(parts[1].type).toBe("file");
    expect(parts[1].textContent).toBe("const x = 1;");
    expect(parts[2].type).toBe("data");
    expect(parts[2].data.title).toBe("Test");
  });

  it("produces pretty-printed JSON with 2-space indent", () => {
    const thread = makeThread();
    const json = exportThreadAsJSON(thread);
    expect(json).toContain("\n");
    expect(json).toContain("  ");
  });
});

describe("exportThreadAsMarkdown", () => {
  it("uses thread title as heading when available", () => {
    const thread = makeThread({ title: "My Conversation" });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("# My Conversation");
  });

  it("uses fallback heading for untitled threads", () => {
    const thread = makeThread();
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("# Chat Conversation");
  });

  it("renders user and assistant role labels", () => {
    const thread = makeThread({
      messages: [
        makeMessage({ id: "m1", role: "user", content: [{ type: "text", text: "Hello" }] }),
        makeMessage({ id: "m2", role: "assistant", content: [{ type: "text", text: "Hi!" }] }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("### **User**");
    expect(md).toContain("### **Assistant**");
  });

  it("renders system role label", () => {
    const thread = makeThread({
      messages: [
        makeMessage({ id: "s1", role: "system", content: [{ type: "text", text: "Be helpful." }] }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("### **System**");
  });

  it("renders text content directly", () => {
    const thread = makeThread({
      messages: [
        makeMessage({ id: "m1", role: "user", content: [{ type: "text", text: "Hello world" }] }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("Hello world");
  });

  it("renders tool-call as blockquote with tool name and args", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "tc1", toolName: "readFile", args: { path: "/foo" } },
          ],
        }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("> **Tool Call:** `readFile`");
    expect(md).toContain('"/foo"');
  });

  it("renders tool-result as blockquote with result", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "assistant",
          content: [
            { type: "tool-result", toolCallId: "tc1", toolName: "readFile", result: "file contents" },
          ],
        }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("> **Tool Result** (`readFile`):");
    expect(md).toContain("file contents");
  });

  it("renders image with alt text", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "user",
          content: [
            { type: "image", data: "base64data", mimeType: "image/png", alt: "screenshot" },
          ],
        }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("![screenshot](image)");
  });

  it("renders image without alt text using default", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "user",
          content: [
            { type: "image", data: "base64data", mimeType: "image/png" },
          ],
        }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("![image](image)");
  });

  it("renders file with text content in code block", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "user",
          content: [
            { type: "file", name: "main.ts", mimeType: "text/typescript", size: 100, textContent: "const x = 1;" },
          ],
        }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("**Attached file:** `main.ts`");
    expect(md).toContain("```\nconst x = 1;\n```");
  });

  it("renders binary file with size", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "user",
          content: [
            { type: "file", name: "image.bin", mimeType: "application/octet-stream", size: 2048 },
          ],
        }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("**Attached file:** `image.bin` (2.0 KB)");
  });

  it("formats bytes correctly", () => {
    // Small file
    const thread1 = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "user",
          content: [{ type: "file", name: "tiny.bin", mimeType: "application/octet-stream", size: 500 }],
        }),
      ],
    });
    expect(exportThreadAsMarkdown(thread1)).toContain("500 B");

    // MB file
    const thread2 = makeThread({
      messages: [
        makeMessage({
          id: "m2",
          role: "user",
          content: [{ type: "file", name: "big.bin", mimeType: "application/octet-stream", size: 2 * 1024 * 1024 }],
        }),
      ],
    });
    expect(exportThreadAsMarkdown(thread2)).toContain("2.0 MB");
  });

  it("renders data parts as name-value pairs", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "assistant",
          content: [
            { type: "data", name: "progress", data: { step: 1, total: 5 } },
          ],
        }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("[progress]: ");
    expect(md).toContain('"step":1');
  });

  it("includes message timestamp when createdAt is set", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "hi" }],
          createdAt: new Date("2026-01-15T10:30:00Z"),
        }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    // Should contain an italic timestamp
    expect(md).toMatch(/_.*2026.*/);
  });

  it("separates messages with horizontal rules", () => {
    const thread = makeThread({
      messages: [
        makeMessage({ id: "m1", role: "user", content: [{ type: "text", text: "Hello" }] }),
        makeMessage({ id: "m2", role: "assistant", content: [{ type: "text", text: "Hi!" }] }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("---");
  });

  it("handles empty thread with no messages", () => {
    const thread = makeThread();
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("# Chat Conversation");
    expect(md).not.toContain("### **User**");
  });

  it("handles message with multiple content parts", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          id: "m1",
          role: "assistant",
          content: [
            { type: "text", text: "Let me check that file." },
            { type: "tool-call", toolCallId: "tc1", toolName: "readFile", args: { path: "/foo" } },
            { type: "tool-result", toolCallId: "tc1", toolName: "readFile", result: "contents" },
          ],
        }),
      ],
    });
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain("Let me check that file.");
    expect(md).toContain("`readFile`");
    expect(md).toContain("contents");
  });
});
