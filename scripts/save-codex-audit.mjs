import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
const output='data/codex-system-audit.json';
if(existsSync(output)){mkdirSync('data/backups/codex-audit',{recursive:true});copyFileSync(output,'data/backups/codex-audit/'+Date.now()+'.json')}
const brand=JSON.parse(readFileSync('brand.json','utf8').replace(/^\uFEFF/,'')).brand;
const normalize=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase();
const records=[];
for(const file of ['prototype-observations.sqlite','brand_observations.db']){
 if(!existsSync('data/'+file))continue;
 const db=new DatabaseSync('data/'+file,{readOnly:true});
 try{for(const row of db.prepare('SELECT * FROM observations WHERE brand=? ORDER BY id').all(brand)){
  let results;try{results=JSON.parse(row.search_results)}catch{}
  const valid=Array.isArray(results)&&results.length>0&&results.every(x=>x&&typeof x.title==='string'&&typeof x.content==='string'&&typeof x.url==='string');
  const hits=valid?results.flatMap((r,i)=>{const t=r.title+'\n'+r.content;const at=normalize(t).indexOf(normalize(brand));return at<0?[]:[{position:i+1,url:r.url,title:r.title,matchedBrand:brand}]}):[];
  records.push({file,id:row.id,observedAt:row.observed_at,query:row.query,valid,branded:normalize(row.query).includes(normalize(brand)),mentioned:valid?hits.length>0:null,storedMention:row.mentioned,changed:valid?Boolean(row.mentioned)!==Boolean(hits.length):null,hits,resultsCount:valid?results.length:0});
 }}finally{db.close()}
}
const metrics=[];
for(const file of [...new Set(records.map(r=>r.file))])for(const branded of [false,true]){
 const rows=records.filter(r=>r.file===file&&r.branded===branded&&r.valid),yes=rows.filter(r=>r.mentioned).length;
 metrics.push({label:(file.startsWith('prototype')?'原型歷史':'第二版新紀錄')+' · '+(branded?'指定品牌':'未指定品牌')+'搜尋品牌文字命中率',numerator:yes,denominator:rows.length,percent:rows.length?Math.round(yes/rows.length*10000)/100:null,scope:'以每筆搜尋觀測為單位；只計回傳標題／摘要中的完整品牌名，不以網址或問題文字推定。每筆最多命中一次，重複查詢不同時間仍為不同觀測。空結果待確認，不計入分母；不代表回答提及或推薦。'})
}
const definitions=[
 ['官網與商品收集','程式測試通過','依實際分類／商品連結遍歷；分類頁不抽商品事實。成功頁立即保存，停止保留成果。','使用保存資料，不重新抓取；動態缺資料需個別補讀。'],
 ['圖片下載與文字辨識','沿用已驗證資料','527 張圖片上一輪已校驗；圖片文字與 HTML 分開保存，相鄰文字用於歸屬，不能以其他商品的共用圖覆蓋。','文字辨識不能單獨證明食品標示正確，仍保留原圖查核。'],
 ['一鍵分析與分析已保存資料','程式測試通過','已保存入口可省略重新收集，部分圖片失敗保留之前的文字，工作可暫停與停止。','本次由 Codex 檢視保存資料，未呼叫本地或付費模型。'],
 ['商品知識與事實來源','Codex 檢查完成','現有 36 份商品報告逐份閱讀摘要；包裝、口味與商品 ID 分離，未知與版本衝突不擅自補值。','商品114、210、211的摘要明確顯示擷取不足，不能宣稱全站所有資訊分析完成。'],
 ['優先改善與 SEO／GEO','Codex 檢查完成','優先處理重量／營養矛盾、贈品限制只在圖片、奶素與蛋奶素不一致；尺寸方向及括號屬較低優先。','先核對商品6、493、458的現售標示與活動有效期，再更新購買區文字。'],
 ['內容與助理','程式檢視完成','助理以保存來源摘錄回答，與首頁商品卡分開；一般引用生成仍可能缺網址。','回答需對應實際提供來源；不把模型自述網址當已驗證引用。'],
 ['原型搜尋觀測','歷史資料重新計算','搜尋結果的品牌出現只能作搜尋命中率；本次逐筆從保存標題與摘要重算，保留原始值及差異。','即時 Tavily 未執行；既有搜尋不等於 ChatGPT／Gemini 回答。'],
 ['AI 回答提及率與推薦率','已修正並測試','提及與推薦分開判定；各平台、模型、題目版本、指定／未指定品牌與搜尋模式分開；未知不當否。同 ID 重複只算一次，衝突排除。','有效原始回答與查核判定才進分母；推薦需具體推薦語句，否定提及仍可算提及但不算推薦。'],
 ['模型自動判讀','已修正請求欄位','修正觀測請求缺少必填品牌欄位；未指定品牌採樣使用中性欄位，判讀階段才提供目標品牌。','修正後未實際呼叫模型；既有自動判讀仍需人工核對，避免推薦句只推薦了競品。'],
 ['內容健檢與修改包','程式檢視完成','問題對照來源、保留原文快照與待補欄位，核准需品牌核對；模型重寫取消核准。','修改包是草稿，不代表已發布官網。'],
 ['發布與前後測','程式檢視完成','僅在相同平台模型、條件、輪次且改善／對照四格皆有效時比較；發布同日不比較。','維持新對話與固定題目；描述性變化不能宣稱因果。'],
 ['待辦與匯入匯出','程式檢視完成','待辦完成只代表內部處理；報告匯出與完整資料庫備份不同，審查包保留來源與模型 provenance。','瀏覽器內人工回答、待辦與實驗不會自動出現在伺服器資料庫；需匯出保存。'],
 ['中英文與 Dev 頁面','程式檢視完成','介面語言與商品原文分開，Dev 預設關閉；翻譯不應取代來源原文。','翻譯與原文版本需對照；未逐項視覺驗收所有文案。'],
 ['API 與本地模型設定','程式測試通過','本地與雲端模型分開設定；Tavily 在 .env，不能把模型 key 當搜尋 key。','本次不使用付費 API；不驗證金鑰額度或外部模型權限。'],
 ['停止、備份與資源管理','程式測試通過','停止工作不一定立刻卸載 Ollama；資料清除先備份；正式資料未刪除。','需要釋放顯存時使用終止本地模型；不要把停止狀態當作已卸載。']
];
const audit={version:1,date:'2026-11-11',createdAt:new Date().toISOString(),reviewer:'Codex',method:'Codex source and saved-evidence review; no paid API or local-model inference',notice:'本次為 Codex 直接檢視程式與已保存證據的系統分析，不是付費 Astra API，也不是外部 AI 平台盲測。各項列出實際驗證層級；程式檢視不等於逐項端到端測試。',metrics,records,changedRecords:records.filter(r=>r.changed).map(r=>({file:r.file,id:r.id,stored:r.storedMention,recomputed:r.mentioned})),features:definitions.map(([name,status,analysis,next])=>({name,status,analysis,next})),answerMentionRate:{numerator:0,denominator:0,percent:null,scope:'伺服器未保存可用的外部平台回答樣本。瀏覽器觀測另行計算。'},tests:{node:41,python:2},limitations:['未新增盲測回答，不使用本次已知品牌的 Codex 對話估計自然提及率。','沒有重抓所有網站或重辨識全部圖片，沿用保存日期的證據。','未讀取其他埠號瀏覽器 localStorage 的人工觀測。']};
writeFileSync(output,JSON.stringify(audit,null,2));
console.log(JSON.stringify({metrics,changes:audit.changedRecords,records:records.length,features:audit.features.length},null,2));
