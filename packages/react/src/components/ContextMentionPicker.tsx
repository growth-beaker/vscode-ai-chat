import { useState, useEffect, useCallback, useRef } from "react";
import { useComposer, useComposerRuntime } from "@assistant-ui/react";


export interface MentionItem {
  label: string;
  description?: string;
  value: string;
}

export interface ContextMentionPickerProps {
  onSearch: (mentionType: "file" | "workspace" | "symbol", query: string) => void;
  /** Results populated asynchronously after onSearch fires */
  items: MentionItem[];
}

/**
 * Detect @query pattern at the end of text (or at cursor position).
 * Triggers on @ followed by at least 1 non-whitespace character.
 * Returns null if no active mention.
 */
function parseMention(text: string): { query: string; start: number } | null {
  // Match @ followed by non-whitespace chars at end of input
  const match = /@([^\s@]+)$/.exec(text);
  if (!match) return null;
  return {
    query: match[1]!,
    start: match.index!,
  };
}

/**
 * Inline file mention picker. Type @ followed by characters to search files.
 * Selected files are inserted as `@filename` which renders as a styled pill
 * in messages via the remarkMentions plugin.
 */
export function ContextMentionPicker({ onSearch, items }: ContextMentionPickerProps) {
  const text = useComposer((s) => s.text);
  const composerRuntime = useComposerRuntime();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const lastSearchRef = useRef("");
  const pickerRef = useRef<HTMLDivElement>(null);

  const mention = parseMention(text);
  const isOpen = mention !== null && items.length > 0;

  // Fire search when mention query changes
  useEffect(() => {
    if (!mention) return;
    const searchKey = mention.query;
    if (searchKey === lastSearchRef.current) return;
    lastSearchRef.current = searchKey;
    onSearch("file", mention.query);
  }, [mention?.query, onSearch]);

  // Reset selection on new results
  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  // Scroll selected item into view
  useEffect(() => {
    if (!isOpen || !pickerRef.current) return;
    const selected = pickerRef.current.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, isOpen]);

  const handleSelect = useCallback(
    (item: MentionItem) => {
      if (!mention) return;
      // Replace @query with @filename — rendered as a styled pill by the markdown plugin
      const before = text.slice(0, mention.start);
      const after = text.slice(mention.start + mention.query.length + 1); // +1 for @
      composerRuntime.setText(`${before}@${item.label} ${after}`);
    },
    [composerRuntime, text, mention],
  );

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (items[selectedIndex]) {
          e.preventDefault();
          handleSelect(items[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        // Remove the mention trigger
        if (mention) {
          composerRuntime.setText(text.slice(0, mention.start));
        }
      }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [isOpen, items, selectedIndex, handleSelect, composerRuntime, text, mention]);

  if (!isOpen) return null;

  return (
    <div className="aui-mention-picker" role="listbox" ref={pickerRef}>
      {items.map((item, i) => (
        <button
          key={`${item.label}-${item.value}`}
          className={`aui-mention-picker-item ${i === selectedIndex ? "aui-mention-picker-item-selected" : ""}`}
          role="option"
          aria-selected={i === selectedIndex}
          onMouseEnter={() => setSelectedIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            handleSelect(item);
          }}
        >
          <span className="aui-mention-picker-icon">📄</span>
          <span className="aui-mention-picker-content">
            <span className="aui-mention-picker-label">{item.label}</span>
            {item.description && (
              <span className="aui-mention-picker-desc">{item.description}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
