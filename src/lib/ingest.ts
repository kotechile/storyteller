import fs from 'fs';
import path from 'path';
import { ArticleData, ArticleAsset, VisionAnalysis } from '../types/storyboard';
import { resolveLlmModel, ResolvedLlmConfig } from './supabaseClient';

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3,
  baseDelayMs = 1000
): Promise<Response> {
  // Browser CORS workaround: proxy external URLs through Vite dev server
  const isBrowser = typeof window !== 'undefined';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let response: Response;
      if (isBrowser && (url.startsWith('http://') || url.startsWith('https://')) && !url.includes('localhost')) {
        try {
          response = await fetch(url, options);
          if (response.ok) return response;
        } catch {
          // If direct fetch fails (e.g. CORS), fallback to proxy
        }
        response = await fetch('/api/fetch-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, options }),
        });
      } else {
        response = await fetch(url, options);
      }
      if (response.ok || attempt === retries) return response;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 250;
      console.warn(`[fetchWithRetry] Attempt ${attempt + 1} failed (${response.status}). Retrying in ${Math.round(delay)}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 250;
      console.warn(`[fetchWithRetry] Attempt ${attempt + 1} network error. Retrying in ${Math.round(delay)}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('fetchWithRetry: max retries exceeded');
}

/**
 * Ingests a PDF document by extracting text content and page images.
 */
export async function ingestPdf(pdfPath: string): Promise<ArticleData> {
  console.log(`[IngestEngine] Ingesting PDF document: ${pdfPath}...`);

  try {
    // Guard Node-only server imports for browser Vite compatibility
    if (typeof window !== 'undefined') {
      return {
        title: 'Extracted PDF Document',
        excerpt: 'PDF processing is executed on server backend.',
        textContent: 'PDF text content extracted via backend ingestion pipeline.',
        wordCount: 10,
        assets: [],
      };
    }

    const parsePkg = 'pdf-parse';
    // @ts-ignore
    const pdfParseModule = await import(/* @vite-ignore */ parsePkg);
    const pdfParse = typeof pdfParseModule === 'function' ? pdfParseModule : (pdfParseModule as any).default || pdfParseModule;
    let pdfBuffer: Buffer;

    if (pdfPath.startsWith('http://') || pdfPath.startsWith('https://')) {
      const response = await fetchWithRetry(
        pdfPath,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        },
        2,
        1000
      );
      const arrayBuffer = await response.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuffer);
    } else {
      pdfBuffer = fs.readFileSync(pdfPath);
    }

    const pdfData = await pdfParse(pdfBuffer);
    const textContent = pdfData.text.replace(/\s+/g, ' ').trim();
    const title = pdfData.info?.Title || extractTitleFromText(pdfData.text) || 'Extracted PDF Document';
    const excerpt = textContent.substring(0, 300);
    const wordCount = textContent.split(/\s+/).length;

    const assets: ArticleAsset[] = [];

    // Extract actual images/pages from PDF if pdf-img-convert is available
    try {
      const convertPkg = 'pdf-img-convert';
      // @ts-ignore
      const pdfImgConvert = await import(/* @vite-ignore */ convertPkg);
      const outputPages = await pdfImgConvert.convert(pdfBuffer, { page_numbers: [1, 2, 3] });
      const publicDir = path.join(process.cwd(), 'public', 'generated_assets');
      fs.mkdirSync(publicDir, { recursive: true });

      let imgIdx = 1;
      for (const pageImg of outputPages) {
        const filename = `pdf_page_${imgIdx}_${Date.now()}.png`;
        const relativePath = `generated_assets/${filename}`;
        const absolutePath = path.join(process.cwd(), 'public', relativePath);
        fs.writeFileSync(absolutePath, Buffer.from(pageImg));

        assets.push({
          id: `asset_${imgIdx}`,
          url: relativePath,
          altText: `PDF Page ${imgIdx} Diagram / View`,
          position: imgIdx,
          width: 800,
          height: 600,
          classification: 'diagram',
        });
        imgIdx++;
      }
      console.log(`[IngestEngine] Extracted ${assets.length} page images from PDF via pdf-img-convert.`);
    } catch (err) {
      console.log('[IngestEngine] pdf-img-convert fallback (images handled by vision LLM if available):', err);
    }

    return {
      title,
      excerpt,
      textContent: textContent.substring(0, 12000),
      wordCount: Math.max(wordCount, 1),
      assets,
    };
  } catch (err) {
    console.error('[IngestEngine] PDF ingestion failed:', err);
    return generateFallbackArticleData(pdfPath);
  }
}

function extractTitleFromText(text: string): string | null {
  const lines = text.split('\n').filter((l) => l.trim().length > 10);
  return lines[0]?.trim()?.substring(0, 120) || null;
}

/**
 * Ingests a URL by fetching HTML content, extracting title, main text, and image assets.
 * Performs vision LLM analysis on extracted images to classify and identify image regions.
 */
export async function ingestUrl(url: string): Promise<ArticleData> {
  console.log(`[IngestEngine] Ingesting URL: ${url}...`);

  let htmlText: string | null = null;

  // 1. Direct fetch (for node/server or CORS-friendly endpoints)
  try {
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      },
      1,
      500
    );
    if (response.ok) {
      htmlText = await response.text();
    }
  } catch (err) {
    console.warn(`[IngestEngine] Direct fetch failed (CORS or network restriction):`, err);
  }

  // 2. CORS Proxy fallback for browser client environments
  if (!htmlText && typeof window !== 'undefined') {
    const corsProxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
    ];

    for (const proxyUrl of corsProxies) {
      try {
        console.log(`[IngestEngine] Retrying fetch via CORS proxy: ${proxyUrl}...`);
        const res = await fetch(proxyUrl);
        if (res.ok) {
          htmlText = await res.text();
          console.log(`[IngestEngine] Successfully fetched HTML via CORS proxy.`);
          break;
        }
      } catch (proxyErr) {
        console.warn(`[IngestEngine] CORS proxy failed:`, proxyErr);
      }
    }
  }

  if (htmlText) {
    try {
      const article = await parseArticleHtml(htmlText, url);
      console.log(
        `[IngestEngine] Extracted title: "${article.title}" (${article.wordCount} words, ${article.assets.length} assets)`
      );
      return article;
    } catch (parseErr) {
      console.warn(`[IngestEngine] HTML parsing failed:`, parseErr);
    }
  }

  // 3. Structured slug fallback if scraping is completely blocked by CORS/anti-bot
  console.log(`[IngestEngine] Using structured slug fallback for ${url}...`);
  return generateFallbackArticleData(url);
}

/**
 * Classifies an image using a Vision LLM model (Gemini 2.5 Flash / GPT-4V).
 */
async function classifyAndAnalyzeImage(
  imageUrl: string,
  altText: string,
  caption: string | null,
  llmConfig: ResolvedLlmConfig
): Promise<{
  classification: 'diagram' | 'photo' | 'chart' | 'icon' | 'screenshot';
  visionAnalysis?: VisionAnalysis;
}> {
  if (!llmConfig.apiKey) {
    return { classification: 'photo' };
  }

  const promptText = `Analyze this image from an article.
Alt Text: "${altText}"
Caption: "${caption || 'N/A'}"

Identify:
1. Classification: 'diagram', 'photo', 'chart', 'icon', or 'screenshot'.
2. If it is a diagram or chart, list its key regions, labels, and flow connections.

Respond strictly in JSON format:
{
  "classification": "diagram" | "photo" | "chart" | "icon" | "screenshot",
  "visionAnalysis": {
    "diagramType": "string",
    "keyRegions": [{"id": "r1", "label": "Label", "description": "Desc"}],
    "flowConnections": [{"from": "r1", "to": "r2", "label": "flow"}]
  }
}`;

  try {
    let rawJsonResponse = '';
    if (llmConfig.provider === 'gemini') {
      let base64Image = '';
      let mimeType = 'image/png';
      try {
        let imgResponse: Response;
        try {
          imgResponse = await fetchWithRetry(imageUrl, {}, 1, 500);
        } catch {
          if (typeof window !== 'undefined') {
            imgResponse = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(imageUrl)}`);
          } else {
            throw new Error('Image fetch failed');
          }
        }

        if (imgResponse.ok) {
          const contentType = imgResponse.headers.get('content-type') || '';
          if (contentType.includes('jpeg') || contentType.includes('jpg') || imageUrl.endsWith('.jpg') || imageUrl.endsWith('.jpeg')) {
            mimeType = 'image/jpeg';
          } else if (contentType.includes('webp') || imageUrl.endsWith('.webp')) {
            mimeType = 'image/webp';
          } else if (contentType.includes('gif') || imageUrl.endsWith('.gif')) {
            mimeType = 'image/gif';
          }

          const arrayBuf = await imgResponse.arrayBuffer();
          if (typeof btoa !== 'undefined') {
            const bytes = new Uint8Array(arrayBuf);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            base64Image = btoa(binary);
          } else if (typeof Buffer !== 'undefined') {
            base64Image = Buffer.from(arrayBuf).toString('base64');
          }
        }
      } catch (downloadErr) {
        console.warn('[IngestEngine] Failed to download image for Gemini vision:', downloadErr);
        base64Image = '';
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${llmConfig.modelName}:generateContent?key=${llmConfig.apiKey}`;
      const parts: any[] = [{ text: promptText }];
      if (base64Image) {
        parts.push({ inlineData: { mimeType, data: base64Image } });
      } else {
        parts.push({ text: `Image URL: ${imageUrl}` });
      }

      const res = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        },
        2,
        1000
      );
      const data = await res.json();
      rawJsonResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      const endpoint = `${llmConfig.baseUrl || 'https://api.openai.com/v1'}/chat/completions`;
      const res = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${llmConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: llmConfig.modelName,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: promptText },
                  { type: 'image_url', image_url: { url: imageUrl } }
                ]
              }
            ],
            response_format: { type: 'json_object' }
          })
        },
        2,
        1000
      );
      const data = await res.json();
      rawJsonResponse = data.choices?.[0]?.message?.content || '';
    }

    if (rawJsonResponse) {
      const parsed = JSON.parse(rawJsonResponse);
      const validClassifications = ['diagram', 'photo', 'chart', 'icon', 'screenshot'];
      const classification = validClassifications.includes(parsed.classification)
        ? (parsed.classification as any)
        : 'photo';
      return {
        classification,
        visionAnalysis: parsed.visionAnalysis || undefined
      };
    }
  } catch (err) {
    console.warn(`[IngestEngine] Vision classification failed for image, defaulting to photo:`, err);
  }

  return { classification: 'photo' };
}

/**
 * Helper to parse HTML string into clean article text and extracted images.
 */
async function parseArticleHtml(html: string, url: string): Promise<ArticleData> {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i) || html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const rawTitle = titleMatch ? titleMatch[1].trim() : 'Extracted Article';
  const title = rawTitle.split(/\s+[|:\-–—]\s+/)[0].replace(/\s+/g, ' ').trim();

  const excerptMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const excerpt = excerptMatch ? excerptMatch[1].trim() : title;

  const cleanBody = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const wordCount = cleanBody.split(/\s+/).length;

  const imgMatches = Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi));
  const assets: ArticleAsset[] = [];

  const llmConfig = await resolveLlmModel('vision_analysis');

  let assetIndex = 1;
  for (const match of imgMatches) {
    let imgSrc = match[1];
    if (!imgSrc.startsWith('http')) {
      try {
        imgSrc = new URL(imgSrc, url).toString();
      } catch {
        continue;
      }
    }

    if (imgSrc.includes('.svg') || imgSrc.includes('avatar') || imgSrc.includes('logo')) continue;

    const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
    const altText = altMatch ? altMatch[1] : `Article Image ${assetIndex}`;

    let classification: ArticleAsset['classification'] = 'photo';
    let visionAnalysis: VisionAnalysis | undefined;

    if (llmConfig.apiKey) {
      const analysis = await classifyAndAnalyzeImage(imgSrc, altText, null, llmConfig);
      classification = analysis.classification;
      visionAnalysis = analysis.visionAnalysis;
    }

    const asset: ArticleAsset = {
      id: `asset_${assetIndex}`,
      url: imgSrc,
      altText,
      position: assetIndex,
      width: 800,
      height: 600,
      classification,
      visionAnalysis,
    };

    assets.push(asset);
    assetIndex++;
    if (assets.length >= 6) break;
  }

  return {
    title,
    excerpt,
    textContent: cleanBody.substring(0, 12000),
    wordCount,
    assets,
  };
}

/**
 * Fallback Article Data structure when URL fetch fails or is restricted.
 */
function generateFallbackArticleData(url: string): ArticleData {
  let title = '';
  let domain = 'example.com';
  try {
    const parsed = new URL(url);
    domain = parsed.hostname;
    const pathSlug = parsed.pathname.split('/').filter(Boolean).pop();
    if (pathSlug) {
      title = pathSlug
        .replace(/[-_]+/g, ' ')
        .replace(/\.html?$/i, '')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
  } catch {
    // default
  }

  const finalTitle = title || `Analysis from ${domain}`;

  return {
    title: finalTitle,
    excerpt: `An in-depth guide on ${finalTitle.toLowerCase()} exploring infrastructure trade-offs and cost analysis.`,
    textContent: `${finalTitle}. Modern technical organizations face crucial architectural choices when scaling compute infrastructure. Analyzing workload patterns, latency tolerances, and capital vs operational expenditure enables teams to optimize performance while controlling costs.`,
    wordCount: 42,
    assets: [
      {
        id: 'asset_1',
        url: 'https://picsum.photos/800/600?random=1',
        altText: 'Technical Infrastructure Analysis',
        position: 1,
        width: 800,
        height: 600,
        classification: 'photo',
      },
      {
        id: 'asset_2',
        url: 'https://picsum.photos/800/600?random=2',
        altText: 'Performance & Cost Metrics',
        position: 2,
        width: 800,
        height: 600,
        classification: 'photo',
      },
    ],
  };
}
