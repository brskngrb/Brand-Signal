import {spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createInterface} from 'node:readline';

export function createPrototypeObservation(root, apiKey) {
  const readConfig = file => JSON.parse(readFileSync(resolve(root, file), 'utf8').replace(/^\uFEFF/, ''));
  const queries = readConfig('queries.json').queries;
  const brand = readConfig('brand.json').brand;
  let child = null;
  let job = {status: 'idle', total: 0, done: 0, saved: 0, failed: 0};

  function history(file, historical) {
    const path = resolve(root, 'data', file);
    if (!existsSync(path)) return [];
    const db = new DatabaseSync(path, {readOnly: true});
    try {
      return db.prepare('SELECT * FROM observations WHERE brand=? ORDER BY rowid DESC LIMIT ?').all(brand, historical ? 100 : 20)
        .map(row => ({...row, historical, search_results: JSON.parse(row.search_results),
          mention_positions: JSON.parse(row.mention_positions), competitors: JSON.parse(row.competitors)}));
    } finally { db.close(); }
  }

  function searchTotals() {
    const path = resolve(root, 'data', 'brand_observations.db');
    if (!existsSync(path)) return {hits: 0, total: 0};
    const db = new DatabaseSync(path, {readOnly: true});
    try {
      return db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(mentioned = 1), 0) AS hits FROM observations WHERE brand=?').get(brand);
    } finally { db.close(); }
  }

  return {
    get busy() { return child !== null; },
    state() {
      let codexAudit=null;try{codexAudit=readConfig('data/codex-system-audit.json')}catch{}
      return {codexAudit, brand, queries, configured: Boolean(apiKey), job: {...job}, searchTotals: searchTotals(),
        rows: [...history('brand_observations.db', false), ...history('prototype-observations.sqlite', true)]};
    },
    start(index) {
      if (child) throw Error('原型批次仍在執行。');
      if (!apiKey) throw Error('請先在專案 .env 設定 TAVILY_API_KEY，再重啟系統。');
      if (!Number.isInteger(index) || index < 0 || index > queries.length) throw Error('題目索引無效。');
      job = {status: 'running', total: index ? 1 : queries.length, done: 0, saved: 0, failed: 0};
      const args = ['-X', 'utf8', resolve(root, 'agent.py'), '--search'];
      if (index) args.push('--query-index', String(index));
      child = spawn(resolve(root, '.runtime/python/python.exe'), args, {
        cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
        env: {...process.env, PYTHONDONTWRITEBYTECODE: '1', TAVILY_API_KEY: apiKey}
      });
      const lines = createInterface({input: child.stdout});
      lines.on('line', line => {
        const progress = /^BATCH_PROGRESS (\d+) (saved|failed)$/.exec(line);
        if (progress) {
          job.done = Number(progress[1]);
          job[progress[2]]++;
        }
      });
      child.on('error', () => { job.error = '無法啟動專案的 Python。'; });
      child.on('close', code => {
        child = null;
        job.status = job.status === 'stopping' ? 'stopped' : code === 0 ? 'completed' : job.saved ? 'partial' : 'failed';
        if (code !== 0 && job.status !== 'stopped' && !job.error) job.error = '部分題目未完成，請確認 Ollama 模型與 Tavily 金鑰可用。';
      });
    },
    stop() {
      if (!child) return;
      job.status = 'stopping';
      child.kill();
    }
  };
}
