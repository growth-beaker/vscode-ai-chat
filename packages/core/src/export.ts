import type { ChatThread } from "./types/thread.js";
import type { ChatContentPart } from "./types/messages.js";

/** Export a thread as JSON string */
export function exportThreadAsJSON(thread: ChatThread): string {
  return JSON.stringify(thread, null, 2);
}

/** Export a thread as Markdown string */
export function exportThreadAsMarkdown(thread: ChatThread): string {
  const lines: string[] = [];

  if (thread.title) {
    lines.push(`# ${thread.title}`);
  } else {
    lines.push("# Chat Conversation");
  }
  lines.push("");

  for (const msg of thread.messages) {
    const roleLabel = msg.role === "user" ? "**User**" : msg.role === "assistant" ? "**Assistant**" : "**System**";
    lines.push(`### ${roleLabel}`);
    if (msg.createdAt) {
      lines.push(`_${new Date(msg.createdAt).toLocaleString()}_`);
    }
    lines.push("");

    for (const part of msg.content) {
      lines.push(contentPartToMarkdown(part));
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function contentPartToMarkdown(part: ChatContentPart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "tool-call":
      return `> **Tool Call:** \`${part.toolName}\`\n> \`\`\`json\n> ${JSON.stringify(part.args, null, 2).split("\n").join("\n> ")}\n> \`\`\``;
    case "tool-result":
      return `> **Tool Result** (\`${part.toolName}\`):\n> \`\`\`\n> ${String(part.result)}\n> \`\`\``;
    case "image":
      return part.alt ? `![${part.alt}](image)` : "![image](image)";
    case "file":
      if (part.textContent) {
        return `**Attached file:** \`${part.name}\`\n\`\`\`\n${part.textContent}\n\`\`\``;
      }
      return `**Attached file:** \`${part.name}\` (${formatBytes(part.size)})`;
    case "data":
      return `[${part.name}]: ${JSON.stringify(part.data)}`;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
