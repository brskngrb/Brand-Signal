export const SOURCE_KINDS = ['目前競品', '替代競品', '引用來源'];
const clean = (v, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export function sourceHost(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.hostname.toLowerCase().replace(/^www\./, '') : '';
  } catch { return ''; }
}
const belongs = (host, root) => !!root && (host === root || host.endsWith('.' + root));
export function isReadableSource(page) {
  const title=String(page?.title||'').trim();
  return !/^(?:just a moment[.!…]*|attention required!?\s*\|?\s*cloudflare|access denied|verify (?:that )?you are human|security verification)$/i.test(title);
}
export function normalizeBaseline(value, brand = {}) {
  const base = value && typeof value === 'object' ? value : {};
  const seen = new Set();
  return {
    name: clean(brand.name || base.name, 80),
    domain: sourceHost(brand.domain || base.domain) ? new URL(brand.domain || base.domain).origin : '',
    topics: clean(base.topics, 200) || '月餅、糕餅、糕餅廠家',
    sources: (Array.isArray(base.sources) ? base.sources : []).flatMap(row => {
      const host = sourceHost(row?.url);
      if (!host || !SOURCE_KINDS.includes(row.kind) || seen.has(host)) return [];
      seen.add(host);
      return [{name: clean(row.name, 80) || host, url: new URL(row.url).origin, kind: row.kind}];
    }).slice(0, 50),
  };
}
export function parseBaselineForm({name, domain, topics, sources}) {
  if (!clean(name, 80) || !sourceHost(domain)) throw Error('請填寫指定品牌名稱及有效的官網網址。');
  const lines = String(sources || '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length > 50) throw Error('基準來源最多 50 個網站。');
  const rows = lines.map((line, index) => {
    const parts = line.split(/[|｜]/).map(value => value.trim());
    if (parts.length !== 3 || !parts[0] || !sourceHost(parts[1]) || !SOURCE_KINDS.includes(parts[2])) throw Error(`第 ${index + 1} 行請填：名稱 | https://網站 | 目前競品／替代競品／引用來源（擇一）。`);
    if (belongs(sourceHost(parts[1]), sourceHost(domain))) throw Error(`第 ${index + 1} 行是指定品牌官網，無須列為競品或引用來源。`);
    return {name: parts[0], url: parts[1], kind: parts[2]};
  });
  return normalizeBaseline({topics, sources: rows}, {name: name.trim(), domain});
}
export function classifySource(page, baseline) {
  const host = sourceHost(page?.url);
  if (belongs(host, sourceHost(baseline.domain))) return {scope: '指定品牌', kind: '指定品牌', name: baseline.name, host};
  // External categories apply only to the confirmed host; subdomains can be separate publishers.
  const match = baseline.sources.find(row => host === sourceHost(row.url));
  return {scope: '非指定品牌', kind: match?.kind || '待分類', name: match?.name || host, host};
}
export function withSourceBreakdown(insights, baseline) {
  const classify = page => ({...page, ...classifySource(page, baseline)});
  return {...insights, rows: insights.rows.map(row => {
    const pages = row.pages.map(classify);
    return {...row, pages, brandMatchCount: pages.filter(page => page.scope === '指定品牌').length, otherMatchCount: pages.filter(page => page.scope === '非指定品牌').length};
  })};
}
export function baselinePanel({e, baseline, disabled = false}) {
  const d = disabled ? 'disabled' : '';
  return `<details class="card baseline-details"><summary>指定品牌與人工基準資料 <span class="muted">目前：${e(baseline.name)}</span></summary><form id="baseline-form" class="baseline-form">
    <div class="field"><label for="baseline-name">指定品牌名稱</label><input id="baseline-name" value="${e(baseline.name)}" maxlength="80" required ${d}></div>
    <div class="field"><label for="baseline-domain">指定品牌官網</label><input id="baseline-domain" type="url" value="${e(baseline.domain)}" required ${d}></div>
    <div class="field"><label for="baseline-topics">預設探索主題</label><input id="baseline-topics" value="${e(baseline.topics)}" maxlength="200" required ${d}></div>
    <div class="field baseline-sources"><label for="baseline-sources">已人工確認的比較來源（每行一個）</label><textarea id="baseline-sources" rows="4" ${d} placeholder="名稱 | https://網站 | 目前競品&#10;名稱 | https://網站 | 替代競品&#10;名稱 | https://網站 | 引用來源">${e(baseline.sources.map(row => `${row.name} | ${row.url} | ${row.kind}`).join('\n'))}</textarea><small>目前競品：其他月餅／糕餅廠家；替代競品：其他送禮品類；引用來源：部落格、評比或新聞。只填已核實的網站。</small></div>
    <div class="toolbar"><button class="btn" ${d}>保存基準</button><button type="button" class="text-link" data-action="export-baseline">匯出基準</button><label class="text-link">匯入基準 <input id="baseline-import" type="file" accept=".json" ${d}></label></div>
    <p class="muted">人工建立方式：確認品牌官網 → 填入共同關鍵字 → 加入已確認的三類來源 → 用相同頁數或時間收集，保留日期與來源作為比較基準。設定保存在此瀏覽器，可匯出備份。</p>
  </form></details>`;
}
export function competitionPanel({e, pages, baseline}) {
  const grouped = SOURCE_KINDS.map(kind => {
    const sites = new Map();
    pages.forEach(page => {
      const c = classifySource(page, baseline);
      if (c.kind === kind) { const site = sites.get(c.host) || {...c, count: 0, url: new URL(page.url).origin}; site.count++; sites.set(c.host, site); }
    });
    return {kind, sites: [...sites.values()]};
  });
  const pending = new Set(pages.filter(page => classifySource(page, baseline).kind === '待分類').map(page => sourceHost(page.url))).size;
  return `<section class="card competition-panel"><div class="card-head"><h2>競爭與引用來源</h2><span class="muted">依人工確認的基準分類</span></div><div class="competition-grid">${grouped.map(group => `<section><h3>${group.kind}</h3>${group.sites.length ? group.sites.slice(0, 6).map(site => `<div class="competition-item"><a href="${e(site.url)}" target="_blank" rel="noopener noreferrer">${e(site.name)}</a><span>${site.count} 頁</span></div>`).join('') : '<p class="muted">尚無已分類的頁面</p>'}${group.sites.length > 6 ? `<small>另有 ${group.sites.length - 6} 個網站</small>` : ''}</section>`).join('')}</div><p class="muted">僅比較已收集樣本，不推估市佔或市場規模。${pending ? `${pending} 個非指定品牌網站待分類，可在首頁來源清單指定類別。` : ''}</p></section>`;
}
