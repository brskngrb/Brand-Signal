// Public-page research is separate from measured SEO/AIO/GEO performance.
// This module performs no requests, executes no page HTML, and creates no KPIs.
const MAX_PAGES = 100;
const MAX_FAILURES = 20;
const MAX_REFERENCES = 30;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 2000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max).trim() : '';
const integer = (value, max = 1000000) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
const optionalBoolean = (value) => typeof value === 'boolean' ? value : null;
const sameImageSite = (a,b) => a===b || ((a==='idodo.com.tw'||a.endsWith('.idodo.com.tw'))&&(b==='idodo.com.tw'||b.endsWith('.idodo.com.tw')));

function timestamp(value) {
  if (typeof value !== 'string' || value.length > 50 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(time) || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  return new Date(time).toISOString();
}

function publicUrl(value, domain = false) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001F\u007F]/.test(value)) return null;
  let input = text(value, 2048);
  if (!input) return null;
  if (domain && /^[a-z0-9.-]+$/i.test(input) && input.includes('.')) input = `https://${input}`;
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host) return null;
    if (host.startsWith('[')) return null; // IPv6 literals are not public-page evidence URLs here.
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
    }
    return domain ? `${url.origin}/` : url.href;
  } catch { return null; }
}

function strings(value, limit = 30, max = 300) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return values.slice(0, limit).map((item) => text(item, max)).filter(Boolean);
}

function issue(value) {
  if (typeof value === 'string') return text(value, 2000) || null;
  if (!object(value)) return null;
  const result = {};
  for (const key of ['id', 'code', 'label', 'title', 'detail', 'message', 'recommendation', 'severity', 'status', 'evidence']) {
    const item = text(value[key], key === 'id' || key === 'code' || key === 'severity' || key === 'status' ? 100 : 2000);
    if (item) result[key] = item;
  }
  if (typeof value.passed === 'boolean' || value.passed === null) result.passed = value.passed;
  return Object.keys(result).length ? result : null;
}

function page(value) {
  if (!object(value)) return null;
  const url = publicUrl(value.url || value.finalUrl || value.requestedUrl);
  if (!url) return null;
  const links = (Array.isArray(value.links) ? value.links : []).slice(0, 80).map((item) => publicUrl(typeof item === 'string' ? item : object(item) ? item.url : null)).filter(Boolean);
  const images = (Array.isArray(value.images) ? value.images : []).slice(0, 64).flatMap(item => {
    if (!object(item)) return [];
    const imageUrl = publicUrl(item.url);
    if (!imageUrl || !sameImageSite(new URL(imageUrl).hostname,new URL(url).hostname)) return [];
    return [{url:imageUrl,alt:text(item.alt,300),title:text(item.title,200),...(object(item.context)&&item.context.version===1?{context:{version:1,method:text(item.context.method,40),before:text(item.context.before,600),after:text(item.context.after,600),heading:text(item.context.heading,200)}}:{})}];
  });
  return {
    url,
    requestedUrl: publicUrl(value.requestedUrl) ?? url,
    title: text(value.title, 500),
    description: text(value.description, 2000),
    h1: strings(value.h1, 20, 500),
    h2: strings(value.h2, 40, 500),
    wordCount: integer(value.wordCount),
    wordCountMethod: text(value.wordCountMethod, 300),
    analyzedCharacters: integer(value.analyzedCharacters),
    textTruncated: optionalBoolean(value.textTruncated),
    faqPresent: optionalBoolean(value.faqPresent),
    structuredData: strings(value.structuredData, 30, 200),
    keywordMatches: strings(value.keywordMatches, 40, 300),
    links: [...new Set(links)],
    images,
    ...(object(value.catalog)?{catalog:{role:text(value.catalog.role,20),productId:text(value.catalog.productId,12),categoryId:text(value.catalog.categoryId,12),status:text(value.catalog.status,20),productsDiscovered:integer(value.catalog.productsDiscovered)}}:{}),
    imageDiscoveryTotal:Math.max(images.length,Number.isSafeInteger(value.imageDiscoveryTotal)?Math.min(200,value.imageDiscoveryTotal):0),
    imageText: text(value.imageText, 48000),
    imageTextSources: (Array.isArray(value.imageTextSources) ? value.imageTextSources : []).slice(0, 64).flatMap(item => {
      if (!object(item)) return [];
      const imageUrl = publicUrl(item.url);
      return imageUrl && sameImageSite(new URL(imageUrl).hostname,new URL(url).hostname) ? [{url:imageUrl,alt:text(item.alt,300),text:text(item.text,48000),status:item.status==='read'?'read':item.status==='failed'?'failed':'legacy',version:Number(item.version)||0,recognizedAt:timestamp(item.recognizedAt),error:text(item.error,200),model:text(item.model,120),provider:text(item.provider,30),precision:text(item.precision,30),passes:Number.isInteger(item.passes)?item.passes:null,regions:Number.isInteger(item.regions)?item.regions:null,enhanced:typeof item.enhanced==='boolean'?item.enhanced:null}] : [];
    }),
    imageTextFetchedAt: timestamp(value.imageTextFetchedAt),
    excerpt: text(value.excerpt, 6000),
    issues: (Array.isArray(value.issues) ? value.issues : []).slice(0, 40).map(issue).filter(Boolean),
  };
}

function failure(value) {
  if (typeof value === 'string') return { url: null, code: '', message: text(value, 2000) };
  if (!object(value)) return null;
  return { url: publicUrl(value.url || value.requestedUrl), code: text(value.code, 100), message: text(value.message || value.error, 2000) };
}

function provenance(value, expected, label) {
  if (value.source !== undefined && value.source !== expected) throw new Error(`${label}來源格式不符。`);
}

function normalizeCrawl(value) {
  if (!object(value)) return null;
  provenance(value, 'website_crawl', '網頁抓取');
  const domain = publicUrl(value.domain, true);
  if (!domain) throw new Error('網頁抓取需要有效的公開 http/https 網域。');
  const pages = [], seen = new Set();
  for (const item of (Array.isArray(value.pages) ? value.pages : []).slice(0, MAX_PAGES * 2)) {
    if (pages.length === MAX_PAGES) break;
    const normalized = page(item);
    if (!normalized || seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    pages.push(normalized);
  }
  const failures = (Array.isArray(value.failures) ? value.failures : []).slice(0, MAX_FAILURES).map(failure).filter(Boolean);
  const coverage = object(value.coverage) ? value.coverage : {};
  return {
    source: 'website_crawl',
    generatedAt: timestamp(value.generatedAt),
    domain,
    pages,
    failures,
    coverage: { attempted: integer(coverage.attempted), fetched: integer(coverage.fetched), limit: integer(coverage.limit, MAX_PAGES) },
    notice: text(value.notice, 4000),
  };
}

function normalizeWeb(value) {
  if (!object(value)) return null;
  provenance(value, 'openai_web_research', '網路研究');
  const result = object(value.result) ? value.result : {};
  // Citation offsets address this exact UTF-16 string. Do not trim or rewrite it.
  const report = typeof result.report === 'string' ? result.report.slice(0, 40000) : '';
  const seen = new Set();
  const sources = (Array.isArray(result.sources) ? result.sources : []).slice(0, MAX_REFERENCES).flatMap((item) => {
    if (!object(item)) return [];
    const url = publicUrl(item.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, title: text(item.title, 500) }];
  });
  const citations = (Array.isArray(result.citations) ? result.citations : []).slice(0, 50).flatMap((item) => {
    if (!object(item)) return [];
    const startIndex = integer(item.startIndex, report.length);
    const endIndex = integer(item.endIndex, report.length);
    const url = publicUrl(item.url);
    if (startIndex === null || endIndex === null || startIndex >= endIndex || !url) return [];
    return [{ startIndex, endIndex, url, title: text(item.title, 500) }];
  });
  return {
    mode: 'research',
    source: 'openai_web_research',
    generatedAt: timestamp(value.generatedAt),
    model: text(value.model, 100),
    reasoningEffort: text(value.reasoningEffort, 30),
    result: { report, sources, citations, webSearches: integer(result.webSearches, 10000) },
  };
}

/** Whitelist persisted research fields; missing values remain unknown.
 * Returned strings are plain text and must still be escaped when inserted into HTML.
 * Crawl evidence and web-research prose never establish traffic, indexation or AI visibility.
 */
export function normalizeResearchReport(value) {
  if (value === null || value === undefined) return null;
  if (!object(value)) throw new Error('網路研究報告必須是物件。');
  const crawl = normalizeCrawl(value.crawl);
  const web = normalizeWeb(value.web);
  const result = { generatedAt: timestamp(value.generatedAt) ?? crawl?.generatedAt ?? web?.generatedAt ?? null, domain: publicUrl(value.domain, true) ?? crawl?.domain ?? '', crawl, web };
  const crawlError = text(value.crawlError, 2000);
  const webError = text(value.webError, 2000);
  if (crawlError) result.crawlError = crawlError;
  if (webError) result.webError = webError;
  return result;
}
