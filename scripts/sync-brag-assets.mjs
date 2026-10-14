#!/usr/bin/env node
/**
 * Syncs the brag skill's bundled audio into this project.
 *
 * Why a copy is necessary: Remotion can only serve files that live under the project's `public/`
 * directory (its bundle roots there). The brag skill lives in the Hermes skills directory, outside
 * the Remotion root, so its music/cues/SFX are unreachable until copied in.
 *
 * Also load-bearing for SFX: src/lib/sfxEngine.ts ships SFX_MAP with every value commented out
 * (empty strings), so the explainer's sound-effect layer currently plays nothing. The bundled
 * Kenney set gives it real files to point at.
 *
 * Idempotent. Writes public/brag/brag-assets.json so the runtime can map intent → file without
 * re-walking the tree.
 *
 * Run: node scripts/sync-brag-assets.mjs [--skill-dir <path>] [--out <public dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const expandHome = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

const SKILL_DIR = expandHome(argOf('--skill-dir') || process.env.OMNICAST_BRAG_SKILL_DIR || '~/.hermes/skills/brag');
const OUT_ROOT = path.resolve(argOf('--out') || path.join(process.cwd(), 'public', 'brag'));

const AUDIO_EXT = new Set(['.mp3', '.ogg', '.wav', '.m4a']);

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

/** 'happy-beats-business-moves-vol-11-by-ende-dot-app.mp3' -> id used by the plan/cue lookup. */
const trackIdOf = (filename) => path.basename(filename, path.extname(filename));

/** Buckets a bundled SFX path into its Kenney category ('ui', 'interface', 'impact', 'keyboard', 'casino'). */
const categoryOf = (relPath) => {
  const parts = relPath.split(path.sep);
  return parts.length > 1 ? parts[0] : 'misc';
};

function copyAll(sourceDir, destDir, filter) {
  const copied = [];
  for (const rel of walk(sourceDir)) {
    if (filter && !filter(rel)) continue;
    const dest = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(sourceDir, rel), dest);
    copied.push(rel);
  }
  return copied;
}

function main() {
  if (!fs.existsSync(SKILL_DIR)) {
    console.error(`[sync-brag-assets] Skill directory not found: ${SKILL_DIR}`);
    console.error('  Set OMNICAST_BRAG_SKILL_DIR in .env, or pass --skill-dir <path>.');
    process.exit(1);
  }

  const assetsDir = path.join(SKILL_DIR, 'assets');
  if (!fs.existsSync(assetsDir)) {
    console.error(`[sync-brag-assets] No assets/ directory inside ${SKILL_DIR}.`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_ROOT, { recursive: true });

  // ── music ──
  const musicSrc = path.join(assetsDir, 'music');
  const music = copyAll(musicSrc, path.join(OUT_ROOT, 'music'), (rel) => AUDIO_EXT.has(path.extname(rel).toLowerCase()));

  // ── cue presets (beat grids) ──
  const cuesSrc = path.join(assetsDir, 'music', 'cues');
  const cues = copyAll(cuesSrc, path.join(OUT_ROOT, 'cues'), (rel) => rel.endsWith('.json'));

  // ── sfx ──
  const sfxSrc = path.join(assetsDir, 'sfx');
  const sfx = copyAll(sfxSrc, path.join(OUT_ROOT, 'sfx'), (rel) => AUDIO_EXT.has(path.extname(rel).toLowerCase()));

  // ── sfx analysis (descriptions/durations written by the upstream skill) ──
  let sfxAnalysis = null;
  const analysisPath = path.join(sfxSrc, 'sfx-analysis.json');
  if (fs.existsSync(analysisPath)) {
    try {
      sfxAnalysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));
    } catch (err) {
      console.warn(`[sync-brag-assets] Could not parse sfx-analysis.json: ${err.message}`);
    }
  }

  const tracks = music
    .filter((rel) => AUDIO_EXT.has(path.extname(rel).toLowerCase()))
    .map((rel) => {
      const id = trackIdOf(rel);
      const cueName = `${id}.music-cues.json`;
      return {
        id,
        file: rel.split(path.sep).join('/'),
        cueFile: cues.includes(cueName) ? cueName : null,
      };
    });

  const sfxByCategory = {};
  for (const rel of sfx) {
    const cat = categoryOf(rel);
    (sfxByCategory[cat] ??= []).push(rel.split(path.sep).join('/'));
  }

  // ── intent map ────────────────────────────────────────────────────────────
  // The upstream analysis names 15 usage intents ('card reveal', 'logo payoff', …) with ranked
  // file recommendations. Fold it into a compact, validated map so the runtime can turn a scene's
  // sfxMoment intent into a real file without carrying the 400KB analysis around.
  const missingRecommended = [];
  const intents = {};
  const presentSfx = new Set(sfx.map((rel) => rel.split(path.sep).join('/')));
  if (sfxAnalysis?.recommendationsByUse && typeof sfxAnalysis.recommendationsByUse === 'object') {
    for (const [use, recs] of Object.entries(sfxAnalysis.recommendationsByUse)) {
      if (!Array.isArray(recs)) continue;
      const choices = [];
      for (const rec of recs.slice(0, 3)) {
        const rel = String(rec?.path ?? '').split(path.sep).join('/');
        if (!rel) continue;
        if (!presentSfx.has(rel)) {
          missingRecommended.push(`${use} → ${rel}`);
          continue;
        }
        choices.push({
          file: `sfx/${rel}`,
          duration: Number(rec.duration) || 0.3,
          rms: Number(rec.loudness?.rms) || 0.1,
        });
      }
      if (choices.length) intents[use] = choices;
    }
  }
  if (missingRecommended.length) {
    console.warn(
      `[sync-brag-assets] WARNING: ${missingRecommended.length} recommended sfx file(s) in sfx-analysis.json are not present in the skill bundle and were skipped:\n  - ${missingRecommended.slice(0, 8).join('\n  - ')}${missingRecommended.length > 8 ? '\n  …' : ''}`,
    );
  }
  if (Object.keys(intents).length === 0) {
    console.warn('[sync-brag-assets] WARNING: no sfx intents resolved — promo videos will have no sound effects.');
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    skillDir: SKILL_DIR,
    counts: { music: tracks.length, cues: cues.length, sfx: sfx.length, sfxCategories: Object.keys(sfxByCategory).length },
    tracks,
    sfxByCategory,
    sfxIntents: intents,
    hasSfxAnalysis: Boolean(sfxAnalysis),
  };

  fs.writeFileSync(path.join(OUT_ROOT, 'brag-assets.json'), JSON.stringify(manifest, null, 2));

  console.log(`[sync-brag-assets] skill: ${SKILL_DIR}`);
  console.log(`[sync-brag-assets] out:   ${OUT_ROOT}`);
  console.log(`[sync-brag-assets] ${tracks.length} music tracks, ${cues.length} cue presets, ${sfx.length} sfx files`);
  for (const [cat, files] of Object.entries(sfxByCategory)) {
    console.log(`[sync-brag-assets]   · ${cat}: ${files.length}`);
  }
  if (tracks.length === 0) console.warn('[sync-brag-assets] WARNING: no music found — promo videos will render silent.');
  if (sfx.length === 0) console.warn('[sync-brag-assets] WARNING: no sfx found.');
}

main();
