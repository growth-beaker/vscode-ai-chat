import { createElement, type ComponentType } from "react";
import type { ChatMessage, ChatContentPart } from "@growthbeaker/ai-chat-core";
import type { ThreadMessageLike } from "@assistant-ui/react";

type ThreadContentPart = Exclude<ThreadMessageLike["content"], string>[number];
type JSONObject = { readonly [key: string]: JSONValue };
type JSONValue = null | string | number | boolean | JSONObject | readonly JSONValue[];

/** Map of data part names to React components that render them */
export type DataPartRenderers = Record<string, ComponentType<{ data: unknown }>>;

/**
 * Create a message converter that handles custom data-part renderers.
 * When a DataContentPart matches a registered renderer, it's converted to a UIContentPart.
 */
export function createMessageConverter(dataParts?: DataPartRenderers) {
  return (msg: ChatMessage): ThreadMessageLike => {
    const content: ThreadContentPart[] = msg.content.map((part) =>
      toThreadContentPart(part, dataParts),
    );
    return {
      id: msg.id,
      role: msg.role,
      content,
      createdAt: msg.createdAt,
    };
  };
}

/**
 * Convert our ChatMessage to assistant-ui's ThreadMessageLike format.
 */
export function toThreadMessageLike(msg: ChatMessage): ThreadMessageLike {
  const content: ThreadContentPart[] = msg.content.map((part) => toThreadContentPart(part));
  return {
    id: msg.id,
    role: msg.role,
    content,
    createdAt: msg.createdAt,
  };
}

function toThreadContentPart(
  part: ChatContentPart,
  dataParts?: DataPartRenderers,
): ThreadContentPart {
  switch (part.type) {
    case "text":
      return { type: "text" as const, text: part.text };
    case "tool-call":
      return {
        type: "tool-call" as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.args as JSONObject,
      };
    case "tool-result":
      return {
        type: "tool-call" as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: {} as JSONObject,
        result: part.result,
      };
    case "image": {
      const src = part.url ?? (part.data ? `data:${part.mimeType};base64,${part.data}` : "");
      return {
        type: "image" as const,
        image: src,
      } as ThreadContentPart;
    }
    case "file": {
      if (part.textContent) {
        return {
          type: "text" as const,
          text: `**${part.name}:**\n\`\`\`\n${part.textContent}\n\`\`\``,
        };
      }
      return {
        type: "text" as const,
        text: `📎 **${part.name}** (${formatFileSize(part.size)})`,
      };
    }
    case "data": {
      const Renderer = dataParts?.[part.name];
      if (Renderer) {
        return {
          type: "ui" as const,
          display: createElement(Renderer, { data: part.data }),
        };
      }
      // Fallback: render as text representation
      return {
        type: "text" as const,
        text: `[${part.name}]: ${JSON.stringify(part.data)}`,
      };
    }
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Convert assistant-ui's append message content back to our ChatContentPart[].
 */
export function fromAppendContent(
  content: Array<{ type: string; text?: string; [key: string]: unknown }>,
): ChatContentPart[] {
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => ({ type: "text" as const, text: part.text }));
}
