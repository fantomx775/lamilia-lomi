import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedOwnedRscTeardown } from "../../../tests/e2e/helpers/owned-rsc-teardown";
afterEach(() => vi.useRealTimers());
describe("owned callback teardown", () => {
  it("reaches independent fixture cleanup even when a real callback never settles", async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const work = (async () => {
      try { await boundedOwnedRscTeardown(new Promise<void>(() => {})); }
      finally { cleanup(); }
    })();
    const rejected = expect(work).rejects.toThrow("five-second cleanup budget");
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves continuation errors instead of treating teardown as success", async () => {
    await expect(boundedOwnedRscTeardown(Promise.reject(new Error("continuation failed")))).rejects.toThrow("continuation failed");
  });
});
