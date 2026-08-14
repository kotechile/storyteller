# OmniCast — Standalone Studio App Setup

> **Problem:** `http://localhost:3000` shows the Remotion Studio (composition list + timeline), not our custom `StoryStudio` wizard UI.
> **Root cause:** `StoryStudio.tsx` has no DOM entry point — nothing mounts it. Remotion Studio renders `Root.tsx` → compositions.
> **Solution:** Create a separate Vite-powered app entry that mounts `StoryStudio` on port 3001.

---

## Files to Create/Modify

| Action | File | Purpose |
|---|---|---|
| **CREATE** | `src/studioEntry.tsx` | ReactDOM entry point that mounts StoryStudio |
| **CREATE** | `studio.html` | HTML shell (already created, verify it exists) |
| **CREATE** | `vite.config.ts` | Vite config with React plugin |
| **MODIFY** | `package.json` | Add `"app": "vite --port 3001 --open studio.html"` script |

Then run: `npm install --save-dev vite @vitejs/plugin-react`

---

## File 1: `src/studioEntry.tsx` (CREATE)

```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import { StoryStudio } from './components/studio/StoryStudio';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <StoryStudio />
    </React.StrictMode>
  );
}
```

## File 2: `studio.html` (VERIFY EXISTS)

Already created at `/Users/jorgefernandezilufi/Documents/_article_research/remotion/studio.html`. Verify it contains:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OmniCast — Video Studio</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/studioEntry.tsx"></script>
</body>
</html>
```

## File 3: `vite.config.ts` (CREATE)

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist-studio',
  },
  server: {
    port: 3001,
    open: '/studio.html',
  },
});
```

## File 4: `package.json` (MODIFY)

Add to `"scripts"`:
```json
"app": "vite --port 3001 --open /studio.html"
```

## Install & Run

```bash
cd /Users/jorgefernandezilufi/Documents/_article_research/remotion

# Install Vite + React plugin
npm install --save-dev vite @vitejs/plugin-react

# Start the app (separate from Remotion Studio)
npm run app
```

This opens `http://localhost:3001/studio.html` — the standalone OmniCast wizard UI.

---

## How to Run Both

Open two terminals:

**Terminal 1** — Remotion Studio (developer tool for previewing compositions):
```bash
npm run studio    # → http://localhost:3000
```

**Terminal 2** — OmniCast App (user-facing wizard):
```bash
npm run app       # → http://localhost:3001/studio.html
```

---

## What Users See at `:3001/studio.html`

- **Step 1** — Paste URL or drop PDF, pick visual style, select music, click "Generate Storyboard"
- **Step 2** — Video preview + editable scene cards + floating camera/lighting/music toolbar
- **Step 3** — Final video player + cost breakdown

No Remotion timeline. No composition list. No developer chrome. Just the wizard.

---

## Post-Implementation Verification

- [ ] `npx tsc --noEmit` passes
- [ ] `npm run app` starts and opens browser
- [ ] StoryStudio loads at `:3001/studio.html`
- [ ] Step 1 shows URL input, style cards, music cards
- [ ] Paste a URL → click Generate → advances to Step 2
- [ ] Step 2 shows video preview + scene cards
- [ ] Expand a scene card → edit narration + image prompts
- [ ] Step 3 shows final video player + cost breakdown
