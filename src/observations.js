import {retrievalPanel} from './retrieval-evidence.js';
// A fixed question bank and reviewed observations. These are measurements of saved
// answers, not estimates of search traffic or the whole AI market.
export const PROMPT_VERSION = 'cookies-v2';
export const PROMPT_TYPES = {unbranded:'未指定品牌',branded:'指定品牌',unknown:'未分類舊紀錄'};
const PHASES = {baseline:'基準測試',after:'改善後測試',unspecified:'未標記階段'};
const SCENARIOS = [
  ['holiday-1','節慶送禮','中秋節送長輩，有哪些台灣糕餅或餅乾禮盒可以比較？請提供推薦理由及來源。','{brand} 有哪些適合中秋送長輩的禮盒？請核對商品與來源，不確定的資訊請註明。'],
  ['holiday-2','節慶送禮','拜訪親友想送常溫保存的烘焙禮盒，有哪些選擇？請比較內容、保存方式與來源。','{brand} 禮盒的保存方式與期限是什麼？請區分商品，提供可查核來源。'],
  ['enterprise-1','企業採購','公司要採購 100 盒員工禮盒，有哪些烘焙品牌可以洽詢？請列出採購條件及來源。','向 {brand} 採購 100 盒企業禮盒，需要確認哪些數量、交期與配送條件？請提供來源。'],
  ['enterprise-2','企業採購','企業禮盒需要客製卡片與多地址配送，有哪些台灣品牌可考慮？請說明已知條件及來源。','{brand} 是否提供客製卡片與多地址配送？請列出已確認條件與待詢問事項。'],
  ['ingredients-1','成分與證據','想找成分標示清楚的餅乾送禮，有哪些品牌可比較？請提供成分、過敏原及來源。','{brand} 曲奇的成分、過敏原與保存資訊是什麼？請註明商品名稱與來源。'],
  ['ingredients-2','成分與證據','選購主打無添加的烘焙禮盒，有哪些品牌可比較？請核對宣稱適用商品與證據。','{brand} 的無添加或潔淨標章宣稱適用哪些商品？請提供年份、適用範圍及證據來源。'],
  ['budget-1','預算與伴手禮','每盒預算 500 元以內，台中有哪些適合送同事的伴手禮？請列價格日期與來源。','{brand} 每盒 500 元以內有哪些送禮選項？請區分原價、優惠與運費，註明來源日期。'],
  ['budget-2','預算與伴手禮','每盒預算 800 至 1,200 元，適合企業客戶的台灣禮盒有哪些？請比較規格及來源。','{brand} 有哪些 800 至 1,200 元的禮盒適合企業客戶？請列規格與可查核來源。'],
  ['holiday-3','節慶送禮','春節拜訪親家，想送包裝正式的台灣糕餅禮盒，有哪些品牌可以比較？請提供品項、訂購資訊與來源。','{brand} 有哪些適合春節拜訪親家的禮盒？請列包裝、品項與訂購來源，未公布的資訊請註明。'],
  ['holiday-4','節慶送禮','中秋送禮不想選傳統月餅，有哪些曲奇或其他烘焙禮盒可替代？請比較送禮理由與來源。','中秋不想送傳統月餅，{brand} 有哪些替代選擇？請核對內容物及供應資訊並附來源。'],
  ['holiday-5','節慶送禮','端午拜訪客戶，除了粽子以外有哪些台灣點心禮盒適合送禮？請說明保存與攜帶條件並附來源。','{brand} 有哪些適合端午拜訪客戶的點心禮盒？請查核保存與攜帶條件並附來源。'],
  ['holiday-6','節慶送禮','母親節想送能與家人分食的餅乾禮盒，有哪些品牌可選？請比較份量、口味與來源。','{brand} 有哪些適合母親節全家分食的餅乾禮盒？請列入數、口味及來源，不推估未標示的份量。'],
  ['holiday-7','節慶送禮','教師節想送小份量、方便分享的糕餅，有哪些品牌可考慮？請提供包裝與內容物來源。','{brand} 有哪些小份量、方便分享的糕餅適合教師節送禮？請核對包裝與內容物來源。'],
  ['holiday-8','節慶送禮','聖誕交換禮物想找有節日包裝的餅乾，有哪些品牌可選？請區分當期販售與過期活動並附來源日期。','{brand} 是否有當期聖誕包裝的餅乾禮盒？請區分現售商品與過去活動，附來源日期。'],
  ['holiday-9','節慶送禮','婚禮回禮想找獨立包裝的台灣烘焙點心，有哪些品牌值得洽詢？請列包裝、訂購條件與來源。','{brand} 是否有適合婚禮回禮的獨立包裝點心？請列已確認的品項、包裝及訂購條件與來源。'],
  ['holiday-10','節慶送禮','中秋節前一週才訂禮盒，有哪些品牌可查詢宅配或門市取貨？請列官方截止日期與來源，不能確認到貨的請註明。','中秋節前一週向 {brand} 訂禮盒，宅配與門市取貨要確認哪些截止日期？請附官方來源，不保證未確認的到貨時間。'],
  ['enterprise-3','企業採購','公司要採購 300 盒客戶禮盒，有哪些烘焙品牌提供大量訂購洽詢管道？請列聯絡方式與已公布條件及來源。','向 {brand} 洽詢 300 盒客戶禮盒，應透過什麼官方管道？請列已公布採購條件與來源。'],
  ['enterprise-4','企業採購','公司採購前希望試吃，有哪些糕餅品牌公布企業試吃辦法？請列申請資格、費用與來源。','{brand} 的企業試吃如何申請？請查核資格、費用及申請期限，未公布的標待詢問並附來源。'],
  ['enterprise-5','企業採購','企業禮盒希望加上公司標誌或訂製腰封，有哪些烘焙品牌可洽詢？請查核最低數量、費用與來源。','{brand} 是否提供公司標誌或客製腰封？請查核最低數量、費用與製作時間並附來源。'],
  ['enterprise-6','企業採購','公司採購糕餅需要統編發票與報價單，有哪些品牌有清楚的企業訂購流程？請列流程與來源。','向 {brand} 企業採購時，報價單、統編發票及付款方式如何辦理？請以官方說明為準並附來源。'],
  ['enterprise-7','企業採購','公司要將禮盒分兩批送到不同辦公室，有哪些烘焙品牌可詢問分批出貨？請比較公開配送條件與來源。','{brand} 是否接受分批出貨到不同辦公室？請列可確認的配送條件、運費及待詢問項目與來源。'],
  ['enterprise-8','企業採購','企業員工禮盒需要混合不同口味，有哪些品牌公布可選品項及訂購方式？請列規格與來源。','向 {brand} 大量訂購是否可以混搭口味或品項？請區分固定組合與可客製內容並附來源。'],
  ['enterprise-9','企業採購','企業大量訂購糕餅後若遇缺貨或破損，有哪些品牌公開處理辦法？請比較政策與來源，不自行推定補償。','{brand} 企業訂單若遇缺貨、配送破損或需要修改數量，如何處理？請列官方政策及待確認事項與來源。'],
  ['enterprise-10','企業採購','中秋企業採購有哪些品牌公布早鳥優惠及訂購截止日？請列活動適用條件、年份與來源。','{brand} 目前有哪些企業採購早鳥優惠？請核對活動年份、數量門檻、適用品項與截止日並附來源。'],
  ['ingredients-3','成分與證據','想挑選清楚標示奶素或蛋奶素的餅乾禮盒，有哪些品牌可比較？請依商品標示列出來源。','{brand} 哪些商品標示奶素或蛋奶素？請逐項列官方成分或素食標示來源，不由品牌名稱推定。'],
  ['ingredients-4','成分與證據','替有堅果過敏需求的親友選餅乾，有哪些品牌公開過敏原及共線生產資訊？請列資訊來源，缺資料時不要判定可安全食用。','{brand} 哪些商品公開堅果過敏原及共線生產資訊？請提供來源；未提供時請標未知，不判定可安全食用。'],
  ['ingredients-5','成分與證據','想比較烘焙禮盒的糖與鈉含量，有哪些品牌提供完整營養標示？請統一以每 100 公克比較並附來源，無法換算的註明。','{brand} 曲奇有哪些可查核的營養標示？請列每 100 公克糖與鈉含量及來源，沒有資料不要估算。'],
  ['ingredients-6','成分與證據','選購主打奶油香氣的曲奇，有哪些品牌公開使用油脂與原料資訊？請區分成分標示及宣傳文字並附來源。','{brand} 曲奇使用哪些油脂與主要原料？請區分正式成分標示與宣傳文字，提供來源。'],
  ['ingredients-7','成分與證據','想找公開保存期限及開封後保存方法的糕餅禮盒，有哪些品牌資訊較完整？請列具體商品與來源。','{brand} 各款禮盒的未開封期限、開封後保存方法及溫度要求是什麼？請逐品項查核來源。'],
  ['ingredients-8','成分與證據','哪些糕餅品牌公開食品檢驗報告供消費者查核？請列報告日期、受測品項、檢測項目與來源，不將單項檢驗當成全面認證。','{brand} 有哪些公開檢驗報告？請列日期、受測品項、檢測項目與原始來源，不擴大解讀適用範圍。'],
  ['ingredients-9','成分與證據','選購強調台灣原料的糕餅，有哪些品牌提供可查核的原料產地資訊？請列品項、原料及來源。','{brand} 哪些商品有公開原料產地資訊？請列品項、原料與來源，未揭露的不要推定為台灣產。'],
  ['ingredients-10','成分與證據','哪些糕餅品牌的獲獎資訊可以查到主辦單位或得獎名單？請列年份、獎項及適用品項，區分品牌自述與第三方來源。','{brand} 公開的獲獎資訊有哪些可查核依據？請列年份、獎項、適用品項及主辦單位來源，查不到的標待確認。'],
  ['budget-3','預算與伴手禮','每份預算 300 元以內，想帶台中糕餅當辦公室伴手禮，有哪些選擇？請列份量、價格日期與來源。','{brand} 每份 300 元以內有哪些伴手禮？請列入數、價格日期與來源，不把超出預算的商品列入。'],
  ['budget-4','預算與伴手禮','每盒預算 500 至 800 元，想送台灣曲奇禮盒，有哪些品牌可比較？請列內容物、價格及來源日期。','{brand} 每盒 500 至 800 元有哪些曲奇禮盒？請列內容物、價格及來源日期。'],
  ['budget-5','預算與伴手禮','總預算 2,000 元含運費，要買 4 份糕餅禮物，有哪些品牌組合可比較？請列可核對計算與來源，運費不明時註明。','向 {brand} 買 4 份禮物，總預算 2,000 元含運費，有哪些已知組合？請附計算及來源，運費未知不宣稱符合預算。'],
  ['budget-6','預算與伴手禮','想買餅乾給 20 位同事分享，有哪些品牌可比較每人份量及單片成本？請列入數、售價與來源，不猜測未標示的片數。','{brand} 有哪些商品適合 20 位同事分享？請依官方入數與價格比較份量及單片成本，附來源。'],
  ['budget-7','預算與伴手禮','去台中一日遊想在門市買糕餅伴手禮，有哪些品牌可選？請比較公開門市地點、營業時間、價格與來源。','{brand} 在台中有哪些可購買伴手禮的門市？請列地址、營業時間、可查核商品價格與來源。'],
  ['budget-8','預算與伴手禮','要帶台灣糕餅搭飛機送朋友，有哪些常溫、方便攜帶的禮盒可比較？請列重量、包裝與來源，入境限制另標需查目的地規定。','{brand} 有哪些常溫且方便攜帶的禮盒？請列重量、包裝及保存來源，不將常溫保存等同可以攜入所有國家。'],
  ['budget-9','預算與伴手禮','同樣預算 600 元，曲奇禮盒與鳳梨酥禮盒有哪些品牌可比較？請列份量、保存期限及價格來源，不將不同規格直接當便宜或昂貴。','預算 600 元時，{brand} 的不同糕餅禮盒怎麼選？請依已公布的品項比較份量、保存期限與價格並附來源。'],
  ['budget-10','預算與伴手禮','想買免運門檻較適合小量送禮的糕餅，有哪些品牌可以比較？請列原價、優惠條件、運費與日期來源。','小量購買 {brand} 禮盒的運費與免運門檻是多少？請區分常態規則和限時活動，列適用地區及日期來源。'],
];
const text = (value,max=2000) => String(value??'').trim().slice(0,max);
const finite = value => value!==''&&value!==null&&value!==undefined&&Number.isFinite(Number(value));
const safeUrl = value => {try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}};
const htmlEscape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function tri(value,label,{form=false}={}) {
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='boolean')return value;
  if(form&&['true','false'].includes(value))return value==='true';
  throw Error(`${label} 必須是已確認的「是／否」，未查核請留空。`);
}
export function observationPrompts(brandName='鴻鼎菓子') {
  const scenarios=[...SCENARIOS,['baby-gift-1','彌月禮','我想挑台灣烘焙品牌的彌月禮盒，每盒預算 500 元，希望能常溫保存、可以先試吃。有哪些選擇？請比較禮盒內容、價格、保存期限與試吃條件，附上可查核的來源。找不到的資訊請標示待確認。','{brand} 有哪些每盒 500 元以內、可常溫保存的彌月禮盒？請查核內容、價格、保存期限及試吃條件，附來源並標記待確認資訊。']];
  return ['unbranded','branded'].flatMap(type=>scenarios.map(([id,scenario,unbranded,branded])=>({id:`${type}-${id}`,version:PROMPT_VERSION,type,scenario,query:(type==='branded'?branded:unbranded).replaceAll('{brand}',text(brandName,120))})));
}
function urlsFrom(value) {
  const values=Array.isArray(value)?value:String(value??'').split(/\r?\n/);
  if(values.length>12)throw Error('每筆觀測最多記錄 12 個引用網址。');
  return [...new Set(values.map(v=>typeof v==='object'?v?.url:v).map(v=>text(v,2048)).filter(Boolean).map(value=>{const url=safeUrl(value);if(!url)throw Error('引用或查核網址請使用有效的 http/https 網址。');return url}))];
}
function competitorsFrom(value) {
  const rows=Array.isArray(value)?value:String(value??'').split(/\r?\n/).filter(s=>s.trim()).map(line=>{const [name,kind,reason,...url]=line.split('|').map(s=>s.trim());return {name,kind,reason,url:url.join('|')}});
  if(rows.length>12)throw Error('每筆回答最多記錄 12 個競品或引用來源。');
  return rows.map(row=>{if(!row||!text(row.name,120)||!['目前競品','替代競品','引用來源'].includes(row.kind))throw Error('競爭來源請填「名稱 | 目前競品、替代競品或引用來源 | 回答中的理由 | 網址（選填）」。');const url=row.url?safeUrl(row.url):'';if(row.url&&!url)throw Error('競爭來源網址無效。');return {name:text(row.name,120),kind:row.kind,reason:text(row.reason,500),url}});
}
/** Extra fields only: legacy datasets retain their existing core normalizer. */
export function normalizeObservationMetadata(row={}) {
  const promptType=Object.hasOwn(PROMPT_TYPES,row.promptType)?row.promptType:'unknown';
  if(row.promptType&&!Object.hasOwn(PROMPT_TYPES,row.promptType))throw Error('觀測提問類型無效。');
  const round=finite(row.round)?Number(row.round):null;
  if(row.round!==''&&row.round!==null&&row.round!==undefined&&round===null)throw Error('重複測試輪次須為有效整數。');
  if(round!==null&&(!Number.isInteger(round)||round<1||round>100))throw Error('重複測試輪次須為 1 至 100 的整數。');
  const minutes=finite(row.minutes)?Number(row.minutes):null;
  if(row.minutes!==''&&row.minutes!==null&&row.minutes!==undefined&&minutes===null)throw Error('整理時間須為有效分鐘數。');
  if(minutes!==null&&(minutes<0||minutes>1440))throw Error('整理時間須介於 0 至 1,440 分鐘。');
  const informationCorrect=tri(row.informationCorrect,'資訊正確性');
  const accuracyEvidence=row.accuracyEvidence?safeUrl(row.accuracyEvidence):'';
  if(row.accuracyEvidence&&!accuracyEvidence)throw Error('資訊查核依據請填有效網址。');
  return {experimentId:text(row.experimentId,100),testArm:['target','control'].includes(row.testArm)?row.testArm:'',contentVersion:text(row.contentVersion,80),promptId:text(row.promptId,100),promptVersion:text(row.promptVersion,80),promptType,scenario:text(row.scenario,100),model:text(row.model,160),round,phase:Object.hasOwn(PHASES,row.phase)?row.phase:'unspecified',conditions:text(row.conditions,1000),webMode:['enabled','disabled'].includes(row.webMode)?row.webMode:'unknown',newConversation:tri(row.newConversation,'全新對話'),informationCorrect,accuracyNotes:text(row.accuracyNotes,2000),accuracyEvidence,citations:urlsFrom(row.citations||[]),competitors:competitorsFrom(row.competitors||[]),minutes,sampledAt:text(row.sampledAt,50)};
}
/** Raw values may come from Object.fromEntries(new FormData(form)). */
export function normalizeObservationInput(raw,brand) {
  const query=text(raw.query,1000),answer=text(raw.answer,20000),platform=text(raw.platform,200);
  if(!query||!answer||!platform)throw Error('請填寫題目、平台及原始回答。');
  const selectedPrompt=observationPrompts(brand?.name).find(p=>p.id===raw.promptId);
  if(raw.promptId&&!selectedPrompt)throw Error('請選擇有效的固定題庫題目。');
  // Edited questions are retained as custom records, never counted as the
  // original fixed question/version in repeatable experiments.
  const modified=!!selectedPrompt&&query!==selectedPrompt.query,prompt=modified?null:selectedPrompt;
  const promptType=prompt?.type||raw.promptType||selectedPrompt?.type;
  if(!['unbranded','branded'].includes(promptType))throw Error('請標記「未指定品牌」或「指定品牌」。');
  const brandName=text(brand?.name,120);
  if(promptType==='unbranded'&&brandName&&query.includes(brandName))throw Error('未指定品牌題目不可包含指定品牌名稱，請改選提問類型。');
  if(promptType==='branded'&&brandName&&!query.includes(brandName))throw Error('指定品牌題目須包含目前品牌名稱。');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw.date||'')||!Number.isFinite(Date.parse(raw.date))||new Date(raw.date).toISOString().slice(0,10)!==raw.date)throw Error('請填有效觀測日期。');
  const citedUrl=raw.citedUrl?safeUrl(raw.citedUrl):null;
  if(raw.citedUrl&&!citedUrl)throw Error('引用網址無效。');
  const metadata=normalizeObservationMetadata({...raw,promptId:prompt?.id||'',promptType,promptVersion:modified?'custom-v1':prompt?.version||text(raw.promptVersion,80)||'custom-v1',scenario:prompt?.scenario||raw.scenario,newConversation:tri(raw.newConversation,'全新對話',{form:true}),informationCorrect:tri(raw.informationCorrect,'資訊正確性',{form:true}),round:raw.round||1,phase:raw.phase||'baseline'});
  if(metadata.informationCorrect!==null&&(!metadata.accuracyEvidence||!metadata.accuracyNotes))throw Error('判定資訊正確性前，請填寫查核依據網址與說明。');
  const source=/OpenAI API|Gemini API|OpenClaw API|本地 Ollama/.test(platform)&&(!raw.source||raw.source==='manual')?'manual_api':text(raw.source,80)||'manual';
  return {...metadata,id:text(raw.id,100),date:raw.date,platform,query,answer,source,brandMentioned:tri(raw.brandMentioned,'品牌提及',{form:true}),recommended:tri(raw.recommended,'品牌推薦',{form:true}),citedUrl,citationChecked:tri(raw.citationChecked,'引用查核',{form:true}),citations:urlsFrom([...(citedUrl?[citedUrl]:[]),...metadata.citations])};
}
export function observationMethod(row) {
  if(row.source==='external_web')return 'external';
  if(/codex/i.test(row.source||'')||/codex/i.test(row.platform||''))return 'codex';
  return /(?:^|_)api$/.test(row.source||'')||/ API|Ollama|OpenClaw/.test(row.platform||'')?'api':'manual';
}
export function observationPlatformKey(row) {return JSON.stringify([observationMethod(row),text(row.platform,200),text(row.model,160)]);}
export function officialCitation(url,brand) {
  try{const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');return [brand.domain,...(brand.domains||[])].some(value=>{const own=new URL(value).hostname.toLowerCase().replace(/^www\./,'');return host===own||host.endsWith('.'+own)})}catch{return false}
}
function rowUrls(row) {return [...new Set([row.citedUrl,...(Array.isArray(row.citations)?row.citations:[])].map(v=>typeof v==='object'?v?.url:v).map(safeUrl).filter(Boolean))];}
function hasAccuracyEvidence(row){return !!safeUrl(row.accuracyEvidence)&&!!text(row.accuracyNotes,2000)}
function accuracyLabel(row){return typeof row.informationCorrect!=='boolean'?'尚未查核':!hasAccuracyEvidence(row)?'待補查核依據':row.informationCorrect?'正確':'有錯誤'}
function metric(rows,field,test) {const reviewed=rows.filter(row=>test?row.citationChecked===true:typeof row[field]==='boolean'&&(field!=='informationCorrect'||hasAccuracyEvidence(row))),yes=reviewed.filter(row=>test?test(row):row[field]===true).length;return {yes,reviewed:reviewed.length,percent:reviewed.length?Math.round(1000*yes/reviewed.length)/10:null};}
export function observationSummary(rows=[],brand,filters={}) {
  const candidates=rows.filter(row=>row.source!=='demo'&&!['failed','cancelled','pending'].includes(row.status)&&text(row.answer,20000));
  // Identical imported IDs count once; conflicting copies are excluded pending review.
  const counts=new Map(),conflicts=new Set();
  for(const row of candidates){if(!row.id)continue;const old=counts.get(row.id);if(old&&JSON.stringify(old)!==JSON.stringify(row))conflicts.add(row.id);else counts.set(row.id,row)}
  const seen=new Set();const usable=candidates.filter(row=>{if(!row.id)return true;if(conflicts.has(row.id)||seen.has(row.id))return false;seen.add(row.id);return true});
  const groups=[...new Map(usable.map(row=>{const key=observationPlatformKey(row);return [key,{key,platform:row.platform,model:row.model||'',method:observationMethod(row)}]})).values()];
  const promptType=Object.hasOwn(PROMPT_TYPES,filters.promptType)?filters.promptType:'unbranded';
  const phase=Object.hasOwn(PHASES,filters.phase)?filters.phase:'baseline';
  const platformKey=groups.some(g=>g.key===filters.platformKey)?filters.platformKey:groups[0]?.key||observationPlatformKey({platform:'人工觀測 / ChatGPT',source:'manual'});
  const scope=usable.filter(row=>(row.promptType||'unknown')===promptType&&(row.phase||'unspecified')===phase&&observationPlatformKey(row)===platformKey);
  const versions=[...new Set(scope.map(row=>row.promptVersion||'unknown'))];
  const promptVersion=text(filters.promptVersion,80)||versions[0]||PROMPT_VERSION;
  if(!versions.includes(promptVersion))versions.unshift(promptVersion);
  const webMode=['enabled','disabled','unknown'].includes(filters.webMode)?filters.webMode:scope.find(row=>(row.promptVersion||'unknown')===promptVersion)?.webMode||'unknown';
  const selected=scope.filter(row=>(row.promptVersion||'unknown')===promptVersion&&(row.webMode||'unknown')===webMode);
  const mention=metric(selected,'brandMentioned'),recommendation=metric(selected,'recommended'),citation=metric(selected,null,row=>rowUrls(row).some(url=>officialCitation(url,brand))),accuracy=metric(selected,'informationCorrect');
  const sources=new Map(),competitors=[];
  for(const row of selected){if(row.citationChecked===true)for(const url of rowUrls(row)){const old=sources.get(url)||{url,count:0,official:officialCitation(url,brand)};old.count++;sources.set(url,old)}for(const competitor of row.competitors||[])competitors.push({...competitor,observationId:row.id,query:row.query,date:row.date})}
  const timed=selected.filter(row=>typeof row.minutes==='number'&&Number.isFinite(row.minutes));
  return {filters:{promptType,phase,platformKey,promptVersion,webMode},versions,groups,rows:selected,total:selected.length,allTotal:usable.length,legacyCount:usable.filter(row=>!['unbranded','branded'].includes(row.promptType)).length,mention,recommendation,citation,accuracy,citationSources:[...sources.values()].sort((a,b)=>b.count-a.count),competitors,minutes:timed.length?{total:timed.reduce((sum,row)=>sum+row.minutes,0),samples:timed.length}:null};
}
export function observationContext(rows=[],brand) {
  const groups=[...new Map(rows.filter(row=>row.source!=='demo'&&row.answer?.trim()&&['unbranded','branded'].includes(row.promptType)).map(row=>[JSON.stringify([row.promptType,row.phase,observationPlatformKey(row),row.promptVersion||'unknown',row.webMode||'unknown']),{promptType:row.promptType,phase:row.phase||'unspecified',platformKey:observationPlatformKey(row),promptVersion:row.promptVersion||'unknown',webMode:row.webMode||'unknown'}])).values()];
  return {notice:'只統計已保存並人工查核的回答。未指定品牌觀察自然出現；指定品牌檢查資訊理解；平台網頁人工觀測與 API/本地採樣分開。不同題庫、模型、搜尋模式、輪次及條件不可直接作因果比較。',groups:groups.slice(-12).map(filter=>{const s=observationSummary(rows,brand,filter);return {...filter,samples:s.total,mention:s.mention,recommendation:s.recommendation,citation:s.citation,accuracy:s.accuracy,citationSources:s.citationSources.slice(0,3),competitors:s.competitors.slice(0,3)}})};
}
const selectOptions = (rows,selected,e) => rows.map(([value,label])=>`<option value="${e(value)}" ${value===selected?'selected':''}>${e(label)}</option>`).join('');
const triSelect=(id,name,label,e)=>`<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${name}">${selectOptions([['','尚未查核'],['true','是'],['false','否']],'',e)}</select></div>`;
function recordChecks(row,brand) {
  const citation=row.citationChecked===true?rowUrls(row).some(url=>officialCitation(url,brand)):null;
  return [['提及',row.brandMentioned],['推薦',row.recommended],['官網引用',citation]].map(([label,value])=>`<span class="tag${value===true?'':value===false?' gray':' amber'}">${label}：${typeof value==='boolean'?(value?'是':'否'):'待查核'}</span>`).join(' ');
}
export function observationWorkspace({e=htmlEscape,icon=()=>'',dataset,filters={},provider='所選模型',ready=false,workflowFields='',showEntry=false}) {
  const s=observationSummary(dataset.observations,dataset.brand,filters),bank=observationPrompts(dataset.brand.name),today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
  const groups=s.groups.length?s.groups:[{key:s.filters.platformKey,platform:showEntry?'人工觀測 / ChatGPT':'尚無 AI 網頁實測',model:'',method:showEntry?'manual':'external'}];
  const stats=[...(s.filters.promptType==='unbranded'?[['主動品牌提及率',s.mention],['主動品牌推薦率',s.recommendation]]:[]),['官網引用率',s.citation],['品牌資訊正確率',s.accuracy]];
  return `<div class="home-intro"><h1>AI 題庫與紀錄</h1><div class="toolbar"><button class="btn small" data-observation-audit>健檢</button><button class="btn small" data-nav="improvements">查看內容改善與前後測</button></div></div>
  <div class="form-grid observation-primary-filters"><div class="field"><label for="obs-filter-type">提問類型</label><select id="obs-filter-type">${selectOptions(Object.entries(PROMPT_TYPES),s.filters.promptType,e)}</select></div><div class="field"><label for="obs-filter-platform">平台與模型</label><select id="obs-filter-platform">${selectOptions(groups.map(g=>[g.key,`${g.platform}${g.model?' · '+g.model:''} · ${g.method==='api'?'API／本地採樣':g.method==='external'?'網頁實測':'平台人工觀測'}`]),s.filters.platformKey,e)}</select></div></div>
  <details class="quiet-details" id="observation-filter-conditions"><summary>測試條件 · ${e(PHASES[s.filters.phase])} · ${e(s.filters.promptVersion==='unknown'?'版本未記錄':s.filters.promptVersion)} · ${{unknown:'搜尋未記錄',enabled:'搜尋開啟',disabled:'搜尋關閉'}[s.filters.webMode]}</summary><div class="toolbar observation-filters"><div class="field"><label for="obs-filter-phase">測試階段</label><select id="obs-filter-phase">${selectOptions(Object.entries(PHASES),s.filters.phase,e)}</select></div><div class="field"><label for="obs-filter-version">題目版本</label><select id="obs-filter-version">${selectOptions(s.versions.map(version=>[version,version==='unknown'?'版本未記錄':version]),s.filters.promptVersion,e)}</select></div><div class="field"><label for="obs-filter-webmode">平台網路搜尋</label><select id="obs-filter-webmode">${selectOptions([['unknown','未記錄'],['enabled','已開啟'],['disabled','未開啟']],s.filters.webMode,e)}</select></div></div></details>
  <div class="home-summary observation-summary">${stats.map(([label,m])=>`<div class="summary-item"><small>${label}</small><strong>${m.percent===null?'—':m.percent+'%'}</strong><small>${m.reviewed?`${m.yes} / ${m.reviewed} 筆已查核回答`:'待建立基準'}</small></div>`).join('')}</div><p class="muted">此範圍 ${s.total} 筆回答；比例＝提及的已查核回答 ÷ 已查核回答，每筆最多計一次。未查核、失敗及衝突 ID 不列入分母，同 ID 重複匯入只計一次。${s.legacyCount?`${s.legacyCount} 筆舊紀錄尚未標記提問類型。`:''}${s.minutes?` 已記錄整理時間 ${s.minutes.total} 分鐘（${s.minutes.samples} 筆）。`:''}</p>
  ${retrievalPanel({e,dataset})}<details class="quiet-details"><summary>題庫與測試方法 · ${bank.length} 題</summary><p>${PROMPT_VERSION}：既有題庫涵蓋送禮、採購、成分與預算，另提供彌月禮情境的兩種問法。前後測固定題目、平台、模型與搜尋模式，使用全新對話重複測試。</p><p>API／本地採樣與平台網頁結果分開記錄；內部測試不代表外部推薦率提升。</p><div class="toolbar"><button type="button" class="btn small" data-action="export-prompt-bank">${icon('down')}匯出題庫</button><button type="button" class="btn small" data-action="export-observations">${icon('down')}匯出紀錄</button></div></details>
  ${showEntry?`<section class="card observation-entry"><div class="card-head"><h2>建立一筆觀測</h2><span class="tag gray">人工查核</span></div><div class="panel-body"><form id="observation-form">${workflowFields}
  <div class="field"><label for="obs-prompt">固定題庫 · ${bank.length} 題</label><select id="obs-prompt" name="promptId"><option value="">選擇題目，或自行輸入</option>${[...new Set(bank.map(p=>p.scenario))].map(scenario=>['unbranded','branded'].map(type=>`<optgroup label="${e(scenario+' · '+PROMPT_TYPES[type])}">${bank.filter(p=>p.scenario===scenario&&p.type===type).map(p=>`<option value="${e(p.id)}">${e(p.id.split('-').at(-1)+'. '+p.query)}</option>`).join('')}</optgroup>`).join('')).join('')}</select></div><div class="form-grid"><div class="field"><label for="obs-type">提問類型</label><select id="obs-type" name="promptType">${selectOptions([['unbranded','未指定品牌：自然出現'],['branded','指定品牌：資訊理解']],'unbranded',e)}</select></div><div class="field"><label for="obs-platform">平台</label><select id="obs-platform" name="platform">${selectOptions(['人工觀測 / ChatGPT','人工觀測 / Gemini','OpenAI API','Gemini API','OpenClaw API','本地 Ollama'].map(x=>[x,x]),'人工觀測 / ChatGPT',e)}</select></div></div>
  <div class="field"><label for="obs-query">觀測問題</label><textarea id="obs-query" name="query" required maxlength="1000" placeholder="選擇固定題庫，或輸入完整問題。"></textarea></div><div class="field"><label for="obs-answer">原始回答</label><textarea id="obs-answer" name="answer" required maxlength="20000" placeholder="貼上平台完整回答，再逐項查核。"></textarea></div>
  <div class="form-grid">${triSelect('obs-mention','brandMentioned','有提及指定品牌',e)}${triSelect('obs-recommend','recommended','有推薦指定品牌',e)}</div><div class="form-grid"><div class="field"><label for="obs-citation-checked">引用查核</label><select id="obs-citation-checked" name="citationChecked"><option value="">尚未查核</option><option value="true">已查核（無引用也算）</option></select></div>${triSelect('obs-correct','informationCorrect','品牌資訊正確',e)}</div>
  <div class="field"><label for="obs-url">引用網址（選填）</label><input id="obs-url" name="citedUrl" type="url" maxlength="2048" placeholder="https://…"><small>官網引用依網域判定。</small></div>
  <details class="quiet-details"><summary>查核依據與其他引用</summary><div class="field"><label for="obs-evidence">資訊正確性查核依據</label><input id="obs-evidence" name="accuracyEvidence" type="url" maxlength="2048" placeholder="核對的官網或原始資料網址"></div><div class="field"><label for="obs-accuracy-notes">查核說明</label><textarea id="obs-accuracy-notes" name="accuracyNotes" maxlength="2000" placeholder="哪些商品、成分、價格或服務資訊已確認／有錯誤？"></textarea></div><div class="field"><label for="obs-citations">其他引用網址</label><textarea id="obs-citations" name="citations" maxlength="20000" placeholder="每行一個網址，最多 12 個"></textarea></div><div class="field"><label for="obs-competitors">回答實際出現的競品與引用來源</label><textarea id="obs-competitors" name="competitors" maxlength="10000" placeholder="名稱 | 目前競品 | 回答中的推薦理由 | 引用網址（選填）"></textarea><small>分類只保留目前競品、替代競品、引用來源；照原始回答記錄。</small></div></details>
  <details class="quiet-details" id="observation-conditions"><summary>日期與測試條件 · 預設今日／基準測試</summary><div class="form-grid"><div class="field"><label for="obs-date">觀測日期</label><input type="date" id="obs-date" name="date" value="${today}" required></div><div class="field"><label for="obs-phase">測試階段</label><select id="obs-phase" name="phase">${selectOptions([['baseline','基準測試'],['after','改善後測試']],'baseline',e)}</select></div><div class="field"><label for="obs-model">平台顯示的模型</label><input id="obs-model" name="model" maxlength="160" placeholder="未顯示可留空"></div><div class="field"><label for="obs-round">重複測試輪次</label><input type="number" id="obs-round" name="round" min="1" max="100" step="1" value="1" required></div><div class="field"><label for="obs-web-mode">平台網路搜尋</label><select id="obs-web-mode" name="webMode">${selectOptions([['unknown','未記錄'],['enabled','已開啟'],['disabled','未開啟']],'unknown',e)}</select></div>${triSelect('obs-new-conversation','newConversation','使用全新對話',e)}<div class="field"><label for="obs-version">題目版本</label><input id="obs-version" name="promptVersion" value="custom-v1" maxlength="80"></div><div class="field"><label for="obs-minutes">人工整理分鐘數（選填）</label><input type="number" id="obs-minutes" name="minutes" min="0" max="1440" step="0.1"></div></div><input type="hidden" id="obs-scenario" name="scenario"><div class="field"><label for="obs-conditions">其他固定條件</label><input id="obs-conditions" name="conditions" maxlength="1000" placeholder="例如繁體中文、台灣地區、相同登入狀態、原始／優化頁面版本"></div></details>
  <div class="toolbar"><button class="btn primary" type="submit">${icon('check')}保存觀測</button><button type="button" class="btn" data-action="calculate-observation">模型自動判讀</button></div><p class="muted">貼上回答可直接判讀。回答留空時，使用目前模型採樣，並與外部平台紀錄分開統計。</p><p id="sample-status" class="inline-message" role="status"></p><p class="muted">API 結果與平台網頁版分開統計。紀錄存於此瀏覽器，可匯出備份。</p></form></div></section>`:''}
  <section class="card observation-records"><div class="card-head"><h2>觀測紀錄</h2><span>${s.total} 筆</span></div><div class="panel-body">${s.rows.length?s.rows.slice().reverse().slice(0,20).map(row=>`<details class="source-item"><summary><div><strong>${e(row.query)}</strong><small>${row.experimentId?e(row.testArm==='control'?'對照組':'改善組')+' · '+e(row.contentVersion)+' · ':''}${e(row.date)} · 第 ${e(row.round??'—')} 輪 · ${e(row.promptVersion||'版本未記錄')}</small><span class="toolbar observation-checks">${recordChecks(row,dataset.brand)}</span></div></summary><div><p class="observation-answer">${e(row.answer)}</p><p class="muted">${e(row.conditions||'其他條件未記錄')}</p><p>資訊查核：${accuracyLabel(row)}${row.accuracyNotes?' · '+e(row.accuracyNotes):''}</p>${row.accuracyEvidence?`<a href="${e(safeUrl(row.accuracyEvidence))}" target="_blank" rel="noopener noreferrer">查核依據 ↗</a>`:''}<div class="kw-source-links">${rowUrls(row).map((url,i)=>`<a href="${e(url)}" target="_blank" rel="noopener noreferrer">引用 ${i+1} ↗</a>`).join('')}</div></div></details>`).join(''):'<div class="empty"><h3>待建立基準</h3><p>選題 → 貼上回答 → 查核並保存。</p><small>蒐集網頁不會自動產生 AI 推薦率。</small></div>'}</div></section>
  ${s.competitors.length?`<details class="quiet-details"><summary>回答中的競品與引用來源 · ${s.competitors.length} 筆</summary>${['目前競品','替代競品','引用來源'].map(kind=>`<h3>${kind}</h3>${s.competitors.filter(row=>row.kind===kind).map(row=>`<p><strong>${e(row.name)}</strong> · ${e(row.reason||'未記錄推薦理由')}${row.url?` <a href="${e(safeUrl(row.url))}" target="_blank" rel="noopener noreferrer">來源 ↗</a>`:''}<small>（${e(row.date)}）</small></p>`).join('')||'<p class="muted">尚未記錄</p>'}`).join('')}</details>`:''}
  ${s.citationSources.length?`<details class="quiet-details"><summary>已查核引用來源分布</summary>${s.citationSources.map(row=>`<p><a href="${e(row.url)}" target="_blank" rel="noopener noreferrer">${e(row.url)}</a> · ${row.count} 筆回答 · ${row.official?'品牌官網':'外部來源'}</p>`).join('')}</details>`:''}`;
}

export function applyObservationPrompt(form,promptId,brandName) {
  const prompt=observationPrompts(brandName).find(p=>p.id===promptId);
  if(!prompt){form.querySelector('#obs-version').value='custom-v1';form.querySelector('#obs-scenario').value='';return null}
  for(const [id,value] of [['obs-query',prompt.query],['obs-type',prompt.type],['obs-version',prompt.version],['obs-scenario',prompt.scenario]])form.querySelector('#'+id).value=value;
  return prompt;
}
