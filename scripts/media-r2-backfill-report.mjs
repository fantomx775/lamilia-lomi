import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";

export async function createBackfillReportWriter({
  requestedPath,
  directory = path.join(process.cwd(), ".media-r2-backfill-reports"),
  mode,
  projectRef,
  target,
  createdAt = new Date().toISOString(),
}) {
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const reportPath = path.resolve(requestedPath || path.join(
    directory,
    `backfill-${timestamp}-${randomUUID()}.jsonl`,
  ));
  await mkdir(path.dirname(reportPath), { recursive: true });
  const file = await open(reportPath, "wx");
  let closed = false;

  async function append(value) {
    if (closed) throw new Error("The backfill report is already closed.");
    await file.appendFile(`${JSON.stringify(value)}\n`, "utf8");
    await file.sync();
  }

  await append({ type: "report", version: 1, mode, createdAt, projectRef, target });

  return {
    path: reportPath,
    appendAsset(record) {
      return append({ type: "asset", ...record });
    },
    async finish(summary) {
      await append({ type: "summary", completedAt: new Date().toISOString(), summary });
      await file.close();
      closed = true;
    },
    async close() {
      if (closed) return;
      await file.close();
      closed = true;
    },
  };
}
