const labels=[['eco','省電'],['balanced','平衡'],['performance','高效'],['custom','自訂']];
const fields=[['cpuThreads','CPU 執行緒',1,'maxThreads',1],['cpuAffinityPercent','可用邏輯核心 (%)',10,90,1],['numBatch','推論批次',32,256,1],['gpuReserveMiB','預留顯存 (MiB)',256,8192,1],['cooldownMs','每次分析休息 (毫秒)',0,30000,1],['keepAliveSeconds','閒置卸載 (秒)',10,600,1]];
export function resourcePanel(state,e){
 if(!state)return '<section id="agent-resource-panel" class="resource-settings"><p class="muted">正在讀取本機算力設定…</p></section>';
 if(!state.available)return '<section id="agent-resource-panel" class="resource-settings"><p role="status">無法讀取本機算力設定。請重新執行 start.bat。</p></section>';
 const r=state.resources;
 return `<section id="agent-resource-panel" class="resource-settings"><div class="card-head"><h3>本機算力</h3><button type="button" class="btn" data-action="terminate-local">終止本地模型</button></div><div class="field"><label for="resource-preset">運算模式</label><select id="resource-preset">${labels.map(([value,label])=>`<option value="${value}" ${state.preset===value?'selected':''}>${label}</option>`).join('')}</select></div><p id="resource-summary" class="muted">${summary(r)}</p><details id="resource-details" ${state.preset==='custom'?'open':''}><summary>自訂算力</summary><div class="form-grid">${fields.map(([key,label,min,max,step])=>`<div class="field"><label for="resource-${key}">${label}</label><input id="resource-${key}" type="number" min="${min}" max="${max==='maxThreads'?state.maxThreads:max}" step="${step}" value="${e(r[key])}" required></div>`).join('')}</div></details><small class="muted">僅影響本機 Ollama。圖片精度不變；GPU 推論時仍可能短暫滿載。</small><p id="resource-status" class="inline-message" role="status">${!state.managedOllama?'目前使用外部 Ollama；CPU 核心與顯存限制需在該服務設定。執行緒、批次與休息間隔仍可套用。':state.restartRequired?'顯存預留已儲存；重新執行 start.bat 後生效。':'模型、執行緒與休息間隔套用後生效；CPU 核心範圍約 2 秒內更新。'}</p></section>`;
}
function summary(r){return `${r.cpuThreads} 條執行緒 · ${r.cpuAffinityPercent}% 邏輯核心 · 預留 ${r.gpuReserveMiB} MiB 顯存 · 間隔 ${r.cooldownMs/1000} 秒`}
export function readResourceForm(document){return Object.fromEntries(fields.map(([key])=>[key,Number(document.querySelector('#resource-'+key).value)]))}
export function changeResourceForm(element,document,state){
 if(!state?.available)return;
 if(element.id==='resource-preset'){
  const preset=state.presets[element.value];
  if(preset)for(const [key,value] of Object.entries(preset))document.querySelector('#resource-'+key).value=value;
  if(element.value==='custom')document.querySelector('#resource-details').open=true;
 }else if(fields.some(([key])=>element.id==='resource-'+key)){document.querySelector('#resource-preset').value='custom'}else return;
 document.querySelector('#resource-summary').textContent=summary(readResourceForm(document));
 document.querySelector('#resource-status').textContent='尚未儲存，請按下方「套用設定」。';
}
