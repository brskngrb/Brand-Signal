import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPythonTransport} from '../scripts/python-transport.mjs';
import {createResourceController} from '../scripts/resource-control.mjs';
const projectRoot=fileURLToPath(new URL('..',import.meta.url));
const python=process.env.AGENT_PYTHON||resolve(projectRoot,'.runtime/python/python.exe');
test('real Python Agent transport: text, images, saved model/profile, HTTP errors, redirect refusal and cancellation',{skip:!existsSync(python)},async()=>{
 const root=await mkdtemp(join(tmpdir(),'bakery-python-'));
 const received=[],sockets=new Set();let requestStarted;
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const payload=JSON.parse(Buffer.concat(chunks));received.push(payload);requestStarted?.();
  if(payload.prompt==='slow')return;
  if(payload.prompt==='redirect'){res.writeHead(302,{location:'http://example.com'});res.end();return}
  if(payload.prompt==='missing'){res.writeHead(404);res.end('{}');return}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({message:{content:'已辨識：運費 150 元'},response:'已分析'}));
 });
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket))});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await mkdir(join(root,'.runtime'));
  await writeFile(join(root,'.runtime/agent-model.json'),JSON.stringify({model:'qwen3.5:27b'}));
  await writeFile(join(root,'.runtime/resource-settings.json'),JSON.stringify({cpuThreads:3,numBatch:64,keepAliveSeconds:30}));
  // Test-only wrapper redirects the real Python module to our local stub, never the user's Ollama.
  await writeFile(join(root,'agent.py'),`import runpy\nfrom pathlib import Path\nm=runpy.run_path(${JSON.stringify(resolve(projectRoot,'agent.py'))})\ng=m['infer'].__globals__\ng['ROOT']=Path(${JSON.stringify(root)})\ng['OLLAMA_URL']='http://127.0.0.1:${server.address().port}'\nm['main']()\n`);
  const transport=createPythonTransport(root,{python});
  const call=(payload,signal)=>transport('http://127.0.0.1:11434/api/chat',{method:'POST',body:JSON.stringify(payload),signal});
  const views=['aGVsbG8=','c2Vjb25k'];
  assert.match((await (await call({messages:[{role:'user',content:'辨識圖片',images:views}],options:{num_ctx:32768,num_predict:8192,temperature:0}})).json()).message.content,/150/);
  assert.equal(received[0].model,'qwen3.5:27b');assert.equal(received[0].options.num_thread,3);assert.equal(received[0].options.num_batch,64);assert.equal(received[0].keep_alive,'30s');assert.deepEqual(received[0].messages[0].images,views);assert.equal(received[0].options.num_ctx,32768);assert.equal(received[0].options.num_predict,8192);
  const gate=createResourceController({cpuThreads:4,numBatch:128,cooldownMs:0});const queued=gate.wrap(transport);
  await (await queued('http://127.0.0.1:11434/api/generate',{method:'POST',body:JSON.stringify({model:'qwen3.5:4b',prompt:'text'})})).text();assert.equal(received.at(-1).model,'qwen3.5:4b');assert.equal(received.at(-1).options.num_thread,4);
  assert.equal((await call({prompt:'missing'})).status,404);assert.equal((await call({prompt:'redirect'})).status,302);
  const controller=new AbortController();const started=new Promise(resolve=>{requestStarted=resolve});
  const failure=assert.rejects(queued('http://127.0.0.1:11434/api/chat',{method:'POST',body:JSON.stringify({prompt:'slow'}),signal:controller.signal}),{name:'AbortError'});
  await started;requestStarted=null;controller.abort();await failure;assert.equal(gate.pending,0);
  await (await queued('http://127.0.0.1:11434/api/chat',{method:'POST',body:JSON.stringify({prompt:'after abort'})})).text();
 }finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}
});
