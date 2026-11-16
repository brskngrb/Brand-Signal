export function singleImageProgress(progress,e){
 const single=progress?.single;if(!single)return '';
 const percent=Number.isFinite(single.percent)?Math.min(100,Math.max(0,single.percent)):null;
 const elapsed=Math.max(0,Math.floor(((single.finishedAt||Date.now())-(single.startedAt||Date.now()))/1000));
 return `<div class="single-image-progress"><strong>單張圖片辨識${percent===null?'':` · ${percent}%`}</strong><span>本頁第 ${progress.index||1} / ${progress.total||1} 張</span><progress max="100" ${percent===null?'':`value="${percent}"`} aria-label="單張圖片已完成步驟比例"></progress><p role="status">${e(single.stage||'等待處理')} · 已經過 ${elapsed} 秒</p><small>${single.total?`已完成 ${single.completed||0} / ${single.total} 個步驟（區域轉錄、校對與結果檢查）；各步驟耗時不同，非剩餘時間估計。`:percent===100?'此張圖片已完成辨識。':'目前階段無法量測完成比例；完成後顯示 100%。'}</small></div>`;
}
