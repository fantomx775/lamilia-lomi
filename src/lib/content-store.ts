import fs from "node:fs";
import path from "node:path";

import type { ContentSnapshot } from "./types";
import { getSeedContentSnapshot } from "./local-content";

export { getSeedContentSnapshot } from "./local-content";

const contentStorePath = path.join(
  process.cwd(),
  "data",
  "lamilialomi-content.local.json",
);

export function getContentStorePath() {
  return contentStorePath;
}

export function getContentSnapshot(): ContentSnapshot {
  if (process.env.VITEST) {
    return getSeedContentSnapshot();
  }

  if (!fs.existsSync(contentStorePath)) {
    return getSeedContentSnapshot();
  }

  try {
    const stored = JSON.parse(fs.readFileSync(contentStorePath, "utf8")) as Partial<ContentSnapshot>;
    const seed = getSeedContentSnapshot();

    return structuredClone({
      products: Array.isArray(stored.products) ? stored.products : seed.products,
      categories: Array.isArray(stored.categories) ? stored.categories : seed.categories,
      tags: Array.isArray(stored.tags) ? stored.tags : seed.tags,
      staticPages: Array.isArray(stored.staticPages)
        ? stored.staticPages
        : seed.staticPages,
    });
  } catch {
    return getSeedContentSnapshot();
  }
}

export function saveContentSnapshot(snapshot: ContentSnapshot) {
  fs.mkdirSync(path.dirname(contentStorePath), { recursive: true });
  fs.writeFileSync(contentStorePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}
