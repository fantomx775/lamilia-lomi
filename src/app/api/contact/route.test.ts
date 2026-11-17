import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), getResendClient: vi.fn(), getBackendMode: vi.fn() }));
vi.mock("@/lib/email", () => ({ getResendClient: mocks.getResendClient }));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
import { POST } from "./route";

const payload = { name: "Test Reader", email: "reader@example.test", message: "A controlled test message.", locale: "en" };
function request(extra = {}, origin = "http://127.0.0.1:3000") {
  return new Request("http://127.0.0.1:3000/api/contact", { method: "POST", headers: { origin }, body: new URLSearchParams({ ...payload, requestId: "11111111-1111-4111-8111-111111111111", ...extra }) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.getBackendMode.mockReturnValue("local"); mocks.getResendClient.mockReturnValue({ emails: { send: mocks.send } }); });
afterEach(() => vi.unstubAllEnvs());

describe("Contact delivery contract", () => {
  it("returns field errors without reaching the provider and rejects a foreign origin", async () => {
    const invalid = await POST(request({ name: "", message: "" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ ok: false, fields: { name: expect.any(String), message: expect.any(String) } });
    expect((await POST(request({}, "https://evil.test"))).status).toBe(403);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not report accepted delivery when the provider resolves with an error", async () => {
    mocks.send.mockResolvedValue({ data: null, error: { message: "Provider rejected" } });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false });
  });
  it("uses the same provider idempotency key for the same retry and binds it to content", async () => {
    mocks.send.mockResolvedValue({ data: { id: "accepted-test" }, error: null });
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(200);
    const first = mocks.send.mock.calls[0][1].idempotencyKey;
    expect(mocks.send.mock.calls[1][1].idempotencyKey).toBe(first);
    await POST(request({ message: "A different controlled message." }));
    expect(mocks.send.mock.calls[2][1].idempotencyKey).not.toBe(first);
    expect(mocks.send.mock.calls[0][0].replyTo).toBe(payload.email);
  });
  it("fails explicitly without a mail provider instead of returning a stub success", async () => {
    mocks.getResendClient.mockReturnValue(null);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
  });
  it("records accepted local mail exactly once in the guarded test sink", async () => {
    vi.stubEnv("LAMILIA_CONTACT_TEST_SINK", "1");
    const requestId = randomUUID();
    const key = createHash("sha256").update(requestId).update(JSON.stringify(payload)).digest("hex");
    const filename = path.join(process.cwd(), ".data", "contact-test-outbox", `${key}.json`);
    try {
      const first = await POST(request({ requestId }));
      expect(await first.json()).toEqual({ ok: true, mode: "local-test-sink" });
      const stored = await readFile(filename, "utf8");
      const repeated = await POST(request({ requestId }));
      expect(await repeated.json()).toEqual({ ok: true, mode: "local-test-sink" });
      expect(await readFile(filename, "utf8")).toBe(stored);
      expect(JSON.parse(stored).text).toContain(payload.message);
      expect(mocks.send).not.toHaveBeenCalled();
    } finally { await unlink(filename).catch(() => undefined); }
  });
  it("never enables the test sink for a public-host request", async () => {
    vi.stubEnv("LAMILIA_CONTACT_TEST_SINK", "1");
    mocks.getResendClient.mockReturnValue(null);
    const publicRequest = new Request("https://example.test/api/contact", { method: "POST", headers: { origin: "https://example.test" }, body: new URLSearchParams({ ...payload, requestId: randomUUID() }) });
    expect((await POST(publicRequest)).status).toBe(503);
  });
});
