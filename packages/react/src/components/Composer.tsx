import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from "react";
import {
  ComposerPrimitive,
  ThreadPrimitive,
  AttachmentPrimitive,
  useComposerRuntime,
  useAttachment,
} from "@assistant-ui/react";
import { useComposerConfig, type ComposerConfig } from "./ComposerContext.js";

export type ComposerProps = ComposerConfig;

export function Composer(props: ComposerProps) {
  // Props can come directly or from context (context allows stable component identity)
  const contextConfig = useComposerConfig();
  const { showAttach, models, activeModel, onModelSwitch, usage, onExport, inputHint } = {
    ...contextConfig,
    ...props,
  };
  const composerRuntime = useComposerRuntime();

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.altKey || e.shiftKey)) {
      e.preventDefault();
      const { selectionStart, selectionEnd } = e.currentTarget;
      const text = composerRuntime.getState().text;
      composerRuntime.setText(
        text.slice(0, selectionStart) + "\n" + text.slice(selectionEnd),
      );
      const target = e.currentTarget;
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = selectionStart + 1;
      });
    }
  }, [composerRuntime]);

  const showModelSelector = models && models.length > 1 && onModelSwitch;

  const showToolbar = usage || onExport;

  return (
    <div className="aui-composer-wrapper">
      {showToolbar && (
        <div className="aui-composer-toolbar">
          {usage && (
            <div className="aui-composer-usage">
              <span className="aui-composer-usage-label">in</span>
              <span className="aui-composer-usage-value">{formatTokens(usage.promptTokens)}</span>
              <span className="aui-composer-usage-label">out</span>
              <span className="aui-composer-usage-value">{formatTokens(usage.completionTokens)}</span>
            </div>
          )}
          <div className="aui-composer-toolbar-spacer" />
          {onExport && <ExportMenu onExport={onExport} />}
        </div>
      )}

      <ComposerPrimitive.Root className="aui-composer-root">
        <ComposerPrimitive.Input
          className="aui-composer-input"
          autoFocus
          submitOnEnter
          onKeyDown={handleKeyDown}
          {...(inputHint ? { placeholder: inputHint } : {})}
        />

        <ComposerPrimitive.Attachments
          components={{ Attachment: FileChip }}
        />

        <div className="aui-composer-actions">
          <div className="aui-composer-actions-left">
            {showAttach && (
              <ThreadPrimitive.If running={false}>
                <ComposerPrimitive.AddAttachment className="aui-composer-attach">
                  <PaperclipIcon />
                </ComposerPrimitive.AddAttachment>
              </ThreadPrimitive.If>
            )}
            {showAttach && (
              <ThreadPrimitive.If running>
                <button className="aui-composer-attach" disabled>
                  <PaperclipIcon />
                </button>
              </ThreadPrimitive.If>
            )}
            {showModelSelector && (
              <select
                className="aui-composer-model-select"
                value={activeModel ?? models[0]}
                onChange={(e) => onModelSwitch(e.target.value)}
              >
                {models.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            )}
          </div>
          <div className="aui-composer-actions-right">
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send className="aui-composer-send">
                <SendIcon />
              </ComposerPrimitive.Send>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel className="aui-composer-cancel">
                <StopIcon />
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
          </div>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function ExportMenu({ onExport }: { onExport: (format: "json" | "markdown") => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleExport = useCallback(
    (format: "json" | "markdown") => {
      onExport(format);
      setOpen(false);
    },
    [onExport],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="aui-composer-export" ref={menuRef}>
      <button
        className="aui-composer-export-trigger"
        onClick={() => setOpen((prev) => !prev)}
        title="Export conversation"
        aria-label="Export conversation"
        aria-expanded={open}
      >
        <ExportIcon />
        Export
      </button>
      {open && (
        <div className="aui-composer-export-menu" role="menu">
          <button className="aui-composer-export-menu-item" role="menuitem" onClick={() => handleExport("markdown")}>
            Export as Markdown
          </button>
          <button className="aui-composer-export-menu-item" role="menuitem" onClick={() => handleExport("json")}>
            Export as JSON
          </button>
        </div>
      )}
    </div>
  );
}

function ExportIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v8M4 6l4-4 4 4M2 12h12" />
    </svg>
  );
}

function FileChip() {
  const name = useAttachment((a) => a.name);
  return (
    <AttachmentPrimitive.Root className="aui-file-chip">
      <FileIcon />
      <span className="aui-file-chip-name">{name}</span>
      <AttachmentPrimitive.Remove className="aui-file-chip-remove">
        <CloseIcon />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 01-4.5-4.5l5.8-5.8a2.1 2.1 0 013 3L6.2 11.8a1.1 1.1 0 01-1.5-1.5L10 5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="3" width="10" height="10" rx="1" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="aui-file-chip-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 1.5h7l3 3V14.5H3z" />
      <path d="M10 1.5v3h3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2l6 6M8 2l-6 6" />
    </svg>
  );
}
