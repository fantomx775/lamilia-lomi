# Local Issue 60/67 media

`frog-prince-public.json` contains story copy used by the PDP/gallery tests. Its media entries are fixture identifiers; the tests copy the bundled SVG illustrations and the existing local `issue-127/flower.mp4` into a unique temporary directory under `public/uploads`, then remove that directory during cleanup.

These cases exercise the real local Next image routes, native poster rendering, video range server, and playback without downloading media or contacting Production.
