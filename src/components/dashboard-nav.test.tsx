/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/users/42",
}));

import { DashboardNav, getActiveHref, type DashboardNavItem } from "@/components/dashboard-nav";

afterEach(() => {
  cleanup();
});

const nav: DashboardNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "dashboard" },
  { href: "/admin/users", label: "Users", icon: "users" },
];

describe("getActiveHref", () => {
  it("keeps a section active on nested routes", () => {
    expect(getActiveHref("/admin/users/42", nav)).toBe("/admin/users");
  });

  it("does not treat a similar route as a nested section", () => {
    expect(getActiveHref("/admin/users-extra", nav)).toBeNull();
  });

  it("prefers the most specific matching section", () => {
    expect(getActiveHref("/admin/users", nav)).toBe("/admin/users");
  });
});

describe("DashboardNav", () => {
  it("keeps every mobile item visible without a horizontal scroller", () => {
    const view = render(<DashboardNav nav={nav} />);
    const navigation = view.getByRole("navigation");

    expect(navigation).toHaveClass("grid", "grid-cols-2", "lg:grid-cols-1");
    expect(navigation).not.toHaveClass("overflow-x-auto");
    expect(view.getAllByRole("link")).toHaveLength(nav.length);
    expect(view.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
  });
});
