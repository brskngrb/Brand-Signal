// A deliberately small Markdown renderer. Raw HTML is always text.
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function markdownInline(value,depth=0){
 const text=String(value??'');if(depth>8)return escape(text);
 const pattern=/\\([\\`*_{}\[\]()#+.!>~-])|`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*\*([^\n]+?)\*\*\*|\*\*([^\n]+?)\*\*|__([^\n]+?)__|~~([^\n]+?)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
 let out='',end=0;
 for(const m of text.matchAll(pattern)){
  out+=escape(text.slice(end,m.index));end=m.index+m[0].length;
  if(m[1])out+=escape(m[1]);
  else if(m[2])out+='<code>'+escape(m[2])+'</code>';
  else if(m[3]){let url;try{url=new URL(m[4]);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)url=null}catch{}out+=url?`<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${markdownInline(m[3],depth+1)}</a>`:escape(m[0])}
  else {const tag=m[5]?'strong':m[6]||m[7]?'strong':m[8]?'del':'em';const body=markdownInline(m[5]||m[6]||m[7]||m[8]||m[9]||m[10],depth+1);out+=`<${tag}>${m[5]?'<em>'+body+'</em>':body}</${tag}>`}
 }
 return out+escape(text.slice(end));
}
export function renderMarkdown(value){
 const lines=String(value??'').replace(/\r\n?/g,'\n').split('\n');let html='',i=0;
 const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(v=>v.trim());
 const divider=line=>/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line||'');
 while(i<lines.length){
  let line=lines[i],match;
  if(!line.trim()){i++;continue}
  if((match=line.match(/^\s*(`{3,}|~{3,})(.*)$/))){const fence=match[1],body=[];i++;while(i<lines.length&&!lines[i].trim().startsWith(fence))body.push(lines[i++]);if(i<lines.length)i++;html+='<pre><code>'+escape(body.join('\n'))+'</code></pre>';continue}
  if((match=line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/))){const level=Math.min(6,match[1].length+1);html+=`<h${level}>${markdownInline(match[2])}</h${level}>`;i++;continue}
  if(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)){html+='<hr>';i++;continue}
  if(line.includes('|')&&divider(lines[i+1])){const headers=cells(line);i+=2;html+='<div class="markdown-table"><table><thead><tr>'+headers.map(v=>'<th>'+markdownInline(v)+'</th>').join('')+'</tr></thead><tbody>';while(i<lines.length&&lines[i].includes('|')&&lines[i].trim()){const row=cells(lines[i++]);html+='<tr>'+headers.map((_,k)=>'<td>'+markdownInline(row[k]||'')+'</td>').join('')+'</tr>'}html+='</tbody></table></div>';continue}
  if(/^\s*>/.test(line)){const body=[];while(i<lines.length&&/^\s*>/.test(lines[i]))body.push(lines[i++].replace(/^\s*>\s?/,''));html+='<blockquote>'+body.map(v=>markdownInline(v)).join('<br>')+'</blockquote>';continue}
  if((match=line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/))){const tag=match[2]?'ol':'ul';html+=`<${tag}>`;while(i<lines.length){const item=lines[i].match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);if(!item||(item[2]?'ol':'ul')!==tag)break;html+='<li>'+markdownInline(item[3])+'</li>';i++}html+=`</${tag}>`;continue}
  const body=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^\s*(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|`{3}|~{3}|-{3}|\*{3}|_{3})/.test(lines[i])&&!divider(lines[i+1]))body.push(lines[i++]);html+='<p>'+body.map(v=>markdownInline(v)).join('<br>')+'</p>';
 }
 return html;
}
