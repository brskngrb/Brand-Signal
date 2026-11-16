import {Agent,fetch as request} from 'undici';
// Agent and fetch must come from the same Undici version; Node's built-in
// fetch can use an incompatible dispatcher handler protocol.
export function createVisionTransport(){
 const dispatcher=new Agent({headersTimeout:0,bodyTimeout:0});
 const fetchVision=(url,options)=>request(url,{...options,dispatcher});
 fetchVision.close=()=>dispatcher.close();
 return fetchVision;
}
