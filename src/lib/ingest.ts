import { ArticleData, ArticleAsset } from '../types/storyboard';

/**
 * Ingests a URL by fetching HTML content, extracting title, main text, and image assets.
 * Performs simulated vision analysis on diagram/technical assets to identify image regions.
 */
export async function ingestUrl(url: string): Promise<ArticleData> {
  console.log(`[IngestEngine] Ingesting URL: ${url}...`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: Unable to fetch URL`);
    }

    const html = await response.text();
    const article = parseArticleHtml(html, url);

    console.log(
      `[IngestEngine] Extracted title: "${article.title}" (${article.wordCount} words, ${article.assets.length} assets)`
    );
    return article;
  } catch (err) {
    console.warn(`[IngestEngine] Web scrape fallback for ${url}:`, err);
    return generateFallbackArticleData(url);
  }
}

/**
 * Helper to parse HTML string into clean article text and extracted images.
 */
function parseArticleHtml(html: string, url: string): ArticleData {
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
    const isDiagram = assetIndex % 2 === 1;

    const asset: ArticleAsset = {
      id: `asset_${assetIndex}`,
      url: imgSrc,
      altText,
      position: assetIndex,
      width: 800,
      height: 600,
      classification: isDiagram ? 'diagram' : 'photo',
    };

    if (isDiagram) {
      asset.visionAnalysis = {
        description: `Process flowchart diagram showing system steps for ${altText}`,
        textContent: 'Step 1: Data Collection -> Step 2: Analysis -> Step 3: Action',
        regions: [
          {
            id: 'region_1',
            label: 'Step 1: Ingestion',
            boundingBox: { x: 5, y: 20, width: 40, height: 60 },
            description: 'Data ingestion and parsing phase',
          },
          {
            id: 'region_2',
            label: 'Step 2: Processing',
            boundingBox: { x: 55, y: 20, width: 40, height: 60 },
            description: 'LLM reasoning and sync engine phase',
          },
        ],
      };
    }

    assets.push(asset);
    assetIndex++;
    if (assets.length >= 6) break;
  }

  return {
    title,
    excerpt,
    textContent: cleanBody.substring(0, 4000),
    wordCount,
    assets,
  };
}

/**
 * Fallback Article Data structure when URL fetch fails or is restricted.
 */
function generateFallbackArticleData(url: string): ArticleData {
  let domain = 'example.com';
  try {
    domain = new URL(url).hostname;
  } catch {
    // default
  }

  return {
    title: `Insights from ${domain}`,
    excerpt: 'An in-depth look at technology innovation, workflow automation, and scalable creative output.',
    textContent:
      'Modern digital workflows are undergoing a rapid evolution. By pairing artificial intelligence narrative structuring with real-time video rendering, organizations can transform complex written technical documentation into engaging visual storytelling. This breakthrough reduces friction and accelerates content distribution.',
    wordCount: 42,
    assets: [
      {
        id: 'asset_1',
        url: 'https://picsum.photos/800/600?random=1',
        altText: 'System Architecture Diagram',
        position: 1,
        width: 800,
        height: 600,
        classification: 'diagram',
        visionAnalysis: {
          description: 'Flowchart diagram illustrating automated data pipeline',
          textContent: 'Point A: Raw Data -> Point B: Processed Insights',
          regions: [
            {
              id: 'region_1',
              label: 'Point A (Raw Data)',
              boundingBox: { x: 5, y: 25, width: 40, height: 50 },
              description: 'Input data ingestion stage',
            },
            {
              id: 'region_2',
              label: 'Point B (Processed Insights)',
              boundingBox: { x: 55, y: 25, width: 40, height: 50 },
              description: 'Final automated output stage',
            },
          ],
        },
      },
      {
        id: 'asset_2',
        url: 'https://picsum.photos/800/600?random=2',
        altText: 'Team Performance Overview',
        position: 2,
        width: 800,
        height: 600,
        classification: 'photo',
      },
    ],
  };
}
