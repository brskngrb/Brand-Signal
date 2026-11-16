import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAgentSettings,RESOURCE_PRESETS} from '../scripts/agent-settings.mjs';
import {createResourceController,normalizeResources,loadResources} from '../scripts/resource-control.mjs';
test('settings API validates, saves, reapplies resources, preserves model metadata, and protects active work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bakery-settings-'));let model;
 const controller=createResourceController({cooldownMs:0});
 const handler=createAgentSettings({projectRoot:root,controller,onModel:value=>{model=value}});
 const server=createServer((req,res)=>{if(!handler.handle(req,res)){res.writeHead(404);res.end()}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const save=(value,headers={})=>fetch(base+'/api/agent/settings',{method:'PUT',headers:{'content-type':'application/json','x-agent-settings':'1',...headers},body:JSON.stringify(value)});
 try{
  await mkdir(join(root,'.runtime'));await writeFile(join(root,'.runtime/agent-model.json'),'\uFEFF'+JSON.stringify({model:'old',hardware:'preserve'}));
  const resources=normalizeResources(RESOURCE_PRESETS.eco),input={localModel:'qwen3.5:27b',resources};
  assert.equal((await save(input,{origin:'https://evil.example'})).status,403);
  assert.equal((await save(input,{'x-agent-settings':''})).status,403);
  assert.equal((await save({...input,resources:{...resources,numBatch:999}})).status,400);
  assert.equal((await save({...input,localModel:'../../bad model'})).status,400);
  const live=controller.wrap(async()=>new Response('active'));const response=await live('http://127.0.0.1:11434/api/chat',{method:'POST',body:'{}'});
  assert.equal((await save(input)).status,409);await response.text();
  const updated=await save(input);assert.equal(updated.status,200);const description=await updated.json();assert.equal(description.restartRequired,true);assert.equal(description.transport,'agent.py');assert.equal(description.preset,'eco');assert.equal(model,input.localModel);
  assert.deepEqual(controller.config,resources);assert.deepEqual(await loadResources(root),resources);
  const file=JSON.parse(await readFile(join(root,'.runtime/agent-model.json'),'utf8'));assert.equal(file.model,input.localModel);assert.equal(file.hardware,'preserve');
  assert.equal((await (await fetch(base+'/api/agent/settings')).json()).localModel,input.localModel);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}
});
