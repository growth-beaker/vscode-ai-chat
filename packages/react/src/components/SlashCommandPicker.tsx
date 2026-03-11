import { useState, useEffect, useCallback, useRef } from "react";
import { useComposer, useComposerRuntime } from "@assistant-ui/react";


export interface SlashCommandPickerProps {
  commands: Array<{ name: string; description: string }>;
  onSelect: (command: string, args?: string) => void;
}

export function SlashCommandPicker({ commands, onSelect }: SlashCommandPickerProps) {
  const text = useComposer((s) => s.text);
  const composerRuntime = useComposerRuntime();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Show picker when input starts with "/" and there's no space yet (still typing command name)
  const match = /^\/(\S*)$/.exec(text);
  const query = match?.[1]?.toLowerCase() ?? null;

  const filtered = query !== null
    ? commands.filter((c) => c.name.toLowerCase().startsWith(query))
    : [];

  const isOpen = filtered.length > 0;

  // Reset selection when list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback(
    (command: { name: string }) => {
      composerRuntime.setText("");
      onSelect(command.name);
    },
    [composerRuntime, onSelect],
  );

  // Keyboard navigation via capturing keydown on the document
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (filtered[selectedIndex]) {
          e.preventDefault();
          handleSelect(filtered[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        composerRuntime.setText("");
      }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [isOpen, filtered, selectedIndex, composerRuntime, handleSelect]);

  if (!isOpen) return null;

  return (
    <div className="aui-slash-picker" ref={listRef} role="listbox">
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          className={`aui-slash-picker-item ${i === selectedIndex ? "aui-slash-picker-item-selected" : ""}`}
          role="option"
          aria-selected={i === selectedIndex}
          onMouseEnter={() => setSelectedIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // prevent blur on composer
            handleSelect(cmd);
          }}
        >
          <span className="aui-slash-picker-name">/{cmd.name}</span>
          <span className="aui-slash-picker-desc">{cmd.description}</span>
        </button>
      ))}
    </div>
  );
}
