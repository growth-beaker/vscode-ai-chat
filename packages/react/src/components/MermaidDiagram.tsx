import { useContentPart } from "@assistant-ui/react";
import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import { useEffect, useRef, type FC } from "react";

export const MermaidDiagram: FC<SyntaxHighlighterProps> = ({
  code,
}) => {
  const ref = useRef<HTMLPreElement>(null);

  // Only render when the content part is no longer streaming
  const isComplete = useContentPart((s) => {
    if (s.type !== "text") return false;
    const codeIndex = s.text.indexOf(code);
    if (codeIndex === -1) return false;
    const afterCode = s.text.substring(codeIndex + code.length);
    return /^```|^\n```/.test(afterCode);
  });

  useEffect(() => {
    if (!isComplete || !ref.current) return;

    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
        });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const result = await mermaid.render(id, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = result.svg;
          result.bindFunctions?.(ref.current);
        }
      } catch (e) {
        if (!cancelled && ref.current) {
          console.warn("Failed to render Mermaid diagram:", e);
          ref.current.textContent = code;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isComplete, code]);

  return (
    <pre ref={ref} className="aui-mermaid-diagram">
      Drawing diagram...
    </pre>
  );
};
