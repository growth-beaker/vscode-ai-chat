import { TokenUsage, type TokenUsageProps } from "./TokenUsage.js";
import { ExportButton, type ExportButtonProps } from "./ExportButton.js";

export interface ChatToolbarProps {
  usage?: TokenUsageProps["usage"];
  onExport?: ExportButtonProps["onExport"];
}

export function ChatToolbar({ usage, onExport }: ChatToolbarProps) {
  const hasContent = usage || onExport;
  if (!hasContent) return null;

  return (
    <div className="aui-chat-toolbar">
      {usage && <TokenUsage usage={usage} />}
      <div className="aui-chat-toolbar-spacer" />
      {onExport && <ExportButton onExport={onExport} />}
    </div>
  );
}
