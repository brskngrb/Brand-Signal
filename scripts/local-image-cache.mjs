import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
const execute=promisify(execFile),digest=b=>createHash('sha256').update(b).digest('hex');
export async function createLocalImageCache(root){
 const folder=resolve(root,'data/image-downloads');await mkdir(folder,{recursive:true});
 let manifest={images:[]};try{manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'))}catch{}
 const known=new Map(manifest.images.map(i=>[i.url,i]));
 const load=async(url,download)=>{
  const href=String(url),old=known.get(href);let bytes,meta;
  if(old?.localPath&&resolve(old.localPath).startsWith(folder+'\\'))try{bytes=await readFile(old.localPath);if(old.sha256&&digest(bytes)!==old.sha256)bytes=null}catch{}
  if(!bytes){const source=await download();bytes=Buffer.from(source.base64,'base64');meta=await sharp(bytes).metadata();const path=join(folder,digest(href)+'.'+(meta.format==='jpeg'?'jpg':meta.format));await writeFile(path,bytes);known.set(href,{url:href,localPath:path,sha256:digest(bytes),bytes:bytes.length,width:meta.width,height:meta.height,status:'downloaded',format:meta.format});manifest.images=[...known.values()];await writeFile(join(folder,'manifest.json'),JSON.stringify(manifest,null,2))}
  meta||=await sharp(bytes).metadata();return {base64:bytes.toString('base64'),size:bytes.length,mimeType:'image/'+(meta.format==='jpg'?'jpeg':meta.format),localPath:known.get(href).localPath,sha256:digest(bytes),width:meta.width,height:meta.height};
 };
 const ocr=async(image,signal)=>{
  signal?.throwIfAborted();const key=image.sha256,dir=join(folder,'native-ocr',key);await mkdir(dir,{recursive:true});
  try{const saved=JSON.parse(await readFile(join(dir,'result.json'),'utf8'));if(saved.text)return saved}catch{}
  const paths=[];for(let top=0;top<image.height;top+=1800)for(let left=0;left<image.width;left+=1800){signal?.throwIfAborted();const path=join(dir,paths.length+'.png');await sharp(image.localPath).extract({left,top,width:Math.min(2000,image.width-left),height:Math.min(2000,image.height-top)}).flatten({background:'#fff'}).png().toFile(path);paths.push(path)}
  const input=join(dir,'input.json');await writeFile(input,JSON.stringify(paths));
  const {stdout}=await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve(root,'scripts/windows-image-ocr.ps1'),'-InputManifest',input],{windowsHide:true,signal,maxBuffer:8*1024*1024,encoding:'utf8'});
  const result=JSON.parse(stdout.replace(/^\uFEFF/,''));await writeFile(join(dir,'result.json'),JSON.stringify(result));return result;
 };
 return {load,ocr};
}
