import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RichTextContent } from "@/components/rich-text-content";
import {
  RICH_TEXT_FORMAT_PREFIX,
  getRichTextTextContent,
  parseRichTextValue,
  richTextDocumentForEditor,
  sanitizeRichTextHref,
  sanitizeRichTextValue,
  serializeRichTextDocument,
} from "./rich-text";

describe("rich text serialization and rendering", () => {
  it("round trips headings, paragraphs, emphasis, links, and ordered and unordered lists", () => {
    const document = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A heading" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Bold", marks: [{ type: "bold" }] },
            { type: "text", text: " and italic", marks: [{ type: "italic" }] },
            { type: "text", text: " link", marks: [{ type: "link", attrs: { href: "https://example.com/" } }] },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First point" }] }] }] },
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First step" }] }] }] },
      ],
    };

    const value = serializeRichTextDocument(document);
    const rendered = renderToStaticMarkup(<RichTextContent value={value} />);

    expect(value.startsWith(RICH_TEXT_FORMAT_PREFIX)).toBe(true);
    expect(parseRichTextValue(value)).toMatchObject({ kind: "rich", document });
    expect(rendered).toContain("<h2");
    expect(rendered).toContain("<strong>Bold</strong>");
    expect(rendered).toContain("<em> and italic</em>");
    expect(rendered).toContain('<a class="underline underline-offset-2" href="https://example.com/" target="_blank" rel="noopener noreferrer"> link</a>');
    expect(rendered).toContain("<ul");
    expect(rendered).toContain("<ol");
    expect(rendered).toContain("First point");
    expect(rendered).toContain("First step");
  });

  it("removes unsupported nodes and dangerous link targets before persistence and rendering", () => {
    const hostile = `${RICH_TEXT_FORMAT_PREFIX}${JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Keep this", marks: [{ type: "bold" }, { type: "link", attrs: { href: "javascript:alert(1)" } }] },
          ],
        },
        { type: "rawHTML", attrs: { html: "<script>alert(1)</script>" } },
        { type: "image", attrs: { src: "javascript:alert(2)" } },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Safe heading text" }] },
      ],
    })}`;

    const sanitized = sanitizeRichTextValue(hostile);
    const rendered = renderToStaticMarkup(<RichTextContent value={sanitized} />);
    const parsed = parseRichTextValue(sanitized);

    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("rawHTML");
    expect(sanitized).not.toContain("image");
    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("href=");
    expect(rendered).toContain("<strong>Keep this</strong>");
    expect(rendered).toContain("Safe heading text");
    expect(parsed).toMatchObject({ kind: "rich" });
  });

  it("keeps new formatting readable to older v1 readers and restores it for current readers", () => {
    const value = serializeRichTextDocument({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Underlined", marks: [{ type: "underline" }] }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted" }] }] },
        { type: "horizontalRule" },
      ],
    });
    const stored = JSON.parse(value.slice(RICH_TEXT_FORMAT_PREFIX.length)) as {
      content: Array<{ type: string; content?: Array<{ type: string; text?: string; content?: Array<{ type: string; text?: string }> }> }>;
      richTextV2: { content: unknown[] };
    };
    const legacyValue = `${RICH_TEXT_FORMAT_PREFIX}${JSON.stringify({ type: "doc", content: stored.content })}`;
    const rendered = renderToStaticMarkup(<RichTextContent value={value} />);
    const legacyRendered = renderToStaticMarkup(<RichTextContent value={legacyValue} />);

    expect(stored.content.map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(stored.content.flatMap((node) => node.content ?? []).map((node) => node.text).filter(Boolean)).toContain("Quoted");
    expect(stored.richTextV2.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Underlined", marks: [{ type: "underline" }] }] },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted" }] }] },
      { type: "horizontalRule" },
    ]);
    expect(parseRichTextValue(value)).toMatchObject({
      kind: "rich",
      document: { content: [{ type: "paragraph" }, { type: "blockquote" }, { type: "horizontalRule" }] },
    });
    expect(rendered).toContain("<u>Underlined</u>");
    expect(rendered).toContain("<blockquote");
    expect(rendered).toContain("Quoted");
    expect(rendered).toContain("<hr");
    expect(legacyRendered).toContain("Underlined");
    expect(legacyRendered).toContain("Quoted");
    expect(legacyRendered).not.toContain("<blockquote");
    expect(legacyRendered).not.toContain("<hr");
  });

  it("keeps legacy plain text readable and displays HTML-looking text as text", () => {
    const legacy = "First paragraph.\nStill the first paragraph.\n\nSecond paragraph with <script>alert(1)</script>.";
    const rendered = renderToStaticMarkup(<RichTextContent value={legacy} />);

    expect(sanitizeRichTextValue(legacy)).toBe(legacy);
    expect(richTextDocumentForEditor(legacy).content).toHaveLength(2);
    expect(rendered).toContain("First paragraph.");
    expect(rendered).toContain("Still the first paragraph.");
    expect(rendered).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered).not.toContain("<script>");
  });

  it("extracts visible rich text while preserving legacy and malformed plain values", () => {
    const richValue = serializeRichTextDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A phrase split " },
            { type: "text", text: "across marks", marks: [{ type: "bold" }] },
            { type: "text", text: " with a link", marks: [{ type: "link", attrs: { href: "https://metadata-only.example/" } }] },
          ],
        },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Another block" }] },
      ],
    });
    const legacyValue = "Legacy paragraph.\n\nSecond paragraph.";
    const malformedValue = `${RICH_TEXT_FORMAT_PREFIX}{not-json`;

    expect(getRichTextTextContent(richValue)).toBe("A phrase split across marks with a link Another block");
    expect(getRichTextTextContent(legacyValue)).toBe(legacyValue);
    expect(getRichTextTextContent(malformedValue)).toBe(malformedValue);
  });

  it("accepts safe external, email, fragment, and local links only", () => {
    expect(sanitizeRichTextHref("https://example.com/a path")).toBe("https://example.com/a%20path");
    expect(sanitizeRichTextHref("http://example.com" )).toBe("http://example.com/");
    expect(sanitizeRichTextHref("mailto:help@example.com")).toBe("mailto:help@example.com");
    expect(sanitizeRichTextHref("/en/terms")).toBe("/en/terms");
    expect(sanitizeRichTextHref("#privacy")).toBe("#privacy");
    expect(sanitizeRichTextHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeRichTextHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(sanitizeRichTextHref("//example.com/terms")).toBeNull();
    expect(sanitizeRichTextHref("https://user:password@example.com")).toBeNull();
  });
});
