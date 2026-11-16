import {imageCoverage} from './image-evidence.js';
import {normalizeResearchReport} from './research.js';

const MAX_PAGES = 100;
const origin = value => {try{return new URL(value).origin}catch{return ''}};
const empty = brandDomain => ({brandDomain:origin(brandDomain),updatedAt:null,pages:[],failures:[],notice:''});
const validTime = value => typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;

export function normalizeWebData(value, brandDomain) {
  const result=empty(brandDomain);
  if(!value||typeof value!=='object'||Array.isArray(value)||origin(value.brandDomain)!==result.brandDomain)return result;
  result.updatedAt=validTime(value.updatedAt);
  const seen=new Set();
  // A merge contains at most one incoming and one saved window. Invalid or
  // duplicate entries do not consume a retained-page slot.
  for(const item of (Array.isArray(value.pages)?value.pages:[]).slice(0,MAX_PAGES*2)){
    if(result.pages.length===MAX_PAGES)break;
    const report=normalizeResearchReport({domain:brandDomain,crawl:{source:'website_crawl',domain:brandDomain,pages:[item]}});
    const page=report.crawl.pages[0];
    if(page&&!seen.has(page.url)){seen.add(page.url);result.pages.push({...page,retrievedAt:validTime(item.retrievedAt)||result.updatedAt})}
  }
  result.failures=(Array.isArray(value.failures)?value.failures:[]).slice(0,12).map(item=>({message:String(item?.message||'網頁讀取失敗').slice(0,1000)}));
  result.notice=typeof value.notice==='string'?value.notice.slice(0,4000):'';
  return result;
}

export function mergeWebData(previous, crawl, brandDomain) {
  const current=normalizeWebData(previous,brandDomain);
  const report=normalizeResearchReport({domain:brandDomain,crawl});
  if(!report.crawl)throw Error('網頁抓取未回傳有效資料。');
  const updatedAt=report.crawl.generatedAt||new Date().toISOString();
  // Normalize the whole incoming batch before merging it with retained pages.
  const previousByUrl=new Map(current.pages.map(page=>[page.url,page]));
  const pages=normalizeWebData({brandDomain,updatedAt,pages:crawl.pages},brandDomain).pages.map(page=>{
    const previous=previousByUrl.get(page.url);
    if(!previous?.imageText)return page;
    const sources=(previous.imageTextSources||[]).filter(r=>page.images.some(image=>image.url===r.url));
    return {...page,imageText:sources.filter(r=>r.status==='read').map(r=>r.text).join('\n\n').slice(0,48000),imageTextSources:sources,imageTextFetchedAt:previous.imageTextFetchedAt};
  });
  return normalizeWebData({brandDomain,updatedAt,pages:[...pages,...current.pages.filter(page=>!pages.some(next=>next.url===page.url))],failures:report.crawl.failures,notice:report.crawl.notice},brandDomain);
}

export function mergeLibraryData(previous, library, brandDomain) {
  const current = normalizeWebData(previous, brandDomain);
  if (!library?.available || library.storage !== 'sqlite' || !Array.isArray(library.pages)) return current;
  const pages = library.pages.slice(0,MAX_PAGES*2).filter(page=>page&&typeof page==='object'&&!Array.isArray(page)).map(page => ({...page,retrievedAt:validTime(page.retrievedAt)||validTime(library.updatedAt)}));
  return normalizeWebData({brandDomain,updatedAt:library.updatedAt||current.updatedAt,pages:[...pages,...current.pages.filter(page=>!pages.some(next=>next.url===page.url))],failures:current.failures,notice:current.notice},brandDomain);
}

export function webDataCard({e,icon,webData,brandDomain,running,status,libraryAvailable=false,libraryTotal=0}) {
  return `<section class="card web-data-card" id="web-data-panel"><div class="card-head"><div><div class="eyebrow">AGENT WEB DATA</div><h2>Agent 網頁資料</h2><p>${libraryAvailable?`本地資料庫共 ${e(libraryTotal)} 頁，以下顯示最近載入的 ${webData.pages.length} 頁。`:'從 AI Agent 或這裡抓取，資料會在同一個工作區共用。'}</p></div><span class="tag ${webData.pages.length?'blue':'gray'}">${webData.pages.length} 個來源</span></div><div class="panel-body"><form id="brand-crawl-form" class="web-data-form"><div class="field"><label for="brand-crawl-url">公開網頁網址</label><input id="brand-crawl-url" type="url" value="${e(brandDomain)}" placeholder="https://example.com/article" maxlength="2048" required ${running?'disabled':''}></div><button class="btn primary" type="submit" ${running?'disabled':''}>${icon('search')}${running?'正在抓取…':'抓取網頁資料'}</button></form><p class="inline-message" role="status">${e(status||'支援品牌官網及其他公開 HTTPS 網頁；外站透過 Jina Reader 讀取，不需要模型 API key。')}</p>${webData.pages.length?`<div class="web-data-list">${webData.pages.map((page,index)=>`<details><summary><span class="tag">${index+1}</span><div><strong>${e(page.title||'未提供標題')}</strong><small>${e(page.url)}</small></div>${icon('down')}</summary><div class="web-data-detail"><div class="web-data-meta"><a href="${e(page.url)}" target="_blank" rel="noopener">開啟來源 ↗</a><span>${page.retrievedAt?'抓取時間：'+e(new Date(page.retrievedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})):'未提供抓取時間'}</span></div>${page.description?`<p>${e(page.description)}</p>`:''}<div class="web-data-text">${e(page.excerpt||'此頁沒有可讀取的正文。')}</div>${page.images?.length?`<div class="image-text-panel"><p><strong>圖片</strong> · ${page.images.length} 張 · 已讀取 ${imageCoverage(page).completed} / ${imageCoverage(page).total} 張${imageCoverage(page).complete?' · 已有':' · 尚未完成，不能判定缺漏'}</p>${page.images.map((image,i)=>`<small class="image-source">圖片 ${i+1} · ${e(image.alt||image.title||image.url)}</small>`).join('')}<button class="btn small" data-action="ocr-images" data-page-url="${e(page.url)}" ${running||page.imageOcrBusy?'disabled':''}>${icon('spark')}${page.imageOcrBusy?'正在辨識…':page.imageText?'重新辨識圖片文字':'辨識圖片文字'}</button>${page.imageText?`<details class="quiet-details"><summary>圖片文字（AI 擷取，待人工核對）</summary><div class="web-data-text">${e(page.imageText)}</div>${(page.imageTextSources||[]).map((image,i)=>`<details class="quiet-details"><summary>圖片 ${i+1} · ${image.status==='read'?'已有':'未完成'}</summary><a class="image-source-link" href="${e(image.url)}" target="_blank" rel="noopener noreferrer">開啟原圖核對 ↗</a><div class="web-data-text">${e(image.text||image.error||'待重新辨識')}</div></details>`).join('')}</details>`:''}</div>`:''}</div></details>`).join('')}</div><div class="toolbar web-data-actions"><button class="btn" data-action="analyze-web-data">${icon('spark')}交給 Agent 分析</button><button class="btn" data-action="export-web-data">${icon('down')}匯出抓取資料</button><button class="btn" data-action="export-review-package">匯出審查包</button></div>`:''}${webData.failures.length?`<div class="warning-text">${webData.failures.map(f=>e(f.message)).join('<br>')}</div>`:''}<p class="research-boundary">${e(webData.notice||'抓取內容會保留來源；抓取數量不代表搜尋曝光或排名。')}</p></div></section>`;
}
