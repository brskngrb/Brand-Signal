import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';

export function createPythonTransport(projectRoot,{python=process.env.AGENT_PYTHON||resolve(projectRoot,'.runtime/python/python.exe'),fallback=globalThis.fetch}={}){
 if(!existsSync(python))throw Error('Python Agent runtime missing. Run setup.bat or start.bat.');
 const children=new Set();process.once('exit',()=>{for(const child of children)child.kill()});
 return async(url,options={})=>{
  const match=/^http:\/\/127\.0\.0\.1:11434\/api\/(chat|generate)$/.exec(String(url));
  if(!match||options.method!=='POST'||typeof options.body!=='string')return fallback(url,options);
  options.signal?.throwIfAborted();
  const input=JSON.stringify({endpoint:match[1],payload:JSON.parse(options.body)});
  return new Promise((accept,reject)=>{
   const child=spawn(python,['-X','utf8',resolve(projectRoot,'agent.py'),'--bridge'],{cwd:projectRoot,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
   children.add(child);child.once('close',()=>children.delete(child));
   let bytes=0,settled=false;const chunks=[];
   const finish=(error,value)=>{if(settled)return;settled=true;options.signal?.removeEventListener('abort',cancel);if(error)reject(error);else accept(value)};
   const cancel=()=>{child.kill();finish(options.signal.reason||new DOMException('Aborted','AbortError'))};
   options.signal?.addEventListener('abort',cancel,{once:true});
   if(options.signal?.aborted){cancel();return}
   child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>20*1024*1024){child.kill();finish(Error('Python Agent response too large'))}else chunks.push(chunk)});
   child.stderr.resume(); // Never log prompts or image bytes from subprocesses.
   child.once('error',()=>finish(Error('Python Agent failed to start')));
   child.stdin.on('error',()=>{child.kill();finish(Error('Python Agent input failed'))});
   child.once('close',code=>{
    if(settled)return;
    if(code!==0){finish(Error('Python Agent exited unexpectedly'));return}
    try{const reply=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Number.isInteger(reply.status)||reply.status<200||reply.status>599||typeof reply.body!=='string')throw Error();finish(null,new Response(reply.body,{status:reply.status,headers:{'content-type':'application/json'}}))}catch{finish(Error('Invalid Python Agent response'))}
   });
   child.stdin.end(input);
  });
 };
}
