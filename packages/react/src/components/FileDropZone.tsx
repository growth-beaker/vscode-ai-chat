import { useState, useCallback, useRef, type ReactNode, type DragEvent } from "react";

export interface FileDropZoneProps {
  onDrop: (files: Array<{ name: string; mimeType: string; size: number; data: string }>) => void;
  children: ReactNode;
  className?: string;
}

export function FileDropZone({ onDrop, children, className }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);

      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length === 0) return;

      const fileData = await Promise.all(
        droppedFiles.map(async (file) => {
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]!);
          }
          return {
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            data: btoa(binary),
          };
        }),
      );

      onDrop(fileData);
    },
    [onDrop],
  );

  return (
    <div
      className={`aui-file-drop-zone ${isDragging ? "aui-file-drop-zone-active" : ""} ${className ?? ""}`.trim()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {isDragging && (
        <div className="aui-file-drop-overlay">
          <div className="aui-file-drop-overlay-text">Drop files here</div>
        </div>
      )}
    </div>
  );
}
