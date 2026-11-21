// Generate the controlled UX127 video fixture in a supervisor-owned serial slot.
// No download, dependency install, video byte padding or MP4 concatenation.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const executable = process.argv[2];
if (!executable || !path.isAbsolute(executable)) throw new Error("Pass the absolute existing Playwright ffmpeg1013 executable path.");
await access(executable, constants.X_OK);
if (!/[/\\]ffmpeg-1013[/\\]ffmpeg(?:-win64\.exe|-linux|-mac)?$/.test(executable)) {
  throw new Error("This generator is pinned to the already installed Playwright ffmpeg1013 executable.");
}
const root = path.resolve(".task/ux127/fixtures");
await mkdir(root, { recursive: true });
if (path.relative(await realpath(process.cwd()), await realpath(root)) !== path.join(".task", "ux127", "fixtures")) {
  throw new Error("Private fixture directory resolves outside its intended workspace location.");
}
const output = path.join(root, "ux127-motion-45s.webm");
try { await stat(output); throw new Error("Owned fixture already exists; inspect/reuse it rather than overwriting."); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const width = 960, height = 540, fps = 24, duration = 45, frameCount = fps * duration;
const cycle = [];
// A deterministic changing image sequence. These are genuine decoded frames,
// repeated as video time progresses; no fake bytes are attached to a small clip.
for (let frame = 0; frame < 48; frame += 1) {
  const raw = Buffer.alloc(width * height * 3);
  let state = (0x52a193ab + frame * 0x9e3779b9) >>> 0;
  for (let offset = 0; offset < raw.length; offset += 3) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const x = (offset / 3) % width;
    const y = Math.floor(offset / 3 / width);
    raw[offset] = ((state & 127) + x + frame * 7) & 255;
    raw[offset + 1] = (((state >>> 8) & 127) + y + frame * 11) & 255;
    raw[offset + 2] = (((state >>> 16) & 127) + x + y + frame * 13) & 255;
  }
  cycle.push(await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 78 }).toBuffer());
}
const args = ["-hide_banner", "-loglevel", "error", "-n", "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(fps), "-i", "pipe:0",
  "-an", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "1800k", "-pix_fmt", "yuv420p",
  "-t", String(duration), "-frames:v", String(frameCount), "-f", "webm", output];
const encoder = spawn(executable, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
let stderr = "";
encoder.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4096); });
// Attach the exit listener before writes; a missing codec or EPIPE must not hang.
const exit = once(encoder, "close");
const deadline = setTimeout(() => encoder.kill(), 180_000);
encoder.stdin.on("error", () => undefined);
try {
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (encoder.exitCode !== null || encoder.stdin.destroyed) throw new Error("Existing encoder stopped while reading the genuine JPEG sequence.");
    if (!encoder.stdin.write(cycle[frame % cycle.length])) {
      await Promise.race([once(encoder.stdin, "drain"), exit.then(() => { throw new Error("Encoder closed before reading the frame sequence."); })]);
    }
  }
  encoder.stdin.end();
  const [code] = await exit;
  if (code !== 0) throw new Error("Existing encoder could not produce the controlled WebM fixture. Inspect only this task's private generation diagnostic.");
} catch (error) {
  encoder.stdin.destroy();
  if (encoder.exitCode === null) encoder.kill();
  await writeFile(path.join(root, "video-generation-error-private.log"), stderr);
  throw error;
} finally { clearTimeout(deadline); }
const bytes = await readFile(output);
if (bytes.subarray(0, 4).toString("hex") !== "1a45dfa3") throw new Error("Generated output lacks a WebM EBML header.");
if (bytes.length <= 6 * 1024 * 1024 || bytes.length >= 50 * 1024 * 1024) {
  throw new Error("Actual generated video does not meet the controlled >6MiB and <50MiB requirement; do not pad it or claim a large-file PASS.");
}
// Read actual container metadata with the same existing executable. No browser
// playback or application/WASM pass is inferred from this demux-only check.
const inspection = spawnSync(executable, ["-hide_banner", "-i", output], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
if (inspection.error) throw new Error("Could not inspect actual generated WebM metadata.");
const durationMatch = inspection.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
const videoLine = inspection.stderr.split(/\r?\n/).find((line) => /Video:\s*vp9/.test(line));
const dimensions = videoLine?.match(/(?:^|[, ])(\d{2,5})x(\d{2,5})(?:[, ]|$)/);
if (!durationMatch || !dimensions) throw new Error("Generated WebM does not expose a real VP9 stream and duration.");
const actualDuration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
const actualWidth = Number(dimensions[1]), actualHeight = Number(dimensions[2]);
if (Math.abs(actualDuration - duration) > 0.1 || actualWidth !== width || actualHeight !== height) {
  throw new Error("Actual generated video metadata differs from the controlled fixture contract.");
}
const result = { status: "GENERATED_CONTAINER_METADATA_VERIFIED_BROWSER_NOT_RUN", encoder: "existing Playwright ffmpeg1013 libvpx-vp9",
  width, height, fps, intendedDurationSeconds: duration, actualDurationSeconds: actualDuration,
  actualCodec: "vp9", actualWidth, actualHeight, generatedFrames: frameCount, bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  limitation: "Container metadata is verified; browser playback and original pinned WASM H264 preparation, cancel, retry, Storage and persistence remain NOT RUN." };
await writeFile(path.join(root, "ux127-motion-45s-generation.json"), JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result) + "\n");
