import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ visibility: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/community/repository", () => ({ getCommunityArtworkMedia: mocks.visibility }));
vi.mock("@/lib/community/storage", () => ({ readCommunityArtworkImage: mocks.read }));
import { GET } from "./route";

const id = "11111111-1111-4111-8111-111111111111";
function request(width?: number) { return GET(new Request(`http://localhost/api/community/artworks/${id}/media${width ? `?width=${width}` : ""}`), { params: Promise.resolve({ id }) }); }
beforeEach(() => { vi.clearAllMocks(); });
describe("authenticated artwork variants", () => {
  it("serves bounded decoded derivatives without changing no-store access semantics", async () => {
    const bytes = await sharp({ create: { width: 1536, height: 2048, channels: 3, background: "pink" } }).webp().toBuffer();
    mocks.visibility.mockResolvedValue({ contentType: "image/webp" });
    mocks.read.mockResolvedValue(bytes);
    for (const width of [480, 960, 2048]) {
      const response = await request(width);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toBe("Cookie");
      expect(response.headers.get("content-type")).toBe("image/webp");
      const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      expect(metadata.width).toBe(Math.min(1536, width));
      expect(metadata.exif).toBeUndefined();
    }
    expect(mocks.visibility).toHaveBeenCalledTimes(3);
    expect((await request(4000)).status).toBe(404);
    expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(Buffer.from(await (await request()).arrayBuffer())).toEqual(bytes);
  });
  it("checks current visibility before reading bytes for every variant and original", async () => {
    mocks.visibility.mockResolvedValue(null);
    for (const width of [undefined, 480, 960, 2048]) expect((await request(width)).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.visibility).toHaveBeenCalledTimes(4);
  });
});
