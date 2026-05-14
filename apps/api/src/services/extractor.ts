import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import puppeteer from 'puppeteer';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

export interface ExtractResult {
  title: string;
  rawText: string;
  markdownContent: string;
  wordCount: number;
}

function parseHtml(html: string, url: string): ExtractResult {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const parsed = reader.parse();

  if (!parsed || !parsed.content) {
    throw new Error('Could not extract article content. The page may be paywalled or JS-heavy.');
  }

  const ACCESS_DENIED_TITLES = /^(access denied|forbidden|403 forbidden|401 unauthorized|unauthorized|not authorized|permission denied)$/i;
  if (ACCESS_DENIED_TITLES.test(parsed.title?.trim() ?? '')) {
    throw new Error('Could not extract article content. The page may be paywalled or JS-heavy.');
  }

  const markdownContent = turndown.turndown(parsed.content);
  const rawText = markdownContent.replace(/[#*`\[\]()_~>]/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = rawText.split(/\s+/).filter(Boolean).length;

  return {
    title: parsed.title || new URL(url).hostname,
    rawText,
    markdownContent,
    wordCount,
  };
}

async function extractArticleStatic(url: string): Promise<ExtractResult> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; web2x/1.0; +https://web2x.app)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  return parseHtml(await res.text(), url);
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function extractArticleWithBrowser(url: string): Promise<ExtractResult> {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    const html = await page.content();
    try {
      return parseHtml(html, url);
    } catch {
      throw new Error('Could not extract article content even after browser rendering.');
    }
  } finally {
    await browser.close();
  }
}

function shouldFallbackToBrowser(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.startsWith('Could not extract article content') ||
    /Fetch failed: 40[13]/.test(err.message)
  );
}

export async function extractArticle(url: string): Promise<ExtractResult> {
  try {
    return await extractArticleStatic(url);
  } catch (err) {
    if (shouldFallbackToBrowser(err)) {
      return await extractArticleWithBrowser(url);
    }
    throw err;
  }
}
