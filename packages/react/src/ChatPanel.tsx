import { AssistantRuntimeProvider, Thread } from "@assistant-ui/react";
import { useVSCodeRuntime, type UseVSCodeRuntimeOptions } from "./runtime/useVSCodeRuntime.js";
import { ThreadList } from "./components/ThreadList.js";
import { ModelSelector } from "./components/ModelSelector.js";
import { ChatToolbar } from "./components/ChatToolbar.js";
import { FileDropZone } from "./components/FileDropZone.js";
import type { ComponentType } from "react";
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
  /** Available model IDs for the model selector */
  models?: string[];
  /** Show export button in toolbar */
  showExport?: boolean;
  /** Show token usage in toolbar */
  showTokenUsage?: boolean;
  /** Enable file drag-and-drop */
  enableFileDrop?: boolean;
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
}: ChatPanelProps) {
  const { runtime, chatConfig, switchModel, exportThread, dropFiles, lastUsage } =
    useVSCodeRuntime({ vscodeApi, dataParts });

  const showToolbar = showExport || (showTokenUsage && lastUsage);

  const threadContent = (
    <>
      {toolUIs?.map((ToolUI, i) => (
        <ToolUI key={i} />
      ))}
      {showThreadList && <ThreadList />}
      {models && models.length > 1 && (
        <ModelSelector
          models={models}
          activeModel={chatConfig.activeModel}
          onSwitch={switchModel}
        />
      )}
      {showToolbar && (
        <ChatToolbar
          usage={showTokenUsage ? lastUsage : undefined}
          onExport={showExport ? exportThread : undefined}
        />
      )}
      <Thread />
    </>
  );

  const content = enableFileDrop ? (
    <FileDropZone onDrop={dropFiles}>{threadContent}</FileDropZone>
  ) : (
    threadContent
  );

  return (
    <div className={`aui-root dark ${className ?? ""}`.trim()} style={{ height: "100vh" }}>
      <AssistantRuntimeProvider runtime={runtime}>{content}</AssistantRuntimeProvider>
    </div>
  );
}
