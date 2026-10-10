import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { createBackfillReportWriter } from "./media-r2-backfill-report.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("createBackfillReportWriter", () => {
  it("flushes per-asset progress and leaves a valid resumable report after interruption", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "media-backfill-report-"));
    temporaryDirectories.push(directory);
    const reportPath = path.join(directory, "inventory.jsonl");
    const writer = await createBackfillReportWriter({
      requestedPath: reportPath,
      mode: "apply",
      projectRef: "test-project",
      target: { privateBucket: "private", publicBucket: "public" },
      createdAt: "2026-10-09T12:00:00.000Z",
    });

    await writer.appendAsset({ phase: "started", assetId: "asset-1", result: "in_progress" });
    await writer.appendAsset({ phase: "finished", assetId: "asset-1", result: "failed", failure: "copy failed" });

    const linesBeforeCompletion = (await readFile(reportPath, "utf8")).trim().split("\n").map(JSON.parse);
    expect(linesBeforeCompletion.map((line) => [line.type, line.phase, line.result])).toEqual([
      ["report", undefined, undefined],
      ["asset", "started", "in_progress"],
      ["asset", "finished", "failed"],
    ]);

    await writer.close();
  });

  it("refuses to overwrite an existing report", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "media-backfill-report-"));
    temporaryDirectories.push(directory);
    const reportPath = path.join(directory, "inventory.jsonl");
    const first = await createBackfillReportWriter({
      requestedPath: reportPath,
      mode: "dry-run",
      projectRef: "test-project",
      target: {},
    });
    await first.close();

    await expect(createBackfillReportWriter({
      requestedPath: reportPath,
      mode: "dry-run",
      projectRef: "test-project",
      target: {},
    })).rejects.toMatchObject({ code: "EEXIST" });
  });
});
