import { readFileSync } from "node:fs";

const MEDIA_GATE_PATH = "/_ux127/test/media-gate";

type MediaGateAction = "arm" | "release" | "disarm";
type MediaGateMode = "hold" | "abort" | "http-503";
export type MediaGateRequestArrival = { sequence: number; method: string; range: string | null; arrivedAtEpochMs: number;
  outcome: string; responseStatus: number | null; responseAtEpochMs: number | null };
export type MediaGateState = { armed: boolean; path?: string; mode?: MediaGateMode; arrivals: number; clientClosed: number;
  released: number; aborted: number; http503?: number; requestArrivals?: MediaGateRequestArrival[] };

function mediaGateSecret() {
  const secretPath = process.env.UX127_MEDIA_GATE_SECRET_PATH;
  if (!secretPath || !/^(?:[A-Za-z]:\\|\/)/.test(secretPath)) {
    throw new Error("The private local media test gate secret path is required.");
  }
  const secret = readFileSync(secretPath, "utf8").trim();
  if (secret.length < 32 || /\s/.test(secret)) throw new Error("The private local media test gate secret is invalid.");
  return secret;
}

export async function controlIssue127MediaGate(
  action: MediaGateAction,
  mediaPath: string,
  mode?: MediaGateMode,
) {
  const response = await fetch("https://localhost:3443" + MEDIA_GATE_PATH, {
    method: "POST",
    headers: { authorization: `Bearer ${mediaGateSecret()}`, "content-type": "application/json" },
    body: JSON.stringify({ action, path: mediaPath, ...(mode ? { mode } : {}) }),
  });
  if (!response.ok) throw new Error("The isolated local media test gate rejected a controlled request.");
  return response.json() as Promise<Record<string, unknown>>;
}

export async function readIssue127MediaGateState() {
  const response = await fetch("https://localhost:3443" + MEDIA_GATE_PATH, {
    headers: { authorization: `Bearer ${mediaGateSecret()}` },
  });
  if (!response.ok) throw new Error("The isolated local media test gate state could not be read.");
  return response.json() as Promise<MediaGateState>;
}
