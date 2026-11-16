"""Review saved evidence only; incomplete URL capture cannot prove absence."""
from pathlib import Path
import json, sqlite3, datetime, shutil, hashlib
from urllib.parse import urlparse

root = Path(__file__).resolve().parents[1]
data = root / 'data'
folder = data / 'external-observations'
path = folder / 'reviewed-observations.json'
stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
backup = data / 'backups' / ('saved-review-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
backup.mkdir(parents=True)
for p in [path, data / 'codex-system-audit.json']:
    shutil.copy2(p, backup / p.name)
with sqlite3.connect(data / 'external-observations.sqlite') as src, sqlite3.connect(backup / 'external-observations.sqlite') as dst:
    src.backup(dst)
rows = json.loads(path.read_text(encoding='utf-8-sig'))
original = {r['id']: (r['answer'], r.get('answerSha256')) for r in rows}
checks = []
def official(url):
    host = (urlparse(url).hostname or '').lower()
    return host == 'idodo.com.tw' or host.endswith('.idodo.com.tw')

for row in rows:
    if row['status'] != 'completed' or row.get('citationChecked'):
        continue
    rawpath = folder / ('retest-' + row['id'].removeprefix('gemini-') + '.json')
    raw = json.loads(rawpath.read_text(encoding='utf-8-sig'))
    urls = list(dict.fromkeys([*row.get('citations', []), *raw.get('links', [])]))
    evidence = [u for u in urls if isinstance(u, str) and official(u)]
    review = {'reviewedAt': stamp, 'reviewer': 'Codex', 'basis': 'saved_records_only',
              'rawFile': str(rawpath.relative_to(root)), 'rawSha256': hashlib.sha256(rawpath.read_bytes()).hexdigest(),
              'savedUrlCount': len(urls), 'officialUrls': evidence,
              'reason': '保存的實際連結可確認官網引用。' if evidence else '已核對保存回答及網址；未保存完整引用彈窗，不能據此判定未引用官網。'}
    if 'www.idodo.com.tw' in raw.get('answer', '') and not evidence:
        review['domainTextEvidence'] = '正文保存 www.idodo.com.tw 字樣，但未保存對應超連結目標；依實際連結標準維持待查核。'
    row['savedEvidenceReview'] = review
    if evidence:
        row.update(citations=urls, citationChecked=True, officialCited=True)
    checks.append({'id': row['id'], **review})

suspect = next(r for r in rows if r['id'] == 'gemini-c19b150ffd4a45b0')
assert '享有免運優惠試吃乙次為您挑選了 4 家' in suspect['answer']
suspect['captureReview'] = {'reviewedAt': stamp, 'reviewer': 'Codex', 'previousStatus': 'completed',
    'basis': 'saved_answer_and_original_capture', 'decision': 'exclude_pending_integrity_review',
    'quote': '享有免運優惠試吃乙次為您挑選了 4 家',
    'reason': '原始擷取檔與保存回答皆含未完成段落接上另一份推薦清單，無法確認單一完整回合；保留原文及既有語意標記，暫不納入各指標分母。'}
suspect['status'] = 'pending'
suspect['captureQualityNote'] = suspect['captureReview']['reason']

groups = []
for platform in sorted({r['platform'] for r in rows}):
    valid = [r for r in rows if r['platform'] == platform and r['status'] == 'completed']
    group = {'platform': platform, 'completed': len(valid), 'excluded': sum(r['platform'] == platform and r['status'] != 'completed' for r in rows)}
    for name, key in [('mention', 'brandMentioned'), ('recommendation', 'recommended'), ('citation', 'officialCited')]:
        checked = [r for r in valid if isinstance(r.get(key), bool) and (key != 'officialCited' or r.get('citationChecked') is True)]
        yes = sum(r[key] is True for r in checked)
        group[name] = {'numerator': yes, 'denominator': len(checked), 'pending': len(valid)-len(checked), 'percent': 100*yes/len(checked) if checked else None}
    groups.append(group)
report = {'reviewedAt': stamp, 'method': 'local_saved_evidence_only', 'groups': groups, 'checkedRecords': checks,
          'excludedIntegrity': suspect['id'], 'pendingCitations': [r['id'] for r in rows if r['status'] == 'completed' and not r.get('citationChecked')],
          'limitation': '已檢查全部剩餘保存紀錄；缺少完整引用網址者保留未知。引用率僅為已查核子集，不代表全體。未查核商品事實正確性。'}
auditpath = data / 'codex-system-audit.json'
audit = json.loads(auditpath.read_text(encoding='utf-8-sig'))
audit.update(externalObservations=rows, externalGroups=groups, externalReview={'reviewedAt': stamp, 'method': report['method'], 'limitation': report['limitation']})
assert all((r['answer'], r.get('answerSha256')) == original[r['id']] for r in rows)
with sqlite3.connect(data / 'external-observations.sqlite') as db:
    for row in rows:
        db.execute('UPDATE observations SET body=?,saved_at=? WHERE id=?', (json.dumps(row, ensure_ascii=False), stamp, row['id']))
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
for target, value in [(path, rows), (auditpath, audit), (folder / 'saved-record-review-20261115.json', report)]:
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(target)
with sqlite3.connect(data / 'external-observations.sqlite') as db:
    stored = {i: json.loads(b) for i,b in db.execute('SELECT id,body FROM observations')}
assert all(stored[r['id']] == r for r in rows)
print(json.dumps({'groups': groups, 'savedRecordsChecked': len(checks), 'backup': str(backup)}, ensure_ascii=True, indent=2))
