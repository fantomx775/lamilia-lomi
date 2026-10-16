import test from "node:test";
import assert from "node:assert/strict";
import { median, p95, summarize } from "./statistics.mjs";

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

test("p95 uses the nearest-rank observation and exposes the small-sample limit", () => {
  assert.equal(p95([10, 1, 9, 2, 8, 3, 7, 4, 6, 5]), 10);
  assert.equal(p95([3, 1, 2]), 3);
});

test("p95 filters missing values and returns null when no finite samples exist", () => {
  assert.equal(p95([null, 9, 1, undefined, 7, 3, Number.NaN]), 9);
  assert.equal(p95([]), null);
  assert.equal(p95([null, undefined, Number.NaN, Number.POSITIVE_INFINITY]), null);
});

test("summary reports finite sample count, median, and empirical p95", () => {
  assert.deepEqual(summarize([10, 1, 9, 2, 8, 3, 7, 4, 6, 5]), {
    sampleCount: 10,
    medianMs: 5.5,
    empiricalP95Ms: 10,
  });
  assert.deepEqual(summarize([null, undefined, Number.NaN]), {
    sampleCount: 0,
    medianMs: null,
    empiricalP95Ms: null,
  });
});
