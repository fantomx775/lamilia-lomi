import {
  parseRichTextValue,
  richTextDocumentForEditor,
  sanitizeRichTextDocument,
  sanitizeRichTextHref,
  type RichTextDocument,
  type RichTextMark,
  type RichTextNode,
} from "./rich-text";

const INLINE_TAGS = new Set(["a", "b", "br", "em", "i", "strong", "u"]);
const BLOCK_TAGS = new Set(["blockquote", "h2", "h3", "hr", "ol", "p", "ul"]);
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const DROPPED_CONTENT_TAGS = new Set(["script", "style", "template"]);
const MAX_HTML_SOURCE_LENGTH = 100_000;
const MAX_HTML_DEPTH = 32;
const MAX_HTML_NODES = 10_000;

export type RichTextHtmlWarning = {
  code: "invalid-markup" | "unsafe-link" | "unsupported-attribute" | "unsupported-element";
  message: string;
};

export type RichTextHtmlImport = {
  document: RichTextDocument;
  warnings: RichTextHtmlWarning[];
  canConvert: boolean;
};

export function richTextDocumentToHtml(value: string | unknown): string {
  let document: RichTextDocument;

  if (typeof value === "string") {
    const parsed = parseRichTextValue(value);
    document = parsed.kind === "rich" ? parsed.document : richTextDocumentForEditor(parsed.text);
  } else {
    document = sanitizeRichTextDocument(value) ?? { type: "doc", content: [] };
  }

  return document.content.map(renderBlockHtml).join("");
}

export function importRichTextHtml(source: string): RichTextHtmlImport {
  const warningMap = new Map<string, RichTextHtmlWarning>();
  const addWarning = (code: RichTextHtmlWarning["code"], message: string) => {
    warningMap.set(code + ":" + message, { code, message });
  };

  if (source.length > MAX_HTML_SOURCE_LENGTH) {
    addWarning("invalid-markup", "HTML source is over 100,000 characters and cannot be converted.");
    return { document: { type: "doc", content: [] }, warnings: [...warningMap.values()], canConvert: false };
  }

  if (hasMalformedTagStructure(source)) {
    addWarning("invalid-markup", "Some HTML tags are missing or out of order. Review the source before converting it.");
  }

  if (typeof DOMParser === "undefined") {
    addWarning("invalid-markup", "HTML parsing is unavailable in this environment. The source has been kept unchanged.");
    return { document: { type: "doc", content: [] }, warnings: [...warningMap.values()], canConvert: false };
  }

  const parsed = new DOMParser().parseFromString(source, "text/html");
  if (parsed.querySelector("parsererror")) {
    addWarning("invalid-markup", "The HTML source could not be parsed. Review it before converting.");
  }

  if (!isWithinHtmlLimits(parsed.body)) {
    addWarning("invalid-markup", "The HTML source is too deeply nested or contains too many elements to convert safely.");
    return { document: { type: "doc", content: [] }, warnings: [...warningMap.values()], canConvert: false };
  }

  const inspectedElements = new WeakSet<Element>();
  const inspectAttributes = (element: Element, allowed: Set<string>) => {
    if (inspectedElements.has(element)) return;
    inspectedElements.add(element);

    for (const attribute of Array.from(element.attributes)) {
      if (!allowed.has(attribute.name.toLowerCase())) {
        addWarning(
          "unsupported-attribute",
          "The " + attribute.name.toLowerCase() + " attribute on <" + element.tagName.toLowerCase() + "> will be removed.",
        );
      }
    }
  };

  const inspectElement = (element: Element, isListItem = false) => {
    const tag = element.tagName.toLowerCase();
    const allowedAttributes = tag === "a" ? new Set(["href"]) : new Set<string>();
    inspectAttributes(element, allowedAttributes);
    if (!INLINE_TAGS.has(tag) && !BLOCK_TAGS.has(tag) && !(isListItem && tag === "li")) {
      addWarning("unsupported-element", "The <" + tag + "> element is not supported and will be simplified.");
    }
  };

  const inlineFromNodes = (nodes: NodeListOf<ChildNode> | ChildNode[], inheritedMarks: RichTextMark[] = []): RichTextNode[] => {
    const result: RichTextNode[] = [];
    for (const node of Array.from(nodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.nodeValue ?? "").replace(/\r\n?/g, "\n").replace(/\s+/g, " ");
        if (text) result.push({ type: "text", text, ...(inheritedMarks.length ? { marks: inheritedMarks } : {}) });
        continue;
      }

      if (node.nodeType === Node.COMMENT_NODE) {
        addWarning("unsupported-element", "HTML comments are not supported and will be removed.");
        continue;
      }

      if (!(node instanceof Element)) continue;
      const element = node;
      const tag = element.tagName.toLowerCase();
      inspectElement(element);

      if (tag === "br") {
        result.push({ type: "hardBreak" });
        continue;
      }

      if (DROPPED_CONTENT_TAGS.has(tag)) continue;

      let marks = inheritedMarks;
      if (tag === "b" || tag === "strong") marks = addMark(inheritedMarks, { type: "bold" });
      if (tag === "i" || tag === "em") marks = addMark(inheritedMarks, { type: "italic" });
      if (tag === "u") marks = addMark(inheritedMarks, { type: "underline" });
      if (tag === "a") {
        const rawHref = element.getAttribute("href");
        const safeHref = rawHref === null ? null : sanitizeRichTextHref(rawHref);
        if (safeHref) marks = addMark(inheritedMarks, { type: "link", attrs: { href: safeHref } });
        else if (rawHref !== null) addWarning("unsafe-link", "An unsafe or invalid link address will be removed.");
        else addWarning("unsafe-link", "A link without an href will be converted to plain text.");
      }

      if (["img"].includes(tag)) {
        const alternative = element.getAttribute("alt");
        if (alternative) {
          result.push({ type: "text", text: alternative, ...(marks.length ? { marks } : {}) });
        }
        continue;
      }

      result.push(...inlineFromNodes(Array.from(element.childNodes), marks));
    }
    return mergeInlineNodes(result);
  };

  const trimInlineEdges = (nodes: RichTextNode[]) => {
    const next = nodes.map((node) => ({ ...node }));
    const first = next.find((node) => node.type === "text");
    const last = [...next].reverse().find((node) => node.type === "text");
    if (first?.text !== undefined) first.text = first.text.replace(/^\s+/, "");
    if (last?.text !== undefined) last.text = last.text.replace(/\s+$/, "");
    return next.filter((node) => node.type !== "text" || Boolean(node.text));
  };

  const paragraphFromNodes = (nodes: NodeListOf<ChildNode> | ChildNode[], type: "paragraph" | "heading" = "paragraph", level?: 2 | 3): RichTextNode => {
    const content = trimInlineEdges(inlineFromNodes(nodes));
    return type === "heading"
      ? { type, attrs: { level }, content }
      : { type, content };
  };

  const blocksFromNodes = (nodes: NodeListOf<ChildNode> | ChildNode[]): RichTextNode[] => {
    const blocks: RichTextNode[] = [];
    for (const node of Array.from(nodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.nodeValue ?? "").replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
        if (text) blocks.push({ type: "paragraph", content: [{ type: "text", text }] });
        continue;
      }

      if (node.nodeType === Node.COMMENT_NODE) {
        addWarning("unsupported-element", "HTML comments are not supported and will be removed.");
        continue;
      }

      if (!(node instanceof Element)) continue;
      const element = node;
      const tag = element.tagName.toLowerCase();
      inspectElement(element);

      if (DROPPED_CONTENT_TAGS.has(tag)) continue;

      if (tag === "p") {
        blocks.push(paragraphFromNodes(element.childNodes));
      } else if (tag === "h2" || tag === "h3") {
        blocks.push(paragraphFromNodes(element.childNodes, "heading", tag === "h2" ? 2 : 3));
      } else if (tag === "blockquote") {
        const content = blocksFromNodes(element.childNodes);
        blocks.push({ type: "blockquote", content: content.length ? content : [{ type: "paragraph", content: [] }] });
      } else if (tag === "ul" || tag === "ol") {
        const content: RichTextNode[] = [];
        for (const child of Array.from(element.childNodes)) {
          if (child instanceof Element && child.tagName.toLowerCase() === "li") {
            inspectElement(child, true);
            const itemContent = blocksFromNodes(child.childNodes);
            content.push({
              type: "listItem",
              content: itemContent.length ? itemContent : [{ type: "paragraph", content: [] }],
            });
          } else if (child.nodeType === Node.TEXT_NODE && !(child.nodeValue ?? "").trim()) {
            continue;
          } else {
            addWarning("unsupported-element", "Content outside a <li> element in a list will be moved into a list item.");
            const itemContent = child instanceof Element
              ? blocksFromNodes([child])
              : [{ type: "paragraph", content: inlineFromNodes([child]) }];
            content.push({
              type: "listItem",
              content: itemContent.length ? itemContent : [{ type: "paragraph", content: [] }],
            });
          }
        }
        blocks.push({ type: tag === "ul" ? "bulletList" : "orderedList", content });
      } else if (tag === "hr") {
        blocks.push({ type: "horizontalRule" });
      } else if (INLINE_TAGS.has(tag)) {
        blocks.push({ type: "paragraph", content: trimInlineEdges(inlineFromNodes([element])) });
      } else {
        const children = Array.from(element.childNodes);
        const containsBlock = children.some(
          (child) => child instanceof Element && (BLOCK_TAGS.has(child.tagName.toLowerCase()) || child.tagName.toLowerCase() === "li"),
        );
        if (containsBlock) {
          blocks.push(...blocksFromNodes(children));
        } else {
          const inline = trimInlineEdges(inlineFromNodes([element]));
          if (inline.length) blocks.push({ type: "paragraph", content: inline });
        }
      }
    }
    return blocks;
  };

  const imported = blocksFromNodes(parsed.body.childNodes);
  const document = sanitizeRichTextDocument({ type: "doc", content: imported }) ?? { type: "doc", content: [] };
  if (JSON.stringify(imported) !== JSON.stringify(document.content)) {
    addWarning("unsupported-element", "Some nested content cannot be represented and will be removed during conversion.");
  }
  return { document, warnings: [...warningMap.values()], canConvert: true };
}

function addMark(marks: RichTextMark[], mark: RichTextMark): RichTextMark[] {
  const withoutDuplicate = marks.filter((existing) => existing.type !== mark.type);
  return [...withoutDuplicate, mark];
}

function mergeInlineNodes(nodes: RichTextNode[]): RichTextNode[] {
  const merged: RichTextNode[] = [];
  for (const node of nodes) {
    const previous = merged[merged.length - 1];
    const previousMarks = JSON.stringify(previous?.marks ?? []);
    const nextMarks = JSON.stringify(node.marks ?? []);
    if (node.type === "text" && previous?.type === "text" && previousMarks === nextMarks) {
      previous.text = (previous.text ?? "") + (node.text ?? "");
    } else {
      merged.push(node);
    }
  }
  return merged;
}

function renderBlockHtml(node: RichTextNode): string {
  const content = (node.content ?? []).map(renderBlockHtml).join("");
  if (node.type === "paragraph") return "<p>" + renderInlineHtml(node.content) + "</p>";
  if (node.type === "heading") return "<h" + String(node.attrs?.level) + ">" + renderInlineHtml(node.content) + "</h" + String(node.attrs?.level) + ">";
  if (node.type === "blockquote") return "<blockquote>" + content + "</blockquote>";
  if (node.type === "bulletList") return "<ul>" + content + "</ul>";
  if (node.type === "orderedList") return "<ol>" + content + "</ol>";
  if (node.type === "listItem") return "<li>" + content + "</li>";
  if (node.type === "horizontalRule") return "<hr>";
  return renderInlineHtml([node]);
}

function renderInlineHtml(nodes: RichTextNode[] | undefined): string {
  return (nodes ?? []).map((node) => {
    if (node.type === "hardBreak") return "<br>";
    if (node.type !== "text") return "";

    let html = escapeHtml(node.text ?? "");
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") html = "<strong>" + html + "</strong>";
      if (mark.type === "italic") html = "<em>" + html + "</em>";
      if (mark.type === "underline") html = "<u>" + html + "</u>";
      if (mark.type === "link") {
        const href = sanitizeRichTextHref(mark.attrs.href);
        if (href) html = '<a href="' + escapeHtmlAttribute(href) + '">' + html + "</a>";
      }
    }
    return html;
  }).join("");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function hasMalformedTagStructure(source: string): boolean {
  const stack: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start < 0) break;
    if (source.slice(start, start + 4) === "<!--") {
      const commentEnd = source.indexOf("-->", start + 4);
      if (commentEnd < 0) return true;
      cursor = commentEnd + 3;
      continue;
    }

    const next = source[start + 1];
    if (!next || (!/[A-Za-z]/.test(next) && !(next === "/" && /[A-Za-z]/.test(source[start + 2] ?? "")))) {
      cursor = start + 1;
      continue;
    }

    let end = start + 1;
    let quote = "";
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }
    if (end >= source.length) return true;

    const token = source.slice(start, end + 1);
    const match = token.match(/^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/);
    cursor = end + 1;
    if (!match) continue;

    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (closing) {
      if (stack[stack.length - 1] !== tag) return true;
      stack.pop();
    } else if (!VOID_TAGS.has(tag) && !/\/\s*>$/.test(token)) {
      stack.push(tag);
    }
  }

  return stack.length > 0;
}

function isWithinHtmlLimits(root: Element): boolean {
  const pending = Array.from(root.childNodes).map((node) => ({ node, depth: 1 }));
  let visited = 0;

  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    visited += 1;
    if (visited > MAX_HTML_NODES || current.depth > MAX_HTML_DEPTH) return false;
    for (const child of Array.from(current.node.childNodes)) {
      pending.push({ node: child, depth: current.depth + 1 });
    }
  }

  return true;
}
