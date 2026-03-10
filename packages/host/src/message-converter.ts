import type { ChatMessage, ChatContentPart } from "@vscode-ai-chat/core";
import type {
  CoreMessage,
  CoreUserMessage,
  CoreAssistantMessage,
  CoreSystemMessage,
  CoreToolMessage,
} from "ai";

/**
 * Convert our ChatMessage[] to Vercel AI SDK CoreMessage[] format.
 */
export function toCoreMessages(messages: ChatMessage[]): CoreMessage[] {
  const result: CoreMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        result.push(toSystemMessage(msg));
        break;
      case "user":
        result.push(toUserMessage(msg));
        break;
      case "assistant": {
        const { assistantMsg, toolMsg } = toAssistantMessages(msg);
        result.push(assistantMsg);
        if (toolMsg) {
          result.push(toolMsg);
        }
        break;
      }
    }
  }

  return result;
}

function toSystemMessage(msg: ChatMessage): CoreSystemMessage {
  const text = msg.content
    .filter((p): p is Extract<ChatContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
  return { role: "system", content: text };
}

type UserContentPart = Exclude<CoreUserMessage["content"], string>[number];

function toUserMessage(msg: ChatMessage): CoreUserMessage {
  const parts: UserContentPart[] = [];

  for (const p of msg.content) {
    switch (p.type) {
      case "text":
        parts.push({ type: "text" as const, text: p.text });
        break;
      case "image":
        if (p.data) {
          parts.push({
            type: "image" as const,
            image: p.data,
            mimeType: p.mimeType,
          } as UserContentPart);
        } else if (p.url) {
          parts.push({
            type: "image" as const,
            image: new URL(p.url),
            mimeType: p.mimeType,
          } as UserContentPart);
        }
        break;
      case "file":
        // Include text files as text content for the LLM
        if (p.textContent) {
          parts.push({
            type: "text" as const,
            text: `[File: ${p.name}]\n${p.textContent}`,
          });
        } else if (p.data) {
          // Binary files sent as file part (AI SDK v4 supports this)
          parts.push({
            type: "file" as const,
            data: p.data,
            mimeType: p.mimeType,
          } as UserContentPart);
        }
        break;
    }
  }

  // Simplify single text part to string
  if (parts.length === 1 && parts[0]!.type === "text") {
    return { role: "user", content: (parts[0] as { text: string }).text };
  }
  return { role: "user", content: parts.length > 0 ? parts : "" };
}

function toAssistantMessages(msg: ChatMessage): {
  assistantMsg: CoreAssistantMessage;
  toolMsg: CoreToolMessage | null;
} {
  const content: CoreAssistantMessage["content"] = [];
  const toolResults: CoreToolMessage["content"] = [];

  for (const part of msg.content) {
    switch (part.type) {
      case "text":
        content.push({ type: "text", text: part.text });
        break;
      case "tool-call":
        content.push({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.args as Record<string, unknown>,
        });
        break;
      case "tool-result":
        toolResults.push({
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result: part.result,
        });
        break;
    }
  }

  return {
    assistantMsg: { role: "assistant", content },
    toolMsg: toolResults.length > 0 ? { role: "tool", content: toolResults } : null,
  };
}
