import test from "node:test";
import assert from "node:assert/strict";
import { median } from "./statistics.mjs";

test("median selects the middle value for odd sample counts", () => {
  assert.equal(median([8, 1, 4]), 4);
});

test("median averages the two middle values for even sample counts", () => {
  assert.equal(median([9, 1, 7, 3]), 5);
});

test("median filters missing and non-finite values before selecting the middle", () => {
  assert.equal(median([null, 9, 1, undefined, 7, 3, Number.NaN]), 5);
  assert.equal(median([1, null, 3]), 2);
});

test("median returns null when no finite samples are available", () => {
  assert.equal(median([]), null);
  assert.equal(median([null, undefined, Number.NaN, Number.POSITIVE_INFINITY]), null);
});
