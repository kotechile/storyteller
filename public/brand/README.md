# Brand logo

Drop **one** image in this folder and the next render uses it automatically — no config edit, no rebuild.

- Formats: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`
- If several files are present, the first one alphabetically wins (rename to `01-logo.png` to choose deliberately)
- Where it appears: the **intro title card** (above the title) and the **closing logo card** (full-screen, fades in after the last scene)
- Sizing: the intro caps the logo at 360×140 px with `object-fit: contain`, so a wide wordmark works better than a square mark. Use a transparent PNG or SVG — the cards sit on a dark navy background
- To disable the logo entirely, set `STORYTELLER_LOGO_DIR=` (empty) in `.env`
- To read the logo from somewhere else under `public/`, point `STORYTELLER_LOGO_DIR` at that folder name

If the folder is missing or holds no image, the run does **not** fail: it records a warning naming the path it looked in, and the intro and closing card render without a logo.
