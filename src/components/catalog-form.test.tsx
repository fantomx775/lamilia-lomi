/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/form", () => ({ default: ({ children, scroll, ...props }: ComponentProps<"form"> & { children: ReactNode; scroll?: boolean }) => { void scroll; return <form {...props}>{children}</form>; } }));
import { CatalogForm, CatalogNavigationProvider, CatalogResults, CatalogSearchInput, CatalogSubmitButton } from "./catalog-form";

afterEach(() => { cleanup(); push.mockClear(); });

describe("progressively enhanced catalog GET", () => {
  it("keeps edits newer than submit A when A commits, then synchronizes Back and Forward", () => {
    const controls = (query: string, sourceKey = query ? `/en/products?q=${encodeURIComponent(query)}` : "/en/products") => <CatalogNavigationProvider>
      <CatalogForm action="/en/products" data-testid="mobile"><CatalogSearchInput aria-label="Mobile search" name="q" value={query} sourceKey={sourceKey} /><CatalogSubmitButton>Search</CatalogSubmitButton></CatalogForm>
      <CatalogForm action="/en/products" data-testid="desktop"><CatalogSearchInput aria-label="Desktop search" name="q" value={query} sourceKey={sourceKey} /></CatalogForm>
    </CatalogNavigationProvider>;
    const view = render(controls(""));
    const mobile = screen.getByRole("textbox", { name: "Mobile search" });
    const desktop = screen.getByRole("textbox", { name: "Desktop search" });
    mobile.focus(); fireEvent.change(mobile, { target: { value: "Garden" } });
    fireEvent.submit(screen.getByTestId("mobile"));
    expect(push).toHaveBeenCalledWith("/en/products?q=Garden", { scroll: false });
    // New unsent input arrives after the actual form submission, before its RSC props.
    fireEvent.change(mobile, { target: { value: "Garden sky" } });
    view.rerender(controls("Garden"));
    expect(mobile).toHaveValue("Garden sky"); expect(mobile).toHaveFocus();
    expect(desktop).toHaveValue("Garden");
    // Consuming the submit acknowledgement once keeps future history authoritative.
    view.rerender(controls("Garden", "/en/products?q=Garden&category=earlier"));
    expect(mobile).toHaveValue("Garden"); expect(mobile).toHaveFocus();
    view.rerender(controls("Earlier search"));
    expect(mobile).toHaveValue("Earlier search"); expect(mobile).toHaveFocus();
    view.rerender(controls("Garden"));
    expect(mobile).toHaveValue("Garden"); expect(mobile).toHaveFocus();
    expect(desktop).toHaveValue("Garden");
  });
  it("retains textbox focus when server query changes and restores later history values", () => {
    const view = render(<CatalogSearchInput aria-label="Search catalog" name="q" value="" />);
    const input = screen.getByRole("textbox", { name: "Search catalog" });
    input.focus(); fireEvent.change(input, { target: { value: "Quiet garden" } });
    view.rerender(<CatalogSearchInput aria-label="Search catalog" name="q" value="Quiet garden" />);
    expect(input).toHaveFocus(); expect(input).toHaveValue("Quiet garden");
    view.rerender(<CatalogSearchInput aria-label="Search catalog" name="q" value="Earlier search" />);
    expect(input).toHaveFocus(); expect(input).toHaveValue("Earlier search");
  });
  it("server-renders the native action, usable fields and real results without a streamed fallback", () => {
    const html = renderToStaticMarkup(<CatalogNavigationProvider><CatalogForm action="/en/products"><input name="q" defaultValue="Garden" /><CatalogSubmitButton>Search</CatalogSubmitButton></CatalogForm><CatalogResults desktopColumns={3}><div data-testid="actual-result">Garden book</div></CatalogResults></CatalogNavigationProvider>);
    expect(html).toContain('action="/en/products"');
    expect(html).toContain('name="q" value="Garden"');
    expect(html).toContain('data-testid="actual-result"');
    expect(html).not.toContain('data-testid="product-catalog-loading"');
    expect(html).not.toContain("<!--$");
  });

  it("enhances the real GET fields including repeated context without discarding query or pushing a full document", () => {
    render(<CatalogNavigationProvider><CatalogForm action="/en/products" data-testid="form"><input name="q" defaultValue="Quiet garden & sky" /><input name="audience" defaultValue="adults" /><input name="type" defaultValue="coloring-book" /><input name="category" defaultValue="gardens" /><input name="sort" defaultValue="az" /><input type="hidden" name="context" value="first" /><input type="hidden" name="context" value="second" /><CatalogSubmitButton>Search</CatalogSubmitButton></CatalogForm></CatalogNavigationProvider>);
    expect(fireEvent.submit(screen.getByTestId("form"))).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
    const [href, options] = push.mock.calls[0];
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/en/products");
    expect([...url.searchParams]).toEqual([["q", "Quiet garden & sky"], ["audience", "adults"], ["type", "coloring-book"], ["category", "gardens"], ["sort", "az"], ["context", "first"], ["context", "second"]]);
    expect(options).toEqual({ scroll: false });
  });
});
