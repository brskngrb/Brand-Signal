const MAX_MINUTES = 20;
const MAX_PAGES = 200;
const MAX_ROUNDS = 60;
const MAX_EMPTY_ROUNDS = 6;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const plain = (value, limit = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, limit) : '';
const normalized = value => value.normalize('NFKC').toLocaleLowerCase();

function pageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001F\u007F]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined) return fallback;
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) throw Error(`${name}格式不正確。`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw Error(`${name}須為 ${minimum}–${maximum} 的整數。`);
  return number;
}

function terms(value, name, maximum) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum || value.some(term => typeof term !== 'string' || term.length > 80 || /[\u0000-\u001F\u007F]/.test(term))) throw Error(`${name}最多 ${maximum} 個，每個不超過 80 字。`);
  const seen = new Set();
  return value.map(term => term.trim()).filter(term => {
    if (!term || seen.has(normalized(term))) return false;
    seen.add(normalized(term));
    return true;
  });
}

function configuration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('請提供主題探索設定。');
  if (typeof value.topic !== 'string' || !value.topic.trim() || value.topic.length > 200 || /[\u0000-\u001F\u007F]/.test(value.topic)) throw Error('請輸入 1–200 字的探索主題。');
  const focus = value.focus ?? 'both';
  const stopMode = value.stopMode ?? 'pages';
  if (!['peers', 'related', 'both'].includes(focus)) throw Error('請選擇有效的探索方向。');
  if (!['pages', 'time'].includes(stopMode)) throw Error('請選擇以頁數或時間停止。');
  const pages = boundedInteger(value.pages, 100, 1, MAX_PAGES, '頁數');
  const minutes = boundedInteger(value.minutes, 3, 1, MAX_MINUTES, '分鐘數');
  if (value.planWithLocalModel !== undefined && typeof value.planWithLocalModel !== 'boolean') throw Error('本地模型規劃設定須為開啟或關閉。');
  if (value.includeUrls !== undefined && typeof value.includeUrls !== 'boolean') throw Error('指定網址設定須為開啟或關閉。');
  let urls = [];
  if (value.includeUrls) {
    if (!Array.isArray(value.urls) || !value.urls.length || value.urls.length > 5) throw Error('請提供 1–5 個指定網址。');
    urls = value.urls.map(pageUrl);
    if (urls.some(url => !url)) throw Error('指定網址須為完整的公開 HTTP 或 HTTPS 網址，且不含登入資訊。');
    urls = [...new Set(urls)];
  }
  return {
    topic: value.topic.trim(), focus, competitors: terms(value.competitors, '競品名稱', 5), keywords: terms(value.keywords, '補充關鍵字', 10),
    stopMode, pages, minutes, planWithLocalModel: value.planWithLocalModel !== false, includeUrls: value.includeUrls === true, urls,
  };
}

function idleState() {
  return { running: false, stopping: false, phase: 'idle', status: '輸入主題，探索相關網站並保存資料。', startedAt: null, elapsedMs: 0, completedPages: 0, savedPages: 0, round: 0, query: '', planner: '', notice: '', stopReason: '' };
}

function restriction(value) {
  const message = typeof value === 'string' ? value : `${value?.code || ''} ${value?.message || ''} ${value?.status || ''}`;
  return /SEARCH_(?:VERIFICATION_REQUIRED|RATE_LIMIT|AUTH_REQUIRED)|PUBLIC_READER_RATE_LIMIT|CAPTCHA|RATE[_ -]?LIMIT|AUTH[_ -]?REQUIRED|\b(?:401|402|403|429|451)\b|人工驗證|搜尋.{0,10}(?:額度|速率).{0,8}(?:受限|限制)/i.test(message);
}

/** Bounded sequential exploration; stop requests retain the in-flight batch. */
export function createExplorationRunner({ plan, search, crawl, onBatch = async () => {}, onUpdate = () => {}, now = Date.now } = {}) {
  if (typeof search !== 'function') throw Error('主題探索需要搜尋工具。');
  let state = idleState();
  let clockValue = 0;
  const clock = () => {
    const value = Number(now());
    if (Number.isFinite(value)) clockValue = Math.max(clockValue, value);
    return clockValue;
  };
  const getState = () => ({ ...state, elapsedMs: state.running && state.startedAt !== null ? Math.max(0, clock() - state.startedAt) : state.elapsedMs });
  const notify = () => {
    state.elapsedMs = getState().elapsedMs;
    try { onUpdate(getState()); } catch { /* A rendering error must not discard an already saved batch. */ }
  };
  const stop = () => {
    if (!state.running || state.stopping) return getState();
    state.stopping = true;
    state.status = '已要求停止；目前作業完成後會保留結果，不再開始下一批。';
    notify();
    return getState();
  };

  async function run(input) {
    if (state.running) throw Error('主題探索正在進行，請先停止或等待完成。');
    const config = configuration(input);
    if (config.includeUrls && typeof crawl !== 'function') throw Error('指定網址讀取工具尚未連接。');
    state = { ...idleState(), running: true, startedAt: clock(), targetPages: config.stopMode === 'pages' ? config.pages : null, phase: config.urls.length ? 'crawling' : 'planning', status: config.urls.length ? '準備讀取指定網址…' : '正在規劃探索主題…' };
    const deadline = state.startedAt + (config.stopMode === 'time' ? config.minutes : MAX_MINUTES) * 60000;
    const pageTarget = config.stopMode === 'pages' ? config.pages : MAX_PAGES;
    const readUrls = new Set();
    const savedUrls = new Set();
    const notices = new Set();
    let emptyRounds = 0;
    const note = text => { if (text) { notices.add(plain(text, 1500)); state.notice = [...notices].join(' ').slice(0, 4000); } };
    const finish = (reason, message, phase = 'done') => {
      state.elapsedMs = getState().elapsedMs;
      const shortfall = config.stopMode === 'pages' && state.completedPages < pageTarget ? ` 尚差 ${pageTarget - state.completedPages} 頁達到 ${pageTarget} 頁目標。` : '';
      state = { ...state, running: false, stopping: false, phase, stopReason: reason, status: `${message} 已讀取 ${state.completedPages} 頁；本地已確認保存 ${state.savedPages} 頁。${shortfall}` };
      const finalState = getState();
      notify();
      return finalState;
    };
    const boundary = () => {
      if (state.stopping) return ['user_stop', '已停止探索，未再開始新批次。', 'stopped'];
      if (state.completedPages >= pageTarget) return ['page_limit', config.stopMode === 'pages' ? '已達設定頁數。' : '已達單次 200 頁上限。'];
      if (deadline - clock() < 1000) return ['time_limit', config.stopMode === 'time' ? '已達設定時間，或剩餘不足 1 秒；停止開始新批次。' : '已達單次 20 分鐘上限，或剩餘不足 1 秒；停止開始新批次。'];
      if (emptyRounds >= MAX_EMPTY_ROUNDS) return ['no_new_pages', '連續六批沒有新增頁面，已結束探索。'];
      if (state.round >= MAX_ROUNDS) return ['round_limit', '已達單次 60 批上限。'];
      return null;
    };
    const collect = async (type, query) => {
      state.phase = type === 'crawl' ? 'crawling' : 'searching';
      state.query = query;
      state.round++;
      state.status = type === 'crawl' ? `正在讀取第 ${state.round} 批指定網頁…` : `正在搜尋第 ${state.round} 批網頁…`;
      notify();
      // onUpdate may synchronously request a stop; do not start a new request then.
      if (state.stopping) return null;
      const remaining = deadline - clock();
      if (remaining < 1000) return null;
      const maxPages = Math.min(6, pageTarget - state.completedPages);
      const budgetMs = Math.min(75000, remaining);
      // The request accepts at most 100 exclusions / 28k characters. Keep the
      // newest ones on the wire, but deduplicate the entire run in readUrls.
      let exclusionLength = 0;
      const excludeUrls = [...readUrls].reverse().filter(url => {
        if (exclusionLength + url.length > 28000) return false;
        exclusionLength += url.length;
        return true;
      }).slice(0, 100).reverse();
      const report = type === 'crawl'
        ? await crawl({ url: query, maxPages, budgetMs, excludeUrls })
        : await search({ query, maxPages, excludeUrls, budgetMs, planWithLocalModel: false });
      if (!report || typeof report !== 'object' || !Array.isArray(report.pages)) throw Error('網頁工具未回傳有效的頁面資料。');
      const batchPages = [];
      const batchUrls = new Set();
      for (const page of report.pages) {
        const url = pageUrl(page?.url || page?.finalUrl);
        if (!url || page?.error || page?.ok === false || batchUrls.has(url)) continue;
        batchUrls.add(url);
        batchPages.push({ ...page, url });
      }
      const newPages = batchPages.filter(page => !readUrls.has(page.url));
      newPages.forEach(page => readUrls.add(page.url));
      state.completedPages = readUrls.size;
      emptyRounds = newPages.length ? 0 : emptyRounds + 1;
      const persistence = report.persistence;
      const confirmed = persistence?.storage === 'sqlite' && !persistence.error && Number.isInteger(persistence.saved) && persistence.saved >= batchPages.length;
      if (confirmed) batchPages.forEach(page => savedUrls.add(page.url));
      state.savedPages = savedUrls.size;
      if (persistence?.error) note(`本地資料庫保存失敗：${plain(String(persistence.error), 600)}`);
      else if (batchPages.length && !confirmed) note('部分讀取資料尚未確認寫入本地資料庫；已讀取頁數不等於已保存頁數。');
      if (report.failures?.length) note('部分來源未能讀取，已保留成功取得的頁面。');
      state.status = state.stopping ? '已要求停止；正在保留目前批次的結果。' : `本批取得 ${newPages.length} 個新頁面，正在更新工作區…`;
      notify();
      try { await onBatch(report, { newPages, state: getState(), config, query, type }); }
      catch (error) { return finish('batch_error', `頁面已讀取，但工作區更新未完成：${plain(error?.message || String(error), 500)}。請重新載入已保存資料。`, 'error'); }
      if (persistence?.error) return finish('persistence_error', '本地資料庫保存失敗，已停止後續探索；可查看已確認保存的部分。', 'error');
      if (persistence?.storage === 'sqlite' && batchPages.length && !confirmed) return finish('persistence_error', '本地保存數量未能確認，已停止後續探索。', 'error');
      const restricted = (report.failures || []).find(restriction);
      if (restricted) { note(restricted.message || restricted.code); return finish('restricted', '搜尋服務要求驗證或限制存取，已停止並保留本批結果。', 'stopped'); }
      if (report.search?.stopReason === 'provider_limit') return finish('restricted', '搜尋服務限制存取，已停止並保留本批結果。', 'stopped');
      if (report.search?.stopReason === 'budget_exhausted') note('部分批次已達讀取時間上限；保留結果並在剩餘時間內繼續其他查詢。');
      if (report.error) return finish('search_error', `探索未完成：${plain(String(report.error), 500)}`, 'error');
      return null;
    };

    notify();
    try {
      for (const url of config.urls) {
        const end = boundary();
        if (end) return finish(...end);
        const result = await collect('crawl', url);
        if (result) return result;
      }
      let end = boundary();
      if (end) return finish(...end);
      state.phase = 'planning';
      state.query = '';
      state.status = config.planWithLocalModel ? '正在規劃主題與搜尋詞…' : '正在建立主題搜尋詞…';
      notify();
      end = boundary();
      if (end) return finish(...end);
      const planned = typeof plan === 'function'
        ? await plan({ ...config, budgetMs: Math.min(75000, deadline - clock()) })
        : { queries: [config.topic], planner: 'direct', notice: '使用主題直接搜尋。' };
      state.planner = plain(planned?.planner, 100);
      note(planned?.notice);
      const queryKeys = new Set();
      const queries = (Array.isArray(planned?.queries) ? planned.queries : []).map(query => plain(query)).filter(query => {
        if (!query || queryKeys.has(normalized(query))) return false;
        queryKeys.add(normalized(query));
        return true;
      }).slice(0, MAX_ROUNDS);
      end = boundary();
      if (end) return finish(...end);
      if (!queries.length) return finish('no_queries', '沒有可執行的搜尋詞，請調整探索主題。', 'stopped');
      for (const query of queries) {
        end = boundary();
        if (end) return finish(...end);
        const result = await collect('search', query);
        if (result) return result;
      }
      end = boundary();
      return end ? finish(...end) : finish('queries_exhausted', '本次規劃的搜尋詞已探索完成。');
    } catch (error) {
      const message = plain(error?.message || String(error), 800);
      note(message);
      if (state.stopping) return finish('user_stop', '已停止探索；目前作業未完整回傳，保留先前結果。', 'stopped');
      if (restriction(error)) return finish('restricted', '搜尋服務要求驗證或限制存取，已停止後續探索。', 'stopped');
      return finish('search_error', `探索未完成：${message}`, 'error');
    }
  }
  return { run, stop, getState };
}

const displayNumber = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0;
const elapsed = value => {
  const seconds = Math.floor(displayNumber(value) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function explorationProgress({ e = escapeHtml, icon = () => '', state, libraryAvailable = true, localModelAvailable = true, cachedPages } = {}) {
  const current = { ...idleState(), ...(state || {}) };
  if (!current.running && current.phase === 'idle' && !current.completedPages && !current.elapsedMs && !current.query) return '';
  const cacheConfirmed = Number.isInteger(cachedPages) && cachedPages >= 0;
  const storedCount = libraryAvailable ? displayNumber(current.savedPages) : cacheConfirmed ? cachedPages : '—';
  const storedLabel = libraryAvailable ? '本地已確認保存' : cacheConfirmed ? '瀏覽器已暫存' : '瀏覽器暫存待確認';
  const readCount = `${displayNumber(current.completedPages)}${Number.isInteger(current.targetPages) && current.targetPages > 0 ? ` / ${current.targetPages}` : ''}`;
  const status = libraryAvailable ? current.status : current.status.replace(/本地已確認保存 \d+ 頁。?/g, cacheConfirmed ? `瀏覽器已確認暫存 ${cachedPages} 頁。` : '瀏覽器暫存尚待確認。');
  const notice = libraryAvailable ? current.notice : current.notice.replace('部分讀取資料尚未確認寫入本地資料庫；已讀取頁數不等於已保存頁數。', '').trim();
  return `<div class="exploration-stats"><div><strong>${readCount}</strong><span>已讀取頁面</span></div><div><strong>${storedCount}</strong><span>${storedLabel}</span></div><div><strong>${elapsed(current.elapsedMs)}</strong><span>已用時間</span></div></div><p class="exploration-status" role="status">${e(status)}</p>${current.query ? `<p class="exploration-query">${icon('search')}${current.running?'目前':'最後'}${current.phase === 'crawling' ? '網址' : '查詢'}：${e(current.query)}</p>` : ''}${notice ? `<p class="exploration-notice">${e(notice)}</p>` : ''}`;
}

export function explorationPanel({ e = escapeHtml, icon = () => '', draft = {}, state, disabled = false, libraryAvailable = true, localModelAvailable = true, cachedPages, advancedOpen = false } = {}) {
  const config = { topic: '月餅、糕餅', focus: 'both', competitors: '', keywords: '', stopMode: 'pages', pages: 100, minutes: 3, planWithLocalModel: true, includeUrls: false, urls: '', ...(draft || {}) };
  const current = { ...idleState(), ...(state || {}) };
  const locked = disabled || current.running;
  const disable = locked ? 'disabled' : '';
  const option = (value, label, selected) => `<option value="${e(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${e(label)}</option>`;
  const stringList = value => Array.isArray(value) ? value.join('、') : String(value ?? '');
  const urlList = Array.isArray(config.urls) ? config.urls.join('\n') : String(config.urls ?? '');
  const limit = config.stopMode === 'time' ? `${config.minutes} 分鐘` : `${config.pages} 頁`;
  return `<section class="card exploration-card" id="exploration-panel"><div class="card-head"><div><h2>探索同業與相關網站</h2><p>不必準備網址，從想了解的主題開始。</p></div>${icon('search')}</div><div class="panel-body"><form id="exploration-form" class="exploration-form"><div class="exploration-main-grid"><div class="field"><label for="exploration-topic">探索主題</label><input id="exploration-topic" name="topic" value="${e(config.topic)}" placeholder="例如：月餅、糕餅、企業送禮" maxlength="200" required ${disable}></div><div class="field"><label for="exploration-focus">探索方向</label><select id="exploration-focus" name="focus" ${disable}>${[['both','同業與相關主題'],['peers','同業品牌'],['related','相關主題']].map(([value,label]) => option(value,label,config.focus)).join('')}</select></div></div><details class="exploration-options exploration-advanced" id="exploration-advanced" ${advancedOpen?'open':''}><summary>搜尋設定 <small>本次目標 ${e(limit)} · 指定網址與更多選項</small></summary><div class="exploration-advanced-body"><div class="exploration-limits"><div class="field"><label for="exploration-mode">停止條件</label><select id="exploration-mode" ${disable}>${option('pages','達到頁數',config.stopMode)}${option('time','達到時間',config.stopMode)}</select></div><div class="field" ${config.stopMode === 'time' ? 'hidden' : ''}><label for="exploration-pages">目標頁數</label><select id="exploration-pages" ${disable}>${[100,150,200].map(value => option(value,`${value} 頁`,config.pages)).join('')}</select></div><div class="field" ${config.stopMode === 'time' ? '' : 'hidden'}><label for="exploration-minutes">探索時間</label><select id="exploration-minutes" ${disable}>${[1,3,5,10,20].map(value => option(value,`${value} 分鐘`,config.minutes)).join('')}</select></div></div><div class="exploration-options-grid"><div class="field"><label for="exploration-competitors">競品名稱（選填）</label><input id="exploration-competitors" value="${e(stringList(config.competitors))}" placeholder="最多 5 個，每個 80 字，以逗號分隔" maxlength="404" ${disable}></div><div class="field"><label for="exploration-keywords">補充關鍵字（選填）</label><input id="exploration-keywords" value="${e(stringList(config.keywords))}" placeholder="最多 10 個，每個 80 字，以逗號分隔" maxlength="809" ${disable}></div></div><div class="exploration-url-options"><label class="check-label"><input type="checkbox" id="exploration-include-urls" ${config.includeUrls ? 'checked' : ''} ${disable}>同時讀取指定網址</label><div class="field exploration-url-list" ${config.includeUrls ? '' : 'hidden'}><label for="exploration-urls">指定網址（每行一個，最多 5 個）</label><textarea id="exploration-urls" rows="3" maxlength="10300" placeholder="https://example.com/\nhttps://example.org/products" ${disable}>${e(urlList)}</textarea><small>先讀取指定網址，再探索其他網站；共用本次額度。</small></div></div><label class="check-label exploration-plan ${localModelAvailable?'':'is-unavailable'}"><input type="checkbox" id="exploration-plan" ${localModelAvailable&&config.planWithLocalModel ? 'checked' : ''} ${locked||!localModelAvailable?'disabled':''}>讓本地 Qwen 規劃搜尋詞</label>${!localModelAvailable?'<p class="exploration-model-note">本地 Qwen 尚未連線，會直接使用主題搜尋，可正常收集資料。</p>':''}<p class="exploration-note">探索期間請保留頁面開啟。預設目標 100 頁；單次最多 200 頁、20 分鐘或 60 批；來源不足或服務受限時會提前結束。${libraryAvailable?'本地已保存僅計入確認寫入本地資料庫的頁面。':'結果暫存於此瀏覽器；清除瀏覽器資料後即移除。'}</p></div></details><div class="exploration-actions"><button class="btn primary" type="submit" ${disable}>${icon('search')}${current.running ? '探索中…' : '開始探索'}</button>${current.running ? `<button class="btn" type="button" data-action="stop-exploration" ${current.stopping ? 'disabled' : ''}>${current.stopping ? '正在停止…' : '停止探索'}</button>` : `<span class="exploration-limit-hint">目標 ${e(limit)}，完成後自動分析</span>`}</div></form><div class="exploration-progress" id="exploration-progress">${explorationProgress({ e, icon, state: current, libraryAvailable, localModelAvailable, cachedPages })}</div></div></section>`;
}
