/** @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const linkState = vi.hoisted(() => ({ pending: false }));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
  useLinkStatus: () => ({ pending: linkState.pending }),
}));

import { NavigationLink } from "@/components/navigation-link";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  linkState.pending = false;
});

describe("NavigationLink", () => {
  it("keeps native link behavior and stays visually quiet for fast navigation", () => {
    const view = render(
      <NavigationLink href="/en/products" pendingLabel="Opening catalog" aria-current="page">
        Catalog
      </NavigationLink>,
    );

    expect(view.getByRole("link", { name: "Catalog" })).toHaveAttribute("href", "/en/products");
    expect(view.getByRole("link", { name: "Catalog" })).toHaveAttribute("aria-current", "page");
    expect(view.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "false");
    expect(view.getByRole("status")).toBeEmptyDOMElement();
  });

  it("announces only a navigation that remains pending", async () => {
    vi.useFakeTimers();
    linkState.pending = true;
    const view = render(
      <NavigationLink href="/en/products" pendingLabel="Opening catalog">
        Catalog
      </NavigationLink>,
    );

    expect(view.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "true");
    expect(view.getByRole("status")).toBeEmptyDOMElement();

    await act(async () => vi.advanceTimersByTime(150));
    expect(view.getByRole("status")).toHaveTextContent("Opening catalog");

    linkState.pending = false;
    view.rerender(
      <NavigationLink href="/en/products" pendingLabel="Opening catalog">
        Catalog
      </NavigationLink>,
    );
    await act(async () => vi.advanceTimersByTime(0));
    expect(view.getByRole("status")).toBeEmptyDOMElement();

    linkState.pending = true;
    view.rerender(
      <NavigationLink href="/en/products" pendingLabel="Opening catalog">
        Catalog
      </NavigationLink>,
    );
    expect(view.getByRole("status")).toBeEmptyDOMElement();
  });
});
