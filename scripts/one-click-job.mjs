import {randomUUID} from 'node:crypto';
// Credentials stay in the running closure; only the public progress is persisted.
export function createOneClickJob({collect,recognize,saveImages,analyze,control,persist=()=>{},initial=null}){
 let job=initial?{...initial,status:['running','paused'].includes(initial.status)?'interrupted':initial.status}:null;
 let active=false,cancel=null,completion=Promise.resolve();
 const update=values=>{Object.assign(job,values);persist({...job})};
 const checkpoint=async()=>{cancel.signal.throwIfAborted();await control.checkpoint(cancel.signal)};
 const attempt=async fn=>{for(;;){await checkpoint();try{return await control.run(cancel.signal,fn)}catch(error){if(cancel.signal.aborted)throw error;if(control.paused){await checkpoint();continue}throw error}}};
 return {
  get busy(){return active},state:()=>job?{...job}:{status:'idle'},wait:()=>completion,
  start(input){
   if(active)throw Error('分析進行中，請先停止。');
   if(!['local','openai','gemini'].includes(input.config?.provider)||!input.config?.model)throw Error('請先設定支援圖片的模型。');
   const u=new URL(input.url);if(u.protocol!=='https:'||!['www.idodo.com.tw','idodo.com.tw'].includes(u.hostname)||u.port||u.username||u.password||u.search||!/^\/(?:category\d*|product\d+)\.html$/.test(u.pathname))throw Error('請指定鴻鼎菓子的商品或分類網址。');
   const config={...input.config};const domain=u.origin;active=true;cancel=new AbortController();control.resume();
   job={id:randomUUID(),brand:input.brand,status:'running',stage:'收集商品資料',pages:0,imagesDone:0,imagesTotal:0,imagesFailed:0,errors:[],startedAt:new Date().toISOString()};update({});
   completion=(async()=>{try{
    const pages=await collect(u.href,cancel.signal,async count=>{update({pages:count});await checkpoint()});
    await checkpoint();const products=pages.filter(p=>/\/product\d+\.html$/.test(new URL(p.url).pathname));
    if(!products.length)throw Error('未找到商品詳情頁，請確認網址。');
    const images=new Map();for(const page of products)for(const image of page.images||[])if(!images.has(image.url))images.set(image.url,{page,image});
    const recognized=new Map();update({pages:products.length,imagesTotal:images.size,stage:'讀取商品圖片'});
    for(const [url,{page,image}] of images){
     await checkpoint();update({stage:'辨識圖片',productName:page.title,imageUrl:url});
     try{const result=await attempt(()=>recognize(page,image,config,cancel.signal,p=>update({imageProgress:p})));recognized.set(url,result)}
     catch(error){if(cancel.signal.aborted)throw error;const reason='圖片未完成，請檢查模型設定或稍後重試。';recognized.set(url,{url,status:'failed',text:'',error:reason});update({imagesFailed:job.imagesFailed+1,errors:[...job.errors,{productName:page.title,url,message:reason}]})}
     // Save each completed image with its page-local attribution, including shared images.
     for(const p of products.filter(p=>(p.images||[]).some(i=>i.url===url))){
      const old=new Map((p.imageTextSources||[]).map(x=>[x.url,x]));
      for(const img of p.images||[]){const result=recognized.get(img.url);if(result&&!(result.status==='failed'&&old.get(img.url)?.status==='read'))old.set(img.url,result)}
      await saveImages(domain,p.url,[...old.values()]);
     }
     update({imagesDone:job.imagesDone+1,imageProgress:null});
    }
    await checkpoint();update({stage:'整理商品與優先建議'});
    const result=await analyze({brand:input.brand,domain,config},cancel.signal,checkpoint);
    update({status:job.imagesFailed||result?.status==='completed_with_errors'?'completed_with_errors':'completed',stage:'分析完成',finishedAt:new Date().toISOString()});
   }catch(error){update({status:cancel.signal.aborted?'stopped':'failed',stage:cancel.signal.aborted?'已停止，完成的資料已保存':'分析未完成，已保存的資料保留',error:cancel.signal.aborted?'':'請檢查網址、模型權限及可用額度後重試。'})}
   finally{config.apiKey='';active=false}})();return this.state();
  },
  pause(){if(active){control.pause();update({status:'paused'})}return this.state()},
  resume(){if(active){control.resume();update({status:'running'})}return this.state()},
  stop(){if(active){cancel.abort();control.pause();update({status:'stopped'})}return this.state()}
 };
}
