import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useExternalStoreRuntime } from "@assistant-ui/react";
import type {
  ChatMessage,
  ChatConfig,
  HostToWebviewEvent,
  ThreadSummary,
} from "@vscode-ai-chat/core";
import { parseEvent, isHostToWebviewEvent, generateId } from "@vscode-ai-chat/core";
import {
  toThreadMessageLike,
  fromAppendContent,
  createMessageConverter,
  type DataPartRenderers,
} from "./message-adapter.js";

/** Minimal VS Code webview API type */
export interface VSCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

// Singleton — acquireVsCodeApi() can only be called once per webview
let cachedVSCodeApi: VSCodeApi | null = null;
function getVSCodeApi(): VSCodeApi | null {
  if (cachedVSCodeApi) return cachedVSCodeApi;
  if (typeof acquireVsCodeApi !== "undefined") {
    cachedVSCodeApi = acquireVsCodeApi();
    return cachedVSCodeApi;
  }
  return null;
}

export interface UseVSCodeRuntimeOptions {
  /** Override the VS Code API (for testing) */
  vscodeApi?: VSCodeApi;
  /** Custom data-part renderers keyed by data part name */
  dataParts?: DataPartRenderers;
}

export interface PendingToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export function useVSCodeRuntime(options: UseVSCodeRuntimeOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const activeThreadId = useRef<string>("default");
  const streamingMessageRef = useRef<ChatMessage | null>(null);

  // Thread list state
  const [threadList, setThreadList] = useState<ThreadSummary[]>([]);

  // Config state (for model switching etc.)
  const [chatConfig, setChatConfig] = useState<Partial<ChatConfig>>({});

  // Pending tool calls awaiting approval
  const [pendingToolCalls, setPendingToolCalls] = useState<PendingToolCall[]>([]);

  // Available templates
  const [templates, setTemplates] = useState<Array<{ id: string; label: string }>>([]);

  // Available slash commands
  const [slashCommands, setSlashCommands] = useState<Array<{ name: string; description: string }>>([]);

  // Token usage from last response
  const [lastUsage, setLastUsage] = useState<{ promptTokens: number; completionTokens: number; totalTokens: number } | null>(null);

  const vscodeApiRef = useRef<VSCodeApi | null>(options.vscodeApi ?? getVSCodeApi());

  const postToHost = useCallback((msg: unknown) => {
    vscodeApiRef.current?.postMessage(msg);
  }, []);

  // Handle incoming messages from the extension host
  const handleHostEvent = useCallback((event: HostToWebviewEvent) => {
    console.log("[vscode-ai-chat/webview] Received host event:", event.type);
    switch (event.type) {
      case "threadState": {
        setMessages(event.thread.messages);
        activeThreadId.current = event.thread.id;
        setIsRunning(false);
        streamingMessageRef.current = null;
        break;
      }
      case "threadList": {
        setThreadList(event.threads);
        break;
      }
      case "streamStart": {
        setIsRunning(true);
        streamingMessageRef.current = {
          id: event.messageId,
          role: "assistant",
          content: [],
        };
        setMessages((prev) => [...prev, streamingMessageRef.current!]);
        break;
      }
      case "streamDelta": {
        if (!streamingMessageRef.current) break;
        const current = streamingMessageRef.current;

        if (event.delta.type === "text") {
          // Merge consecutive text deltas
          const lastPart = current.content[current.content.length - 1];
          if (lastPart && lastPart.type === "text") {
            lastPart.text += event.delta.text;
          } else {
            current.content.push({ ...event.delta });
          }
        } else {
          current.content.push({ ...event.delta });
        }

        // Trigger re-render with new array reference
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...current, content: [...current.content] };
          return updated;
        });
        break;
      }
      case "streamEnd": {
        setIsRunning(false);
        streamingMessageRef.current = null;
        if (event.usage) {
          setLastUsage(event.usage);
        }
        break;
      }
      case "streamError": {
        setIsRunning(false);
        // Append error text to the streaming message so the user can see what went wrong
        if (streamingMessageRef.current) {
          const errorMsg = streamingMessageRef.current;
          errorMsg.content.push({
            type: "text",
            text: `\n\n**Error:** ${event.error}`,
          });
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { ...errorMsg, content: [...errorMsg.content] };
            return updated;
          });
        }
        streamingMessageRef.current = null;
        break;
      }
      case "toolCall": {
        setPendingToolCalls((prev) => [
          ...prev,
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
          },
        ]);
        break;
      }
      case "toolResult": {
        setPendingToolCalls((prev) => prev.filter((tc) => tc.toolCallId !== event.toolCallId));
        break;
      }
      case "templateList": {
        setTemplates(event.templates);
        break;
      }
      case "configUpdate": {
        setChatConfig((prev) => ({ ...prev, ...event.config }));
        break;
      }
      case "slashCommandList": {
        setSlashCommands(event.commands);
        break;
      }
      case "contextMentionResult": {
        // Handled by consumers via the contextMentionResult callback
        break;
      }
    }
  }, []);

  // Listen for postMessage events from the host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const parsed = parseEvent(event.data);
      if (parsed && isHostToWebviewEvent(parsed)) {
        handleHostEvent(parsed);
      }
    };
    console.log("[vscode-ai-chat/webview] Message listener registered");
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [handleHostEvent]);

  // Send ready event on mount
  useEffect(() => {
    postToHost({ type: "ready" });
  }, [postToHost]);

  const convertMessage = useMemo(
    () => (options.dataParts ? createMessageConverter(options.dataParts) : toThreadMessageLike),
    [options.dataParts],
  );

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning,
    onNew: async (message) => {
      console.log("[vscode-ai-chat/webview] onNew called, sending message to host");
      const userMessage: ChatMessage = {
        id: generateId(),
        role: "user",
        content: fromAppendContent(message.content as Array<{ type: string; text?: string }>),
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);
      postToHost({
        type: "sendMessage",
        threadId: activeThreadId.current,
        message: userMessage,
      });
    },
    onCancel: async () => {
      postToHost({
        type: "cancelGeneration",
        threadId: activeThreadId.current,
      });
    },
    onEdit: async (message) => {
      const chatContent = fromAppendContent(
        message.content as Array<{ type: string; text?: string }>,
      );
      postToHost({
        type: "editMessage",
        threadId: activeThreadId.current,
        messageId: message.parentId ?? "",
        content: chatContent,
      });
    },
    onReload: async (parentId) => {
      if (parentId) {
        postToHost({
          type: "reloadMessage",
          threadId: activeThreadId.current,
          messageId: parentId,
        });
      }
    },
    adapters: {
      threadList: {
        threadId: activeThreadId.current,
        threads: threadList.map((t) => ({
          threadId: t.id,
          status: "regular" as const,
          title: t.title,
        })),
        onSwitchToNewThread: async () => {
          postToHost({ type: "createThread" });
        },
        onSwitchToThread: async (threadId: string) => {
          postToHost({ type: "switchThread", threadId });
        },
        onDelete: async (threadId: string) => {
          postToHost({ type: "deleteThread", threadId });
        },
      },
    },
  });

  const switchModel = useCallback(
    (modelId: string) => {
      postToHost({ type: "switchModel", modelId });
    },
    [postToHost],
  );

  const sendToolApproval = useCallback(
    (toolCallId: string, approved: boolean, feedback?: string) => {
      postToHost({ type: "toolApproval", toolCallId, approved, feedback });
    },
    [postToHost],
  );

  const selectTemplate = useCallback(
    (templateId: string) => {
      postToHost({ type: "selectTemplate", templateId });
    },
    [postToHost],
  );

  const sendUserAction = useCallback(
    (actionId: string, result: unknown) => {
      postToHost({ type: "userAction", actionId, result });
    },
    [postToHost],
  );

  const exportThread = useCallback(
    (format: "json" | "markdown") => {
      postToHost({ type: "exportThread", threadId: activeThreadId.current, format });
    },
    [postToHost],
  );

  const sendSlashCommand = useCallback(
    (command: string, args: string = "") => {
      postToHost({ type: "slashCommand", threadId: activeThreadId.current, command, args });
    },
    [postToHost],
  );

  const dropFiles = useCallback(
    (files: Array<{ name: string; mimeType: string; size: number; data: string }>) => {
      postToHost({ type: "fileDrop", threadId: activeThreadId.current, files });
    },
    [postToHost],
  );

  const requestContextMention = useCallback(
    (mentionType: "file" | "workspace" | "symbol", query: string) => {
      postToHost({ type: "contextMention", threadId: activeThreadId.current, mentionType, query });
    },
    [postToHost],
  );

  return {
    runtime,
    chatConfig,
    switchModel,
    pendingToolCalls,
    sendToolApproval,
    templates,
    selectTemplate,
    sendUserAction,
    exportThread,
    slashCommands,
    sendSlashCommand,
    dropFiles,
    requestContextMention,
    lastUsage,
  };
}
