export const IMAGE_READER_VERSION=3;
export function imageCoverage(page={}){
 const images=Array.isArray(page.images)?page.images:[];
 const results=Array.isArray(page.imageTextSources)?page.imageTextSources:[];
 const completed=images.filter(image=>results.some(r=>r.url===image.url&&r.status==='read'&&r.version===IMAGE_READER_VERSION)).length;
 const failed=images.filter(image=>results.some(r=>r.url===image.url&&r.status==='failed')).length;
 const total=Math.max(images.length,page.imageDiscoveryTotal||0);
 return {total,completed,failed,pending:Math.max(0,total-completed-failed),complete:total>0&&completed===total};
}
export function imageTranscript(page={}){
 const sources=(page.imageTextSources||[]).filter(s=>s.status==='read'&&s.version===IMAGE_READER_VERSION&&s.text);
 return sources.length?sources.map(s=>s.text).join('\n\n'):'';
}
export function imageLibraryCoverage(pages=[]){
 const assets=new Map();
 for(const page of pages){
  const results=page.imageTextSources||[];
  for(const image of page.images||[]){
   if(!image?.url)continue;
   const matches=results.filter(r=>r.url===image.url);
   const state=matches.some(r=>r.status==='read'&&r.version===IMAGE_READER_VERSION)?'read':matches.some(r=>r.status==='failed')?'failed':'pending';
   const previous=assets.get(image.url);
   if(!previous||state==='read'||previous==='pending')assets.set(image.url,state);
  }
 }
 return {total:assets.size,completed:[...assets.values()].filter(s=>s==='read').length,failed:[...assets.values()].filter(s=>s==='failed').length,pending:[...assets.values()].filter(s=>s==='pending').length};
}
export function withoutLegacyOcr(value){
 const text=String(value||'');const index=text.indexOf('【圖片文字辨識（AI 擷取，待人工核對）】');
 return index<0?text:text.slice(0,index).trim();
}
