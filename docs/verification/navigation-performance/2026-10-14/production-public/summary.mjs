import { summarize } from "./statistics.mjs";

function summarizeState(samples, state) {
  const values = (key) => samples.map((sample) => sample[state][key]);
  const firstVisible = values("clickToFirstVisibleUiMs");
  const meaningfulContent = values("clickToMeaningfulContentMs");

  return {
    firstVisibleFeedback: summarize(firstVisible),
    preContentFeedbackSamples: samples.filter((sample) =>
      Number.isFinite(sample[state].clickToFirstVisibleUiMs)
      && Number.isFinite(sample[state].clickToMeaningfulContentMs)
      && sample[state].clickToFirstVisibleUiMs < sample[state].clickToMeaningfulContentMs
    ).length,
    firstVisibleFeedbackWithin100Ms: firstVisible.filter((value) => Number.isFinite(value) && value <= 100).length,
    firstVisibleFeedbackWithin150Ms: firstVisible.filter((value) => Number.isFinite(value) && value <= 150).length,
    pressedFeedback: summarize(values("clickToPressedFeedbackMs")),
    loadingUi: summarize(values("clickToLoadingUiMs")),
    urlChange: summarize(values("clickToUrlMs")),
    meaningfulContent: summarize(meaningfulContent),
  };
}

export function summarizeGroups(groups) {
  return groups.map((group) => ({
    device: group.device,
    transition: group.transition,
    label: group.label,
    acceptedPairs: group.acceptedPairs,
    cold: summarizeState(group.accepted, "cold"),
    warm: summarizeState(group.accepted, "warm"),
  }));
}
