// Bounded, unauthenticated HTML inspection for the hackathon's public brand site.
// Top-level names have a crawl prefix so the build can inline this module safely.
const crawlHosts = new Set(['idodo.com.tw', 'www.idodo.com.tw']);
const crawlUserAgent = 'BrandSignalBot/1.0';
const crawlPageBytes = 512 * 1024;
const crawlRobotsBytes = 64 * 1024;
const crawlRequestMs = 8_000;
const crawlTotalMs = 40_000;

class CrawlError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    if (status) this.status = status;
  }
}

function crawlError(code, message, status) {
  return new CrawlError(code, message, status);
}

function crawlOwnedUrl(value, base) {
  let url;
  try { url = new URL(value, base); }
  catch { throw crawlError('INVALID_URL', '網址格式不正確。', 400); }
  if (url.protocol !== 'https:' || !crawlHosts.has(url.hostname) || url.username || url.password || url.port) {
    throw crawlError('UNSAFE_URL', '品牌網站爬取目前只支援 https://idodo.com.tw 與 https://www.idodo.com.tw 的公開網頁。', 400);
  }
  if (url.search) throw crawlError('QUERY_NOT_ALLOWED', '官網遍歷不使用含查詢參數的網址。', 400);
  if (url.href.length > 2048) throw crawlError('URL_TOO_LONG', '官網遍歷網址不得超過 2048 字元。', 400);
  url.hash = '';
  return url;
}

function crawlInput(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw crawlError('INVALID_INPUT', '請提供品牌 domain 或完整 HTTPS 網頁 url。', 400);
  }
  let domain;
  if (args.domain !== undefined) {
    if (typeof args.domain !== 'string' || !args.domain.trim()) throw crawlError('INVALID_INPUT', 'domain 必須是品牌網址。', 400);
    const raw = args.domain.trim();
    domain = crawlOwnedUrl(raw.includes('://') ? raw : `https://${raw}`);
    domain.pathname = '/';
  }
  let start;
  if (args.url !== undefined) {
    if (typeof args.url !== 'string' || !args.url.trim()) throw crawlError('INVALID_INPUT', 'url 必須是完整 HTTPS 網頁網址。', 400);
    start = crawlPublicPageUrl(args.url.trim());
    // Reporting stays at the fetched page's brand origin, never its subpage path.
    domain = new URL(`${start.origin}/`);
  } else if (domain) start = domain;
  else throw crawlError('INVALID_INPUT', '請提供品牌 domain 或完整 HTTPS 網頁 url。', 400);
  const maxPages = args.maxPages ?? 6;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 6) {
    throw crawlError('INVALID_LIMIT', 'maxPages 必須是 1–6 的整數。', 400);
  }
  const keywords = args.keywords ?? [];
  if (!Array.isArray(keywords) || keywords.length > 30 || keywords.some((item) => typeof item !== 'string' || item.length > 300)) {
    throw crawlError('INVALID_KEYWORDS', 'keywords 必須是最多 30 個、每個不超過 300 字元的文字陣列。', 400);
  }
  return { domain: domain.href, startUrl: start.href, maxPages, keywords: [...new Set(keywords.map((item) => item.trim()).filter(Boolean))] };
}

function crawlPublicPageUrl(value, base) {
  const url = crawlOwnedUrl(value, base);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname).replace(/\\/g, '/'); }
  catch { throw crawlError('INVALID_URL', '網頁路徑編碼不正確。', 400); }
  if (/(?:^|\/)(?:cart|checkout|login|logout|member|account|admin|payment)(?:[./_-]|$)/i.test(pathname)) {
    throw crawlError('PRIVATE_PATH', '僅讀取品牌公開內容頁面，不爬取購物車、登入、會員或管理頁面。', 400);
  }
  return url;
}

function crawlEntities(value) {
  const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (!entity.startsWith('#')) return names[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
  });
}

function crawlPlain(value) {
  return crawlEntities(String(value).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function crawlAttributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = crawlEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function crawlRobotsNormalize(value) {
  return String(value).replace(/[^\x21-\x7e]/gu, (character) => encodeURIComponent(character)).replace(/%([\da-f]{2})/gi, (match, hex) => {
    const character = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9._~-]/.test(character) ? character : `%${hex.toUpperCase()}`;
  });
}

function crawlRobotsRules(text) {
  const groups = [];
  let group = null;
  let hasRules = false;
  let ruleCount = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === 'user-agent') {
      if (!group || hasRules) { group = { agents: [], rules: [] }; groups.push(group); hasRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && (name === 'allow' || name === 'disallow')) {
      hasRules = true;
      if (value.startsWith('/')) {
        if (++ruleCount > 1000 || value.length > 2048) throw crawlError('ROBOTS_COMPLEXITY', 'robots.txt 規則超過可安全分析的範圍，暫停爬取。');
        group.rules.push({ allow: name === 'allow', path: crawlRobotsNormalize(value) });
      }
    }
  }
  const agent = crawlUserAgent.toLowerCase();
  const scored = groups.map((item) => ({ item, score: Math.max(-1, ...item.agents.map((value) => value === '*' ? 0 : value && agent.includes(value) ? value.length : -1)) }));
  const best = Math.max(-1, ...scored.map((item) => item.score));
  return scored.filter((item) => item.score === best && best >= 0).flatMap((item) => item.item.rules);
}

function crawlRobotsPermits(rules, pathname) {
  const path = crawlRobotsNormalize(pathname);
  let winner = null;
  for (const rule of rules) {
    const end = rule.path.endsWith('$');
    const parts = (end ? rule.path.slice(0, -1) : rule.path).split('*');
    if (!path.startsWith(parts[0])) continue;
    let cursor = parts[0].length;
    let matched = !end || parts.length > 1 || cursor === path.length;
    // Literal pieces plus wildcard stars, without a backtracking regular expression.
    for (let index = 1; index < parts.length && matched; index++) {
      const part = parts[index];
      if (end && index === parts.length - 1) matched = path.endsWith(part) && path.length - part.length >= cursor;
      else {
        const found = path.indexOf(part, cursor);
        if (found < 0) matched = false;
        else cursor = found + part.length;
      }
    }
    if (!matched) continue;
    const length = rule.path.replace(/\*/g, '').replace(/\$$/, '').length;
    if (!winner || length > winner.length || (length === winner.length && rule.allow)) winner = { length, allow: rule.allow };
  }
  return winner?.allow ?? true;
}

async function crawlReadBody(response, maxBytes, signal) {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) {
    response.body?.cancel().catch(() => {});
    throw crawlError('BODY_TOO_LARGE', `回應超過 ${Math.round(maxBytes / 1024)} KiB 限制。`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw crawlError('REQUEST_TIMEOUT', '網站請求逾時。');
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        reader.cancel().catch(() => {});
        throw crawlError('BODY_TOO_LARGE', `回應超過 ${Math.round(maxBytes / 1024)} KiB 限制。`);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8').decode(result);
}

async function crawlFetchOne(state, rawUrl, kind, form = null) {
  const url = crawlOwnedUrl(rawUrl);
  const remaining = state.deadline - state.now();
  if (remaining <= 0) throw crawlError('TOTAL_TIMEOUT', '已達官網遍歷的 40 秒總時間限制。');
  const controller = new AbortController();
  const abort=()=>controller.abort(state.signal.reason);
  state.signal?.throwIfAborted();state.signal?.addEventListener('abort',abort,{once:true});
  const duration = Math.min(state.requestMs, remaining);
  let timer;
  const timeout = new Promise((_, reject) => {
    if(!Number.isFinite(duration))return;
    timer = setTimeout(() => {
      controller.abort();
      reject(crawlError(duration < state.requestMs ? 'TOTAL_TIMEOUT' : 'REQUEST_TIMEOUT', duration < state.requestMs ? '已達官網遍歷的 40 秒總時間限制。' : '網站請求逾時（最多 8 秒）。'));
    }, duration);
  });
  try {
    return await Promise.race([(async () => {
      const response = await state.fetchImpl(url.href, {
        method: form ? 'POST' : 'GET', ...(form?{body:new URLSearchParams(form).toString()}:{}), redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { ...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{}), 'User-Agent': crawlUserAgent, Accept: kind === 'catalog' ? 'application/json' : kind === 'robots' ? 'text/plain' : 'text/html,application/xhtml+xml' },
      });
      // Some test/custom fetch implementations ignore redirect: manual. Never trust their final URL.
      if (response.url && crawlOwnedUrl(response.url).href !== url.href) {
        response.body?.cancel().catch(() => {});
        throw crawlError('UNEXPECTED_REDIRECT', '網站回應未經手動驗證的轉址，已停止。');
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        response.body?.cancel().catch(() => {});
        if (!location) throw crawlError('INVALID_REDIRECT', '網站轉址未提供目的地。');
        let next;
        try { next = crawlOwnedUrl(location, url.href); }
        catch { throw crawlError('UNSAFE_REDIRECT', '網站轉址超出允許的 HTTPS 品牌網域，或含查詢參數，已停止。'); }
        return { status: response.status, redirect: next.href };
      }
      if (!response.ok) {
        response.body?.cancel().catch(() => {});
        return { status: response.status, text: '', contentType: '' };
      }
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (kind === 'html' && !/^(text\/html|application\/xhtml\+xml)(?:;|$)/.test(contentType)) {
        response.body?.cancel().catch(() => {});
        throw crawlError('NOT_HTML', '回應不是 HTML 網頁，未分析。');
      }
      if (kind === 'robots' && contentType.includes('text/html')) {
        response.body?.cancel().catch(() => {});
        throw crawlError('ROBOTS_INVALID', 'robots.txt 回傳 HTML，無法確認爬取規則。');
      }
      return { status: response.status, contentType, text: await crawlReadBody(response, kind === 'robots' ? crawlRobotsBytes : crawlPageBytes, controller.signal) };
    })(), timeout]);
  } catch (error) {
    if (error instanceof CrawlError) throw error;
    throw crawlError(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', controller.signal.aborted ? '網站請求逾時。' : '無法讀取網站，請稍後重試。');
  } finally { clearTimeout(timer);state.signal?.removeEventListener('abort',abort); }
}

async function crawlLoadRobots(state, origin) {
  if (state.robots.has(origin)) return state.robots.get(origin);
  let url = `${origin}/robots.txt`;
  let result;
  const seen = new Set();
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (seen.has(url)) throw crawlError('REDIRECT_LOOP', 'robots.txt 發生循環轉址。');
      seen.add(url);
      const response = await crawlFetchOne(state, url, 'robots');
      if (response.redirect) {
        if (redirects === 3) throw crawlError('REDIRECT_LIMIT', 'robots.txt 超過 3 次轉址限制。');
        url = response.redirect;
        continue;
      }
      if ([404, 410].includes(response.status)) result = { rules: [] };
      else if (response.status >= 200 && response.status < 300) result = { rules: crawlRobotsRules(response.text) };
      else result = { error: crawlError('ROBOTS_UNAVAILABLE', `robots.txt 回應 HTTP ${response.status}，暫停爬取此網域。`) };
      break;
    }
  } catch (error) { result = { error: crawlError(error.code ?? 'ROBOTS_UNAVAILABLE', `無法確認 robots.txt：${error.message}`) }; }
  state.robots.set(origin, result);
  return result;
}

async function crawlFetchPage(state, startUrl) {
  let url = startUrl;
  const seen = new Set();
  for (let redirects = 0; redirects <= 3; redirects++) {
    const parsed = crawlPublicPageUrl(url);
    const robots = await crawlLoadRobots(state, parsed.origin);
    if (robots.error) throw robots.error;
    if (!crawlRobotsPermits(robots.rules, parsed.pathname)) throw crawlError('ROBOTS_DISALLOWED', 'robots.txt 不允許 BrandSignalBot 爬取此頁面。');
    if (seen.has(url)) throw crawlError('REDIRECT_LOOP', '頁面發生循環轉址。');
    seen.add(url);
    const response = await crawlFetchOne(state, url, 'html');
    if (response.redirect) {
      if (redirects === 3) throw crawlError('REDIRECT_LIMIT', '頁面超過 3 次轉址限制。');
      url = response.redirect;
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw crawlError('HTTP_ERROR', `頁面回應 HTTP ${response.status}，未分析。`);
    return { url, html: response.text };
  }
}

function crawlPageLinks(html, pageUrl, keywords) {
  const links = [];
  const host = new URL(pageUrl).hostname;
  const linkHtml = html.replace(/<(script|style|svg|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  for (const match of linkHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = crawlAttributes(match[1]).href;
    if (!href || href.startsWith('#')) continue;
    try {
      const link = crawlPublicPageUrl(href, pageUrl);
      if (link.hostname !== host) continue;
      if (/\.[a-z\d]+$/i.test(link.pathname) && !/\.(?:html?|php)$/i.test(link.pathname)) continue;
      if (!links.some((item) => item.url === link.href)) {
        const label = crawlPlain(match[2]).normalize('NFKC').toLowerCase();
        const matchScore = keywords.some((keyword) => label.includes(keyword.normalize('NFKC').toLowerCase())) ? 2 : 0;
        const buyerScore=/成分|營養|過敏|運費|配送|購物須知|保存|企業|福委|客製|訂購/.test(label)?4:0;
        const productScore=/\/(?:product|goods|item)\d+/i.test(link.pathname)?20:0;
        links.push({ url: link.href, score: matchScore + buyerScore + productScore + (/品牌|伴手禮|中秋|常見問題/.test(label) ? 1 : 0) });
      }
      if (links.length >= 60 && !/^\/category\d*\.html$/i.test(new URL(pageUrl).pathname)) break;
    } catch { /* External, query-string and non-HTTPS links are not crawl targets. */ }
  }
  return links.sort((a, b) => b.score - a.score).map((item) => item.url);
}

function crawlPageImages(html, pageUrl) {
  const page = new URL(pageUrl), images = [], seen = new Set();
  const add = (value, alt = '', title = '', context = null) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048 || images.length >= 200) return;
    try {
      const image = new URL(value.trim(), page);
      const sameBrandHost=image.hostname===page.hostname||((page.hostname==='idodo.com.tw'||page.hostname==='www.idodo.com.tw')&&/(?:^|\.)idodo\.com\.tw$/i.test(image.hostname));
      if (image.protocol !== 'https:' || !sameBrandHost || image.username || image.password || image.port) return;
      if (/\.svg$/i.test(image.pathname)) return;
      image.hash = '';
      if (seen.has(image.href)) return;
      seen.add(image.href);
      images.push({url:image.href,alt:crawlPlain(alt).slice(0,300),title:crawlPlain(title).slice(0,200),...(context?{context}:{})});
    } catch { /* Ignore invalid or cross-site image sources. */ }
  };
  for (const match of html.matchAll(/<(?:img|source)\b([^>]*)>/gi)) {
    const attrs = crawlAttributes(match[1]);
    // Bound adjacency by the previous/next image; never use whole-page text as nearby evidence.
    const before=html.slice(0,match.index).split(/<(?:img|source)\b[^>]*>/i).at(-1);
    const after=html.slice(match.index+match[0].length).split(/<(?:img|source)\b/i)[0];
    const heading=[...html.slice(0,match.index).matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)].at(-1);
    const context={version:1,method:'html-neighbors',before:crawlPlain(before).slice(-600),after:crawlPlain(after).slice(0,600),heading:crawlPlain(heading?.[1]||'').slice(0,200)};
    const srcset=(attrs['data-srcset']||attrs.srcset||'').split(',').map(part=>part.trim().split(/\s+/)).filter(p=>p[0]).sort((a,b)=>(parseFloat(b[1])||1)-(parseFloat(a[1])||1))[0]?.[0];
    if(srcset){add(srcset,attrs.alt||attrs['aria-label'],attrs.title,context);continue}
    for (const key of ['data-src','data-original','data-lazy-src','src']) if (attrs[key]) { add(attrs[key], attrs.alt || attrs['aria-label'], attrs.title,context); break; }
    if(srcset)add(srcset,attrs.alt||attrs['aria-label'],attrs.title,context);
    if (images.length >= 200) break;
  }
  for(const match of html.matchAll(/(?:background(?:-image)?\s*:[^;"']*?url\(\s*["']?)([^)"']+)/gi))add(match[1]);
  // Infographic filenames often hold the only useful label, but Chinese URL
  // path characters are percent-encoded. Decode them before ranking images.
  const priority=item=>{
    let path='';try{path=decodeURIComponent(new URL(item.url).pathname)}catch{}
    const value=(item.alt+' '+item.title+' '+path).normalize('NFKC').toLowerCase();
    return (/運費|配送|運送|免運|貨到付款|shipping|delivery|freight/.test(value)?12:0)
      +(/成分|原料|過敏|營養|ingredient|allergen|nutrition/.test(value)?12:0)
      +(/規格|保存|價格|商品|產品|尺寸|期限|重量|入數|spec|product|detail/.test(value)?8:0)
      +Math.min(3,item.alt.length/30);
  };
  return images.sort((a,b)=>priority(b)-priority(a));
}

function crawlExtractPage(html, url, requestedUrl, keywords, includeContent = false) {
  const types = new Set();
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 10 || types.size >= 30) return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 100)) visit(item, depth + 1); return; }
    const type = value['@type'];
    for (const name of (Array.isArray(type) ? type : [type])) if (typeof name === 'string') types.add(name.slice(0, 100));
    for (const child of Object.values(value).slice(0, 100)) if (child && typeof child === 'object') visit(child, depth + 1);
  };
  let scriptCount = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (crawlAttributes(match[1]).type?.toLowerCase() !== 'application/ld+json') continue;
    if (++scriptCount > 20 || match[2].length > 32 * 1024) continue;
    try { visit(JSON.parse(match[2])); } catch { /* Presence is not schema validity. */ }
  }
  const title = crawlPlain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? '').slice(0, 300);
  let description = '';
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = crawlAttributes(match[0]);
    if (attrs.name?.toLowerCase() === 'description') { description = (attrs.content ?? '').trim().slice(0, 500); break; }
  }
  const contentHtml = (html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? html)
    .replace(/<(script|style|svg|template|noscript|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const headings = (level) => [...contentHtml.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}\\s*>`, 'gi'))].slice(0, 10).map((match) => crawlPlain(match[1]).slice(0, 200)).filter(Boolean);
  const fullText = crawlPlain(contentHtml);
  const text = fullText.slice(0, 3999);
  const h1 = headings(1), h2 = headings(2);
  const structuredData = [...types];
  const faqPresent = structuredData.some((type) => /(?:^|[/#])FAQPage$/i.test(type)) || /FAQ|常見問[題答]|問與答/i.test(text);
  const normalize = (value) => value.normalize('NFKC').toLowerCase();
  const searchable = normalize(`${title} ${description} ${h1.join(' ')} ${h2.join(' ')} ${text}`);
  const keywordMatches = keywords.filter((keyword) => searchable.includes(normalize(keyword)));
  const wordCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]|[\p{L}\p{N}]+/gu) ?? []).length;
  const issues = [];
  if (!title) issues.push('回傳 HTML 缺少 title。');
  else if (Array.from(title).length < 10 || Array.from(title).length > 60) issues.push('標題長度超出本工具 10–60 字的編輯參考範圍。');
  if (!description) issues.push('回傳 HTML 缺少 meta description。');
  if (!h1.length) issues.push('回傳 HTML 未找到 H1。');
  if (!h2.length) issues.push('回傳 HTML 未找到 H2 子題。');
  if (text.length < 200) issues.push('可讀取的文字偏少；內容可能由圖片或 JavaScript 提供，需人工查看。');
  if (!faqPresent) issues.push('分析範圍未找到 FAQ 或 FAQPage。');
  if (!structuredData.length) issues.push('未辨識到 JSON-LD @type；不代表缺少全部結構化資料或無法排名。');
  if (keywords.length && !keywordMatches.length) issues.push('分析範圍未包含所選關鍵字；需核對頁面意圖。');
  // Preserve the same bounded text used by the analysis. Cloud/browser storage
  // relies on excerpt, so a second 1,199-character cut discarded product facts.
  const images = crawlPageImages(contentHtml, url);
  if (images.length) issues.push(`頁面含 ${images.length} 張圖片；圖片文字尚未辨識。`);
  return { url, requestedUrl, title, description, h1, h2, wordCount, wordCountMethod: '分析文字中的 CJK 字元與其他詞段', analyzedCharacters: text.length, textTruncated: fullText.length > text.length, faqPresent, structuredData, keywordMatches, links: crawlPageLinks(html, url, keywords), images:images.slice(0,64),imageDiscoveryTotal:images.length, excerpt: text, ...(includeContent ? { content: fullText.slice(0, 24000), contentTruncated: fullText.length > 24000 } : {}), issues };
}


async function crawlCatalogLinks(state,page,html){
 const match=new URL(page.url).pathname.match(/^\/category(\d*)\.html$/i);
 if(!match)return;
 page.catalog={role:'category',categoryId:match[1]||null,status:'static',productsDiscovered:0};
 if(!html.includes('get_product_list'))return;
 try{
  const csrf=html.match(/(?:var|let|const)\s+csrf\s*=\s*['"]([^'"\r\n]{1,512})['"]/)?.[1]||'';
  const response=await crawlFetchOne(state,page.url,'catalog',{act:'shop_product',code:'get_product_list',ids:match[1],dollar:'',q:'',csrf});
  if(response.redirect||response.status!==200)throw Error('商品清單服務未成功回應');
  const result=JSON.parse(response.text);
  if(!Array.isArray(result.product_list))throw Error('商品清單格式不符');
  const urls=result.product_list.flatMap(item=>{
   const id=String(item?.ID??'');return /^\d{1,12}$/.test(id)?[new URL('product'+id+'.html',page.url).href]:[];
  });
  page.links=[...new Set([...urls,...page.links])];
  page.catalog={...page.catalog,status:'read',productsDiscovered:new Set(urls).size};
 }catch{page.catalog.status='failed';page.issues.push('動態商品清單讀取未完成；只沿已取得連結，不代表此分類沒有商品。')}
}

/** Second argument is for deterministic mock tests; endpoint callers use only the first. */
export async function crawlBrand(args, testOptions = {}) {
  const input = crawlInput(args);
  const now = testOptions.now ?? Date.now;
  const unlimited=testOptions.unlimited===true;
  if(unlimited)input.maxPages=Infinity;
  const state = { signal:testOptions.signal, fetchImpl: testOptions.fetchImpl ?? globalThis.fetch, now, deadline: unlimited?Infinity:now() + Math.min(crawlTotalMs, testOptions.totalTimeoutMs ?? crawlTotalMs), requestMs: unlimited?Infinity:Math.min(crawlRequestMs, testOptions.requestTimeoutMs ?? crawlRequestMs), robots: new Map() };
  const pages = [], failures = [];
  const catalogMode=/^\/(?:category\d*|product\d+)\.html$/i.test(new URL(input.startUrl).pathname);
  const queue = [{ url: input.startUrl, depth: 0 }];
  const scheduled = new Set([input.startUrl]), finalUrls = new Set();
  const excluded = new Set(testOptions.excludeUrls ?? []);
  let skippedExisting = 0;
  let attempted = 0;
  while (queue.length && attempted < input.maxPages) {
    if(state.signal?.aborted)break;
    const next = queue.shift();
    testOptions.onProgress?.({url:next.url,attempted,fetched:pages.length,pending:queue.length+1});
    if (excluded.has(next.url)) { skippedExisting++; continue; }
    if (state.now() >= state.deadline) {
      if(state.signal?.aborted)break;
      if(error.code==='SAVE_FAILED')throw error;
      failures.push({ url: next.url, code: 'TOTAL_TIMEOUT', message: '已達官網遍歷的 40 秒總時間限制；保留已取得結果。' });
      break;
    }
    attempted++;
    try {
      const response = await crawlFetchPage(state, next.url);
      if (excluded.has(response.url)) { skippedExisting++; continue; }
      if (finalUrls.has(response.url)) continue;
      finalUrls.add(response.url);
      scheduled.add(response.url);
      const page = crawlExtractPage(response.html, response.url, next.url, input.keywords, testOptions.includeContent === true);
      if(catalogMode){
        await crawlCatalogLinks(state,page,response.html);
        page.links=page.links.filter(link=>/^\/(?:category\d*|product\d+)\.html$/i.test(new URL(link).pathname));
        const productId=new URL(page.url).pathname.match(/^\/product(\d+)\.html$/i)?.[1];
        if(productId)page.catalog={role:'product',productId};
      }
      await testOptions.onPage?.(page);
      pages.push(page);
      if (unlimited || next.depth < 2) {
        for (const link of page.links) {
          if (scheduled.has(link) || (!unlimited && scheduled.size >= (catalogMode?260:60))) continue;
          scheduled.add(link);
          queue.push({ url: link, depth: next.depth + 1 });
          if(catalogMode)queue.sort((a,b)=>Number(/\/product\d+\.html$/.test(b.url))-Number(/\/product\d+\.html$/.test(a.url)));
        }
      }
    } catch (error) {
      if(state.signal?.aborted)break;
      if(error.code==='SAVE_FAILED')throw error;
      failures.push({ url: next.url, code: error instanceof CrawlError ? error.code : 'CRAWL_FAILED', message: error instanceof CrawlError ? error.message : '無法分析此頁面。' });
      if (error.code === 'TOTAL_TIMEOUT') break;
    }
  }
  const catalogPending=catalogMode?new Set(pages.flatMap(p=>p.links).filter(url=>!finalUrls.has(url)&&!excluded.has(url))).size:0;
  const notice = pages.length
    ? `已讀取 ${pages.length} 個官網公開 HTML 頁面；${unlimited?'無頁數與時間上限':`最多 ${input.maxPages} 頁、深度 2`}，分析文字每頁最多 3999 字元。${failures.length ? '部分頁面未取得，請查看失敗紀錄。' : ''}未執行 JavaScript、驗證收錄、搜尋排名或 AI 引用；不是整站完整掃描。`
    : '未取得可分析的官網頁面，遍歷未完成；請查看 robots.txt、網路或頁面失敗紀錄。本次沒有產生搜尋成效數據。';
  return { source: 'website_crawl', generatedAt: new Date(now()).toISOString(), domain: input.domain, pages, failures, coverage: { attempted, fetched: pages.length, limit: unlimited?null:input.maxPages }, ...(testOptions.excludeUrls ? {traversal: {skippedExisting, exhausted: !pages.length && !failures.length && skippedExisting > 0}} : {}), notice, ...(catalogMode?{catalog:{entry:input.startUrl,pending:catalogPending,complete:!state.signal?.aborted&&catalogPending===0&&failures.length===0&&!pages.some(p=>['failed','partial'].includes(p.catalog?.status)),notice:unlimited?'持續讀取所有已發現商品與分類，直到完成或手動停止。':'分類頁只提供商品入口；每批最多 6 頁，未讀取商品不算已建檔。'}}:{}) };
}
