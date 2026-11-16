// Translate interface text only. Source material and generated answers stay intact.
export const translations=Object.fromEntries(`首頁|Home
內容與助理|Content and assistant
設定|Settings
介面語言|Interface language
語言偏好會保存在此瀏覽器。商品原文與分析紀錄保留原始語言。|Your language preference is saved in this browser. Product sources and analysis records keep their original language.
API 與模型|API and models
API 與模型設定|API and model settings
選擇 Agent 使用的模型，管理搜尋服務與資料。|Choose the model used by the assistant and manage search services and data.
模型與 API|Models and API
本地執行|Local processing
雲端 API|Cloud API
AI Agent 與內容提案共用這組設定。|The assistant and content suggestions share these settings.
使用方式|Mode
本地模型|Local model
本地執行服務|Local service provider
API 供應商|API provider
Ollama · 本地模型|Ollama · Local model
OpenClaw · 本機代理|OpenClaw · Local agent
本地推論 · 不需要 API key|Local inference · No API key required
本地模型名稱|Local model name
填入 Ollama 已下載的模型名稱，預設 qwen3.5:4b。|Enter an installed Ollama model name. Default: qwen3.5:4b.
本地服務|Local service
透過本機後端連接 Ollama，品牌內容留在這台電腦。|Connect to Ollama through the local server. Brand content stays on this computer.
首次使用與啟動方式|Getting started
本機算力|Local resources
終止本地模型|Terminate local model
運算模式|Performance mode
省電|Power saving
平衡|Balanced
高效|Performance
自訂|Custom
自訂算力|Custom resources
網頁搜尋與抓取服務|Web search and retrieval
OpenAI API key（選填）|OpenAI API key (optional)
Gemini API key（選填）|Gemini API key (optional)
Jina Reader API key（選填）|Jina Reader API key (optional)
OpenAI 模型 ID|OpenAI model ID
Gemini 模型 ID|Gemini model ID
推理強度|Reasoning effort
輕度（low）|Low
中度（medium）|Medium
高度（high）|High
極高（xhigh）|Extra high
最高（max）|Maximum
共用後端接口|Shared endpoint
套用設定|Apply settings
測試模型連線|Test model connection
進階頁面|Advanced pages
顯示 Dev 頁面|Show Dev page
開啟後可查看曝光機會及競爭與引用來源，預設關閉。|Show visibility opportunities, competitors and citation sources. Off by default.
資料匯入、匯出與進階工具|Import, export and advanced tools
匯入 CSV / JSON|Import CSV / JSON
匯出報告|Export report
資料範本|Data template
內容健檢|Content audit
行動待辦|Action items
儲存與清除|Storage and cleanup
清除瀏覽器資料與設定|Clear browser data and settings
黑夜模式|Dark mode
切換黑夜模式|Toggle dark mode
主要分頁|Main navigation
暫停|Pause
繼續|Resume
停止|Stop
已停止|Stopped
已暫停|Paused
分析中|Analyzing
已完成|Completed
尚未開始|Not started
更新官網資料|Refresh website data
清除舊資料|Clear old data
品牌知識|Brand knowledge
匯出審查包|Export review package
搜尋前確認|Before searching
商品資料與改善建議|Product information and recommendations
一鍵分析網站|Analyze website
分析已保存資料|Analyze saved data
分析進行中|Analysis in progress
自動收集商品、讀取圖片，並整理值得優先改善的內容。|Collect products, read images and identify improvements to prioritize.
優先改善|Priority improvements
建議修改：|Suggested change:
影響：|Impact:
查看商品來源|View product source
來源商品頁|Product source page
來源圖片|Source image
查看原文|View original text
資料完整度|Data completeness
內容改善與驗證|Content improvements and validation
與助理討論已收集的資料，整理準備修改的內容。|Discuss collected information with the assistant and prepare content updates.
向助理提問|Ask the assistant
待連接模型|Waiting for model connection
下一步怎麼做|What should I do next?
規劃 FAQ|Plan FAQs
找出內容缺口|Find content gaps
交代 AI Agent 任務|Describe your task
使用網頁與本地資料庫|Use web and local database
發送任務|Send task
對話保存在此瀏覽器|Conversations are saved in this browser
清除對話|Clear conversation
已收集的頁面|Collected pages
查看內容建議|View recommendations
品牌歸屬|Brand affiliation
曝光機會與來源分析|Visibility opportunities and source analysis
內容涵蓋分析|Content coverage analysis
追蹤關鍵字|Tracked keywords
更新分析|Refresh analysis
競爭與引用來源|Competitors and citation sources
目前競品|Direct competitors
替代競品|Alternative competitors
引用來源|Citation sources
尚無已分類的頁面|No classified pages yet`.split('\n').map(line=>line.split('|')));
Object.assign(translations,{
 'AI的烘焙口袋名單：是否同意Cookies':'AI Bakery Shortlist',
 '鴻鼎菓子':'Hong Ding Guo Zi',
 '鴻鼎菓子的搜尋與 AI 能見度':'Search and AI visibility for Hong Ding Guo Zi',
 '依官網與公開來源找出內容缺口，提升搜尋與 AI 閱讀品牌資料的清晰度。':'Identify content gaps using official and public sources to make brand information clearer for search and AI.',
 '商品目錄收集不設頁數與時間上限。':'Product catalog collection has no page-count or duration limit.',
 '搜尋':'Search','模型':'Model','儲存':'Storage','搜尋服務可用':'Search service available','模型已連線':'Model connected','本地儲存已啟用':'Local storage enabled',
 '商品規格':'Product specifications','購買條件':'Purchase conditions','食用適用性':'Dietary suitability',
 '食用資訊':'Dietary information','規格一致':'Specification consistency','商品識別':'Product identity','商品資訊':'Product information','內容清晰':'Content clarity',
 '目前既有分析由':'Existing analyses were prepared by',
 '代為分析測試，未使用付費 Astra API；後續新分析會標示實際使用的模型。':'for testing without a paid Astra API. Future analyses will identify the model actually used.',
 'Codex Astra 測試分析':'Codex Astra test analysis',
 '待確認：':'To confirm: ','完成後檢查：':'Verification: ',
 '建議供內容修改參考，不代表搜尋排名或 AI 引用成效。':'Recommendations guide content updates; they do not establish search ranking or AI citation performance.',
 '設定模型後即可開始。':'Configure a model to begin.',
 '目前沒有足夠證據支持高影響建議；文字校對保留在全部改善建議。':'There is insufficient evidence for high-impact recommendations. Editorial corrections remain in the full reports.',
 '待確認':'To confirm','圖片辨識原文（待核對）':'Image OCR source text (verification required)',
 '商品頁標題':'Product page title','商品詳情原文（含口味及規格上下文）':'Original product details including flavor and specification context',
 '本地 Ollama':'Local Ollama','重新開始':'Restart','再試一次':'Retry',
 '依人工確認的基準分類':'Classified using manually confirmed criteria',
 '搜尋與 AI 成效紀錄':'Search and AI performance records',
 '再次探索':'Explore again','調整主題、頁數或指定網址':'Adjust topics, page count or target URL',
 '品牌知識與來源':'Brand knowledge and sources','指定品牌與人工基準資料':'Target brand and manually verified baseline',
 '全部':'All','指定品牌':'Target brand','非指定品牌':'Other brands','待分類':'Unclassified',
 '指定品牌＝官網；外站列為非指定品牌。':'Target brand means the official website; external sites are classified as other brands.',
 '下載':'Download','取消':'Cancel','確認':'Confirm','關閉':'Close','儲存設定':'Save settings',
 '資料來源':'Sources','原文':'Original source','本機模型接口已啟用；請測試連線確認 Ollama 與模型已就緒。':'The local model endpoint is enabled. Test the connection to confirm Ollama and the model are ready.',
 '本地模型需在這台電腦啟動，請執行 start-local.cmd。':'Start the local model on this computer using start-local.cmd.',
 '目前使用讀取服務的免費額度；尚未設定獨立金鑰。':'Using the retrieval service free tier; no separate API key is configured.'
});
export function getLanguage(){try{return typeof localStorage!=='undefined'&&localStorage.getItem('signal.language')==='en'?'en':'zh-TW'}catch{return 'zh-TW'}}
export function translate(text,language){if(language!=='en')return text;const trimmed=text.trim();if(translations[trimmed])return text.replace(trimmed,translations[trimmed]);
 const patterns=[[/^商品資料 · (\d+) 項$/,'Product information · $1 items'],[/^全部改善建議 · (\d+) 份$/,'All recommendations · $1 reports'],[/^圖片已辨識 (\d+)／(\d+) 張，文字仍需核對。$/,'Images processed: $1/$2. Recognized text still requires verification.'],[/^分析素材 · (\d+) 頁已載入$/,'Analysis sources · $1 pages loaded'],[/^待確認：/,'To confirm: '],[/^完成後檢查：/,'Verification: '],[/^目前：/,'Current: '],[/ · (\d+) 筆$/,' · $1 records']];
 let result=text;for(const [pattern,replacement] of patterns)result=result.replace(pattern,replacement);return result;
}
if(typeof document!=='undefined'){
 let language='zh-TW';try{if(localStorage.getItem('signal.language')==='en')language='en'}catch{}
 const originals=new WeakMap();
 const attributes=new WeakMap();
 function apply(){
  document.documentElement.lang=language;
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){
   if(node.parentElement?.closest('script,style,textarea,pre,code,[data-original-source],#agent-messages'))continue;
   const previous=originals.get(node);const source=previous&&node.nodeValue===previous.output?previous.source:node.nodeValue;
   const output=translate(source,language);if(node.nodeValue!==output)node.nodeValue=output;originals.set(node,{source,output});
  }
  for(const el of document.querySelectorAll('[aria-label],[title],[placeholder]')){
   const saved=attributes.get(el)||{};
   for(const attr of ['aria-label','title','placeholder']){if(!el.hasAttribute(attr))continue;const current=el.getAttribute(attr),old=saved[attr];const source=old&&current===old.output?old.source:current;const output=translate(source,language);if(current!==output)el.setAttribute(attr,output);saved[attr]={source,output}}
   attributes.set(el,saved);
  }
  for(const button of document.querySelectorAll('[data-language]')){const selected=button.dataset.language===language;button.setAttribute('aria-pressed',String(selected));button.classList.toggle('primary',selected)}
 }
 let pending=false;const observer=new MutationObserver(()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;observer.disconnect();apply();observe()})});
 function observe(){observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['placeholder','aria-label','title']})}
 function start(){apply();observe();document.addEventListener('click',event=>{const button=event.target.closest('[data-language]');if(!button)return;language=button.dataset.language==='en'?'en':'zh-TW';try{localStorage.setItem('signal.language',language)}catch{}document.dispatchEvent(new Event('languagechange'));observer.disconnect();apply();observe()})}
 if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
}
