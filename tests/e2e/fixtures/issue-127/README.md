# Local video fixture

`flower.mp4` is the independent CC0 sample from the [MDN interactive examples](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4).
It is not customer or Production material. Downloaded 2026-11-17 for local playback regression testing.

The fixture's actual MP4 atom/sample-entry inspection is tested in `src/lib/issue-127-video-fixture.test.ts`.
Codec/container checks do not prove playback: `issue-127-media.spec.ts` separately checks local HTTP Range, real frames, seeking and inline playback in the selected Chromium/WebKit projects.
