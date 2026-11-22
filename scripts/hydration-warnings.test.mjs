import { expect, test } from "vitest";
import { isKnownCaretOnlyHydrationWarning } from "../tests/e2e/helpers/hydration-warnings.ts";

const warning = (diff) => [
  "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties.",
  "This can happen if a SSR-ed Client Component used:",
  "- A server/client branch `if (typeof window !== 'undefined')`.",
  "https://react.dev/link/hydration-mismatch",
  "  <html>",
  "    ...",
  diff,
].join("\n");

test("accepts the exact caret-color-only React hydration diff", () => {
  expect(isKnownCaretOnlyHydrationWarning(warning('- style={{caret-color:"transparent"}}'))).toBe(true);
});

test("rejects another changed attribute before an ellipsis", () => {
  const message = warning('- style={{caret-color:"transparent"}}').replace(
    "    ...",
    '    - className="unexpected-mismatch"\n    ...',
  );
  expect(isKnownCaretOnlyHydrationWarning(message)).toBe(false);
});

test("rejects another changed attribute after an ellipsis", () => {
  const message = warning('- style={{caret-color:"transparent"}}') + '\n+ id="unexpected-mismatch"';
  expect(isKnownCaretOnlyHydrationWarning(message)).toBe(false);
});

test("rejects a missing React diff marker", () => {
  expect(isKnownCaretOnlyHydrationWarning(
    "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties.\n- style={{caret-color:\"transparent\"}}",
  )).toBe(false);
});
