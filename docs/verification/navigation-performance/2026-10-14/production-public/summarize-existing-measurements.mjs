import fs from "node:fs";
import { summarizeGroups } from "./summary.mjs";

const filePath = process.argv[2];
if (!filePath) throw new Error("Pass a measurements.json path.");
const report = JSON.parse(fs.readFileSync(filePath, "utf8"));
report.summary = summarizeGroups(report.groups);
fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ runId: report.runId, summary: report.summary }, null, 2));
