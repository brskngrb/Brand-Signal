import {observationPrompts, PROMPT_VERSION, observationMethod, officialCitation} from './observations.js';
import {classifySource, isReadableSource} from './source-baseline.js';
import {analysisSignature} from './analysis.js';

const clean=(v,n=2000)=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,n);
export const workflowUrl=value=>{try{const u=new URL(value);u.hash='';return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!/[?&](?:token|api_key|secret|password)=/i.test(u.search)?u.href:''}catch{return ''}};
const day=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export const emptyWorkflow=()=>({version:1,reviews:{},packs:[],experiments:[]});
export function workflowState(value){return {version:1,reviews:value?.reviews&&typeof value.reviews==='object'&&!Array.isArray(value.reviews)?value.reviews:{},packs:Array.isArray(value?.packs)?value.packs.slice(0,100):[],experiments:Array.isArray(value?.experiments)?value.experiments.slice(0,100):[]};}

function requirements(prompt){
  const q=prompt.query;
  const fields=[];
  const add=(label,pattern)=>{if(!fields.some(f=>f.label===label))fields.push({label,pattern});};
  if(/預算|售價|價格|成本|元|原價/.test(q))add('售價與更新日期',/售價|價格|NT\$|\d[\d,]*\s*元/i);
  if(/運費|免運|含運/.test(q))add('運費與適用條件',/運費|免運|配送費/);
  if(/成分|原料|油脂|奶油/.test(q))add('商品成分與原料',/成分|原料|奶油|油脂/);
  if(/過敏|堅果|共線/.test(q))add('過敏原與共線資訊',/過敏原|過敏|共線|同.*產線/);
  if(/素食|奶素|蛋奶素/.test(q))add('素食標示與品項',/奶素|蛋奶素|全素|素食/);
  if(/營養|糖|鈉/.test(q))add('營養標示與單位',/營養|每\s*100|糖|鈉/);
  if(/無添加|潔淨|宣稱/.test(q))add('宣稱適用品項與依據',/無添加|潔淨|標章|檢驗/);
  if(/獎|檢驗|報告|認證/.test(q))add('年份、適用品項與原始依據',/檢驗|報告|獲獎|得獎|授予|認證/);
  if(/產地|台灣原料/.test(q))add('原料產地與來源',/產地|產自|原產|台灣.*原料/);
  if(/保存|常溫|攜帶|飛機/.test(q))add('保存條件與期限',/保存|有效期限|賞味|常溫|冷藏/);
  if(/交期|出貨|到貨|截止|一週|分批/.test(q))add('交期或訂購截止日',/交期|出貨|到貨|截止|工作天|營業日/);
  if(/客製|標誌|腰封|卡片/.test(q))add('客製範圍與條件',/客製|標誌|腰封|卡片/);
  if(/試吃/.test(q))add('試吃資格與費用',/試吃|申請|費用/);
  if(/發票|報價|付款/.test(q))add('報價、付款與發票辦法',/發票|報價|付款|匯款/);
  if(/破損|缺貨|修改數量/.test(q))add('異常訂單處理政策',/破損|缺貨|退換|取消|修改訂單/);
  if(/門市|取貨|營業/.test(q))add('門市或取貨資訊',/門市|地址|營業時間|取貨/);
  if(/採購|企業|訂購|訂量|大量|300 盒|100 盒/.test(q))add('訂購管道與數量條件',/採購|訂購|最低|訂量|洽詢|客服/);
  if(/優惠|早鳥|活動/.test(q))add('活動年份與適用條件',/優惠|早鳥|活動|截止/);
  add('品項、規格與適用需求',/品名|內容物|規格|入數|重量|禮盒|曲奇|餅乾|月餅|鳳梨酥/);
  return fields;
}

/** Keyword clues are only discovery aids, never a semantic completeness verdict. */
export function buildQuestionMatrix({pages=[],baseline,reviews={},brandName}={}){
  const seen=new Set();
  const own=pages.filter(p=>isReadableSource(p)&&workflowUrl(p.url)&&classifySource(p,baseline).scope==='指定品牌'&&!seen.has(p.url)&&seen.add(p.url));
  const sourceSignature=analysisSignature(own.map(p=>[p.url,p.retrievedAt,p.content||p.excerpt||p.description]));
  return observationPrompts(brandName||baseline?.name).map(prompt=>{
    const required=requirements(prompt);
    const evidence=required.map(field=>({label:field.label,sources:own.flatMap(p=>{
      const body=clean(p.content||p.excerpt||p.description,100000),match=body.match(field.pattern);
      if(!match)return [];
      const index=match.index||0;
      return [{url:p.url,title:clean(p.title,160),retrievedAt:clean(p.retrievedAt,50),excerpt:body.slice(Math.max(0,index-60),index+220)}];
    }).slice(0,3)}));
    const sources=[...new Map(evidence.flatMap(f=>f.sources).map(s=>[s.url,s])).values()];
    const signature=analysisSignature([prompt,sourceSignature]);
    const prior=reviews[prompt.id],review=prior?.signature===signature?prior:null;
    const missing=evidence.filter(f=>!f.sources.length).map(f=>f.label);
    const automatic=!sources.length?'尚未找到':missing.length?'線索不足':sources.some(s=>evidence.every(f=>f.sources.some(p=>p.url===s.url)))?'已有線索':'答案分散';
    return {...prompt,required:required.map(f=>f.label),evidence,sources,missing,signature,status:review?.status||automatic,review,stale:!!prior&&!review,automatic};
  });
}

export function reviewQuestion(row,{status,note,sourceUrl,reviewer}){
  if(!['已有答案','答案分散','資訊矛盾','尚未找到'].includes(status))throw Error('請選擇有效的查核結果。');
  if(!clean(note)||!clean(reviewer,80))throw Error('請填查核說明與核對人。');
  if(status!=='尚未找到'&&!row.sources.some(s=>s.url===sourceUrl))throw Error('請選擇本題已保存的官方來源。');
  return {signature:row.signature,status,note:clean(note),sourceUrl:status==='尚未找到'?'':sourceUrl,reviewer:clean(reviewer,80),reviewedAt:new Date().toISOString()};
}

export function createModificationPack({row,card,baseline,id}){
  const sources=(row?.sources||card?.sources||[]).filter(s=>workflowUrl(s.url)&&classifySource(s,baseline).scope==='指定品牌').slice(0,3);
  const required=row?.required||['已確認商品與適用需求','規格及購買條件','資料更新日期'];
  return {id,questionId:row?.id||'',question:row?.query||card?.title||'',title:row?`補齊：${row.scenario}`:card.title,targetUrl:sources[0]?.url||'',section:row?.scenario||'產品資訊與問答',original:sources[0]?.excerpt||'目前樣本尚無對應官方摘錄，請先補來源。',sources,required,questionSignature:row?.signature||'',draft:card?.draft||`${baseline.name}｜${row?.scenario||'產品資訊'}\n\n${required.map(f=>`${f}：待補`).join('\n')}\n\n官方洽詢方式：待補\n更新日期：待補`,pending:card?.pending||required.join('、'),acceptance:card?.verify||'發布後重新讀取目標頁，逐項確認以上欄位、來源與日期；可匯入搜尋曝光與點擊，作為後續內容維護參考。',action:card?.action||'核對官方資訊後補齊欄位；未確認內容保留待補。',reviewer:'',approved:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}

export function updateModificationPack(pack,raw,baseline){
  const targetUrl=workflowUrl(raw.targetUrl);
  if(!targetUrl||classifySource({url:targetUrl},baseline).scope!=='指定品牌')throw Error('修改位置必須是指定品牌的官方網址。');
  if(!clean(raw.draft,6000)||!clean(raw.section,200)||!clean(raw.acceptance))throw Error('請填寫區塊、建議新文與驗收方式。');
  const approved=raw.approved==='on'||raw.approved===true;
  if(approved&&(!clean(raw.reviewer,80)||clean(raw.pending)||/待補|待確認/.test(raw.draft)))throw Error('核准前請填核對人，完成待確認欄位及草稿內的待補資訊。');
  return {...pack,targetUrl,section:clean(raw.section,200),draft:clean(raw.draft,6000),pending:clean(raw.pending),acceptance:clean(raw.acceptance),reviewer:clean(raw.reviewer,80),approved,updatedAt:new Date().toISOString()};
}
export function packMarkdown(pack){return [`# ${pack.title}`,`狀態：${pack.approved?'品牌已核准（尚需在官網上稿）':'待品牌核對'}`,`問題：${pack.question}`,`修改網址：${pack.targetUrl||'待補'}`,`區塊：${pack.section}`,'## 保存原文',pack.original,'## 建議新文',pack.draft,'## 待確認',pack.pending||'無（依人工核對）',`核對人：${pack.reviewer||'待填'}`,'## 驗收',pack.acceptance,'## 來源',...pack.sources.map(s=>`${s.url}\n讀取：${s.retrievedAt||'未記錄'}\n${s.excerpt||'無摘錄'}`)].join('\n\n');}

export function createExperiment(raw,pack,brandName,id,baseline){
  const bank=observationPrompts(brandName),target=bank.find(p=>p.id===raw.targetPrompt),control=bank.find(p=>p.id===raw.controlPrompt);
  if(!pack)throw Error('請先保存一份修改包。');
  const controlUrl=workflowUrl(raw.controlUrl);
  if(!workflowUrl(pack.targetUrl)||!controlUrl||controlUrl===workflowUrl(pack.targetUrl)||!baseline||classifySource({url:controlUrl},baseline).scope!=='指定品牌')throw Error('請保存改善頁網址，並填寫另一個官方對照頁網址。');
  if(!target||!control||target.id===control.id||target.type!==control.type)throw Error('請選兩個不同、同提問類型的固定題目，分別作改善組與對照組。');
  if(!clean(raw.name,120)||!clean(raw.conditions,1000))throw Error('請填測試名稱及固定條件（地區、語言、登入狀態等）。');
  return {id,name:clean(raw.name,120),packId:pack.id,targetUrl:pack.targetUrl,controlUrl,targetPrompt:target,controlPrompt:control,promptVersion:PROMPT_VERSION,conditions:clean(raw.conditions,1000),createdAt:new Date().toISOString(),publication:null};
}
export function publishExperiment(experiment,pack,raw,today){
  if(experiment.publication)throw Error('此發布版本已鎖定；再次改版請建立新測試。');
  if(!pack?.approved||pack.pending||/待補|待確認/.test(pack.draft))throw Error('請先完成並由品牌核准修改包。');
  if(workflowUrl(pack.targetUrl)!==workflowUrl(experiment.targetUrl))throw Error('改善頁網址已變更，請為新網址建立測試。');
  if(!day(raw.publishedOn)||raw.publishedOn>today||!clean(raw.version,80)||!clean(raw.reviewer,80)||raw.confirmed!=='on')throw Error('請填有效發布日期、內容版本與確認人，並確認已在官網上稿及保留對照內容。');
  return {...experiment,publication:{publishedOn:raw.publishedOn,version:clean(raw.version,80),reviewer:clean(raw.reviewer,80),url:pack.targetUrl,snapshot:structuredClone(pack),recordedAt:new Date().toISOString()}};
}

export function validateExperimentObservation(row,experiment){
  if(!experiment)throw Error('此測試不存在，請重新選擇。');
  if(!['baseline','after'].includes(row.phase)||!day(row.date))throw Error('請標記有效的前後測階段與日期。');
  const expected=row.testArm==='control'?experiment.controlPrompt:row.testArm==='target'?experiment.targetPrompt:null;
  if(!expected||row.promptId!==expected.id||row.query!==expected.query||row.promptVersion!==experiment.promptVersion)throw Error('題目或版本與測試快照不符，請由測試入口重新帶入題目。');
  if(!row.contentVersion||row.contentVersion!==(row.phase==='baseline'?'baseline':experiment.publication?.version))throw Error('請確認測試階段與內容版本。');
  if(row.phase==='after'&&!experiment.publication)throw Error('請先記錄官網發布版本，再做改善後測試。');
  if(!row.model||row.webMode!=='enabled'||row.newConversation!==true||row.conditions!==experiment.conditions||observationMethod(row)!=='manual')throw Error('外部前後測需人工平台回答、記錄模型、開啟搜尋、使用全新對話及相同固定條件。API／本地採樣請另存一般觀測。');
  if(experiment.publication&&((row.phase==='baseline'&&row.date>=experiment.publication.publishedOn)||(row.phase==='after'&&row.date<=experiment.publication.publishedOn)))throw Error('以日期比對時，基準需早於發布日，後測需晚於發布日；同日資料不列入。');
  return row;
}

export function verifyPublishedText(experiment,crawl){
  if(!experiment.publication)throw Error('請先保存官網發布版本。');
  const target=workflowUrl(experiment.publication.url),page=(crawl.pages||[]).find(p=>isReadableSource(p)&&[p.url,p.requestedUrl].some(u=>workflowUrl(u)===target));
  if(!page)throw Error('這次未能讀取目標頁，保留上次驗收紀錄。');
  const normalize=v=>String(v||'').replace(/\s+/g,'');
  const body=normalize(page.content||page.excerpt||'');
  const lines=experiment.publication.snapshot.draft.split(/\n+/).map(s=>s.replace(/^\s*(?:#{1,6}\s*|[-*]\s*|\d+[.)]\s*)/,'').trim()).filter(s=>s.length>=5&&!/待補|待確認/.test(s)).slice(0,20);
  if(!body||!lines.length)throw Error('正文或可核對稿件不足，請人工檢查。');
  return {version:experiment.publication.version,url:page.url,checkedAt:new Date().toISOString(),retrievedAt:page.retrievedAt||crawl.generatedAt||'',checks:lines.map(line=>({line,found:body.includes(normalize(line))})),excerpt:(page.content||page.excerpt||'').slice(0,1800),notice:'僅為本次文字擷取與逐字比對，不代表搜尋引擎已收錄、語意完整或 AI 會引用。'};
}

/** Strict paired rounds: duplicate, unreviewed or unmatched records do not enter
 * denominators. No pooling across platform/model or questions. */
export function compareExperiment(experiment,observations=[],brand){
  const result={groups:[],excluded:0,published:!!experiment.publication};
  const usable=[];
  for(const row of observations.filter(r=>r.experimentId===experiment.id)){
    try{if(row.source==='demo'||!row.answer?.trim()||!Number.isInteger(row.round)||row.round<1)throw Error();validateExperimentObservation(row,experiment);usable.push(row);}catch{result.excluded++;}
  }
  const groups=new Map();
  for(const row of usable){const key=JSON.stringify([row.platform,row.model]);if(!groups.has(key))groups.set(key,{platform:row.platform,model:row.model,rows:[]});groups.get(key).rows.push(row);}
  const value=(r,field)=>['citation','modifiedCitation'].includes(field)?(r.citationChecked===true?[r.citedUrl,...(r.citations||[])].some(u=>field==='citation'?officialCitation(typeof u==='object'?u.url:u,brand):workflowUrl(typeof u==='object'?u.url:u)===(r.testArm==='target'?experiment.publication?.url:experiment.controlUrl)):null):typeof r[field]==='boolean'?r[field]:null;
  for(const group of groups.values()){
    const metrics=['brandMentioned','recommended','citation','modifiedCitation'].map(field=>{
      const slots=new Map();
      for(const r of group.rows){const key=`${r.testArm}|${r.phase}|${r.round}`;if(!slots.has(key))slots.set(key,[]);slots.get(key).push(r);}
      const rounds=[...new Set(group.rows.map(r=>r.round))].filter(round=>['target','control'].every(arm=>['baseline','after'].every(phase=>{const rows=slots.get(`${arm}|${phase}|${round}`)||[];return rows.length===1&&value(rows[0],field)!==null;})));
      const stat=(arm,phase)=>{const yes=rounds.filter(round=>value(slots.get(`${arm}|${phase}|${round}`)[0],field)).length;return {yes,n:rounds.length,percent:rounds.length?Math.round(1000*yes/rounds.length)/10:null};};
      const targetBefore=stat('target','baseline'),targetAfter=stat('target','after'),controlBefore=stat('control','baseline'),controlAfter=stat('control','after');
      const delta=rounds.length?Math.round(10*(targetAfter.percent-targetBefore.percent))/10:null;
      const controlDelta=rounds.length?Math.round(10*(controlAfter.percent-controlBefore.percent))/10:null;
      return {field,targetBefore,targetAfter,controlBefore,controlAfter,delta,controlDelta,net:delta===null?null:Math.round(10*(delta-controlDelta))/10};
    });
    result.groups.push({...group,metrics});
  }
  return result;
}

export function workflowObservationFields({e,experiments=[]}){
  return `<details class="quiet-details" id="workflow-observation-link"><summary>連結發布前後測（選填）</summary><div class="field"><label for="obs-experiment">測試</label><select id="obs-experiment" name="experimentId"><option value="">一般觀測</option>${experiments.map(x=>`<option value="${e(x.id)}">${e(x.name)}</option>`).join('')}</select></div><div class="form-grid"><div class="field"><label for="obs-arm">組別</label><select id="obs-arm" name="testArm"><option value="target">改善組</option><option value="control">對照組</option></select></div><div class="field"><label for="obs-content-version">內容版本</label><input id="obs-content-version" name="contentVersion" readonly></div></div><p class="muted">選測試後帶入固定題目與條件；每個平台各輪需保存兩組的前後回答。發布同日不比較。</p></details>`;
}

export function applyExperimentToForm(form,experiment,brandName){
  const put=(id,v)=>{const el=form.querySelector('#'+id);if(el)el.value=v;};
  if(!experiment){put('obs-content-version','');return;}
  const arm=form.querySelector('#obs-arm').value,phase=form.querySelector('#obs-phase').value,prompt=arm==='control'?experiment.controlPrompt:experiment.targetPrompt;
  put('obs-prompt',prompt.id);put('obs-query',prompt.query);put('obs-type',prompt.type);put('obs-version',experiment.promptVersion);put('obs-scenario',prompt.scenario);put('obs-conditions',experiment.conditions);put('obs-web-mode','enabled');put('obs-new-conversation','true');put('obs-content-version',phase==='baseline'?'baseline':experiment.publication?.version||'');
  for(const id of ['obs-answer','obs-mention','obs-recommend','obs-citation-checked','obs-correct','obs-url','obs-citations','obs-accuracy-notes','obs-evidence'])put(id,'');
}

const select=(e,name,rows,selected)=>`<select name="${name}">${rows.map(([v,label])=>`<option value="${e(v)}" ${v===selected?'selected':''}>${e(label)}</option>`).join('')}</select>`;
const field=(e,label,name,value,{area=false,required=false,readonly=false}={})=>`<div class="field"><label>${label}${area?`<textarea name="${name}" ${required?'required':''} ${readonly?'readonly':''} maxlength="6000" rows="4">${e(value||'')}</textarea>`:`<input name="${name}" value="${e(value||'')}" ${required?'required':''} ${readonly?'readonly':''} maxlength="2000">`}</label></div>`;

export function contentWorkflowPage({e,baseline,pages,state,category='',type='unbranded',status='',busy=false}){
  const matrix=buildQuestionMatrix({pages,baseline,reviews:state.reviews}),categories=[...new Set(matrix.map(r=>r.scenario))];
  const filtered=matrix.filter(r=>(!category||r.scenario===category)&&r.type===type&&(!status||r.status===status));
  return `<div class="home-intro"><h1>內容改善與驗證</h1><p>找出內容缺口 → 建立修改包 → 品牌審稿發布。</p><div class="home-shortcuts"><button class="btn small" data-nav="home">回首頁</button></div><p class="muted">此流程存於目前瀏覽器的品牌工作區；請定期匯出。</p><div class="toolbar workflow-jumps"><a href="#question-evidence">1 問題缺口</a><a href="#modification-packs">2 修改包</a></div></div>
  <section class="card workflow-section" id="question-evidence"><div class="card-head"><h2>1 · 問題與內容缺口</h2><span>${matrix.length} 題</span></div><div class="panel-body"><div class="toolbar workflow-filters"><label>情境 <select id="workflow-category"><option value="">全部情境</option>${categories.map(c=>`<option ${category===c?'selected':''}>${e(c)}</option>`).join('')}</select></label><label>提問類型 <select id="workflow-type"><option value="unbranded" ${type==='unbranded'?'selected':''}>未指定品牌</option><option value="branded" ${type==='branded'?'selected':''}>指定品牌</option></select></label><label>狀態 <select id="workflow-status"><option value="">全部</option>${['尚未找到','線索不足','已有線索','已有答案','答案分散','資訊矛盾'].map(s=>`<option ${status===s?'selected':''}>${s}</option>`).join('')}</select></label></div><p class="muted">只比對已收集官網；字詞命中是線索，完整性與矛盾需人工查核。尚未找到不代表整站沒有。</p><div class="workflow-questions">${filtered.map(row=>`<details class="workflow-question"><summary><span>${e(row.query)}</span><span class="tag ${row.review?'':'gray'}">${e(row.status)}${row.stale?' · 需重核':row.review?' · 人工':' · 待核對'}</span></summary><div class="workflow-question-body"><p><strong>需要回答：</strong>${e(row.required.join('、'))}</p>${row.evidence.map(f=>`<div class="workflow-evidence"><strong>${e(f.label)}</strong>${f.sources.length?f.sources.map(s=>`<p><a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.title||s.url)} ↗</a><small> · ${e(s.retrievedAt||'日期未記錄')}</small></p><blockquote>${e(s.excerpt)}</blockquote>`).join(''):'<p class="muted">目前官網樣本尚未找到線索。</p>'}</div>`).join('')}<form data-workflow-form="review" data-question="${e(row.id)}"><div class="form-grid"><label>人工查核 ${select(e,'status',['已有答案','答案分散','資訊矛盾','尚未找到'].map(s=>[s,s]),row.review?.status||'尚未找到')}</label><label>核對來源 ${select(e,'sourceUrl',[['','選擇來源'],...row.sources.map(s=>[s.url,s.title||s.url])],row.review?.sourceUrl||'')}</label></div>${field(e,'查核說明','note',row.review?.note,{required:true})}${field(e,'核對人','reviewer',row.review?.reviewer,{required:true})}<div class="toolbar"><button class="btn small" ${busy?'disabled':''}>保存查核</button><button type="button" class="btn small" data-action="create-question-pack" data-question="${e(row.id)}" ${busy?'disabled':''}>建立修改包</button></div></form></div></details>`).join('')||'<p class="muted">此篩選下沒有題目。</p>'}</div></div></section>
  <section class="card workflow-section" id="modification-packs"><div class="card-head"><h2>2 · 可上稿修改包</h2><span>${state.packs.length} 份</span></div><div class="panel-body"><p class="muted">草稿需品牌核對；核准後由網站管理者到官網上稿。</p>${state.packs.map(pack=>`<details class="workflow-pack" ${state.packs.length===1?'open':''}><summary><span>${e(pack.title)}</span><span class="tag ${pack.approved?'':'gray'}">${pack.approved?'已核准':'待核對'}</span></summary><div class="workflow-question-body"><p>${e(pack.question)}</p><details><summary>原文與來源快照</summary><blockquote>${e(pack.original)}</blockquote>${pack.sources.map(s=>`<p><a href="${e(workflowUrl(s.url))}" target="_blank" rel="noopener noreferrer">${e(s.url)}</a> · ${e(s.retrievedAt||'日期未記錄')}</p>`).join('')}</details><form data-workflow-form="pack" data-pack="${e(pack.id)}">${field(e,'修改網址（官網）','targetUrl',pack.targetUrl,{required:true})}${field(e,'頁面區塊','section',pack.section,{required:true})}${field(e,'建議新文','draft',pack.draft,{area:true,required:true})}${field(e,'待確認欄位（核准前需清空）','pending',pack.pending,{area:true})}${field(e,'發布後驗收方式','acceptance',pack.acceptance,{area:true,required:true})}${field(e,'品牌核對人','reviewer',pack.reviewer)}<label class="check-label"><input type="checkbox" name="approved" ${pack.approved?'checked':''}> 品牌已核對事實、來源及所有待補欄位</label><div class="toolbar"><button class="btn small" ${busy?'disabled':''}>保存修改包</button><button type="button" class="btn small" data-action="generate-pack-draft" data-pack="${e(pack.id)}" ${busy?'disabled':''}>Agent 產生新文</button><button type="button" class="text-link" data-action="export-modification-pack" data-pack="${e(pack.id)}">下載上稿稿件</button></div><p class="muted">先保存編輯，再使用 Agent；模型草稿會取消原核准。</p></form></div></details>`).join('')||'<p class="muted">從上方題目或首頁建議建立第一份修改包。</p>'}</div></section>`;
}
