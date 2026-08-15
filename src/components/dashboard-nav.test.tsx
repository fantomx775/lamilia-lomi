import { describe, expect, it } from "vitest";

import { getActiveHref, type DashboardNavItem } from "@/components/dashboard-nav";

const nav: DashboardNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "dashboard" },
  { href: "/admin/users", label: "Users", icon: "users" },
];

describe("getActiveHref", () => {
  it("keeps a section active on nested routes", () => {
    expect(getActiveHref("/admin/users/42", nav)).toBe("/admin/users");
  });

  it("does not treat a similar route as a nested section", () => {
    expect(getActiveHref("/admin/users-extra", nav)).toBe("/admin");
  });

  it("prefers the most specific matching section", () => {
    expect(getActiveHref("/admin/users", nav)).toBe("/admin/users");
  });
});
