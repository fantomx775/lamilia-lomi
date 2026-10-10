import { describe, expect, it } from "vitest";

import { routing } from "./routing";

describe("public locale routing", () => {
  it("supports English as the only locale", () => {
    expect(routing.locales).toEqual(["en"]);
    expect(routing.defaultLocale).toBe("en");
  });
});
