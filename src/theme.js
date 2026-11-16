document.addEventListener('DOMContentLoaded', () => {
const root = document.documentElement;
const modeKey = 'signal.appearance-mode';
const darkToggle = document.querySelector('#appearance-dark');
try { darkToggle.checked = localStorage.getItem(modeKey) === 'dark'; } catch {}
root.dataset.theme = darkToggle.checked ? 'dark' : 'light';
const dialog=document.querySelector('#settings');
const palette=[['--bg','頁面背景','#f7f8f2'],['--surface','卡片背景','#fffefa'],['--ink','主要文字','#203b30'],['--muted','次要文字','#78867c'],['--green','按鈕與主色','#295640'],['--line','邊框','#dfe5db'],['--soft','柔和底色','#f0f3e9'],['--side','側欄背景','#19372c']];
let colors={};try{colors=JSON.parse(localStorage.getItem('signal.appearance-colors')||'{}')||{}}catch{}
function saveColors(){try{localStorage.setItem('signal.appearance-colors',JSON.stringify(colors))}catch{/* Private storage can be unavailable. */}}
function applyColor(key,value){document.documentElement.style.setProperty(key,value);colors[key]=value;if(key==='--green'){const rgb=value.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);const lum=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;document.documentElement.style.setProperty('--button-ink',lum>.179?'#14251c':'#ffffff')}}
const wheel=document.querySelector('#color-wheel'),ctx=wheel.getContext('2d');
const brightness=document.querySelector('#brightness'),hexField=document.querySelector('#wheel-hex'),wheelError=document.querySelector('#wheel-error');
const selected='--green';
let hue=0,saturation=0,value=1;
function hsv(h,s,v){const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return rgb.map(n=>Math.round((n+m)*255))}
function fromHex(hex){const rgb=hex.slice(1).match(/../g).map(n=>parseInt(n,16)/255),max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;let h=0;if(d){if(max===rgb[0])h=60*((rgb[1]-rgb[2])/d%6);else if(max===rgb[1])h=60*((rgb[2]-rgb[0])/d+2);else h=60*((rgb[0]-rgb[1])/d+4)}return [(h+360)%360,max?d/max:0,max]}
function draw(){const size=wheel.width,r=size/2,img=ctx.createImageData(size,size);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const dx=x+.5-r,dy=y+.5-r,s=Math.hypot(dx,dy)/(r-1);if(s>1)continue;const h=(Math.atan2(dy,dx)*180/Math.PI+360)%360,i=(y*size+x)*4;const rgb=hsv(h,s,value);img.data[i]=rgb[0];img.data[i+1]=rgb[1];img.data[i+2]=rgb[2];img.data[i+3]=255}ctx.putImageData(img,0,0)}
function cursor(){const angle=hue*Math.PI/180;document.querySelector('#wheel-cursor').style.left=(50+Math.cos(angle)*saturation*49.64)+'%';document.querySelector('#wheel-cursor').style.top=(50+Math.sin(angle)*saturation*49.64)+'%'}
function applyTheme(hex) {
  const base = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16));
  const mix = (target, amount) => '#' + base.map((channel, i) =>
    Math.round(channel * (1 - amount) + target[i] * amount).toString(16).padStart(2, '0')
  ).join('');
  const light = [255, 254, 250], dark = [16, 24, 21];
  const theme = {
    '--bg': mix(light, .96), '--surface': mix(light, .99),
    '--ink': mix(dark, .78), '--muted': mix(dark, .55),
    '--green': hex, '--line': mix(light, .84),
    '--soft': mix(light, .91), '--side': mix(dark, .55),
    '--active-nav': mix(light, .83)
  };
  if (darkToggle.checked) {
    Object.assign(theme, {
      '--bg': mix(dark, .93), '--surface': mix(dark, .82),
      '--surface-raised': mix(dark, .72), '--ink': mix(light, .96),
      '--muted': mix(light, .72), '--line': mix(light, .27),
      '--soft': mix(dark, .72), '--side': mix(dark, .65),
      '--active-nav': mix(dark, .55)
    });
  }
  Object.entries(theme).forEach(([key, color]) => applyColor(key, color));
}
darkToggle.addEventListener('change', () => {
  root.dataset.theme = darkToggle.checked ? 'dark' : 'light';
  applyTheme(colors[selected]);
  try { localStorage.setItem(modeKey, root.dataset.theme); } catch {}
});
function commit() {
  const hex = '#' + hsv(hue, saturation, value).map(n => n.toString(16).padStart(2, '0')).join('');
  applyTheme(hex);
  saveColors();
  hexField.value = hex.toUpperCase();
  hexField.removeAttribute('aria-invalid');
  wheelError.hidden = true;
  cursor();
}
function select(hex) {
  applyTheme(hex);
  [hue, saturation, value] = fromHex(hex);
  brightness.value = String(value * 100);
  hexField.value = hex.toUpperCase();
  hexField.removeAttribute('aria-invalid');
  wheelError.hidden = true;
  draw();
  cursor();
}
function pick(e){const rect=wheel.getBoundingClientRect(),x=e.clientX-rect.left-rect.width/2,y=e.clientY-rect.top-rect.height/2;hue=(Math.atan2(y,x)*180/Math.PI+360)%360;saturation=Math.min(1,Math.hypot(x,y)/(rect.width/2-1));commit()}
wheel.onpointerdown=e=>{if(e.button!==0)return;wheel.setPointerCapture(e.pointerId);pick(e)};wheel.onpointermove=e=>{if(wheel.hasPointerCapture(e.pointerId))pick(e)};wheel.onpointerup=e=>{if(wheel.hasPointerCapture(e.pointerId))wheel.releasePointerCapture(e.pointerId)};
brightness.oninput=()=>{value=Number(brightness.value)/100;draw();commit()};
hexField.oninput=()=>{let hex=hexField.value.trim();if(!hex.startsWith('#'))hex='#'+hex;if(/^#[0-9a-f]{3}$/i.test(hex))hex='#'+[...hex.slice(1)].map(c=>c+c).join('');const valid=/^#[0-9a-f]{6}$/i.test(hex);hexField.setAttribute('aria-invalid',String(!valid));wheelError.hidden=valid;if(valid){applyTheme(hex);saveColors();[hue,saturation,value]=fromHex(hex);brightness.value=String(value*100);draw();cursor()}};
document.querySelector('#settings-close').onclick=()=>dialog.close();document.querySelector('#finish-colors').onclick=()=>dialog.close();
const defaultColor = '#295640';
document.querySelector('#reset-colors').onclick = () => {
  darkToggle.checked = false;
  darkToggle.dispatchEvent(new Event('change'));
  select(defaultColor);
  saveColors();
};
select(/^#[0-9a-f]{6}$/i.test(colors[selected]) ? colors[selected] : defaultColor);


const textSize = document.querySelector("#text-size");
const textSizeValue = document.querySelector("#text-size-value");
function showTextSize() {
  document.documentElement.style.fontSize = textSize.value + "%";
  textSizeValue.value = textSize.value + "%";
}
try { textSize.value = localStorage.getItem("signal.appearance-text-size") || "100"; } catch {}
showTextSize();
textSize.addEventListener("input", () => {
  showTextSize();
  try { localStorage.setItem("signal.appearance-text-size", textSize.value); } catch {}
});
document.querySelector("#reset-colors").addEventListener("click", () => {
  textSize.value = "100";
  textSize.dispatchEvent(new Event("input"));
});


function syncSidebar() {
  const button = document.querySelector('#sidebar-toggle');
  if (!button) return;
  const expanded = !root.classList.contains('sidebar-collapsed');
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', expanded ? '收起側邊欄' : '展開側邊欄');
}
new MutationObserver(syncSidebar).observe(document.querySelector('#app'), {childList:true});
syncSidebar();
document.addEventListener('click', event => {
  if (event.target.closest('[data-theme-toggle]')) dialog.showModal();
  if (event.target.closest('#sidebar-toggle')) {
    root.classList.toggle('sidebar-collapsed');
    syncSidebar();
  }
});
});
