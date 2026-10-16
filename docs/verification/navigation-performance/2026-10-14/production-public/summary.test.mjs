import test from "node:test";
import assert from "node:assert/strict";
import { summarizeGroups } from "./summary.mjs";

test("group summary reports early feedback, URL, loading, and content timings", () => {
  const groups = summarizeGroups([{
    device: "desktop",
    transition: "test",
    label: "Test transition",
    acceptedPairs: 3,
    accepted: [
      { cold: { clickToFirstVisibleUiMs: 20, clickToPressedFeedbackMs: 20, clickToLoadingUiMs: 30, clickToUrlMs: 25, clickToMeaningfulContentMs: 300 }, warm: { clickToFirstVisibleUiMs: 40, clickToPressedFeedbackMs: null, clickToLoadingUiMs: 40, clickToUrlMs: 50, clickToMeaningfulContentMs: 350 } },
      { cold: { clickToFirstVisibleUiMs: 150, clickToPressedFeedbackMs: null, clickToLoadingUiMs: 150, clickToUrlMs: 175, clickToMeaningfulContentMs: 400 }, warm: { clickToFirstVisibleUiMs: 350, clickToPressedFeedbackMs: null, clickToLoadingUiMs: null, clickToUrlMs: 175, clickToMeaningfulContentMs: 350 } },
      { cold: { clickToFirstVisibleUiMs: 500, clickToPressedFeedbackMs: null, clickToLoadingUiMs: null, clickToUrlMs: 550, clickToMeaningfulContentMs: 500 }, warm: { clickToFirstVisibleUiMs: 80, clickToPressedFeedbackMs: 80, clickToLoadingUiMs: null, clickToUrlMs: 90, clickToMeaningfulContentMs: 330 } },
    ],
  }]);

  assert.deepEqual(groups[0].cold.firstVisibleFeedback, { sampleCount: 3, medianMs: 150, empiricalP95Ms: 500 });
  assert.equal(groups[0].cold.preContentFeedbackSamples, 2);
  assert.equal(groups[0].cold.firstVisibleFeedbackWithin100Ms, 1);
  assert.equal(groups[0].cold.firstVisibleFeedbackWithin150Ms, 2);
  assert.deepEqual(groups[0].cold.loadingUi, { sampleCount: 2, medianMs: 90, empiricalP95Ms: 150 });
  assert.deepEqual(groups[0].cold.urlChange, { sampleCount: 3, medianMs: 175, empiricalP95Ms: 550 });
  assert.deepEqual(groups[0].cold.meaningfulContent, { sampleCount: 3, medianMs: 400, empiricalP95Ms: 500 });
});
