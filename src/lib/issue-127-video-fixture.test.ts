import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("independent local MP4 fixture", () => {
  it("has real AVC/AAC sample entries and a faststart moov before mdat", () => {
    const bytes = readFileSync(path.resolve("tests/e2e/fixtures/issue-127/flower.mp4"));
    const boxes: Array<{ type: string; offset: number }> = [];
    const codecs: string[] = [];
    function inspect(start: number, end: number, top = false) {
      for (let offset = start; offset + 8 <= end;) {
        const size = bytes.readUInt32BE(offset);
        const type = bytes.toString("ascii", offset + 4, offset + 8);
        expect(size).toBeGreaterThanOrEqual(8);
        expect(offset + size).toBeLessThanOrEqual(end);
        if (top) boxes.push({ type, offset });
        if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) inspect(offset + 8, offset + size);
        if (type === "stsd") {
          const count = bytes.readUInt32BE(offset + 12);
          let entry = offset + 16;
          for (let index = 0; index < count; index++) {
            codecs.push(bytes.toString("ascii", entry + 4, entry + 8));
            entry += bytes.readUInt32BE(entry);
          }
        }
        offset += size;
      }
    }
    inspect(0, bytes.length, true);
    expect(boxes[0].type).toBe("ftyp");
    expect(boxes.find((box) => box.type === "moov")!.offset).toBeLessThan(boxes.find((box) => box.type === "mdat")!.offset);
    expect(codecs).toContain("avc1");
    expect(codecs).toContain("mp4a");
  });
});
