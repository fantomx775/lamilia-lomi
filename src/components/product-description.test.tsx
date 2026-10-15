/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductDescription } from "@/components/product-description";
import { RichTextContent } from "@/components/rich-text-content";
import { getRichTextTextContent, serializeRichTextDocument } from "@/lib/rich-text";

let scrollHeight = 400;
class ResizeObserverMock { observe() {} disconnect() {} }
beforeEach(() => {
  scrollHeight = 400;
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => scrollHeight);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const rich = serializeRichTextDocument({type:"doc",content:[
  {type:"heading",attrs:{level:2},content:[{type:"text",text:"Explore the story"}]},
  {type:"paragraph",content:[{type:"text",text:"Story details",marks:[{type:"link",attrs:{href:"https://example.com/story"}}]}]},
]});
const description = <ProductDescription previewText={getRichTextTextContent(rich)} readMore="Read more" showLess="Show less"><RichTextContent value={rich} /></ProductDescription>;

describe("ProductDescription", () => {
  it("exposes the collapsed preview to assistive technology and reveals original rich text", async () => {
    const user = userEvent.setup();
    render(description);
    const toggle = screen.getByRole("button", {name:"Read more"});
    const region = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(region).not.toHaveAttribute("inert");
    expect(region).not.toHaveAttribute("aria-hidden");
    expect(screen.getByText("Explore the story Story details")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("link", {name:"Story details"})).toBeVisible();
    expect(screen.getByRole("heading", {name:"Explore the story"})).toBeVisible();
    expect(screen.getByRole("button", {name:"Show less"})).toHaveAttribute("aria-expanded", "true");
  });
  it("makes the hidden rich content inert and supports keyboard disclosure", async () => {
    const user = userEvent.setup();
    render(<><ProductDescription previewText="Accessible preview" readMore="Read more" showLess="Show less"><a href="https://example.com/details">Hidden link</a><button>Hidden action</button></ProductDescription><button>After description</button></>);
    expect(screen.getByText("Hidden link").parentElement).toHaveAttribute("inert");
    screen.getByRole("button", {name:"Read more"}).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("link")).toBeVisible();
    await user.keyboard(" ");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("button", {name:"After description"})).toHaveFocus();
  });
  it("keeps short and empty content accessible without a disclosure", () => {
    scrollHeight = 80;
    const {rerender} = render(description);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link")).toBeVisible();
    rerender(<ProductDescription previewText="" readMore="Read more" showLess="Show less">{null}</ProductDescription>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("renders the complete, unrestricted rich text before hydration and without JavaScript", () => {
    const html = renderToStaticMarkup(description);
    const body = document.createElement("div");
    body.innerHTML = html;
    expect(body.querySelector("a")).toHaveTextContent("Story details");
    expect(body.querySelector("h2")).toHaveTextContent("Explore the story");
    expect(body.querySelector("[inert], [aria-hidden], button, [style*='max-height']")).toBeNull();
  });
  it("truncates only extracted text and escapes markup in the preview", () => {
    render(<ProductDescription previewText={'<script>alert(1)</script> ' + 'story '.repeat(100)} readMore="Read more" showLess="Show less"><p>Full content</p></ProductDescription>);
    expect(screen.getByText(/<script>/)).toHaveTextContent(/…$/);
    expect(document.querySelector("script")).toBeNull();
  });
});
