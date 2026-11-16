export function createImageProgress(){
 const jobs=new Map();
 return {
  start(id){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||jobs.has(id))throw Error('圖片進度識別碼無效或重複');
   for(const [key,value] of jobs)if(value.status!=='running'&&jobs.size>=100)jobs.delete(key);
   if(jobs.size>=100)throw Error('同時進行的圖片工作過多');
   jobs.set(id,{status:'running',stage:'準備讀取圖片',completed:0,total:null,percent:null,startedAt:Date.now()});
  },
  update(id,value){const job=jobs.get(id);if(!job||job.status!=='running')return;
   if(typeof value.stage==='string')job.stage=value.stage;
   if(Number.isInteger(value.total)&&value.total>0)job.total=value.total;
   if(Number.isInteger(value.completed)&&value.completed>=job.completed)job.completed=value.completed;
   job.percent=job.total?Math.min(99,Math.floor(job.completed/job.total*100)):null;
  },
  finish(id,ok){const job=jobs.get(id);if(!job)return;job.status=ok?'completed':'failed';job.stage=ok?'辨識完成':'辨識未完成，可重試';if(ok){job.completed=job.total;job.percent=100}},
  get(id){const job=jobs.get(id);return job?{...job,elapsedSeconds:Math.floor((Date.now()-job.startedAt)/1000)}:null}
 };
}
