import test from 'node:test';
import assert from 'node:assert/strict';
import {pageRole,sourceContext,constrainFact} from '../scripts/source-context.mjs';
import {crawlBrand} from '../worker/crawl.js';
import {normalizeResearchReport} from '../src/research.js';
const fact={scope:'product',category:'餅乾',product:'奶油餅乾',field:'成分',value:'奶油',quote:'成分：奶油'};
test('promotion cannot become product or brand policy; flavor is not ingredients',()=>{
 const context=sourceContext({url:'https://www.idodo.com.tw/page24.html',title:'奶油餅乾推薦'}, {kind:'html'});
 assert.equal(constrainFact(fact,context).scope,'unassigned');
 assert.equal(constrainFact({...fact,scope:'brand_policy'},context).scope,'unassigned');
 assert.equal(constrainFact({...fact,quote:'三種口味'}, {...context,pageRole:'product'}).scope,'unassigned');
});
test('image attribution uses page-local neighbors, never cached OCR from another page',()=>{
 const page={url:'https://www.idodo.com.tw/product546.html',title:'禮盒',images:[{url:'https://www.idodo.com.tw/a.jpg',context:{version:1,before:'奶油餅乾',after:'保存30天'}}]};
 const context=sourceContext(page,{kind:'image',url:page.images[0].url});
 assert.equal(constrainFact(fact,context).scope,'product');
 assert.equal(constrainFact({...fact,product:'巧克力餅乾'},context).scope,'unassigned');
 assert.equal(constrainFact(fact,sourceContext({...page,images:[]},{kind:'image',url:page.images[0].url})).scope,'unassigned');
});
test('crawler prioritizes product link and preserves neighboring text through normalization',async()=>{
 const html='<title>商品</title><body><a href="/page19.html">企業福委配送</a><a href="/product546.html">奶油餅乾</a><h2>奶油餅乾</h2><p>本款成分如下</p><img src="/a.jpg"><p>保存30天</p><img src="/b.jpg"><p>其他商品</p></body>';
 const result=await crawlBrand({url:'https://www.idodo.com.tw/',maxPages:1},{includeContent:true,fetchImpl:async url=>new Response(String(url).endsWith('robots.txt')?'User-agent: *\nAllow: /':html,{headers:{'content-type':String(url).endsWith('robots.txt')?'text/plain':'text/html'}})});
 assert.equal(result.pages[0].links[0],'https://www.idodo.com.tw/product546.html');
 const image=normalizeResearchReport({domain:'https://www.idodo.com.tw/',crawl:result}).crawl.pages[0].images[0];
 assert.equal(image.context.heading,'奶油餅乾');assert.match(image.context.after,/保存30天/);assert.ok(!image.context.after.includes('其他商品'));
});

test('category catalog reads returned IDs only, excludes promotions and separates product identities',async()=>{
 const calls=[];
 const result=await crawlBrand({url:'https://www.idodo.com.tw/category.html',maxPages:3},{includeContent:true,fetchImpl:async(url,options)=>{
  calls.push({url,method:options.method,body:options.body});
  if(url.endsWith('robots.txt'))return new Response('User-agent: *\nAllow: /');
  if(options.method==='POST')return Response.json({product_list:[{ID:595},{ID:546},{ID:'../admin'}]});
  if(url.endsWith('category.html'))return new Response(`<title>商品總覽</title><script>const csrf = 'test'; const code='get_product_list';</script><a href="category3.html">禮盒</a><a href="page24.html">宣傳</a>`,{headers:{'content-type':'text/html'}});
  return new Response('<title>同名禮盒</title><p>成分</p>',{headers:{'content-type':'text/html'}});
 }});
 assert.deepEqual(result.pages.map(p=>new URL(p.url).pathname),['/category.html','/product595.html','/product546.html']);
 assert.equal(result.catalog.pending,1);assert.equal(result.catalog.complete,false);
 assert.equal(result.pages[0].catalog.productsDiscovered,2);
 assert.ok(!calls.some(c=>c.url.includes('page24')||c.url.includes('product594')));
 assert.equal(new URLSearchParams(calls.find(c=>c.method==='POST').body).get('code'),'get_product_list');
 assert.equal(pageRole(result.pages[0]),'category');
 assert.equal(sourceContext(result.pages[1],{kind:'html'}).productId,'595');
 assert.equal(sourceContext(result.pages[2],{kind:'html'}).productId,'546');
});
test('failed dynamic category list remains explicitly incomplete',async()=>{
 const result=await crawlBrand({url:'https://www.idodo.com.tw/category3.html',maxPages:1},{fetchImpl:async(url,options)=>url.endsWith('robots.txt')?new Response('User-agent: *\nAllow: /'):options.method==='POST'?new Response('denied',{status:403}):new Response("<script>const code='get_product_list';</script>",{headers:{'content-type':'text/html'}})});
 assert.equal(result.pages[0].catalog.status,'failed');assert.equal(result.catalog.complete,false);assert.match(result.pages[0].issues.join(''),/不代表此分類沒有商品/);
});
