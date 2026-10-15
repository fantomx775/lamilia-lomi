/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductDescription } from "@/components/product-description";

let scrollHeight = 400;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  scrollHeight = 400;
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => scrollHeight);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProductDescription", () => {
  it("keeps the full server-rendered description and offers an accessible disclosure when it overflows", async () => {
    render(
      <ProductDescription readMore="Read more" showLess="Show less">
        <p>Complete product description</p>
        <a href="https://example.com/details">More details</a>
      </ProductDescription>,
    );

    const body = screen.getByText("Complete product description").parentElement;
    const toggle = await screen.findByRole("button", { name: "Read more" });
    const content = document.getElementById(toggle.getAttribute("aria-controls") ?? "");

    expect(body).toHaveTextContent("More details");
    expect(content).toHaveTextContent("Complete product description");
    expect(content).toHaveAttribute("inert");
    expect(content).toHaveAttribute("aria-hidden", "true");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", content?.id);

    fireEvent.click(toggle);

    expect(await screen.findByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(content).not.toHaveAttribute("inert");
    expect(content).not.toHaveAttribute("aria-hidden", "true");
  });

  it("does not render a toggle for short or empty content", async () => {
    scrollHeight = 80;
    const { rerender } = render(
      <ProductDescription readMore="Read more" showLess="Show less">
        <p>Short copy</p>
        <a href="https://example.com/details">Short details</a>
      </ProductDescription>,
    );

    await waitFor(() => expect(screen.queryByRole("button", { name: "Read more" })).not.toBeInTheDocument());
    expect(await screen.findByRole("link", { name: "Short details" })).toBeVisible();

    rerender(
      <ProductDescription readMore="Read more" showLess="Show less">
        {null}
      </ProductDescription>,
    );

    expect(screen.queryByRole("button", { name: "Read more" })).not.toBeInTheDocument();
  });
});
