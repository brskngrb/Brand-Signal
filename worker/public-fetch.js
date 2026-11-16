// Public URLs use a fixed external reader so app-local DNS/redirects cannot reach
// loopback, metadata endpoints, or private networks. No caller headers are sent.
const publicFetchReaderOrigin = 'https://r.jina.ai/';
const publicFetchTimeoutMs = 25_000;
const publicFetchResponseBytes = 512 * 1024;
const publicFetchSiteTimeoutMs = 75_000;

class PublicFetchError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    if (status) this.status = status;
  }
}

function publicFetchError(code, message, status) {
  return new PublicFetchError(code, message, status);
}

function publicFetchIsChallenge(data) {
  const title = typeof data.title === 'string' ? data.title.normalize('NFKC').trim() : '';
  if (/^(?:just a moment[.!…]*|attention required[.!…]*)(?:\s*\|\s*cloudflare)?$/i.test(title)) return true;

  // A challenge has a verification instruction at the start of the page, not
  // merely an article mentioning CAPTCHA or quoting a Cloudflare message.
  const content = data.content.normalize('NFKC');
  if (!/\bcloudflare\b/i.test(content)) return false;
  const lines = content.slice(0, 1200).split(/\r?\n/).map(line => line.trim().replace(/^#{1,6}\s+/, '').replace(/^\*\*(.*?)\*\*$/, '$1')).filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    if (/^(?:verify(?: that)? you are human(?: by completing the action below)?|verifying(?: that)? you are human(?:\. this may take a few seconds)?)[.!…]*$/i.test(line)) return true;
    // Only page chrome may precede the instruction. Prose, article headings and
    // blockquotes stop detection, preserving genuine security articles.
    if (!/^(?:[a-z0-9.-]+\.[a-z]{2,}|cloudflare|just a moment[.!…]*|attention required[.!…]*|[-=]{3,})$/i.test(line)) return false;
  }
  return false;
}

function publicFetchUrl(value, domain = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw publicFetchError('INVALID_PUBLIC_URL', '請提供不超過 2048 字元的公開 HTTPS 網址。', 400);
  }
  const raw = value.trim();
  let url;
  try { url = new URL(domain && !raw.includes('://') ? `https://${raw}` : raw); }
  catch { throw publicFetchError('INVALID_PUBLIC_URL', '請提供完整的公開 HTTPS 網址。', 400); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search
    || host.length > 253 || !host.includes('.') || host.endsWith('.')
    || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || /^\d+(?:\.\d+)*$/.test(host) || host.includes(':')
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion|arpa)$/.test(host)
    || host.split('.').includes('metadata') || host === 'r.jina.ai' || host.endsWith('.r.jina.ai')) {
    throw publicFetchError('UNSAFE_PUBLIC_URL', '請使用公開 HTTPS 網站；不支援本機或私人網路、IP 位址、登入資訊、連接埠及查詢參數。', 400);
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname).replace(/\\/g, '/'); }
  catch { throw publicFetchError('INVALID_PUBLIC_URL', '網頁路徑編碼不正確。', 400); }
  if (/(?:^|\/)(?:cart|checkout|login|logout|signin|signout|member|account|admin|payment)(?:[./_-]|$)/i.test(pathname)) {
    throw publicFetchError('PRIVATE_PUBLIC_PATH', '請使用公開內容頁面；不讀取登入、會員、付款或管理頁面。', 400);
  }
  url.hash = '';
  if (domain) url.pathname = '/';
  return url;
}

function publicFetchInput(args, defaultPages = 1, pageLimit = 6) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw publicFetchError('INVALID_PUBLIC_INPUT', '請提供網址資料。', 400);
  const url = args.url !== undefined ? publicFetchUrl(args.url) : publicFetchUrl(args.domain, true);
  const maxPages = args.maxPages ?? defaultPages;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > pageLimit) throw publicFetchError('INVALID_PUBLIC_INPUT', `maxPages 必須是 1–${pageLimit} 的整數。`, 400);
  const keywords = args.keywords ?? [];
  if (!Array.isArray(keywords) || keywords.length > 30 || keywords.some(word => typeof word !== 'string' || word.length > 300)) {
    throw publicFetchError('INVALID_PUBLIC_INPUT', 'keywords 必須是最多 30 個、每個不超過 300 字元的文字陣列。', 400);
  }
  const readerApiKey = args.readerApiKey;
  if (readerApiKey !== undefined && readerApiKey !== '' && (typeof readerApiKey !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(readerApiKey))) {
    throw publicFetchError('INVALID_READER_KEY', 'Jina Reader 金鑰格式錯誤，請在「資料與 API」重新貼上 16–512 字元、無空白的有效金鑰。', 400);
  }
  return { url, readerApiKey, maxPages, keywords: [...new Set(keywords.map(word => word.trim()).filter(Boolean))] };
}

// Follow only hyperlinks actually returned by Reader, never URLs guessed by a model.
function publicFetchPageLinks(data, pageUrl) {
  const links = new Set();
  let examined = 0;
  const add = value => {
    if (++examined > 1200 || links.size >= 60 || typeof value !== 'string' || value.length > 2048) return;
    const href = value.trim();
    if (!href || href.startsWith('#')) return;
    try {
      const link = publicFetchUrl(new URL(href, pageUrl).href);
      if (link.hostname !== pageUrl.hostname) return;
      const path = decodeURIComponent(link.pathname);
      if (/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|pdf|docx?|xlsx?|pptx?|zip|rar|7z|tar|gz|mp[34]|wav|ogg|webm|mov|avi|woff2?|ttf|eot|css|m?js|json|xml|rss|atom)(?:\/)?$/i.test(path)) return;
      links.add(link.href);
    } catch { /* Private, cross-host and unsupported URLs are not crawl targets. */ }
  };
  const markdownLinks = /(?<!!)\[[^\]\r\n]{0,500}\]\(\s*(?:<([^<>\r\n]{1,2048})>|([^\s()]{1,2048}))(?:\s+["'][^"'\r\n]{0,300}["'])?\s*\)|^\s{0,3}\[[^\]\r\n]{1,100}\]:\s*(?:<([^<>\r\n]{1,2048})>|(\S{1,2048}))|<(https:\/\/[^<>\s]{1,2048})>/gm;
  for (const match of data.content.matchAll(markdownLinks)) {
    add(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]);
    if (links.size >= 60 || examined >= 1200) break;
  }
  if (Array.isArray(data.links)) {
    for (const item of data.links.slice(0, 1200)) {
      add(typeof item === 'string' ? item : item?.url ?? item?.href);
      if (links.size >= 60 || examined >= 1200) break;
    }
  } else if (data.links && typeof data.links === 'object') {
    for (const [label, value] of Object.entries(data.links).slice(0, 1200)) {
      if (typeof value === 'string' && /^(?:https?:\/\/|\.?\.?\/)/i.test(value)) add(value);
      else if (value && typeof value === 'object') add(value.url ?? value.href);
      if (/^https?:\/\//i.test(label)) add(label);
      if (links.size >= 60 || examined >= 1200) break;
    }
  }
  return [...links];
}

function publicFetchPageImages(content, pageUrl) {
  const images = [], seen = new Set();
  for (const match of content.matchAll(/!\[([^\]\r\n]{0,300})\]\(\s*(?:<([^<>\s]{1,2048})>|([^\s)]+))/g)) {
    const raw = match[2] ?? match[3];
    try {
      const url = publicFetchUrl(new URL(raw, pageUrl).href);
      const sameHost=url.hostname===pageUrl.hostname||((url.hostname==='idodo.com.tw'||url.hostname.endsWith('.idodo.com.tw'))&&(pageUrl.hostname==='idodo.com.tw'||pageUrl.hostname.endsWith('.idodo.com.tw')));
      if (!sameHost || seen.has(url.href)) continue;
      seen.add(url.href); images.push({url:url.href,alt:match[1].trim().slice(0,300),title:'',context:{version:1,method:'markdown-neighbors',before:content.slice(0,match.index).split(/!\[/).at(-1).replace(/^[^)]*\)/,'').slice(-600),after:content.slice(match.index+match[0].length).replace(/^[^)]*\)/,'').split(/!\[/)[0].slice(0,600),heading:''}});
      if (images.length >= 48) break;
    } catch { /* Ignore invalid or cross-site image sources. */ }
  }
  const priority=item=>{
    let path='';try{path=decodeURIComponent(new URL(item.url).pathname)}catch{}
    const value=(item.alt+' '+path).normalize('NFKC').toLowerCase();
    return (/運費|配送|運送|免運|貨到付款|shipping|delivery|freight/.test(value)?12:0)
      +(/成分|原料|過敏|營養|ingredient|allergen|nutrition/.test(value)?12:0)
      +(/規格|保存|價格|商品|產品|尺寸|期限|重量|入數|spec|product|detail/.test(value)?8:0);
  };
  return images.sort((a,b)=>priority(b)-priority(a)).slice(0,64);
}

async function publicFetchRead(response, signal) {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > publicFetchResponseBytes) {
    await response.body?.cancel().catch(() => {});
    throw publicFetchError('PUBLIC_RESPONSE_TOO_LARGE', '公開讀取服務回應超過 512 KiB，請改用較精簡的內容頁面。');
  }
  if (!response.body) throw publicFetchError('PUBLIC_INVALID_RESPONSE', '公開讀取服務沒有回傳內容。');
  const reader = response.body.getReader();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw publicFetchError('PUBLIC_TIMEOUT', '公開網頁讀取超過 25 秒，請稍後重試。');
      if (done) break;
      bytes += value.byteLength;
      if (bytes > publicFetchResponseBytes) {
        await reader.cancel().catch(() => {});
        throw publicFetchError('PUBLIC_RESPONSE_TOO_LARGE', '公開讀取服務回應超過 512 KiB，請改用較精簡的內容頁面。');
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
  return new TextDecoder().decode(result);
}

async function publicFetchReader(url, options) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(publicFetchError('PUBLIC_TIMEOUT', '公開網頁讀取超過 25 秒，請稍後重試。'));
    }, Math.min(publicFetchTimeoutMs, options.requestTimeoutMs ?? publicFetchTimeoutMs));
  });
  try {
    return await Promise.race([(async () => {
      const readerUrl = `${publicFetchReaderOrigin}${url.href}`;
      const response = await (options.fetchImpl ?? globalThis.fetch)(readerUrl, {
        method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', 'X-Respond-With': 'markdown', 'X-Robots-Txt': 'BrandSignalBot', DNT: '1', ...(options.readerApiKey ? { Authorization: `Bearer ${options.readerApiKey}` } : {}) },
      });
      if (response.url && response.url !== readerUrl) {
        await response.body?.cancel().catch(() => {});
        throw publicFetchError('PUBLIC_READER_REDIRECT', '公開讀取服務回傳未驗證的轉址，已停止讀取。');
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status >= 300 && response.status < 400) throw publicFetchError('PUBLIC_READER_REDIRECT', '公開讀取服務回傳轉址，已停止讀取。');
        if (response.status === 429) throw publicFetchError('PUBLIC_READER_RATE_LIMIT', '公開讀取服務免費額度受限，可在「資料與 API」設定 Jina Reader 金鑰或稍後重試。');
        if ([401, 402, 403, 451].includes(response.status)) throw publicFetchError('PUBLIC_READER_BLOCKED', '網站或公開讀取服務拒絕存取；請改用其他公開頁面，或稍後重試。');
        throw publicFetchError('PUBLIC_READER_UNAVAILABLE', '公開讀取服務暫時無法讀取此頁面，請稍後重試。');
      }
      if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel().catch(() => {});
        throw publicFetchError('PUBLIC_INVALID_RESPONSE', '公開讀取服務未回傳可分析的 JSON 資料。');
      }
      let envelope;
      try { envelope = JSON.parse(await publicFetchRead(response, controller.signal)); }
      catch (error) {
        if (error instanceof PublicFetchError) throw error;
        throw publicFetchError('PUBLIC_INVALID_RESPONSE', '公開讀取服務回傳格式不完整，請重試。');
      }
      const data = envelope?.data;
      if (envelope?.code !== 200 || !data || typeof data !== 'object' || Array.isArray(data)
        || typeof data.content !== 'string' || !data.content.trim() || typeof data.url !== 'string'
        || (data.httpStatus !== undefined && (!Number.isInteger(data.httpStatus) || data.httpStatus < 200 || data.httpStatus >= 300))) {
        throw publicFetchError('PUBLIC_INVALID_RESPONSE', '公開讀取服務未取得成功的網頁內容；可能受網站限制，請改用其他公開頁面。');
      }
      if (publicFetchIsChallenge(data)) {
        throw publicFetchError('PUBLIC_READER_BLOCKED', '網站要求驗證或拒絕存取，未取得可分析內容；請改用其他公開頁面，或稍後重試。');
      }
      let finalUrl;
      try { finalUrl = publicFetchUrl(data.url); }
      catch { throw publicFetchError('PUBLIC_UNSAFE_RESULT', '公開讀取服務回報非公開或不安全的來源網址，已停止分析。'); }
      if (finalUrl.hostname !== url.hostname) throw publicFetchError('PUBLIC_CROSS_HOST_RESULT', '網站轉往不同網域，請直接提供最終公開網頁網址後重試。');
      return { data, finalUrl };
    })(), timeout]);
  } catch (error) {
    if (error instanceof PublicFetchError) throw error;
    throw publicFetchError('PUBLIC_READER_UNAVAILABLE', '無法連接公開讀取服務，請檢查網路或稍後重試。');
  } finally { clearTimeout(timer); }
}

/** One requested public page; no model, browser credentials, or direct target fetch. */
export async function crawlPublicPage(args, testOptions = {}) {
  const { url, keywords, readerApiKey } = publicFetchInput(args);
  const pages = [], failures = [];
  try {
    const { data, finalUrl } = await publicFetchReader(url, { ...testOptions, readerApiKey });
    const content = data.content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    const text = content.slice(0, testOptions.includeContent ? 24000 : 3999);
    const title = typeof data.title === 'string' ? data.title.slice(0, 300).trim() : '';
    const searchable = `${title} ${text}`.normalize('NFKC').toLowerCase();
    pages.push({
      url: finalUrl.href, requestedUrl: url.href, title, description: '', h1: [], h2: [],
      wordCount: (text.match(/[\u3400-\u9fff\uf900-\ufaff]|[\p{L}\p{N}]+/gu) ?? []).length,
      wordCountMethod: 'Jina Reader 回傳文字中的 CJK 字元與其他詞段',
      analyzedCharacters: text.length, textTruncated: content.length > text.length,
      faqPresent: null, structuredData: [],
      keywordMatches: keywords.filter(word => searchable.includes(word.normalize('NFKC').toLowerCase())),
      links: testOptions.includeLinks ? publicFetchPageLinks(data, finalUrl) : [], images: publicFetchPageImages(content, finalUrl), excerpt: text.slice(0, 1199),
      ...(testOptions.includeContent ? { content: text, contentTruncated: content.length > text.length } : {}),
      issues: ['本頁由 Jina Reader 公開讀取服務轉換為文字；標題為服務回報，尚未直接驗證原始 HTML 的 meta description、H1/H2、FAQ 或 JSON-LD。'],
    });
  } catch (error) {
    failures.push({ url: url.href, code: error instanceof PublicFetchError ? error.code : 'PUBLIC_READER_UNAVAILABLE', message: error instanceof PublicFetchError ? error.message : '公開網頁讀取暫時失敗，請稍後重試。' });
  }
  return {
    source: 'website_crawl', generatedAt: new Date().toISOString(), domain: `${url.origin}/`, pages, failures,
    coverage: { attempted: 1, fetched: pages.length, limit: 1 },
    notice: `本次透過 Jina Reader 公開讀取服務處理指定的 1 個網頁，並要求遵守 robots.txt；網址會傳至該服務，不轉送模型金鑰或網站登入資訊。${pages.length ? `每頁分析文字最多 ${testOptions.includeContent ? 24000 : 3999} 字元；未直接驗證原始 HTML 中繼資料。` : '未取得可分析內容，請查看失敗紀錄。'}未遍歷其他連結，未量測搜尋排名、流量、搜尋量或 AI 引用成效。`,
  };
}

/** Bounded, same-host public traversal using the existing fixed Reader service. */
export async function crawlPublicSite(args, options = {}) {
  const input = publicFetchInput(args, 3, 12);
  const now = options.now ?? Date.now;
  const deadline = now() + Math.max(1, Math.min(publicFetchSiteTimeoutMs, options.totalTimeoutMs ?? publicFetchSiteTimeoutMs));
  const pages = [], failures = [];
  const queue = [{ url: input.url.href, depth: 0 }];
  const scheduled = new Set([input.url.href]), finalUrls = new Set();
  const excluded = new Set(options.excludeUrls ?? []);
  let skippedExisting = 0;
  let attempted = 0;
  while (queue.length && attempted < input.maxPages) {
    const next = queue.shift();
    if (excluded.has(next.url)) { skippedExisting++; continue; }
    if (finalUrls.has(next.url)) continue;
    const remaining = deadline - now();
    if (remaining <= 0) {
      failures.push({ url: next.url, code: 'PUBLIC_TOTAL_TIMEOUT', message: '已達本次網站遍歷的時間上限，保留已取得的頁面。' });
      break;
    }
    attempted++;
    const report = await crawlPublicPage({ url: next.url, keywords: input.keywords, readerApiKey: input.readerApiKey }, {
      fetchImpl: options.fetchImpl, includeLinks: true, includeContent: options.includeContent === true,
      requestTimeoutMs: Math.max(1, Math.min(publicFetchTimeoutMs, options.requestTimeoutMs ?? publicFetchTimeoutMs, remaining)),
    });
    for (const failure of report.failures) {
      failures.push(failure.code === 'PUBLIC_TIMEOUT' && now() >= deadline
        ? { url: failure.url, code: 'PUBLIC_TOTAL_TIMEOUT', message: '已達本次網站遍歷的時間上限，保留已取得的頁面。' }
        : failure);
    }
    const page = report.pages[0];
    if (page && excluded.has(page.url)) { skippedExisting++; continue; }
    if (!page || finalUrls.has(page.url)) continue;
    finalUrls.add(page.url);
    scheduled.add(page.url);
    pages.push(page);
    if (next.depth < 2) {
      for (const link of page.links) {
        if (scheduled.has(link) || scheduled.size >= 60) continue;
        scheduled.add(link);
        queue.push({ url: link, depth: next.depth + 1 });
      }
    }
  }
  return {
    source: 'website_crawl', generatedAt: new Date(now()).toISOString(), domain: `${input.url.origin}/`, pages, failures,
    coverage: { attempted, fetched: pages.length, limit: input.maxPages },
    ...(options.excludeUrls ? {traversal: {skippedExisting, exhausted: !pages.length && !failures.length && skippedExisting > 0}} : {}),
    notice: `本次透過 Jina Reader 讀取同一網站的公開頁面，最多 ${input.maxPages} 頁、深度 2，並要求遵守 robots.txt；網址會傳至該服務。每頁保留最多 ${options.includeContent ? 24000 : 3999} 字元及來源網址。${failures.length ? '部分頁面未取得，請查看失敗紀錄。' : ''}不是整站完整掃描；未直接驗證原始 HTML 中繼資料，未量測搜尋排名、流量、搜尋量或 AI 引用成效。`,
  };
}

export const validatePublicUrl = publicFetchUrl;
