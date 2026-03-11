import { useMemo, type ComponentType } from "react";
import { AssistantRuntimeProvider, Thread } from "@assistant-ui/react";
import { useVSCodeRuntime, type UseVSCodeRuntimeOptions } from "./runtime/useVSCodeRuntime.js";
import { ThreadList } from "./components/ThreadList.js";

import { FileDropZone } from "./components/FileDropZone.js";
import { SlashCommandPicker } from "./components/SlashCommandPicker.js";
import { ContextMentionPicker } from "./components/ContextMentionPicker.js";
import { Composer } from "./components/Composer.js";
import { ComposerConfigProvider } from "./components/ComposerContext.js";
import { MarkdownText } from "./components/MarkdownText.js";

import type { DataPartRenderers } from "./runtime/message-adapter.js";

export interface ChatPanelProps {
  /** Tool UI components created via makeAssistantToolUI */
  toolUIs?: ComponentType[];
  /** Custom data-part renderers keyed by data part name */
  dataParts?: DataPartRenderers;
  /** Additional CSS class names */
  className?: string;
  /** Override VS Code API (for testing) */
  vscodeApi?: UseVSCodeRuntimeOptions["vscodeApi"];
  /** Whether to show the thread list sidebar */
  showThreadList?: boolean;
  /** Available model IDs for the model selector (shown in composer when 2+) */
  models?: string[];
  /** Show export button in toolbar */
  showExport?: boolean;
  /** Show token usage in toolbar */
  showTokenUsage?: boolean;
  /** Enable file attachments (attach button + drag-and-drop) */
  enableFileDrop?: boolean;
  /** Enable slash command picker (requires host to have commands configured) */
  enableSlashCommands?: boolean;
  /** Enable @mention picker (requires host to have contextMentionProvider) */
  enableMentions?: boolean;
}

export function ChatPanel({
  toolUIs,
  dataParts,
  className,
  vscodeApi,
  showThreadList,
  models,
  showExport,
  showTokenUsage,
  enableFileDrop,
  enableSlashCommands,
  enableMentions,
}: ChatPanelProps) {
  const {
    runtime,
    chatConfig,
    switchModel,
    exportThread,
    dropFiles,
    lastUsage,
    slashCommands,
    sendSlashCommand,
    requestContextMention,
    mentionItems,
  } = useVSCodeRuntime({ vscodeApi, dataParts });

  const showModelSelector = models && models.length > 1;

  // Stable component identity — Composer reads changing values (activeModel)
  // from ComposerConfigContext so the component reference never changes.
  const composerConfig = useMemo(
    () => ({ components: { Composer } }),
    [],
  );

  const composerContextValue = useMemo(
    () => ({
      showAttach: enableFileDrop,
      models: showModelSelector ? models : undefined,
      activeModel: chatConfig.activeModel,
      onModelSwitch: showModelSelector ? switchModel : undefined,
      usage: showTokenUsage ? lastUsage : undefined,
      onExport: showExport ? exportThread : undefined,
    }),
    [enableFileDrop, showModelSelector, models, chatConfig.activeModel, switchModel, showTokenUsage, lastUsage, showExport, exportThread],
  );

  const assistantMessageConfig = useMemo(
    () => ({ components: { Text: MarkdownText } }),
    [],
  );

  const threadContent = (
    <>
      {toolUIs?.map((ToolUI, i) => (
        <ToolUI key={i} />
      ))}
      {showThreadList && <ThreadList />}
      <Thread assistantMessage={assistantMessageConfig} {...composerConfig} />
      {enableSlashCommands && slashCommands.length > 0 && (
        <SlashCommandPicker commands={slashCommands} onSelect={sendSlashCommand} />
      )}
      {enableMentions && (
        <ContextMentionPicker onSearch={requestContextMention} items={mentionItems} />
      )}
    </>
  );

  const content = enableFileDrop ? (
    <FileDropZone onDrop={dropFiles}>{threadContent}</FileDropZone>
  ) : (
    threadContent
  );

  return (
    <div className={`aui-root dark ${className ?? ""}`.trim()} style={{ height: "100vh" }}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ComposerConfigProvider value={composerContextValue}>
          {content}
        </ComposerConfigProvider>
      </AssistantRuntimeProvider>
    </div>
  );
}
