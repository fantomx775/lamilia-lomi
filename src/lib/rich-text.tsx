import type { ReactNode } from "react";

export const RICH_TEXT_FORMAT_PREFIX = "lamilia-rich-text:v1:";

export type RichTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "link"; attrs: { href: string } };

export type RichTextNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
};

export type RichTextDocument = {
  type: "doc";
  content: RichTextNode[];
};

type ParsedRichText =
  | { kind: "plain"; text: string }
  | { kind: "rich"; document: RichTextDocument };

const MARK_ORDER: Record<RichTextMark["type"], number> = {
  link: 0,
  bold: 1,
  italic: 2,
};

const MAX_DOCUMENT_DEPTH = 32;
const MAX_DOCUMENT_NODES = 10_000;

export function parseRichTextValue(value: string): ParsedRichText {
  if (!value.startsWith(RICH_TEXT_FORMAT_PREFIX)) {
    return { kind: "plain", text: value };
  }

  try {
    const parsed: unknown = JSON.parse(value.slice(RICH_TEXT_FORMAT_PREFIX.length));
    const document = sanitizeRichTextDocument(parsed);
    return document ? { kind: "rich", document } : { kind: "plain", text: value };
  } catch {
    return { kind: "plain", text: value };
  }
}

export function serializeRichTextDocument(document: unknown): string {
  const safeDocument = sanitizeRichTextDocument(document) ?? emptyRichTextDocument();
  return `${RICH_TEXT_FORMAT_PREFIX}${JSON.stringify(safeDocument)}`;
}

export function sanitizeRichTextValue(value: string): string {
  const parsed = parseRichTextValue(value);
  return parsed.kind === "rich" ? serializeRichTextDocument(parsed.document) : value;
}

export function richTextDocumentForEditor(value: string): RichTextDocument {
  const parsed = parseRichTextValue(value);
  if (parsed.kind === "rich") return parsed.document;

  const text = parsed.text.replace(/\r\n?/g, "\n");
  if (!text) return { type: "doc", content: [{ type: "paragraph" }] };

  return {
    type: "doc",
    content: text.split(/\n{2,}/).map((paragraph) => ({
      type: "paragraph",
      content: paragraph.split("\n").flatMap((line, index) => [
        ...(index > 0 ? [{ type: "hardBreak" }] : []),
        ...(line ? [{ type: "text", text: line }] : []),
      ]),
    })),
  };
}

export function sanitizeRichTextDocument(value: unknown): RichTextDocument | null {
  if (!isRecord(value) || value.type !== "doc") return null;

  let visitedNodes = 0;
  const sanitizeNode = (node: unknown, depth: number): RichTextNode | null => {
    visitedNodes += 1;
    if (visitedNodes > MAX_DOCUMENT_NODES || depth > MAX_DOCUMENT_DEPTH || !isRecord(node)) {
      return null;
    }

    if (node.type === "text") {
      if (typeof node.text !== "string") return null;
      const marks = sanitizeMarks(node.marks);
      return {
        type: "text",
        text: node.text,
        ...(marks.length ? { marks } : {}),
      };
    }

    if (node.type === "hardBreak") return { type: "hardBreak" };

    if (node.type === "paragraph") {
      return { type: "paragraph", content: sanitizeInlineContent(node.content, depth + 1) };
    }

    if (node.type === "heading") {
      const level = isRecord(node.attrs) ? node.attrs.level : undefined;
      const content = sanitizeInlineContent(node.content, depth + 1);
      return level === 2 || level === 3
        ? { type: "heading", attrs: { level }, content }
        : { type: "paragraph", content };
    }

    if (node.type === "bulletList" || node.type === "orderedList") {
      const content = Array.isArray(node.content)
        ? node.content.flatMap((child) => {
            const safeChild = sanitizeNode(child, depth + 1);
            return safeChild?.type === "listItem" ? [safeChild] : [];
          })
        : [];
      return { type: node.type, content };
    }

    if (node.type === "listItem") {
      const content = Array.isArray(node.content)
        ? node.content.flatMap((child) => {
            const safeChild = sanitizeNode(child, depth + 1);
            return safeChild && ["paragraph", "heading", "bulletList", "orderedList"].includes(safeChild.type)
              ? [safeChild]
              : [];
          })
        : [];
      return content.length ? { type: "listItem", content } : null;
    }

    // Unsupported nodes such as images, code blocks, and arbitrary HTML are dropped.
    return null;
  };

  const sanitizeInlineContent = (content: unknown, depth: number): RichTextNode[] =>
    Array.isArray(content)
      ? content.flatMap((node) => {
          const safeNode = sanitizeNode(node, depth);
          return safeNode && ["text", "hardBreak"].includes(safeNode.type) ? [safeNode] : [];
        })
      : [];

  const content = Array.isArray(value.content)
    ? value.content.flatMap((node) => {
        const safeNode = sanitizeNode(node, 1);
        return safeNode && ["paragraph", "heading", "bulletList", "orderedList"].includes(safeNode.type)
          ? [safeNode]
          : [];
      })
    : [];

  return { type: "doc", content };
}

export function sanitizeRichTextHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href || /[\u0000-\u001f\u007f\\]/.test(href)) return null;

  if (href.startsWith("#")) return href;
  if (href.startsWith("/") && !href.startsWith("//")) return href;

  if (/^mailto:/i.test(href)) {
    try {
      const url = new URL(href);
      return url.protocol === "mailto:" ? url.href : null;
    } catch {
      return null;
    }
  }

  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const url = new URL(href);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function renderRichTextValue(value: string): ReactNode {
  const parsed = parseRichTextValue(value);
  if (parsed.kind === "plain") return renderPlainText(parsed.text);
  return parsed.document.content.map((node, index) => renderBlock(node, `${node.type}-${index}`));
}

function sanitizeMarks(value: unknown): RichTextMark[] {
  if (!Array.isArray(value)) return [];

  const marks = new Map<RichTextMark["type"], RichTextMark>();
  for (const mark of value) {
    if (!isRecord(mark)) continue;
    if (mark.type === "bold" || mark.type === "italic") {
      marks.set(mark.type, { type: mark.type });
    } else if (mark.type === "link" && isRecord(mark.attrs)) {
      const href = sanitizeRichTextHref(mark.attrs.href);
      if (href) marks.set("link", { type: "link", attrs: { href } });
    }
  }

  return [...marks.values()].sort((left, right) => MARK_ORDER[left.type] - MARK_ORDER[right.type]);
}

function renderPlainText(value: string): ReactNode {
  if (!value) return null;
  return value.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((paragraph, index) => (
    <p className="whitespace-pre-wrap" key={`plain-${index}`}>{paragraph}</p>
  ));
}

function renderBlock(node: RichTextNode, key: string): ReactNode {
  if (node.type === "paragraph") {
    return <p className="whitespace-pre-wrap" key={key}>{renderInline(node.content)}</p>;
  }

  if (node.type === "heading") {
    const content = renderInline(node.content);
    return node.attrs?.level === 3
      ? <h3 className="font-serif text-lg font-semibold leading-snug" key={key}>{content}</h3>
      : <h2 className="font-serif text-xl font-semibold leading-snug" key={key}>{content}</h2>;
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const items = node.content?.map((child, index) => renderBlock(child, `${key}-item-${index}`));
    return node.type === "bulletList"
      ? <ul className="list-disc space-y-1 pl-6" key={key}>{items}</ul>
      : <ol className="list-decimal space-y-1 pl-6" key={key}>{items}</ol>;
  }

  if (node.type === "listItem") {
    return <li className="pl-1" key={key}>{node.content?.map((child, index) => renderBlock(child, `${key}-block-${index}`))}</li>;
  }

  return renderInline([node]);
}

function renderInline(nodes: RichTextNode[] | undefined): ReactNode {
  return nodes?.map((node, index) => {
    if (node.type === "hardBreak") return <br key={`break-${index}`} />;
    if (node.type !== "text") return null;

    let content: ReactNode = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") content = <strong>{content}</strong>;
      if (mark.type === "italic") content = <em>{content}</em>;
      if (mark.type === "link") {
        const href = sanitizeRichTextHref(mark.attrs.href);
        if (href) {
          const isExternal = /^https?:\/\//i.test(href);
          content = <a className="underline underline-offset-2" href={href} {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{content}</a>;
        }
      }
    }
    return <span key={`text-${index}`}>{content}</span>;
  });
}

function emptyRichTextDocument(): RichTextDocument {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
