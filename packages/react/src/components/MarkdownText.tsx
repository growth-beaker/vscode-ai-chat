import { makeMarkdownText, CodeHeader as DefaultCodeHeader, type CodeHeaderProps } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import remarkMentions from "./remarkMentions.js";
import { MermaidDiagram } from "./MermaidDiagram.js";

/**
 * Custom CodeHeader that hides when there's no language
 * (assistant-ui defaults to showing "unknown" for unlabeled code fences).
 */
function CodeHeader(props: CodeHeaderProps) {
  if (!props.language || props.language === "unknown") return null;
  return <DefaultCodeHeader {...props} />;
}

export const MarkdownText = makeMarkdownText({
  remarkPlugins: [remarkGfm, remarkMentions],
  components: {
    CodeHeader,
  },
  componentsByLanguage: {
    mermaid: {
      SyntaxHighlighter: MermaidDiagram,
    },
  },
});
