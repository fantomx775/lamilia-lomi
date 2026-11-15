import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const output = new URL("../public/admin-video-encoder/", import.meta.url);
const esm = dirname(require.resolve("@ffmpeg/ffmpeg"));

await mkdir(output, { recursive: true });
await Promise.all([
  cp(resolve(esm, "../umd/ffmpeg.js"), new URL("ffmpeg.js", output)),
  ...["worker.js", "const.js", "errors.js"].map((file) =>
    cp(resolve(esm, file), new URL(file, output))),
]);
