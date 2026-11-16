"""Apply source-backed adjudications; never convert unavailable citations to negatives.
Raw answers, hashes and capture files remain unchanged. Backup is mandatory.
"""
from pathlib import Path
import json, sqlite3, hashlib, datetime

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
BACKUP = DATA / 'backups/external-review-20261115'
PATH = DATA / 'external-observations/reviewed-observations.json'
assert (BACKUP / 'reviewed-observations.json').exists()
rows = json.loads(PATH.read_text(encoding='utf-8-sig'))
stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
# Individual semantic review of the saved full answers, excluding citation-chip labels.
positive = {
 '9f3db2de53666506': '若追求無添加的手工質感，BabyFace 與鴻鼎菓子則在 500 元預算內能提供相當精緻的常溫手工點心禮盒。',
 '3e2c339304032451': '鴻鼎菓子\t三色曲奇餅 / 堅果塔組合',
 'd5f066b0a67f9488': '鴻鼎菓子\t堅果塔、曲奇、手工餅乾',
 'ca05a144a84ea1dd': '禮盒組合彈性高，常溫保存期限長，長輩與平輩的接受度都很穩健。',
 '0ce12d0de1c6a366': '招牌心型堅果塔、人氣曲奇餅乾，減油減糖配方，口感層次分明、尾韻乾淨，適合辦公室與長輩。',
 'c19b150ffd4a45b0': '推薦禮盒範例：堅果塔結合曲奇餅或手工餅乾之常溫系列禮盒',
}
label_only = set('74f4bdfcf733c690 51f983d8142f40db 1e135a129459f342 3b89871a3a3946d5 3b9403b04986b3b4 176106eca19d6345 286296f165413014'.split())
# Browser UI review: all citation chips expanded for negative decisions.
negative_counts = dict(zip(
 'f8293ee316755bc5 8ea2700785661a37 94617690fe8d4f9a 76723fafc9b87f5a 25f6f5e055a665d3 5fc531ee6dc96fc4 7d63df2a42a9fe5e b970c8cb2e397628 3759fb0a80f58ad5 65955f44900b40ce 20ed0221d4e94496 9e4e45c67b2173f6 6e4526c67b2a2d19 ea95c5cf5877f469 913c4d605f53b79b 891bf3241841ace3 e3f85ae5e6c583e8 eae9d13b96fc70c0 212645d7426cc0b9 9f3db2de53666506 f09abce41a0d9298 f5069b39ddc96006 80cddc9fd6fbedc2 fc20701ae72d437d a2106712950d63c8 b890b068f465eb38'.split(),
 [3,18,12,19,27,19,25,17,23,24,1,20,13,10,22,19,25,9,19,25,0,18,26,21,23,4]))
official_urls = {k:'https://www.idodo.com.tw/page768.html' for k in ['74f4bdfcf733c690','51f983d8142f40db','1e135a129459f342']}
changes=[]
for row in rows:
 if row.get('status') != 'completed' or row.get('platform') != 'Gemini 網頁版': continue
 key=row['id'].removeprefix('gemini-')
 before={k:row.get(k) for k in ['brandMentioned','recommended','citationChecked','officialCited']}
 notes=[]
 if key in positive or key in label_only:
  yes=key in positive
  row['brandMentioned']=yes;row['recommended']=yes
  reason='正文將品牌列為符合提問需求的選購選項；此判定不表示價格、食安或試吃宣稱已核實。' if yes else '品牌名稱僅為引用來源標籤，正文討論或推薦其他品牌；不計入正文提及或推薦。'
  quote=positive.get(key,'鴻鼎菓子')
  assert quote in row['answer'], key
  row['semanticReview']={'version':'body-vs-citation-v2','reviewer':'Codex','reviewedAt':stamp,'basis':'saved_answer_semantic_review','quote':quote,'reason':reason}
  notes.append(reason)
  if key=='c19b150ffd4a45b0':
   row['captureQualityNote']='保存文字含兩段不同推薦清單銜接，提及及推薦依第一段明示文字判定；是否為單一回合完整輸出仍需回到原對話核對。'
 if key in negative_counts:
  row['citationChecked']=True;row['officialCited']=False
  row['citationReview']={'reviewer':'Codex','reviewedAt':stamp,'basis':'original_conversation_UI_and_saved_links','sourceUrl':row['sourceUrl'],'checkedChips':negative_counts[key],'totalChips':negative_counts[key],'reason':'原對話引用彈窗逐項展開，與保存連結核對，未找到 idodo.com.tw 官網網址。'}
  notes.append(row['citationReview']['reason'])
 elif key in official_urls:
  url=official_urls[key]
  row['citations']=list(dict.fromkeys([*row.get('citations',[]),url]))
  row['citationChecked']=True;row['officialCited']=True
  row['citationReview']={'reviewer':'Codex','reviewedAt':stamp,'basis':'original_conversation_UI','sourceUrl':row['sourceUrl'],'evidenceUrl':url,'reason':'展開品牌引用標籤，確認連結目標為官網；不代表引用內容正確。'}
  notes.append(row['citationReview']['reason'])
 if notes:
  row['reviewHistory']=row.get('reviewHistory',[])+[{'reviewedAt':stamp,'reviewer':'Codex','before':before,'notes':notes}]
  row['reviewer']='Codex';row['reviewNotes']=row.get('reviewNotes','')+'\n2026-11-15 複核：'+' '.join(notes)
  changes.append({'id':row['id'],'before':before,'after':{k:row.get(k) for k in before},'notes':notes})

def groups(data):
 result=[]
 for platform in sorted({r['platform'] for r in data}):
  complete=[r for r in data if r['platform']==platform and r['status']=='completed']
  g={'platform':platform,'completed':len(complete),'excluded':sum(r['platform']==platform and r['status']!='completed' for r in data)}
  for name,key in [('mention','brandMentioned'),('recommendation','recommended'),('citation','officialCited')]:
   checked=[r for r in complete if isinstance(r.get(key),bool) and (key!='officialCited' or r.get('citationChecked') is True)]
   yes=sum(r[key] is True for r in checked)
   g[name]={'numerator':yes,'denominator':len(checked),'pending':len(complete)-len(checked),'percent':100*yes/len(checked) if checked else None}
  result.append(g)
 return result

original=json.loads((BACKUP/'reviewed-observations.json').read_text(encoding='utf-8-sig'))
assert len(rows)==len(original)==204
assert all(a['answer']==b['answer'] and a.get('answerSha256')==b.get('answerSha256') for a,b in zip(rows,original))
summary=groups(rows)
audit_path=DATA/'codex-system-audit.json'
audit=json.loads(audit_path.read_text(encoding='utf-8-sig'))
audit['externalObservations']=rows;audit['externalGroups']=summary
audit['externalReview']={'reviewedAt':stamp,'method':'保存回答語意複核與原始 Gemini 引用彈窗核對','changes':len(changes),'limitation':'瀏覽器工具連線中斷，剩餘引用維持待查核。商品資訊正確性未判定。'}
with sqlite3.connect(DATA/'external-observations.sqlite') as db:
 for row in rows:
  db.execute('INSERT INTO observations(id,body,saved_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,saved_at=excluded.saved_at',(row['id'],json.dumps(row,ensure_ascii=False),stamp))
 assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
for path,value in [(PATH,rows),(audit_path,audit),(DATA/'external-observations/review-audit-20261115.json',{'reviewedAt':stamp,'groups':summary,'changes':changes,'pendingCitations':[r['id'] for r in rows if r['status']=='completed' and not r.get('citationChecked')]})]:
 temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
print(json.dumps({'groups':summary,'changed':len(changes)},ensure_ascii=False,indent=2))
