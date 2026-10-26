/**
 * Ingest a document from the operator's own machine.
 *
 * The pipeline only ever accepted an http(s) URL or a `.pdf`, so "make a video from this file" meant
 * "put the file on the public web first". This module closes that gap for the formats a person
 * actually has lying around: PDF, plain text / markdown, HTML, and Word `.docx`.
 *
 * Three rules, because this reads arbitrary files from a laptop:
 *
 * 1. **Refuse, never substitute.** An unreadable, empty, oversized or unsupported file throws with
 *    the reason. The URL path in `ingest.ts` ends in a fabricated placeholder article (~42 words,
 *    picsum images) which is exactly the failure this must not reproduce: a video that looks real
 *    and is about nothing.
 * 2. **Stay inside the allowlist.** Paths resolve to absolute and must live under the home directory
 *    (or an explicitly configured root). An agent that can pass any path can otherwise read
 *    `/etc/passwd` and narrate it.
 * 3. **No new dependency.** `.docx` is a zip with one XML part; `unzip -p` is on every macOS and
 *    most Linux boxes, which is cheaper than carrying a Word parser into a render pipeline.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ArticleData } from '../types/storyboard';
import { ingestPdf } from './ingest';

/** 25 MB. Beyond this it is not an article, and the LLM prompt is billed per token anyway. */
const MAX_BYTES = 25 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set(['.txt', '.text', '.md', '.markdown', '.mdx', '.rst', '.csv', '.log']);
const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml']);
const DOCX_EXTENSIONS = new Set(['.docx']);

export interface LocalIngestResult extends ArticleData {
  /** Absolute path actually read, recorded so run.json can be traced back to the source. */
  sourcePath: string;
  sourceKind: 'pdf' | 'text' | 'html' | 'docx';
}

function allowedRoots(): string[] {
  const configured = (process.env.STORYTELLER_LOCAL_ROOTS ?? '')
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
  return [os.homedir(), ...configured];
}

/** Resolve a user-typed path (`~/Downloads/x.md`, `./notes.txt`) and prove it is readable + allowed. */
export function resolveLocalPath(input: string): string {
  const expanded = input.startsWith('~') ? path.join(os.homedir(), input.slice(1)) : input;
  const absolute = path.resolve(process.cwd(), expanded);

  if (!fs.existsSync(absolute)) {
    throw new Error(`File not found: ${absolute}`);
  }
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${absolute} (directories are not supported — point at one document)`);
  }
  if (stat.size === 0) {
    throw new Error(`File is empty: ${absolute}`);
  }
  if (stat.size > MAX_BYTES) {
    throw new Error(
      `File is ${(stat.size / 1048576).toFixed(1)} MB, over the ${MAX_BYTES / 1048576} MB limit: ${absolute}`
    );
  }

  const real = fs.realpathSync(absolute);
  const roots = allowedRoots();
  const allowed = roots.some((root) => {
    const resolvedRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
    return real === resolvedRoot || real.startsWith(resolvedRoot + path.sep);
  });
  if (!allowed) {
    throw new Error(
      `Refusing to read ${real}: outside the allowed roots (${roots.join(', ')}). ` +
        `Add a directory with STORYTELLER_LOCAL_ROOTS (path delimiter separated) to allow it.`
    );
  }

  return real;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    rsquo: '’',
    lsquo: '‘',
    ldquo: '“',
    rdquo: '”'
  };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

/** Block-level tags become paragraph breaks so the planner sees sentences, not one long run-on. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(nav|footer|header|aside|form|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

/** Strip the markdown that would otherwise be read aloud ("hash hash why RAG..."). */
function markdownToText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^ {0,3}[>#]+\s?/gm, '')
    .replace(/^ {0,3}([-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_)([^*_]+)\1/g, '$2')
    .replace(/^ {0,3}([-*_]\s*){3,}$/gm, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

function docxToXml(filePath: string): string {
  try {
    return execFileSync('unzip', ['-p', filePath, 'word/document.xml'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new Error(
      `Could not read the .docx body (${reason}). A .docx is a zip whose word/document.xml holds the ` +
        `text; if the file is password-protected or actually a .doc, export it as .docx or .pdf first.`
    );
  }
}

function docxXmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<\/w:p>/g, '\n\n')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

/** First heading, else first meaningful line, else the filename — never an invented title. */
function deriveTitle(text: string, markdownHeading: string | undefined, fallbackFromFile: string): string {
  if (markdownHeading && markdownHeading.trim().length >= 3) return markdownHeading.trim().slice(0, 120);

  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length >= 12 && !line.endsWith(':'));
  if (firstLine) return firstLine.slice(0, 120);

  return fallbackFromFile
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 120);
}

function excerptFrom(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const firstSentence = flat.match(/^.{40,240}?[.!?](\s|$)/)?.[0] ?? flat.slice(0, 220);
  return firstSentence.trim();
}

/**
 * Read a local document into the same `ArticleData` shape the URL path produces.
 *
 * Throws on anything it cannot genuinely read. A short document is rejected rather than padded:
 * the planner budgets scenes by word count, so 40 words of real text is not a video either.
 */
export async function ingestLocalFile(inputPath: string): Promise<LocalIngestResult> {
  const filePath = resolveLocalPath(inputPath);
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    const article = await ingestPdf(filePath);
    return { ...article, sourcePath: filePath, sourceKind: 'pdf' };
  }

  let text = '';
  let sourceKind: LocalIngestResult['sourceKind'] = 'text';
  let markdownHeading: string | undefined;

  if (TEXT_EXTENSIONS.has(ext)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const isMarkdown = ['.md', '.markdown', '.mdx'].includes(ext);
    markdownHeading = isMarkdown ? raw.match(/^ {0,3}#\s+(.+)$/m)?.[1] : undefined;
    text = isMarkdown ? markdownToText(raw) : raw;
    sourceKind = 'text';
  } else if (HTML_EXTENSIONS.has(ext)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    markdownHeading = decodeEntities(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '');
    text = htmlToText(raw);
    sourceKind = 'html';
  } else if (DOCX_EXTENSIONS.has(ext)) {
    text = docxXmlToText(docxToXml(filePath));
    sourceKind = 'docx';
  } else {
    const supported = [...TEXT_EXTENSIONS, ...HTML_EXTENSIONS, ...DOCX_EXTENSIONS, '.pdf'].join(', ');
    throw new Error(
      `Unsupported file type "${ext || '(none)'}": ${filePath}. Supported: ${supported}. ` +
        `Export the document to .pdf or .docx, or save it as .txt/.md.`
    );
  }

  const textContent = text.replace(/\r\n/g, '\n').trim();
  const wordCount = textContent.split(/\s+/).filter(Boolean).length;

  if (wordCount < 120) {
    throw new Error(
      `Only ${wordCount} words in ${path.basename(filePath)} — too short to plan a narrated video ` +
        `(a 3-4 minute piece needs roughly 500+). Add the source material instead of a summary of it.`
    );
  }

  return {
    title: deriveTitle(textContent, markdownHeading, path.basename(filePath)),
    excerpt: excerptFrom(textContent),
    textContent,
    wordCount,
    // Local documents carry no extractable image assets yet: a .docx/.md that references images would
    // need a second pass to resolve them, and pretending we found some is the failure mode this
    // module exists to avoid. Scenes are illustrated from scratch instead.
    assets: [],
    sourcePath: filePath,
    sourceKind
  };
}

/** True when the target should be read from disk rather than fetched. */
export function isLocalTarget(target: string): boolean {
  return !/^https?:\/\//i.test(target);
}

/** `file:///Users/x/a.md` → `/Users/x/a.md`; anything else passes through. */
export function stripFileScheme(target: string): string {
  if (!/^file:\/\//i.test(target)) return target;
  try {
    return decodeURIComponent(new URL(target).pathname);
  } catch {
    return target.replace(/^file:\/\//i, '');
  }
}
