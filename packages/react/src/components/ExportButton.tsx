import { useState, useCallback, useRef, useEffect } from "react";

export interface ExportButtonProps {
  onExport: (format: "json" | "markdown") => void;
}

export function ExportButton({ onExport }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleExport = useCallback(
    (format: "json" | "markdown") => {
      onExport(format);
      setOpen(false);
    },
    [onExport],
  );

  // Close menu on outside click
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
    <div className="aui-export-button" ref={menuRef}>
      <button
        className="aui-export-button-trigger"
        onClick={() => setOpen((prev) => !prev)}
        title="Export conversation"
        aria-label="Export conversation"
        aria-expanded={open}
      >
        <ExportIcon />
      </button>
      {open && (
        <div className="aui-export-menu" role="menu">
          <button
            className="aui-export-menu-item"
            role="menuitem"
            onClick={() => handleExport("markdown")}
          >
            Export as Markdown
          </button>
          <button
            className="aui-export-menu-item"
            role="menuitem"
            onClick={() => handleExport("json")}
          >
            Export as JSON
          </button>
        </div>
      )}
    </div>
  );
}

function ExportIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v8M4 6l4-4 4 4M2 12h12" />
    </svg>
  );
}
