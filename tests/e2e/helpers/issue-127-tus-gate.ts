import { readFileSync } from "node:fs";

const TUS_GATE_PATH = "/_ux127/test/tus-gate";
type TusGateAction = "arm" | "release" | "disarm";
type TusGateMethod = "POST" | "PATCH";
export type TusGateTransfer = { sequence: number; method: TusGateMethod; offset: number | null; declaredBytes: number | null;
  bytes: number; sha256: string | null; status: number | null; acknowledgedOffset: number | null; complete: boolean };
export type TusGateState = { armed: boolean; method?: TusGateMethod; arrivals: number; released: number;
  transfers?: TusGateTransfer[]; aggregateSha256?: string };

function tusGateSecret() {
  const secretPath = process.env.UX127_MEDIA_GATE_SECRET_PATH;
  if (!secretPath || !/^(?:[A-Za-z]:\\|\/)/.test(secretPath)) {
    throw new Error("The private local TUS test gate secret path is required.");
  }
  const secret = readFileSync(secretPath, "utf8").trim();
  if (secret.length < 32 || /\s/.test(secret)) throw new Error("The private local TUS test gate secret is invalid.");
  return secret;
}

async function sendTusGateRequest(method: "GET" | "POST", body?: Record<string, string>) {
  const response = await fetch("https://localhost:3443" + TUS_GATE_PATH, {
    method,
    headers: { authorization: `Bearer ${tusGateSecret()}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error("The isolated local TUS test gate rejected the request.");
  return response.json() as Promise<TusGateState>;
}

export function controlIssue127TusGate(action: TusGateAction, objectPrefix: string, method?: TusGateMethod) {
  return sendTusGateRequest("POST", { action, objectPrefix, ...(method ? { method } : {}) });
}

export function readIssue127TusGateState() {
  return sendTusGateRequest("GET");
}
