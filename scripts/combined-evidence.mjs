import {sourceContext} from './source-context.mjs';
export function combinedEvidence(page, facts, limit = 24000) {
  const html = page.content || page.excerpt || '';
  const images = (page.images || []).map(image => {
    const read = (page.imageTextSources || []).find(s => s.url === image.url && s.status === 'read');
    return {url:image.url, context:sourceContext(page,{kind:'image',url:image.url}), status:read?'read':'unread',
      method:read?.model || read?.provider || '', text:(read?.text || '').slice(0,1800),
      truncated:(read?.text || '').length > 1800};
  });
  // Alternate source kinds so HTML cannot consume the whole model context before image evidence.
  const groups = [facts.filter(f=>f.kind!=='image'),facts.filter(f=>f.kind==='image')];
  const ordered=[];for(let i=0;i<Math.max(...groups.map(g=>g.length));i++)for(const group of groups)if(group[i])ordered.push(group[i]);
  const result={htmlText:html.replace(/\{\{[^}]*\}\}/g, " ").slice(0,5000),images:[],facts:[],coverage:{htmlTruncated:html.length>5000,totalFacts:facts.length,factsProvided:0,imagesFound:images.length,imagesRead:images.filter(i=>i.status==='read').length,imagesProvided:0,layoutVerified:false,dynamicBindingsDetected:/\{\{[^}]*\}\}/.test(html),renderedPurchaseSectionVerified:false}};
  for(const fact of ordered){result.facts.push(fact);if(JSON.stringify(result).length>limit/2)result.facts.pop()}
  for(const img of images){result.images.push(img);if(JSON.stringify(result).length>limit)result.images.pop()}
  result.coverage.factsProvided=result.facts.length;result.coverage.imagesProvided=result.images.length;
  return result;
}
