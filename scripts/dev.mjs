import {createOneClickJob} from './one-click-job.mjs';
import {createLocalImageCache} from './local-image-cache.mjs';
import {crawlBrand} from '../worker/crawl.js';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {createImageProgress} from './image-progress.mjs';
import {createCatalogJob} from './catalog-job.mjs';
import {clearCollectedData} from './data-maintenance.mjs';
import {Agent as HttpAgent,fetch as httpFetch} from 'undici';
import {execFile} from 'node:child_process';
import {createAnalysisControl} from './analysis-control.mjs';
import {openKnowledgeWorkflow} from './knowledge-workflow.mjs';
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, projectRoot } from "./build.mjs";
import { openLibrary } from "./local-library.mjs";
import {loadResources,createResourceController} from './resource-control.mjs';
import {createPythonTransport} from './python-transport.mjs';
import {createAgentSettings} from './agent-settings.mjs';
import {createPrototypeObservation} from './prototype-observation.mjs';

// Reads only documented provider settings. .env is never embedded by the build.
const PROVIDER_ENV_NAMES = ["TAVILY_API_KEY", "JINA_API_KEY", "LOCAL_MODEL_ENABLED", "LOCAL_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_REASONING_EFFORT"];
async function localEnv() {
  const env = {};
  try {
    const text = await readFile(resolve(projectRoot, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (match && PROVIDER_ENV_NAMES.includes(match[1])) env[match[1]] = match[2].replace(/^(?:"(.*)"|'(.*)')$/, (_, double, single) => double ?? single);
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const name of PROVIDER_ENV_NAMES) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

const dist = await build();
const source = await readFile(resolve(dist, "server", "index.js"), "utf8");
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const env = await localEnv();
const prototypeObservation = createPrototypeObservation(projectRoot, env.TAVILY_API_KEY);
const resources=await loadResources(projectRoot);
const resourceController=createResourceController(resources);
const pythonTransport=createPythonTransport(projectRoot);
const analysisControl=createAnalysisControl();
globalThis.fetch=analysisControl.wrap(resourceController.wrap(pythonTransport));
env.LOCAL_VISION_FETCH=globalThis.fetch;
try { const {prepareVisionImage}=await import("./image-preprocess.mjs"); env.PREPARE_VISION_IMAGE=prepareVisionImage; } catch { console.warn("圖片細節增強未啟用：請先執行 npm install。"); }
const library = openLibrary(resolve(projectRoot, "data", "web-knowledge.sqlite"));
env.LOCAL_LIBRARY = library;
process.once("exit", () => library.close());
// The local preview serves the Agent UI and its model routes from one origin.
env.LOCAL_MODEL_ENABLED = env.LOCAL_MODEL_ENABLED === undefined || env.LOCAL_MODEL_ENABLED === "true";
try {
  const profile=JSON.parse((await readFile(resolve(projectRoot,'.runtime/agent-model.json'),'utf8')).replace(/^\uFEFF/,''));
  if(typeof profile.model==='string'&&/^[a-zA-Z0-9:._-]+$/.test(profile.model))env.LOCAL_MODEL ||= profile.model;
} catch(error){if(error.code!=='ENOENT')console.warn('Model profile unavailable; using default.');}
env.LOCAL_MODEL ||= "qwen3.5:4b";
const agentSettings=createAgentSettings({projectRoot,controller:resourceController,onModel:model=>{env.LOCAL_MODEL=model}});
env.OPENCLAW_LOCAL_ENABLED = true;
try {
  const config = JSON.parse(await readFile(resolve(projectRoot, '../openclaw-local/state/openclaw.json'), 'utf8'));
  env.OPENCLAW_GATEWAY_TOKEN = config.gateway?.auth?.token || '';
} catch (error) { if (error.code !== 'ENOENT') console.warn('OpenClaw config could not be loaded.'); }

const knowledge=openKnowledgeWorkflow({path:resolve(projectRoot,'data/product-knowledge.sqlite'),library,control:analysisControl,recognizeImage:async(page,image,config,signal)=>{
 const request=new Request('http://localhost/api/images/ocr',{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({...config,pageUrl:page.url,images:[{url:image.url,alt:image.alt||''}]})});
 const response=await worker.fetch(request,env);
 const result=await response.json();
 if(!response.ok||!result.answer?.trim())throw Error(result.error||'圖片沒有可用轉錄');
 return {url:image.url,alt:image.alt||'',text:result.answer,status:'read',version:3,model:result.model,provider:config.provider,recognizedAt:result.recognizedAt};
},ask:async(config,question,content)=>{
 if(config.provider==='local'){
  const response=await globalThis.fetch('http://127.0.0.1:11434/api/chat',{method:'POST',body:JSON.stringify({model:config.model,stream:false,think:true,format:'json',messages:[{role:'system',content:question},{role:'user',content}],options:{num_ctx:32768,num_predict:8192}})});
  if(!response.ok)throw Error('本地模型分析失敗，請確認模型與連線。');const result=await response.json();if(!result.done||!result.message?.content)throw Error('模型輸出未完成。');return result.message.content;
 }
 const response=await worker.fetch(new Request('http://localhost/api/'+config.provider,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'observe',brand:'品牌知識分析',keyword:'官網 GAI 可讀性',question,content,model:config.model,apiKey:config.apiKey,reasoningEffort:config.reasoningEffort})}),env);
 const result=await response.json();if(!response.ok)throw Error(result.error||'API 分析失敗');return result.result?.answer||result.answer||'';
}});
const catalogTransport=new HttpAgent({headersTimeout:0,bodyTimeout:0});
const catalogJob=createCatalogJob({library,fetchImpl:(url,options)=>httpFetch(url,{...options,dispatcher:catalogTransport})});
let activeRequests=0;const imageProgress=createImageProgress();
const imageCache=await createLocalImageCache(projectRoot);
env.READ_PUBLIC_IMAGE=(url,limit,download)=>imageCache.load(url,download).then(image=>{if(image.size>limit)throw Error('圖片過大，請另行核對。');return image});
const pipelineStateFile=resolve(projectRoot,'data/one-click-state.json');
let savedPipeline=null;try{savedPipeline=JSON.parse(readFileSync(pipelineStateFile,'utf8'))}catch{}
const pipeline=createOneClickJob({control:analysisControl,initial:savedPipeline,
 persist:state=>{writeFileSync(pipelineStateFile+'.tmp',JSON.stringify(state));renameSync(pipelineStateFile+'.tmp',pipelineStateFile)},
 collect:async(url,signal,onPage)=>{let count=0;const result=await crawlBrand({url},{unlimited:true,includeContent:true,signal,fetchImpl:(u,o)=>httpFetch(u,{...o,dispatcher:catalogTransport}),onPage:async page=>{const saved=library.saveCrawl(new URL(url).origin,{source:'website_crawl',pages:[page],generatedAt:new Date().toISOString()});if(saved.saved!==1)throw Error('商品資料未保存');await onPage(++count)}});if(result.failures?.length)throw Error('部分商品頁收集失敗，請重試');return result.pages},
 recognize:async(page,image,config,signal,progress)=>{
  const invoke=async(route,body)=>{const response=await worker.fetch(new Request('http://localhost'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{...env,IMAGE_PROGRESS:progress});const result=await response.json();if(!response.ok)throw Error(result.error||'圖片辨識失敗');return result};
  progress({stage:'下載圖片'});
  const loaded=await imageCache.load(image.url,()=>invoke('/api/images/review-source',{pageUrl:page.url,url:image.url}));
  signal.throwIfAborted();progress({stage:'讀取圖片文字'});
  try{const result=await imageCache.ocr(loaded,signal);if(result.text?.trim())return {url:image.url,alt:image.alt||'',text:result.text,status:'read',model:'Windows OCR zh-Hant-TW',provider:'windows',version:3,recognizedAt:new Date().toISOString(),passes:1,regions:result.regions,precision:'native-ocr-unverified'}}catch(error){if(signal.aborted||analysisControl.paused)throw error}
  progress({stage:'核對圖片內容'});const result=await invoke('/api/images/ocr',{...config,pageUrl:page.url,images:[{url:image.url,alt:image.alt||''}]});return {url:image.url,alt:image.alt||'',text:result.answer,status:'read',version:3,model:result.model,provider:config.provider,recognizedAt:result.recognizedAt};
 },
 saveImages:async(domain,url,images)=>{const saved=library.saveImageText(domain,url,images.filter(x=>x.status==='read').map(x=>x.text).join('\n\n'),images);if(!saved.saved)throw Error('圖片文字未保存')},
 analyze:async(input,signal,checkpoint)=>{knowledge.start(input);try{while(knowledge.busy){await checkpoint();await new Promise(resolve=>setTimeout(resolve,150))}signal.throwIfAborted();const job=knowledge.state(input.brand).job;if(!['completed','completed_with_errors'].includes(job?.status))throw Error('商品分析未完成');return job}catch(error){knowledge.stop();throw error}}
});

const port = Number(process.env.PORT || 4173);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");

const zeroTierHost = process.env.BAKERY_ZEROTIER_HOST;
const handleRequest = async (incoming, outgoing) => {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    const host = incoming.headers.host;
    const remoteEntry = zeroTierHost && incoming.socket.localAddress === zeroTierHost;
    if (remoteEntry && !/^172\.23\.\d{1,3}\.\d{1,3}$/.test(incoming.socket.remoteAddress ?? "")) {
      outgoing.writeHead(403); outgoing.end(); return;
    }
    const allowedHosts = remoteEntry ? [zeroTierHost] : ["localhost", "127.0.0.1"];
    if (!host || !allowedHosts.some(name => host === `${name}:${port}`) || !incoming.url.startsWith("/") || incoming.url.startsWith("//")) {
      outgoing.writeHead(400, { "content-type": "text/plain; charset=utf-8" }); outgoing.end("Invalid local host or path"); return;
    }
    if(incoming.url==='/api/codex-audit'&&incoming.method==='GET'){
      try{const audit=await readFile(resolve(projectRoot,'data/codex-system-audit.json'),'utf8');outgoing.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});outgoing.end(audit)}catch{outgoing.writeHead(404);outgoing.end('{}')}return;
    }
    const prototypeRoute = /^\/api\/prototype-observation(?:\/(start|stop))?$/.exec(incoming.url);
    if (prototypeRoute) {
      const send = (status, value) => {
        outgoing.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
        outgoing.end(JSON.stringify(value));
      };
      const action = prototypeRoute[1];
      if (incoming.headers.origin && incoming.headers.origin !== `http://${host}`) return send(403, {error:'來源不符'});
      if (!action && incoming.method === 'GET') return send(200, prototypeObservation.state());
      if (!action || incoming.method !== 'POST' || incoming.headers['x-agent-settings'] !== '1') return send(403, {error:'請求格式錯誤'});
      try {
        if (action === 'stop') prototypeObservation.stop();
        else {
          if (pipeline.busy || catalogJob.busy || knowledge.busy || resourceController.pending || activeRequests) throw Error('請先完成目前工作。');
          const chunks = [];
          let size = 0;
          for await (const chunk of incoming) {
            size += chunk.length;
            if (size > 1024) return send(413, {error:'請求過大'});
            chunks.push(chunk);
          }
          prototypeObservation.start(JSON.parse(Buffer.concat(chunks).toString('utf8')).index);
        }
        return send(200, prototypeObservation.state());
      } catch (error) { return send(400, {error:error.message}); }
    }
    if(incoming.url.split('?')[0]==='/api/one-click'){
      const send=(status,value)=>{outgoing.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});outgoing.end(JSON.stringify(value))};
      if(incoming.headers.origin&&incoming.headers.origin!==`http://${host}`){send(403,{error:'來源不符'});return}
      if(incoming.method==='GET'){send(200,pipeline.state());return}
      if(incoming.method!=='POST'||incoming.headers['x-agent-settings']!=='1'||!String(incoming.headers['content-type']).startsWith('application/json')){send(403,{error:'設定請求格式錯誤'});return}
      try{const parts=[];let size=0;for await(const chunk of incoming){size+=chunk.length;if(size>40000){send(413,{error:'請求過大'});return}parts.push(chunk)}const input=JSON.parse(Buffer.concat(parts).toString('utf8'));
        if(input.action==='start'){if(pipeline.busy||catalogJob.busy||knowledge.busy||prototypeObservation.busy||resourceController.pending||activeRequests)throw Error('請先暫停其他分析工作。');send(200,pipeline.start(input))}
        else if(['pause','resume','stop'].includes(input.action)){const result=pipeline[input.action]();if(input.action==='stop')knowledge.stop();send(200,result)}else send(400,{error:'未知操作'});
      }catch(error){send(400,{error:error.message})}return;
    }
    if(incoming.url==='/api/agent/terminate-local'){
      if(incoming.method!=='POST'||incoming.headers['x-agent-settings']!=='1'||(incoming.headers.origin&&incoming.headers.origin!==`http://${host}`)){outgoing.writeHead(403);outgoing.end();return}
      prototypeObservation.stop();pipeline.stop();knowledge.stop();analysisControl.pause();
      execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve(projectRoot,'scripts/terminate-local.ps1')],{windowsHide:true},error=>{outgoing.writeHead(error?500:200,{'content-type':'application/json'});outgoing.end(JSON.stringify(error?{error:'無法終止本地模型。'}:{ok:true}));analysisControl.resume()});return;
    }
    if(incoming.url.startsWith('/api/images/progress?')){
      if(incoming.method!=='GET'||(incoming.headers.origin&&incoming.headers.origin!==`http://${host}`)){outgoing.writeHead(403);outgoing.end();return}
      const id=new URL(`http://${host}${incoming.url}`).searchParams.get('id');
      outgoing.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});outgoing.end(JSON.stringify(imageProgress.get(id)||{status:'pending'}));return;
    }
    if (prototypeObservation.busy && !['GET', 'HEAD'].includes(incoming.method)) {
      outgoing.writeHead(409, {'content-type':'application/json; charset=utf-8'});
      outgoing.end(JSON.stringify({error:'原型批次搜尋觀測執行中，請等待完成或先停止。'}));
      return;
    }
    if(pipeline.busy&&incoming.method!=='GET'&&incoming.url!=='/api/knowledge'){outgoing.writeHead(409,{'content-type':'application/json'});outgoing.end(JSON.stringify({error:'一鍵分析進行中，請先暫停或停止。'}));return}
    if(agentSettings.handle(incoming,outgoing))return;
    let body;
    if (incoming.method !== "GET" && incoming.method !== "HEAD") {
      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > (incoming.url.split('?')[0] === '/api/library/image-text' ? 8 * 1024 * 1024 : 40 * 1024)) {
          outgoing.writeHead(413, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          outgoing.end(JSON.stringify({ error: "請求超過 40 KB，請縮短原始內容。" })); return;
        }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
    if(incoming.url.split('?')[0]==='/api/catalog'||incoming.url==='/api/data/clear'){
      const send=(code,value)=>{outgoing.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});outgoing.end(JSON.stringify(value))};
      if(incoming.headers.origin&&incoming.headers.origin!==`http://${host}`){send(403,{error:'來源不符'});return}
      if(incoming.method==='GET'&&incoming.url.startsWith('/api/catalog')){send(200,new URL(`http://${host}${incoming.url}`).searchParams.get('pages')==='1'?{...catalogJob.state(),pages:catalogJob.pages()}:catalogJob.state());return}
      if(incoming.method!=='POST'||incoming.headers['x-agent-settings']!=='1'){send(403,{error:'缺少驗證標頭'});return}
      try{const input=JSON.parse(body);
       if(incoming.url==='/api/data/clear'){
        if(input.confirm!=='clear-collected-data')throw Error('請先確認清除資料範圍。');
        if(pipeline.busy||catalogJob.busy||knowledge.busy||resourceController.pending||activeRequests){send(409,{error:'請先停止收集與模型工作，等待目前請求結束後再清除。'});return}
        const cleared=clearCollectedData(projectRoot);catalogJob.reset();send(200,cleared);return;
       }
       if(input.action==='stop'){send(200,catalogJob.stop());return}
       if(input.action!=='start')throw Error('未知操作');
       if(knowledge.busy||resourceController.pending||activeRequests)throw Error('請先完成目前工作。');
       send(200,catalogJob.start(input.url));
      }catch(error){send(400,{error:error.message})}return;
    }
    if(incoming.url.split('?')[0]==='/api/knowledge'){
      const send=(status,value)=>{outgoing.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});outgoing.end(JSON.stringify(value))};
      if(incoming.headers.origin&&incoming.headers.origin!==`http://${host}`){send(403,{error:'來源不符'});return}
      try{
       if(incoming.method==='GET'){send(200,knowledge.state(new URL(`http://${host}${incoming.url}`).searchParams.get('brand')||'鴻鼎菓子',{includeEvidence:new URL(`http://${host}${incoming.url}`).searchParams.get('review')==='1'}));return}
       if(incoming.method!=='POST'||incoming.headers['x-agent-settings']!=='1'){send(403,{error:'設定請求格式錯誤'});return}
       const input=JSON.parse(body);if(pipeline.busy){if(['pause','resume','stop'].includes(input.action)){pipeline[input.action]();if(input.action==='stop')knowledge.stop();send(200,knowledge.state(input.brand||'鴻鼎菓子'));return}throw Error('一鍵分析進行中。')}if(input.action==='start'){if(catalogJob.busy)throw Error('請等待商品收集結束再建檔。');if(typeof input.brand!=='string'||typeof input.domain!=='string'||!input.config?.model)throw Error('品牌與模型設定不完整');send(200,knowledge.start(input))}
       else if(['pause','resume','stop'].includes(input.action)){knowledge[input.action]();send(200,knowledge.state(input.brand||'鴻鼎菓子'))}else send(400,{error:'未知操作'});
      }catch(error){send(400,{error:error.message})}return;
    }
    const request = new Request(`http://${host}${incoming.url}`, { method: incoming.method, headers, body });
    let progressId=null;
    if(incoming.url==='/api/images/ocr'&&incoming.method==='POST'){
      try{progressId=JSON.parse(body).progressId||null;if(progressId)imageProgress.start(progressId)}catch{outgoing.writeHead(400,{'content-type':'application/json'});outgoing.end(JSON.stringify({error:'圖片進度識別碼無效'}));return}
    }
    const requestEnv={...env};
    if (progressId) requestEnv.IMAGE_PROGRESS = value => imageProgress.update(progressId, value);
    if (incoming.url === '/api/health' && incoming.method === 'GET' && env.LOCAL_MODEL_ENABLED) {
      try {
        const tags = await globalThis.fetch('http://127.0.0.1:11434/api/tags', {signal: AbortSignal.timeout(1200)});
        if (tags.ok) requestEnv.INSTALLED_MODELS = (await tags.json()).models.map(model => model.name).filter(name => typeof name === 'string');
      } catch { /* Ollama can be offline while using a cloud model. */ }
    }
    activeRequests++;let response;try{response = await worker.fetch(request, requestEnv);if(progressId)imageProgress.finish(progressId,response.ok)}catch(error){if(progressId)imageProgress.finish(progressId,false);throw error}finally{activeRequests--}
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    outgoing.end(JSON.stringify({ error: "本機預覽無法完成請求。" }));
  }
};

if (zeroTierHost) {
  createServer(handleRequest).listen(port, zeroTierHost, () => {
    console.log(`ZeroTier: http://${zeroTierHost}:${port}`);
  });
}

createServer(handleRequest).listen(port, "127.0.0.1", () => {
  console.log(`AI Agent: http://localhost:${port}`);
  console.log(`Local model: ${env.LOCAL_MODEL_ENABLED ? env.LOCAL_MODEL : "disabled"} (Ollama on 127.0.0.1:11434)`);
  console.log(`Resource mode: headroom; ${resources.cpuThreads} inference threads; batch ${resources.numBatch}; one inference at a time; ${resources.cooldownMs}ms rest between requests.`);
  console.log("Web knowledge database: data/web-knowledge.sqlite");
  console.log("Edit source, then restart this command to rebuild. API keys are never logged.");
});
