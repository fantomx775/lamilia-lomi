import { describe, expect, it } from "vitest";

import { isHtmlDocumentRequest } from "./is-html-document-request";

describe("HTML document request detection", () => {
  it("recognizes browser document navigations", () => {
    expect(
      isHtmlDocumentRequest(
        new Headers({
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "sec-fetch-dest": "document",
        }),
      ),
    ).toBe(true);
  });

  it("skips App Router fetches even when Next strips its internal Flight headers", () => {
    expect(
      isHtmlDocumentRequest(
        new Headers({
          accept: "*/*",
          "sec-fetch-dest": "empty",
        }),
      ),
    ).toBe(false);
  });

  it("recognizes crawler HTML requests when browser fetch metadata is absent", () => {
    expect(isHtmlDocumentRequest(new Headers({ accept: "text/html, */*;q=0.8" }))).toBe(true);
  });

  it("ignores prefetch and generic requests without document markers", () => {
    expect(
      isHtmlDocumentRequest(
        new Headers({
          accept: "text/html",
          purpose: "prefetch",
        }),
      ),
    ).toBe(false);
    expect(isHtmlDocumentRequest(new Headers({ accept: "*/*" }))).toBe(false);
  });
});
