import {imageCoverage,IMAGE_READER_VERSION} from './image-evidence.js';
import {extractPurchaseFields,assessPurchaseAnswers,summarizeImageFields} from './purchase-answers.js';
const pick=(object,keys)=>Object.fromEntries(keys.filter(k=>object?.[k]!==undefined).map(k=>[k,object[k]]));
export function reviewSanitizer(secrets=[]){
 const hidden=secrets.filter(s=>typeof s==='string'&&s.length>=8);
 const clean=value=>{
  if(typeof value==='string'){
   let text=value;for(const secret of hidden)text=text.split(secret).join('[REDACTED]');
   return text.replace(/\bsk-[A-Za-z0-9_-]{16,}/g,'[REDACTED]').replace(/\bAIza[A-Za-z0-9_-]{20,}/g,'[REDACTED]').replace(/Bearer\s+[A-Za-z0-9._~-]+/gi,'Bearer [REDACTED]').replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&#\s]+/gi,'$1[REDACTED]');
  }
  if(Array.isArray(value))return value.map(clean);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/^(?:api[_-]?key|apiKeys|authorization|cookie|password|secret|access[_-]?token|token)$/i.test(k)).map(([k,v])=>[k,clean(v)]));
  return value;
 };return clean;
}
export function buildReviewData({pages=[],brand={},baseline={},analysis={},provider='',model='',libraryTotal=0,failures=[],progress=null,knowledge=null,secrets=[],generatedAt=new Date().toISOString()}={}){
 const clean=reviewSanitizer(secrets),seen=new Set();
 const safePages=pages.filter(p=>p?.url&&!seen.has(p.url)&&seen.add(p.url)).map(p=>({
  ...pick(p,['url','title','description','excerpt','content','retrievedAt','fetchedAt','contentFetchedAt','contentTruncated','h1','h2','structuredData','wordCount','imageDiscoveryTotal','imageText','imageTextFetchedAt','issues']),
  images:(p.images||[]).map(r=>pick(r,['url','alt','title'])),
  imageTextSources:(p.imageTextSources||[]).map(r=>pick(r,['url','alt','text','status','version','recognizedAt','error','model','provider','precision','passes','regions','enhanced'])),
  coverage:imageCoverage(p),extractedFields:extractPurchaseFields(p)
 }));
 const fields=summarizeImageFields(safePages,baseline);
 return clean({schema:'agent-review-package/v2',applicationVersion:'8.2',knowledge,generatedAt,brand:pick(brand,['name','domain']),runtime:{provider,model,readerVersion:IMAGE_READER_VERSION,modelMeaning:'目前設定模型；逐張模型以各圖片紀錄為準，舊紀錄缺少時視為未知'},scope:{exportedPages:safePages.length,libraryTotal,partial:libraryTotal>safePages.length},summary:{readImages:fields.readAssets,usefulImages:fields.usefulAssets,extractedFields:fields.fieldCount,fieldMeaning:'已抽取的欄位線索，包含需查核適用品項的候選；不代表其他圖片沒有資訊，也不代表認證已核實'},pages:safePages,fields:fields.entries,cards:assessPurchaseAnswers({pages:safePages,baseline}),analysis:pick(analysis,['generatedAt','method','summary','modelAnswer','fallbackReason','cards','directions','scope']),failures,progress:progress?pick(progress,['running','pageUrl','index','total','stopping']):null});
}
export function reviewFiles(data){
 const json=value=>JSON.stringify(value,null,2);
 return [
  {name:'README.txt',data:'AI Agent 審查資料包\nsummary.json：範圍、模型、讀取／可用圖片數。\npages.json：頁面及逐圖辨識原文、失敗原因與欄位抽取。\nfields.json：可用欄位與原圖網址。\ncards.json：四類資料卡的實際輸入結果。\nanalysis.json：模型診斷摘要（未執行時明確標記）。\nknowledge.json：新版知識庫事實、原始證據、模型報告與最近任務；null 表示取得失敗，詳見 errors.json。\ncards.json / fields.json 為舊版規則對照，不代表新版模型診斷。\nerrors.json：抓取失敗。\nimage-index.json：原圖檔案對照及未收錄原因。\n圖片若附入，是匯出當下重新取得，不保證與當時抓取版本完全相同。\n審查包在本機產生，請手動上傳給審查者。\n不含 API 設定、瀏覽器對話、原始資料庫或 .env 檔。辨識文字與分析內容屬本次工作區資料。\n'},
  ...Object.entries({'summary.json':{schema:data.schema,applicationVersion:data.applicationVersion,knowledgeIncluded:!!data.knowledge,generatedAt:data.generatedAt,brand:data.brand,runtime:data.runtime,scope:data.scope,summary:data.summary,progress:data.progress},'pages.json':data.pages,'fields.json':data.fields,'cards.json':data.cards,'analysis.json':data.analysis,'errors.json':data.failures,'knowledge.json':data.knowledge}).map(([name,value])=>({name,data:json(value)}))
 ];
}
export async function attachReviewImages(data,fetchImage,onProgress=()=>{}){
 const sources=new Map();for(const p of data.pages)for(const image of [...p.images,...p.imageTextSources])if(image.url&&!sources.has(image.url))sources.set(image.url,{pageUrl:p.url,url:image.url});
 const files=[],index=[];let bytes=0,n=0;
 for(const source of sources.values()){
  n++;onProgress(n,sources.size);
  if(n>128||bytes>=64*1024*1024){index.push({...source,status:'not-included',reason:'超過原圖收錄上限（128 張／64MB），保留網址'});continue}
  try{
   const result=await fetchImage(source);const binary=atob(result.base64);const data=Uint8Array.from(binary,c=>c.charCodeAt(0));
   if(bytes+data.length>64*1024*1024)throw Error('原圖收錄總量超過 64MB');
   const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif'}[result.mimeType];if(!extension)throw Error('不支援的圖片格式');
   const name=`images/${String(n).padStart(4,'0')}.${extension}`;files.push({name,data});bytes+=data.length;index.push({...source,file:name,status:'included',downloadedAt:new Date().toISOString()});
  }catch(e){index.push({...source,status:'failed',reason:String(e.message||e)})}
 }
 return {files,index};
}
// ZIP store format: UTF-8 filenames, CRC32, no external browser dependencies.
export function makeReviewZip(files){
 const encoder=new TextEncoder();let offset=0;const locals=[],centrals=[];
 const u16=(v,n,x)=>v.setUint16(n,x,true),u32=(v,n,x)=>v.setUint32(n,x>>>0,true);
 const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let j=0;j<8;j++)value=(value>>>1)^((value&1)?0xedb88320:0)}return (value^0xffffffff)>>>0};
 for(const file of files){
  if(!/^[a-zA-Z0-9_./-]+$/.test(file.name)||file.name.includes('..'))throw Error('Invalid archive filename');
  const name=encoder.encode(file.name),data=typeof file.data==='string'?encoder.encode(file.data):file.data;
  const local=new Uint8Array(30+name.length+data.length),l=new DataView(local.buffer),sum=crc(data);
  u32(l,0,0x04034b50);u16(l,4,20);u16(l,6,0x800);u16(l,12,33);u32(l,14,sum);u32(l,18,data.length);u32(l,22,data.length);u16(l,26,name.length);local.set(name,30);local.set(data,30+name.length);
  const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);u32(c,0,0x02014b50);u16(c,4,20);u16(c,6,20);u16(c,8,0x800);u16(c,14,33);u32(c,16,sum);u32(c,20,data.length);u32(c,24,data.length);u16(c,28,name.length);u32(c,42,offset);central.set(name,46);
  locals.push(local);centrals.push(central);offset+=local.length;
 }
 const size=centrals.reduce((n,p)=>n+p.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);u32(v,0,0x06054b50);u16(v,8,files.length);u16(v,10,files.length);u32(v,12,size);u32(v,16,offset);
 const result=new Uint8Array(offset+size+22);let pos=0;for(const part of [...locals,...centrals,end]){result.set(part,pos);pos+=part.length}return result;
}
