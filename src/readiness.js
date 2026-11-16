const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const action = (action, label, disabled = false) => ({action, label, disabled});
const item = (label, status, tone, detail, actions = []) => ({label, status, tone, detail, actions});
const modelName = value => typeof value === 'string' ? value.trim().slice(0, 100) : '';

/** Derive independently verified search, model, and storage states for the home page. */
export function workspaceReadiness({health = {}, healthState = 'checking', provider = 'local', model = '', modelReady = false, modelVerified = false, modelChecking = false, modelMessage = '', readerConfigured = false, libraryAvailable = false, libraryStatus = '', explorationState = null} = {}) {
  const checking = healthState === 'checking';
  const offline = healthState === 'error';
  const exploration = explorationState || {};
  const active = exploration.running === true;
  const retry = action('retry-services', '重新檢查', checking);
  const searchSettings = action('configure-search', '搜尋設定');
  const modelSettings = action('configure-model', '模型設定');
  const testModel = action('check-home-model', '測試模型', checking || modelChecking);
  let search;
  if (checking) search = item('搜尋', '正在確認', 'pending', '確認完成後即可查看搜尋狀態。', [retry]);
  else if (offline) search = item('搜尋', '暫時無法連線', 'error', '目前無法確認搜尋服務，請重新檢查。', [retry, searchSettings]);
  else if (active) search = item('搜尋', '正在收集資料', 'pending', '取得的頁面會逐批保留。', [searchSettings]);
  else if (exploration.stopReason === 'restricted') search = item('搜尋', '搜尋暫時受限', 'warning', '部分來源要求驗證或限制存取，已保留取得的結果。', [action('retry-exploration', '重試搜尋'), searchSettings]);
  else if (exploration.phase === 'error') search = item('搜尋', '上次搜尋未完成', 'warning', exploration.stopReason === 'persistence_error' ? '儲存遇到問題，請先確認下方儲存狀態。' : '已保留先前結果，可調整設定後重新嘗試。', [action('retry-exploration', '重試搜尋'), searchSettings]);
  else if (health.webSearchAvailable === true) search = item('搜尋', '搜尋服務可用', 'good', readerConfigured || health.webReaderConfigured === true ? '已設定網頁讀取服務；部分網站仍可能限制讀取。' : '可搜尋公開網站；部分來源可能需要驗證。', [searchSettings]);
  else search = item('搜尋', '搜尋尚未就緒', 'warning', '請確認搜尋設定，再開始收集資料。', [retry, searchSettings]);

  const local = provider === 'local';
  const selected = modelName(model);
  const selectedText = selected ? `${selected}。` : '';
  const previousMessage = typeof modelMessage === 'string' ? modelMessage.trim() : '';
  const previousFailure = modelVerified !== true && !!previousMessage && (/失敗|錯誤|逾時|超時|無法|未能|不足|受限|限制|error|fail|timeout|invalid|unauthorized|forbidden/i.test(previousMessage) || !/成功|已就緒|已連接|可使用/.test(previousMessage));
  let modelState;
  if (checking || modelChecking) modelState = item('模型', '正在確認模型', 'pending', `${selectedText}確認後會顯示是否可進行分析。`, [testModel, modelSettings]);
  else if (offline) modelState = item('模型', '連線待確認', 'warning', `${selectedText}服務暫時無法連線，請重新檢查。`, [retry, modelSettings]);
  else if (local && health.localEnabled !== true) modelState = item('模型', '本地模型未連接', 'warning', `${selectedText}請開啟本機版本與本地模型，或選用其他模型。`, [modelSettings, retry]);
  else if (modelVerified === true && modelReady === true) modelState = item('模型', '模型已連線', 'good', `${selectedText}已通過連線確認，可進行分析。`, [testModel, modelSettings]);
  else if (!local && modelReady === true && previousFailure) modelState = item('模型', '上次回應失敗', 'warning', `${selectedText}請測試模型，或檢查設定後再試。`, [testModel, modelSettings]);
  else if (modelReady === true) modelState = item('模型', '已設定，待驗證', 'warning', `${selectedText}請測試模型，確認能否產生分析。`, [testModel, modelSettings]);
  else if (local || modelMessage) modelState = item('模型', '模型尚未就緒', 'warning', `${selectedText}請檢查模型設定並重新測試。`, [testModel, modelSettings]);
  else modelState = item('模型', '模型尚未設定', 'warning', '選擇模型並完成設定後，即可自動分析。', [modelSettings]);

  const localStorageEnabled = libraryAvailable === true || health.localLibraryAvailable === true;
  const storageFailed = exploration.stopReason === 'persistence_error' || /失敗|錯誤|未能確認|無法(?:讀取|保存|儲存)/.test(String(libraryStatus));
  let storage;
  if (checking) storage = item('儲存', '正在確認儲存', 'pending', '正在確認頁面會存入本地或瀏覽器。');
  else if (offline) storage = item('儲存', '本地儲存待確認', 'warning', '目前可保留瀏覽器暫存；本地保存狀態尚未確認。', [retry]);
  else if (storageFailed) storage = localStorageEnabled
    ? item('儲存', '本地保存待確認', 'error', '本地資料讀取或保存遇到問題，請重新檢查；勿將已讀取頁數視為已保存。', [retry])
    : item('儲存', '瀏覽器暫存失敗', 'error', '目前頁面資料尚未確認保存，請先匯出備份。', [retry]);
  else if (localStorageEnabled) storage = item('儲存', '本地儲存已啟用', 'good', '收集頁面存於本地資料庫；設定與對話留在瀏覽器。');
  else storage = item('儲存', '使用瀏覽器暫存', 'warning', '此版本未連接本地資料庫；清除瀏覽器資料會移除暫存。');
  return {search, model: modelState, storage};
}

export function readinessPanel({e = escapeHtml, state = workspaceReadiness()} = {}) {
  const allowedActions = new Set(['retry-services', 'check-home-model', 'configure-search', 'configure-model', 'retry-exploration']);
  return `<section id="workspace-readiness" class="service-readiness" aria-label="搜尋前確認" aria-live="polite">${['search', 'model', 'storage'].map(key => {
    const current = state[key];
    const tone = ['good', 'pending', 'warning', 'error'].includes(current.tone) ? current.tone : 'pending';
    return `<article class="service-state state-${tone}"><details class="readiness-details"${tone==='error'?' open':''}><summary><span class="readiness-label">${e(current.label)}</span><strong class="readiness-status" role="status">${e(current.status)}</strong></summary><p class="readiness-detail">${e(current.detail)}</p>${current.actions?.length ? `<div class="readiness-actions">${current.actions.filter(button => allowedActions.has(button.action)).map(button => `<button type="button" class="text-link" data-action="${e(button.action)}"${button.disabled ? ' disabled' : ''}>${e(button.label)}</button>`).join('')}</div>` : ''}</details></article>`;
  }).join('')}</section>`;
}
