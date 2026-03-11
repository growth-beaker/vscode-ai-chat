import { streamText } from "ai";
import type { LanguageModel } from "ai";
import type { ChatMessage, ChatContentPart, HostToWebviewEvent, TokenUsage } from "@vscode-ai-chat/core";
import { generateId } from "@vscode-ai-chat/core";
import { toCoreMessages } from "./message-converter.js";
import type { ToolDefinitions } from "./types.js";

export interface StreamingConfig {
  model: LanguageModel;
  system?: string;
  tools?: ToolDefinitions;
  maxSteps?: number;
  /** Called after each tool execution completes. Errors are logged but don't interrupt the stream. */
  onToolResult?: (toolName: string, args: unknown, result: unknown) => void | Promise<void>;
}

/**
 * Handles LLM streaming for a single generation request.
 * Streams chunks to the webview and returns the complete assistant message.
 */
export class StreamingChatHandler {
  private abortController: AbortController | null = null;

  /**
   * Handle a user message: stream an LLM response and post chunks to the webview.
   * Returns the complete assistant ChatMessage when done.
   */
  async handleSendMessage(
    history: ChatMessage[],
    config: StreamingConfig,
    postToWebview: (event: HostToWebviewEvent) => void,
    threadId: string,
  ): Promise<ChatMessage> {
    const assistantMessageId = generateId();
    const contentParts: ChatContentPart[] = [];

    this.abortController = new AbortController();

    console.log("[vscode-ai-chat] StreamingHandler: posting streamStart");
    postToWebview({
      type: "streamStart",
      threadId,
      messageId: assistantMessageId,
    });

    try {
      const coreMessages = toCoreMessages(history);
      console.log("[vscode-ai-chat] StreamingHandler: calling streamText with", history.length, "messages, coreMessages:", JSON.stringify(coreMessages).slice(0, 500));
      const result = streamText({
        model: config.model,
        system: config.system,
        messages: coreMessages,
        tools: config.tools,
        maxSteps: config.maxSteps ?? 5,
        abortSignal: this.abortController.signal,
        onError: ({ error }) => {
          console.error("[vscode-ai-chat] StreamingHandler onError callback:", error);
        },
      });

      // Consume the stream via fullStream iteration — more reliable than await result.text
      console.log("[vscode-ai-chat] StreamingHandler: consuming fullStream");
      let usage: TokenUsage | undefined;
      for await (const chunk of result.fullStream) {
        const streamChunk = chunk as StreamChunk;

        // Handle error chunks from the stream (e.g. auth failures, rate limits)
        if (streamChunk.type === "error") {
          const err = streamChunk.error;
          console.error("[vscode-ai-chat] StreamingHandler: stream error chunk:", err);
          const rawMessage = err instanceof Error ? err.message : String(err);
          throw new Error(rawMessage);
        }

        // Capture token usage from finish chunks
        if (streamChunk.type === "finish" || streamChunk.type === "step-finish") {
          const chunkUsage = streamChunk.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
          if (chunkUsage) {
            if (!usage) {
              usage = {
                promptTokens: chunkUsage.promptTokens ?? 0,
                completionTokens: chunkUsage.completionTokens ?? 0,
                totalTokens: chunkUsage.totalTokens ?? 0,
              };
            } else {
              // Accumulate across steps
              usage.promptTokens += chunkUsage.promptTokens ?? 0;
              usage.completionTokens += chunkUsage.completionTokens ?? 0;
              usage.totalTokens += chunkUsage.totalTokens ?? 0;
            }
          }
        }

        // Fire onToolResult callback for tool-result chunks
        if (streamChunk.type === "tool-result" && config.onToolResult) {
          try {
            const maybePromise = config.onToolResult(
              streamChunk.toolName as string,
              streamChunk.args as unknown,
              streamChunk.result as unknown,
            );
            if (maybePromise) await maybePromise;
          } catch (err) {
            console.error("[vscode-ai-chat] onToolResult callback error:", err);
          }
        }

        const delta = chunkToContentPart(streamChunk);
        if (delta) {
          // Merge consecutive text into existing text part
          if (delta.type === "text") {
            const last = contentParts[contentParts.length - 1];
            if (last && last.type === "text") {
              last.text += delta.text;
            } else {
              contentParts.push({ ...delta });
            }
          } else {
            contentParts.push({ ...delta });
          }

          postToWebview({
            type: "streamDelta",
            threadId,
            messageId: assistantMessageId,
            delta,
          });
        }
      }
      console.log("[vscode-ai-chat] StreamingHandler: stream consumption complete, usage:", usage);

      postToWebview({
        type: "streamEnd",
        threadId,
        messageId: assistantMessageId,
        usage,
      });

      this.abortController = null;

      return {
        id: assistantMessageId,
        role: "assistant",
        content: contentParts,
        createdAt: new Date(),
        metadata: usage ? { usage } : undefined,
      };
    } catch (error) {
      this.abortController = null;

      // Don't treat abort as an error
      if (error instanceof Error && error.name === "AbortError") {
        postToWebview({
          type: "streamEnd",
          threadId,
          messageId: assistantMessageId,
        });

        return {
          id: assistantMessageId,
          role: "assistant",
          content: contentParts,
          createdAt: new Date(),
          metadata: { status: "cancelled" },
        };
      }

      const rawMessage = error instanceof Error ? error.message : "An unknown error occurred";
      const errorMessage = formatErrorMessage(rawMessage);

      postToWebview({
        type: "streamError",
        threadId,
        error: errorMessage,
      });

      throw error;
    }
  }

  /** Cancel the current generation */
  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /** Whether a generation is currently in progress */
  get isStreaming(): boolean {
    return this.abortController !== null;
  }
}

interface StreamChunk {
  type: string;
  [key: string]: unknown;
}

const API_KEY_PATTERNS = [
  /api.?key/i,
  /auth/i,
  /unauthorized/i,
  /401/,
  /ANTHROPIC_API_KEY/,
  /OPENAI_API_KEY/,
  /GOOGLE_GENERATIVE_AI_API_KEY/,
  /credential/i,
  /not.?set/i,
  /missing/i,
];

function formatErrorMessage(raw: string): string {
  if (API_KEY_PATTERNS.some((p) => p.test(raw))) {
    return `API key not configured. Set the appropriate API key environment variable (e.g. ANTHROPIC_API_KEY) in the terminal where VS Code was launched, then restart VS Code.\n\nOriginal error: ${raw}`;
  }
  return raw;
}

function chunkToContentPart(chunk: StreamChunk): ChatContentPart | null {
  switch (chunk.type) {
    case "text-delta":
    case "text":
      return {
        type: "text",
        text: (chunk.textDelta as string) ?? (chunk.text as string) ?? "",
      };
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: chunk.toolCallId as string,
        toolName: chunk.toolName as string,
        args: chunk.args as unknown,
      };
    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: chunk.toolCallId as string,
        toolName: chunk.toolName as string,
        result: chunk.result as unknown,
      };
    default:
      return null;
  }
}
