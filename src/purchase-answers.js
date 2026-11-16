import {imageCoverage,imageTranscript,withoutLegacyOcr,IMAGE_READER_VERSION} from './image-evidence.js';
import {classifySource,isReadableSource} from './source-baseline.js';
import {analysisSignature} from './analysis.js';

const safe=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&!/[?&](?:token|api_key|secret|password)=/i.test(u.search)?u.href:''}catch{return ''}};
const clean=value=>String(value||'').trim();
// Image captions are discovery clues, never proof of readable page text.
export function pageAnswerText(page={}) {
  const raw=clean(withoutLegacyOcr(page.content||page.excerpt||page.description));
  const images=[...raw.matchAll(/!\[([^\]]*)\]\([^)]*\)/g)].map(m=>m[1]);
  images.push(...(page.images||[]).map(image=>image.alt||image.title||image.url));
  const text=raw.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/<img\b[^>]*>/gi,'').replace(/\{\{[\s\S]*?\}\}/g,'[動態欄位未載入]').split(/\r?\n/).filter(line=>!/^\s*(?:[-*]\s*)?\[[^\]]*\]\([^)]*\)\s*$/.test(line)).join('\n');
  return {text,images,ocrText:imageTranscript(page),coverage:imageCoverage(page),hasTemplate:/\{\{/.test(raw),origin:page.content?'正文':page.excerpt?'摘錄':'描述'};
}
const fields={
  spec:['品項與規格',/(?:規格|內容物|淨重|重量|入數)[：:\s]*[^\n。]{0,45}\d+\s*(?:g|公克|克|入|片|罐|盒)|[^\n。]{0,30}(?:曲奇|檸檬酥|鳳凰酥|餅乾|蛋捲)\s*\d+\s*入(?:禮盒)?/i],
  price:['售價',/(?:售價|價格|原價|優惠價|NT\$|NTD|新台幣)[：:\s$]*[\d,]+/i],
  date:['資訊更新日期',/(?:資訊更新日期|更新日期|最後更新|更新|最後修改|資料日期)[：:\s]*(?:20\d{2}[年/.-]\d{1,2}[月/.-]\d{1,2}日?)/],
  storage:['保存期限與方式',/(?:保存|賞味|有效期限)[^\n。]{0,55}\d+\s*(?:天|日|個?月)[^\n。]{0,25}/],
  quantity:['最低訂購量',/(?:最低|最少|起訂|訂購至少)[^\n。]{0,25}\d+\s*(?:盒|組|份|箱)|\d+\s*盒(?:起訂|以上)/],
  custom:['客製範圍與條件',/(?:客製|卡片|小卡|腰封|LOGO)[^\n。]{0,65}(?:\d+\s*(?:盒|張|元)|免費|另計|洽詢|報價)/i],
  lead:['交期',/(?:交期|出貨|到貨|製作|提前)[^\n。]{0,40}\d+\s*(?:個?工作天|個?營業日|天|日|週)/],
  contact:['詢價方式',/(?:詢價|洽詢|客服|電話|聯絡|訂購專線)[^\n。]{0,35}(?:\r?\n[ \t]*)?(?:0\d[\d \t()-]{6,}|[\w.+-]+@[\w.-]+|https?:\/\/[^\s)]+)|(?:LINE@?|Facebook)[ \t\r\n]{0,10}(?:一對一客服|私訊客服)/i],
  ingredients:['成分資訊',/(?:成分|原料)[：:\s]*[^\n。]{4,100}(?:、|，|,)[^\n。]{1,80}/],
  allergens:['過敏原',/(?:過敏原|過敏)[^\n。]{0,70}(?:奶|乳|蛋|麩質|小麥|堅果|大豆|芝麻)/],
  claim:['宣稱依據與適用品項',/(?:檢驗|認證|標章)[^\n。]{0,90}(?:20\d{2}|報告編號|證書編號|https?:\/\/)/],
  shipping:['運費與免運條件',/(?:運費|免運|配送費)[^\n。]{0,50}\d[\d,]*\s*元|滿\s*\d[\d,]*\s*元[^\n。]{0,20}免運/]
};
const comparable=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/\|/g,' ').replace(/[ \t]+/g,' ');
export function extractPurchaseFields(page={}){
 const raw=pageAnswerText(page),body=comparable(raw.text);
 const images=(page.imageTextSources||[]).filter(r=>r.status==='read'&&r.text&&safe(r.url)&&r.version===IMAGE_READER_VERSION);
 return Object.entries(fields).map(([key,[label,pattern]])=>{
  const find=text=>[...text.matchAll(new RegExp(pattern.source,pattern.flags.replace('g','')+'g'))].find(m=>!/動態欄位未載入|不清楚|無法辨識|未顯示|未提供|推測/.test(m[0])&&(key!=='price'||Number(m[0].replace(/[^\d]/g,''))>0));
  const m=find(body);
  const matches=images.flatMap(source=>{const match=find(comparable(source.text));return match?[{source,match}]:[]});
  if(key==='contact')matches.sort((a,b)=>Number(/0\d[\d \t()-]{6,}/.test(b.match[0]))-Number(/0\d[\d \t()-]{6,}/.test(a.match[0])));
  const image=!m?matches[0]?.source:null,im=!m?matches[0]?.match:null;
  let clue=null;
  if(key==='claim'&&!m&&!im)clue=images.find(s=>/(?:獎|AWARD|認證|標章)/i.test(s.text)&&/20\d{2}|報告編號|證書編號/.test(s.text));
  return {key,label,found:!!m,imageFound:!!im,available:!!(m||im),excerpt:m?m[0]:im?im[0]:clue?clue.text.replace(/【原圖區域[^】]*】/g,'').trim().slice(0,500):'',imageUrl:image?.url||clue?.url||'',origin:m?'網頁文字':im||clue?'圖片辨識':'未讀取到',imageClue:!!(matches.length||clue),imageEvidence:matches.map(({source,match})=>({imageUrl:source.url,excerpt:match[0]})),...(clue?{candidate:true,reviewStatus:'已有獎項線索，適用品項與授予單位待查核'}:{})};
 });
}

export function summarizeImageFields(pages=[],baseline=null){
 const own=baseline?pages.filter(p=>classifySource(p,baseline).scope==='指定品牌'):pages;
 const read=new Set(),useful=new Set(),seen=new Set(),entries=[];
 for(const page of own){
  for(const source of page.imageTextSources||[])if(source.status==='read'&&source.version===IMAGE_READER_VERSION)read.add(source.url);
  for(const field of extractPurchaseFields(page))for(const evidence of field.candidate?[{imageUrl:field.imageUrl,excerpt:field.excerpt}]:(field.imageEvidence||[])){
   useful.add(evidence.imageUrl);const key=JSON.stringify([field.key,evidence.imageUrl,evidence.excerpt]);if(seen.has(key))continue;seen.add(key);
   entries.push({field:field.label,quote:evidence.excerpt,imageUrl:evidence.imageUrl,pageUrl:page.url,...(field.candidate?{candidate:true,reviewStatus:field.reviewStatus}:{})});
  }
 }
 return {readAssets:read.size,usefulAssets:useful.size,fieldCount:entries.length,entries};
}

const themes=[
  {id:'gift',name:'送禮選購',question:'這款禮盒有什麼內容、價格及保存方式？',match:/禮盒|商品|產品|product|category/i,keys:['spec','price','storage','date']},
  {id:'enterprise',name:'企業採購',question:'企業大量訂購的最低盒數、客製條件與交期是什麼？',match:/企業|採購|福委|大量|客製/,keys:['quantity','custom','lead','contact']},
  {id:'ingredients',name:'成分食安',question:'這款商品的成分、過敏原與認證依據是否清楚？',match:/成分|過敏|原料|營養/,keys:['ingredients','allergens','claim','storage']},
  {id:'budget',name:'預算配送',question:'禮盒價格、運費與資訊更新日期是否明確？',match:/價格|售價|NT\$|元|運費|配送|運送/i,keys:['price','shipping','spec','date']}
];

export function assessPurchaseAnswers({pages=[],baseline}={}) {
  if(!baseline)return [];
  const seen=new Set();
  const own=pages.filter(p=>isReadableSource(p)&&safe(p.url)&&classifySource(p,baseline).scope==='指定品牌'&&!seen.has(p.url)&&seen.add(p.url)).map(p=>({...p,...pageAnswerText(p)}));
  return themes.map(theme=>{
    const candidates=own.filter(p=>theme.match.test(p.title||'')||theme.match.test(p.text)||theme.match.test(p.ocrText)||theme.match.test(p.images.join(' ')));
    const evaluated=candidates.map(p=>{
      const all=extractPurchaseFields(p);const checks=theme.keys.map(key=>{const check=all.find(c=>c.key===key);return {...check,imageClue:check.imageClue||(!check.found&&p.images.some(x=>fields[key][1].test(x)))};});
      return {page:p,checks,count:checks.filter(x=>x.available).length,textCount:checks.filter(x=>x.found).length,imageCount:checks.filter(x=>x.imageFound).length};
    }).sort((a,b)=>b.count-a.count||Number(!!b.page.ocrText&&/企業|福委|採購/.test(b.page.title||''))-Number(!!a.page.ocrText&&/企業|福委|採購/.test(a.page.title||''))) ;
    const best=evaluated[0],checks=best?.checks||theme.keys.map(key=>({key,label:fields[key][0],found:false,excerpt:'',imageClue:false}));
    const missing=checks.filter(x=>!x.available).map(x=>x.label),page=best?.page;
    const source=page?{url:page.url,title:page.title||page.url,excerpt:checks.filter(c=>c.available).map(c=>c.excerpt).join('\n').slice(0,1200),retrievedAt:page.retrievedAt||'',origin:page.origin}:null;
    const flags=[...(page?.images.length?['含圖片，圖片資訊另需人工核對']:[]),...(page?.contentTruncated?['正文僅保留部分內容']:[]),...(page?.hasTemplate?['動態欄位未展開']:[]),...(page&&page.origin!=='正文'?['僅有'+page.origin+'，非完整正文']:[])];
    const imagePending=!!page&&page.coverage.pending>0,imageFailed=!!page&&page.coverage.failed>0;
    return {...theme,checks,missing,source,count:best?.count||0,textCount:best?.textCount||0,htmlMissing:checks.filter(c=>!c.found).map(c=>c.label),total:checks.length,flags,imageCount:best?.imageCount||0,imagePending,imageFailed,status:!page?'未收集對應來源':imagePending?'圖片尚未讀完，暫不判定內容缺漏':imageFailed?`圖片處理已結束，${page.coverage.failed} 張失敗待重試；暫不判定內容缺漏`:best?.imageCount?'已有（圖片，可補為網頁文字）':missing.length?'目前樣本未讀到，待查核':'已有',signature:analysisSignature([theme.id,page?.url,page?.text,page?.retrievedAt])};
  });
}

export function purchaseDirections({pages=[],baseline}={}) {
  return assessPurchaseAnswers({pages,baseline}).filter(row=>row.source&&row.htmlMissing.length).sort((a,b)=>Number(b.id==='enterprise')-Number(a.id==='enterprise')||b.missing.length-a.missing.length).slice(0,3).map(row=>{
    const productPage=/\/(?:product|goods|item)[^/]*(?:\.|\/|$)/i.test(new URL(row.source.url).pathname);
    const draftChecks=row.checks.map(c=>({...c,usable:c.found&&(!['spec','price','ingredients','allergens','claim','storage'].includes(c.key)||productPage)}));
    return {
    title:row.name+(row.imagePending||row.imageFailed?'｜先完成圖片查核':row.imageCount?'｜將圖片資訊補為可讀文字':'｜查核可回答的文字'),targetUrl:row.source.url,
    evidence:`此頁 ${row.count} / ${row.total} 欄已有資料（正文 ${row.textCount}、圖片 ${row.imageCount}）；尚未讀到：${row.missing.join('、')||'無'}。僅限已收集樣本。`,
    action:row.imageFailed?'重試此頁失敗的圖片；目前沒有正在讀取的證據，不能將辨識失敗當成官網缺少資料。':row.imagePending?'先完成此頁圖片辨識並核對原圖；尚未讀完，不能據此判定官網缺少資料。':row.imageCount?'原圖已有部分資訊。先逐項核對圖片內容，再於同一頁加入等值文字或表格，避免要求品牌重複提供既有資料。':`在「${row.name}資訊」核對下方待補欄位，再決定是否補充。`,
    draft:[`${baseline.name}｜${row.name}資訊`,...draftChecks.map(c=>`${c.label}：${c.usable?c.excerpt+'（待品牌核對）':c.imageFound?c.excerpt+'（圖片辨識，需對照原圖）':'待查核'}`),...(!row.keys.includes('date')?['資訊更新日期：待補']:[])].join('\n'),
    verify:'發布後重新讀取此頁，確認欄位有可讀文字且與商品相符；匯入發布前後相同期間的搜尋曝光與點擊作參考。',
    pending:draftChecks.filter(c=>!c.usable).map(c=>c.label).join('、'),sources:[row.source],quality:row
  }});
}

export function purchaseQualityPanel({e,pages,baseline,searches=[]}) {
  searches=(Array.isArray(searches)?searches:[]).filter(q=>q&&typeof q.query==='string').slice(-60).map(q=>purchaseSearchRecord({pages:q.readUrls,generatedAt:q.at,search:{provider:q.provider,results:q.resultUrls}},q.query));
  const rows=assessPurchaseAnswers({pages,baseline});
  return `<details class="quiet-details purchase-quality"><summary>官網答案檢查 · ${rows.filter(r=>r.source).length} / 4 類有對應頁面</summary><p class="muted">只檢查同一頁的具體文字線索，不代表內容已完整或通過認證。更新日期不以抓取日期代替。</p>${rows.map(r=>`<div class="purchase-quality-row"><strong>${e(r.name)} · ${r.count}/${r.total}</strong><span>${e(r.status)}</span>${r.source?`<a href="${e(r.source.url)}" target="_blank" rel="noopener noreferrer">${e(r.source.title)} ↗</a><small>${e(r.source.origin)} · 讀取 ${e(r.source.retrievedAt||'時間未記錄')}</small>`:''}<div>${r.checks.map(c=>`<span class="tag ${c.found?'':'gray'}">${c.found?'已有':c.imageFound?'已有（圖片）':'尚未讀到／待查核'}：${e(c.label)}</span>${c.imageUrl?`<a href="${e(c.imageUrl)}" target="_blank" rel="noopener noreferrer">原圖 ↗</a>`:''}`).join(' ')}</div>${r.flags.length?`<small>${e(r.flags.join('；'))}</small>`:''}</div>`).join('')}<details class="quiet-details"><summary>購買問題搜尋紀錄 · ${searches.length} 題</summary><p class="muted">列出實際執行的查詢與回傳來源。</p>${searches.length?searches.slice(-60).map(q=>`<details class="quiet-details"><summary>${e(q.query)} · ${q.readUrls.length} 頁已讀取</summary><small>${e(q.at)} · ${e(q.provider||'搜尋服務')} · ${q.resultUrls.length} 個回傳網址</small><ul>${q.resultUrls.map(url=>`<li><a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(url)}</a>${q.readUrls.includes(url)?' · 已讀取':' · 僅搜尋候選'}</li>`).join('')}</ul></details>`).join(''):'<p class="muted">下次探索後會自動保留逐題來源。</p>'}</details></details>`;
}

export function purchaseSearchRecord(report,query) {
  const urls=values=>[...new Set((Array.isArray(values)?values:[]).map(s=>safe(typeof s==='string'?s:s?.url)).filter(Boolean))].slice(0,60);
  const readUrls=urls(report.pages),resultUrls=urls([...(Array.isArray(report.search?.results)?report.search.results:[]),...readUrls]);
  return {query:clean(query).slice(0,500),at:report.generatedAt||new Date().toISOString(),provider:clean(report.search?.provider).slice(0,100),readUrls,resultUrls};
}
