/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import { importRichTextHtml, richTextDocumentToHtml } from "./rich-text-html";
import { parseRichTextValue, serializeRichTextDocument } from "./rich-text";

describe("rich text HTML import and export", () => {
  it("imports and exports the supported editor format without losing structure", () => {
    const imported = importRichTextHtml(
      '<h2>Terms</h2><p><strong>Keep</strong> <em>formatting</em>, <u>underline</u>, <a href="https://example.com/path">links</a><br>and breaks.</p><ul><li><p>First</p></li><li><p>Second</p></li></ul><blockquote><p>A quotation</p></blockquote><hr>',
    );

    expect(imported.canConvert).toBe(true);
    expect(imported.warnings).toEqual([]);
    expect(imported.document.content.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "blockquote",
      "horizontalRule",
    ]);

    const html = richTextDocumentToHtml(serializeRichTextDocument(imported.document));
    expect(html).toContain("<h2>Terms</h2>");
    expect(html).toContain("<strong>Keep</strong>");
    expect(html).toContain("<em>formatting</em>");
    expect(html).toContain("<u>underline</u>");
    expect(html).toContain('<a href="https://example.com/path">links</a>');
    expect(html).toContain("<br>");
    expect(html).toContain("<blockquote><p>A quotation</p></blockquote>");
    expect(html).toContain("<hr>");
    expect(parseRichTextValue(serializeRichTextDocument(imported.document))).toMatchObject({ kind: "rich" });
  });

  it("warns before simplifying unsupported markup and removes active content and attributes", () => {
    const imported = importRichTextHtml(
      '<p onclick="alert(1)">Safe <img src="x" onerror="alert(2)" alt="diagram"> <a href="javascript:alert(3)">link</a><script>alert(4)</script></p>',
    );
    const html = richTextDocumentToHtml(imported.document);

    expect(imported.canConvert).toBe(true);
    expect(imported.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "unsupported-attribute",
      "unsupported-element",
      "unsafe-link",
    ]));
    expect(html).toContain("Safe diagram link");
    expect(html).not.toMatch(/script|javascript:|onclick|onerror|src=/i);
  });

  it("keeps malformed source reviewable and rejects sources above the parser limit", () => {
    const malformed = importRichTextHtml("<p>Keep this paragraph");
    const oversized = importRichTextHtml("<p>" + "a".repeat(100_001) + "</p>");
    const tooDeep = importRichTextHtml("<p>" + "<strong>".repeat(40) + "nested" + "</strong>".repeat(40) + "</p>");

    expect(malformed.canConvert).toBe(true);
    expect(malformed.warnings.map((warning) => warning.code)).toContain("invalid-markup");
    expect(richTextDocumentToHtml(malformed.document)).toContain("Keep this paragraph");
    expect(oversized.canConvert).toBe(false);
    expect(oversized.warnings.map((warning) => warning.code)).toContain("invalid-markup");
    expect(tooDeep.canConvert).toBe(false);
    expect(tooDeep.warnings.map((warning) => warning.code)).toContain("invalid-markup");
  });

  it("warns when structurally misplaced content would be removed by the document sanitizer", () => {
    const imported = importRichTextHtml("<ul><li><hr></li></ul>");

    expect(imported.document.content).toEqual([{ type: "bulletList", content: [] }]);
    expect(imported.warnings.map((warning) => warning.code)).toContain("unsupported-element");
  });

  it("warns when style block content is removed even when it appears in the document head", () => {
    const imported = importRichTextHtml("<style>p { color: red }</style><p>Text</p>");

    expect(imported.canConvert).toBe(true);
    expect(richTextDocumentToHtml(imported.document)).toBe("<p>Text</p>");
    expect(imported.warnings.map((warning) => warning.code)).toContain("unsupported-element");
  });

  it("warns before dropping unsupported content from a full document head", () => {
    const imported = importRichTextHtml(
      "<!doctype html><html><head><title>Keep this title</title><script>discardThisScript()</script></head><body><p>Keep this body</p></body></html>",
    );

    expect(imported.canConvert).toBe(true);
    expect(richTextDocumentToHtml(imported.document)).toBe("<p>Keep this body</p>");
    expect(imported.warnings).toContainEqual({
      code: "unsupported-element",
      message: "Zawartość sekcji <head> nie jest obsługiwana i zostanie usunięta podczas konwersji.",
    });
  });

  it.each([
    { comment: "<!-->", description: "abruptly closed comment", suffix: "" },
    { comment: "<!--->", description: "short abruptly closed comment", suffix: "" },
    { comment: "<!-- --!>", description: "comment closed with an exclamation mark", suffix: "<!-- later normal terminator -->" },
  ])("strips resource attributes after a $description", ({ comment, suffix }) => {
    const imported = importRichTextHtml(
      `${comment}<img src="https://rich-text-resource.invalid/malformed-comment.png" alt="Recovered image">${suffix}<p>Keep this paragraph</p>`,
    );

    expect(imported.canConvert).toBe(true);
    expect(imported.warnings).toContainEqual({
      code: "unsupported-attribute",
      message: "Atrybut „src” w elemencie <img> zostanie usunięty.",
    });
    expect(richTextDocumentToHtml(imported.document)).toContain("Recovered image");
    expect(richTextDocumentToHtml(imported.document)).toContain("Keep this paragraph");
    expect(richTextDocumentToHtml(imported.document)).not.toContain("rich-text-resource.invalid");
  });

  it("escapes legacy text when exporting it to HTML", () => {
    const html = richTextDocumentToHtml("Legacy <script>alert(1)</script> & text");

    expect(html).toBe("<p>Legacy &lt;script&gt;alert(1)&lt;/script&gt; &amp; text</p>");
  });
});
