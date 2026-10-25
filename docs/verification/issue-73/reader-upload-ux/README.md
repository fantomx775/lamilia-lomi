# Reader-artwork upload UX follow-up

The reader-artwork section now follows GALERIA directly. Its file picker matches the gallery drop area, accepts multiple images, and shows local thumbnails before asking for each public nickname and optional description. Upload errors retain that row's file and text. Saved cards expose move up/down, edit, show/hide and delete controls. The storage model, API and 4 MiB image limit are unchanged.

- [Mobile preview and attribution](preview-390.png)
- [Multiple selected images](previews-1440.png)
- [Saved artwork management, desktop](management-1440.png)
- [Saved artwork management, mobile](management-390.png)

These are owned local-demo fixtures. The focused Playwright scenario covers file selection and drag/drop, no upload before attribution, three uploads, both move directions, edit/reload persistence, hide/show, deletion, responsive geometry and preservation of original book assets. It removes its own artwork and restores the original content snapshot. Current-SHA commands, run ID, CI and independent review are recorded in the PR verification comments.

No database migration is required for this client UI change.
