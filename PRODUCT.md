# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner-builder: a solo software architect producing explainer and launch videos for his own
products. He is not a video editor and does not want to be in an editing loop — he has a URL or a
document that deserves a video, and he wants the video. Work happens in short sessions, usually
started from an agent (Hermes) rather than from a browser, often while doing something else.

No other audience is confirmed. External customers, team operators, and a hosted service were
offered and not selected; treat them as unvalidated.

## Product Purpose

Turn a URL (or PDF) into a finished, narrated explainer video — storyboard, generated images and
infographics, animated scenes, narration with word-level timestamps, and a rendered MP4 with a baked
poster — without a human assembling it.

Success is a run that a person can leave alone and come back to a watchable video. The owner judges
it by whether he would publish the result, not by whether the pipeline ran.

## Positioning

The durable mechanism is the **unattended path**: a URL goes in and a finished video comes out with
no editor in the loop, invocable as a tool call with every parameter defaulted from configuration.
Confirmed by the owner as the one property that must survive future changes.

Neighbouring tools either generate clips from a prompt, or hand a human a timeline to assemble.
This one owns the whole chain — planning, art, motion, voice, render — and is designed to be driven
by an agent or a scheduler, with the interactive Studio as an override rather than the requirement.

## Operating Context

- **Two surfaces, one engine.** Headless: `npm run storyteller`, and the `storyteller` MCP server
  (`storyteller_generate` / `_status` / `_list_runs` / `_defaults`) registered in Hermes. Interactive:
  the Studio (`vite --port 3001` → `studio.html`), which edits the same storyboard and renders the same
  composition.
- **Invoked agent-first.** The real usage scene is a chat with an agent: hand over a URL, poll for
  status, get a path. Long work is expected (a Seedance clip can queue ~20 minutes; a rendered video
  took minutes), so runs report progress and survive an agent restart.
- **Outputs are artifacts on disk.** Every run owns `runs/<runId>/`: `run.json` (status, warnings,
  corrections, log), the storyboard artifacts, `scene_audio.json`, `storyboard_props.json`, `final.mp4`,
  `poster/poster.jpg`, and its localized assets.
- **Configuration is data, not code.** Model choices, API keys, and task→model routing live in
  Supabase; run defaults live in `.env` (`STORYTELLER_*`). Retuning should not require a redeploy.
- **Providers:** kie.ai for image (nano-banana-pro, flux-2) and video (Seedance), ElevenLabs for
  narration, Remotion for rendering, an optional local EasyOCR/DINO backend on :8001 for highlights.

## Capabilities and Constraints

Confirmed capabilities: URL/PDF ingestion; LLM storyboard with per-scene narration and visual
strategy; image generation routed by style; animated scenes via Seedance; per-scene narration with
real word timestamps plus burned-in word-synced captions; optional region highlights; poster chosen
from scene midpoints and baked as frame 0; per-stage checkpointing, a clean stop after any stage for
cheap verification, and resume of an interrupted run without re-paying for generated assets.

Constraints that are factual properties of this system, verified by measurement:

- **No silent fallbacks.** A missing model, image, or narration track fails the run and records the
  real error. A degraded asset is never substituted for a missing one.
- **Render-time assets must be absolute URLs.** A public-relative path is resolved by the renderer
  against its own bundle server and 404s; images are localized to a run-scoped directory and served
  over HTTP before rendering.
- **Video generation must be handed a publicly fetchable image URL** — a local path or base64 is
  rejected by the provider.
- **Renders are CPU-bound** and runs are serialised; scene animation costs are significant per scene,
  so animated scenes are capped and the cap is reported.
- **Scene length is planner-driven.** A 3,520-word article produced a 6:14 video, with one scene
  holding a single still for 87 seconds. Whether to cap narration or scene length is **undecided**.
- **Publishing is not wired.** YouTube upload exists as a separate, unproven path and is off by
  default.
- **Native is not built.** Platform is web; a native surface is a stated future intention, with no
  native design language, targets, or affordances decided.
- **Background music is off** (no track configured); only narration and captions are audible today.

Terminology in use: run, runId, scene, storyboard, animation strategy, infographic, poster, promo
(the rejected marketing-video branch).

## Brand Commitments

The product name is **OmniCast** (the Studio surface titles itself "OmniCast — Video Studio"). No
logo, voice-and-tone guide, or other identity commitment has been established.

## Evidence on Hand

- `PRD-url-to-explainer-video .md` — the product's original PRD (v0.2), including the storyboard-JSON
  mechanism.
- `IMPLEMENTATION_BLUEPRINT*.md`, `PRODUCTION_UI_BLUEPRINT*.md`, `STORYSTUDIO_FIX.md`,
  `ANTIGRAVITY_INSTRUCTIONS_VISUAL_STYLE_EDIT.md` — build and UI blueprints for the Studio.
- `src/components/studio/{StoryStudio,CanvasEditor,Timeline,VoiceSelectionModal}.tsx` — the incumbent
  interactive surface; `src/compositions/storyteller/*` — the renderer.
- `runs/2026-10-14-173258/` — a real run: 7 scenes, 373.95 s render, verified 1920×1080 h264 with
  audible narration, plus its poster and per-stage artifacts.
- `runs/model-probe-2026-10-13/` — inspected outputs proving the image-model routing rule
  (nano-banana-pro → labelled infographic; flux-2 → photograph).
- `public/asset_catalog.json` — generated image catalog with concept keys.

Absent, and not to be fabricated: any customer, testimonial, benchmark, pricing, license, or
deployment claim for this product. There is no user research beyond the owner's own use.

## Product Principles

1. **The unattended path is the product.** Anything that only works with a human clicking through the
   Studio is incomplete. The Studio is an override for when the owner wants to intervene, never a
   prerequisite for a result.
2. **An honest failure beats a plausible video.** Surface the real error in the run record; never
   substitute a stand-in asset, a made-up duration, or a quieter success.
3. **Every knob is data.** Model routing, provider choice, tone, style, and lengths are configured,
   not hard-coded, so the system can be retuned without touching code.
4. **Long runs are resumable.** Minutes-long generation and rendering must survive interruption
   without paying again for assets that were already produced.
5. **Prove it on the artifact.** A run is done when a video is verified as playable with audible
   narration and a real visual in every scene — checked on the output, not inferred from logs.
