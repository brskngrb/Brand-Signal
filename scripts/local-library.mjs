import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeResearchReport} from '../src/research.js';
import {buildKeywordInsights} from '../src/keyword-insights.js';

const MAX_CONTENT = 24000;
const MAX_PAGES_PER_SAVE = 100;
const taipeiDateFormatter = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'});
const cleanText = (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, limit) : '';
const time = value => typeof value === 'string' && value.length <= 50 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007F]/.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return null;
    if ([...url.searchParams.keys()].some(key => /^(?:api[-_]?key|access[-_]?token|token|secret|password|authorization|jina[-_]?api[-_]?key)$/i.test(key))) return null;
    url.hostname = host;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function workspace(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const normalized = publicUrl(raw.includes('://') ? raw : `https://${raw}`);
  if (!normalized) {
    const error = new Error('本地資料庫需要有效的品牌公開網址。');
    error.status = 400;
    error.code = 'INVALID_DOMAIN';
    throw error;
  }
  const url = new URL(normalized);
  url.hostname = url.hostname.replace(/^www\./, '');
  return url.origin;
}

function safePage(value, domain, fetchedAt) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.error || value.ok === false || value.success === false || (Number.isFinite(value.status) && value.status >= 400)) return null;
  const url = publicUrl(value.url || value.finalUrl || value.requestedUrl);
  const content = cleanText(value.content, MAX_CONTENT);
  const excerpt = cleanText(value.excerpt, 6000);
  if (!url || (!content && !excerpt)) return null;
  // Reuse the research field whitelist rather than persisting response objects,
  // which may contain request headers, API keys, or other transport metadata.
  const page = normalizeResearchReport({domain, crawl: {domain, source: 'website_crawl', pages: [{...value, url}]}}).crawl.pages[0];
  page.url = url;
  page.requestedUrl = publicUrl(page.requestedUrl) || url;
  page.links = page.links.map(publicUrl).filter(Boolean);
  page.content = content || excerpt;
  page.excerpt = excerpt || content.slice(0, 6000);
  page.fetchedAt = time(value.fetchedAt) || time(value.retrievedAt) || fetchedAt;
  page.retrievedAt = page.fetchedAt;
  page.contentFetchedAt = page.fetchedAt;
  return {page, hasContent: Boolean(content)};
}

function queryTerms(value) {
  const query = cleanText(value, 1800).toLocaleLowerCase();
  if (!query) return [];
  const segments = new Intl.Segmenter('zh-TW', {granularity: 'word'}).segment(query);
  const words = [...segments].filter(item => item.isWordLike).map(item => item.segment).filter(word => /\p{Script=Han}/u.test(word) ? word.length >= 2 : word.length >= 3);
  return [...new Set([query, ...words])].slice(0, 24);
}

function relevantExcerpt(content, terms, fallback) {
  if (!terms.length) return fallback;
  const lower = content.toLocaleLowerCase();
  const positions = terms.map(term => lower.indexOf(term)).filter(position => position >= 0);
  if (!positions.length) return fallback;
  const start = Math.max(0, Math.min(...positions) - 180);
  const end = Math.min(content.length, start + 3000);
  return `${start ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

function snapshotKeywords(value) {
  if (!Array.isArray(value) || value.length > 20 || value.some(keyword => typeof keyword !== 'string' || !keyword.trim() || keyword.length > 80 || /[\u0000-\u001f\u007f]/.test(keyword))) {
    const error = new Error('keywords 須為最多 20 個、各 1–80 字元的單行關鍵字。');
    error.status = 400;
    error.code = 'INVALID_KEYWORDS';
    throw error;
  }
  return value.map(keyword => keyword.trim());
}

function snapshotDate(value) {
  const parts = Object.fromEntries(taipeiDateFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Persistent source library for the local server; no model credentials are stored. */
export function openLibrary(databasePath, {databaseLabel = 'data/web-knowledge.sqlite', now = Date.now} = {}) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), {recursive: true});
  const db = new DatabaseSync(databasePath);
  // Only a workspace-relative label is exposed through the HTTP API.
  const label = typeof databaseLabel === 'string' && !/^(?:[A-Za-z]:|[\\/])/.test(databaseLabel) && !databaseLabel.split(/[\\/]/).includes('..') ? databaseLabel : 'data/web-knowledge.sqlite';
  db.exec(`PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS crawl_runs (
      id TEXT PRIMARY KEY, workspace TEXT NOT NULL, query TEXT NOT NULL,
      source TEXT NOT NULL, created_at TEXT NOT NULL, saved INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS web_pages (
      workspace TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
      excerpt TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL,
      fetched_at TEXT NOT NULL, content_fetched_at TEXT NOT NULL, saved_at TEXT NOT NULL,
      page_json TEXT NOT NULL, query TEXT NOT NULL, run_id TEXT NOT NULL,
      PRIMARY KEY (workspace, url), FOREIGN KEY (run_id) REFERENCES crawl_runs(id)
    );
    CREATE INDEX IF NOT EXISTS web_pages_recency ON web_pages(workspace, fetched_at DESC, saved_at DESC, url);
    CREATE INDEX IF NOT EXISTS crawl_runs_workspace ON crawl_runs(workspace, created_at DESC);
    CREATE TABLE IF NOT EXISTS keyword_snapshots (
      workspace TEXT NOT NULL, date TEXT NOT NULL, keyword_key TEXT NOT NULL, keyword TEXT NOT NULL,
      total_pages INTEGER NOT NULL CHECK(total_pages BETWEEN 1 AND 100),
      match_count INTEGER NOT NULL CHECK(match_count BETWEEN 0 AND total_pages),
      coverage_percent REAL NOT NULL CHECK(coverage_percent BETWEEN 0 AND 100),
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (workspace, date, keyword_key)
    );`);

  const count = db.prepare('SELECT count(*) AS total, max(fetched_at) AS updatedAt FROM web_pages WHERE workspace = ?');
  const prior = db.prepare('SELECT content, content_fetched_at, excerpt, page_json FROM web_pages WHERE workspace = ? AND url = ?');
  const insertRun = db.prepare('INSERT INTO crawl_runs (id,workspace,query,source,created_at,saved) VALUES (?,?,?,?,?,?)');
  const upsert = db.prepare(`INSERT INTO web_pages (workspace,url,title,excerpt,content,source,fetched_at,content_fetched_at,saved_at,page_json,query,run_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace,url) DO UPDATE SET
    title=excluded.title,excerpt=excluded.excerpt,content=excluded.content,source=excluded.source,
    fetched_at=excluded.fetched_at,content_fetched_at=excluded.content_fetched_at,saved_at=excluded.saved_at,
    page_json=excluded.page_json,query=excluded.query,run_id=excluded.run_id`);
  const snapshotPages = db.prepare('SELECT page_json, content FROM web_pages WHERE workspace = ? ORDER BY fetched_at DESC, saved_at DESC, url ASC LIMIT 100');
  const upsertSnapshot = db.prepare(`INSERT INTO keyword_snapshots (workspace,date,keyword_key,keyword,total_pages,match_count,coverage_percent,recorded_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workspace,date,keyword_key) DO UPDATE SET
    keyword=excluded.keyword,total_pages=excluded.total_pages,match_count=excluded.match_count,
    coverage_percent=excluded.coverage_percent,recorded_at=excluded.recorded_at`);
  const selectSnapshots = db.prepare(`SELECT date,keyword,total_pages AS totalPages,match_count AS matchCount,coverage_percent AS coveragePercent
    FROM keyword_snapshots WHERE workspace = ? AND date >= ? AND date <= ? ORDER BY date DESC, keyword_key ASC LIMIT 600`);
  const readKeywordHistory = (scope, today = snapshotDate(now())) => {
    const start = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
    return selectSnapshots.all(scope, start, today).map(row => ({...row})).sort((a, b) => a.date.localeCompare(b.date) || a.keyword.localeCompare(b.keyword));
  };

  return {
    saveCrawl(domain, crawl, query = '') {
      const scope = workspace(domain);
      const result = saved => ({storage: 'sqlite', saved, total: count.get(scope).total, database: label});
      if (!crawl || typeof crawl !== 'object' || Array.isArray(crawl) || crawl.ok === false || crawl.success === false || crawl.error || (crawl.source && !['website_crawl', 'website_search'].includes(crawl.source)) || !Array.isArray(crawl.pages)) return result(0);
      const createdAt = new Date().toISOString();
      const fetchedAt = time(crawl.generatedAt) || createdAt;
      const pages = new Map();
      for (const value of crawl.pages.slice(0, MAX_PAGES_PER_SAVE)) {
        const item = safePage(value, scope, fetchedAt);
        if (item) pages.set(item.page.url, item);
      }
      if (!pages.size) return result(0);
      const source = crawl.source === 'website_search' ? 'website_search' : 'website_crawl';
      const savedQuery = cleanText(query, 1000);
      const runId = randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try {
        insertRun.run(runId, scope, savedQuery, source, createdAt, pages.size);
        for (const {page, hasContent} of pages.values()) {
          const previous = prior.get(scope, page.url);
          if (!hasContent && previous && previous.content.length > page.content.length) {
            page.content = previous.content;
            page.contentFetchedAt = previous.content_fetched_at;
          }
          if (previous) {
            try {
              const previousPage=JSON.parse(previous.page_json);
              if(previousPage.imageText){
                page.imageTextSources=(previousPage.imageTextSources||[]).filter(r=>(page.images||[]).some(image=>image.url===r.url));
                page.imageText=page.imageTextSources.filter(r=>r.status==='read').map(r=>r.text).join('\n\n').slice(0,48000);
                page.imageTextFetchedAt=previousPage.imageTextFetchedAt||null;
              }
            } catch { /* Keep the fresh crawl if old page metadata is damaged. */ }
          }
          page.source = source;
          upsert.run(scope, page.url, page.title, page.excerpt, page.content, source, page.fetchedAt, page.contentFetchedAt, createdAt, JSON.stringify(page), savedQuery, runId);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return result(pages.size);
    },

    saveImageText(domain, pageUrl, imageText, imageTextSources = []) {
      const scope = workspace(domain), url = publicUrl(pageUrl);
      const cleanTextValue = cleanText(imageText, 48000);
      if (!url || (!cleanTextValue&&!imageTextSources.length)) return {saved:false};
      const row = db.prepare('SELECT page_json, content, excerpt FROM web_pages WHERE workspace = ? AND url = ?').get(scope, url);
      if (!row) return {saved:false};
      const page = JSON.parse(row.page_json);
      const safeImages = (Array.isArray(imageTextSources) ? imageTextSources : []).flatMap(item => {
        const imageUrl = publicUrl(item?.url);
        const imageHost=imageUrl?new URL(imageUrl).hostname:'';const pageHost=new URL(url).hostname;
        if (!imageUrl || !(imageHost===pageHost||((imageHost==='idodo.com.tw'||imageHost.endsWith('.idodo.com.tw'))&&(pageHost==='idodo.com.tw'||pageHost.endsWith('.idodo.com.tw'))))) return [];
        return [{url:imageUrl,alt:cleanText(item?.alt,300),text:cleanText(item?.text,48000),status:item?.status==='read'?'read':item?.status==='failed'?'failed':'legacy',version:Number(item?.version)||0,recognizedAt:cleanText(item?.recognizedAt,40),error:cleanText(item?.error,200),model:cleanText(item?.model,120),provider:cleanText(item?.provider,30),precision:cleanText(item?.precision,30),passes:Number.isInteger(item?.passes)?item.passes:null,regions:Number.isInteger(item?.regions)?item.regions:null,enhanced:typeof item?.enhanced==='boolean'?item.enhanced:null}];
      });
      const stamp = new Date(now()).toISOString();
      const marker = '\n\n【圖片文字辨識（AI 擷取，待人工核對）】\n';
      const base = row.content.split(marker)[0];
      const content = cleanText(base, MAX_CONTENT);
      const excerpt = cleanText(content || row.excerpt.split(marker.trim())[0], 6000);
      Object.assign(page, {imageText:cleanTextValue,imageTextSources:safeImages,imageTextFetchedAt:stamp,issues:(page.issues||[]).filter(issue=>!String(issue).includes('圖片文字尚未辨識')),content,excerpt});
      db.prepare('UPDATE web_pages SET content = ?, excerpt = ?, content_fetched_at = ?, saved_at = ?, page_json = ? WHERE workspace = ? AND url = ?')
        .run(content, excerpt, stamp, stamp, JSON.stringify(page), scope, url);
      return {saved:true};
    },

    read({domain, q = '', limit = 12} = {}) {
      const scope = workspace(domain);
      const maximum = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Math.trunc(Number(limit)))) : 12;
      const terms = queryTerms(q);
      const stats = count.get(scope);
      const base = 'SELECT * FROM web_pages WHERE workspace = ?';
      const where = terms.length ? ' AND (' + terms.map(() => "(instr(lower(title), ?) > 0 OR instr(lower(content), ?) > 0 OR instr(lower(COALESCE(json_extract(page_json, '$.imageText'), '')), ?) > 0)").join(' OR ') + ')' : '';
      const order = 'fetched_at DESC, saved_at DESC, url ASC';
      const parameters = [scope, ...terms.flatMap(term => [term, term,term])];
      let rows;
      let matched = stats.total;
      if (terms.length) {
        const rank = terms.map(() => '(CASE WHEN instr(lower(title), ?) > 0 THEN 10 ELSE 0 END + CASE WHEN instr(lower(content), ?) > 0 THEN 3 ELSE 0 END)').join(' + ') + ' + CASE WHEN instr(lower(title), ?) > 0 OR instr(lower(content), ?) > 0 THEN 20 ELSE 0 END';
        const rankParameters = [...terms.flatMap(term => [term, term]), terms[0], terms[0]];
        matched = db.prepare('SELECT count(*) AS total FROM web_pages WHERE workspace = ?' + where).get(...parameters).total;
        // Rank inside SQLite so a large library never returns every matching full
        // page to the Node process merely to select the requested bounded subset.
        rows = db.prepare(`SELECT *, (${rank}) AS score FROM web_pages WHERE workspace = ?${where} ORDER BY score DESC, ${order} LIMIT ?`).all(...rankParameters, ...parameters, maximum);
      } else rows = db.prepare(base + ' ORDER BY ' + order + ' LIMIT ?').all(scope, maximum);
      const pages = rows.slice(0, maximum).map(row => {
        const page = JSON.parse(row.page_json);
        const fromContent = terms.some(term => row.content.toLocaleLowerCase().includes(term));
        return {...page, content: row.content, excerpt: relevantExcerpt(row.content, terms, row.excerpt), fetchedAt: row.fetched_at, retrievedAt: fromContent ? row.content_fetched_at : row.fetched_at, contentFetchedAt: row.content_fetched_at};
      });
      return {available: true, storage: 'sqlite', total: stats.total, matched, pages, updatedAt: stats.updatedAt || null, database: label, keywordHistory: readKeywordHistory(scope)};
    },

    recordKeywordSnapshot(domain, keywords) {
      const scope = workspace(domain);
      const terms = snapshotKeywords(keywords);
      const recordedAt = new Date(now()).toISOString();
      const date = snapshotDate(recordedAt);
      if (!terms.length) return {history: readKeywordHistory(scope, date)};
      db.exec('BEGIN IMMEDIATE');
      try {
        const pages = snapshotPages.all(scope).map(row => ({...JSON.parse(row.page_json), content: row.content}));
        const insights = buildKeywordInsights({pages, keywords: terms});
        // No saved evidence means no measurement; do not invent zero-valued days.
        if (insights.totalPages) {
          for (const row of insights.rows) {
            const key = row.keyword.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
            upsertSnapshot.run(scope, date, key, row.keyword, insights.totalPages, row.matchCount, row.coveragePercent, recordedAt);
          }
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return {history: readKeywordHistory(scope, date)};
    },

    readAll(domain){return {pages:db.prepare('SELECT page_json,content FROM web_pages WHERE workspace=? ORDER BY url').all(workspace(domain)).map(r=>({...JSON.parse(r.page_json),content:r.content}))}},
    close() { db.close(); },
  };
}
