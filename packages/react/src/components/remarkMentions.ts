/**
 * Remark plugin that transforms @filename.ext patterns into styled mention spans.
 * Self-contained — no external dependencies beyond what remark already provides.
 */

interface TextNode {
  type: "text";
  value: string;
}

interface HtmlNode {
  type: "html";
  value: string;
}

interface AstNode {
  type: string;
  value?: string;
  children?: AstNode[];
}

function visitTextNodes(node: AstNode): void {
  if (!node.children) return;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!;

    if (child.type === "text" && typeof child.value === "string") {
      const parts = splitMentions(child.value);
      if (parts.length > 1) {
        node.children.splice(i, 1, ...parts);
        i += parts.length - 1; // skip past inserted nodes
      }
    } else {
      visitTextNodes(child);
    }
  }
}

function splitMentions(text: string): (TextNode | HtmlNode)[] {
  // Match @word patterns that look like filenames (contain a dot + extension)
  const regex = /@([\w./-]+\.\w+)/g;
  const parts: (TextNode | HtmlNode)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    parts.push({
      type: "html",
      value: `<span class="aui-mention">@${match[1]}</span>`,
    });
    lastIndex = match.index + match[0].length;
  }

  if (parts.length === 0) return [{ type: "text", value: text }];

  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  return parts;
}

export default function remarkMentions() {
  return (tree: AstNode) => {
    visitTextNodes(tree);
  };
}
