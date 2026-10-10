import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const lockPath = path.join(
  os.tmpdir(),
  `lamilialomi-content-store-${createHash("sha256").update(path.resolve(process.cwd())).digest("hex")}.lock`,
);
const ownerPath = path.join(lockPath, "owner.json");
const lockWaitMs = 9 * 60_000;

type LockOwner = { pid: number; token: string };

export async function acquireLocalContentStoreLock(): Promise<() => void> {
  const token = randomUUID();
  const deadline = Date.now() + lockWaitMs;

  while (true) {
    try {
      fs.mkdirSync(lockPath);
      try {
        fs.writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token } satisfies LockOwner), "utf8");
      } catch (error) {
        fs.rmdirSync(lockPath);
        throw error;
      }

      let released = false;
      return () => {
        if (released) return;
        const owner = readOwner();
        if (owner?.token === token) {
          fs.unlinkSync(ownerPath);
          fs.rmdirSync(lockPath);
        }
        released = true;
      };
    } catch (error) {
      if (codeOf(error) !== "EEXIST") throw error;
      removeStaleLock();
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for another local content-store E2E flow to finish.");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

function readOwner(): LockOwner | null {
  try {
    const value = JSON.parse(fs.readFileSync(ownerPath, "utf8")) as Partial<LockOwner>;
    return Number.isSafeInteger(value.pid) && typeof value.token === "string"
      ? { pid: value.pid!, token: value.token }
      : null;
  } catch {
    return null;
  }
}

function removeStaleLock() {
  let owner: LockOwner | null = null;
  let modifiedAt = 0;
  try {
    owner = readOwner();
    modifiedAt = fs.statSync(lockPath).mtimeMs;
  } catch {
    return;
  }

  if (owner && isProcessAlive(owner.pid)) return;
  if (!owner && Date.now() - modifiedAt < 5_000) return;

  const stalePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    fs.renameSync(lockPath, stalePath);
    try {
      fs.unlinkSync(path.join(stalePath, "owner.json"));
    } catch (error) {
      if (codeOf(error) !== "ENOENT") throw error;
    }
    fs.rmdirSync(stalePath);
  } catch (error) {
    if (codeOf(error) !== "ENOENT" && codeOf(error) !== "EEXIST") throw error;
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === "EPERM";
  }
}

function codeOf(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : "";
}
