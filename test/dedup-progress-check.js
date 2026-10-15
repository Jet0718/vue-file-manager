/* 重整進度測試：掃描／刪除的進度回報，以及暫停、繼續、中止等控制 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const PORT = 4391;
const BASE = `http://127.0.0.1:${PORT}`;
const SCAN_DIR = '/tmp/fmtest-dedup-progress';
const DEL_DIR = '/tmp/fmtest-dedup-progress-del';
const DATA_DIR = '/tmp/fmtest-dedup-progress-data';

const N_SCAN = 800;                 // 同大小檔案數（供內容雜湊比對）
const BLOB = 128 * 1024;            // 每個檔案大小（≈100MB 總量，足以觀察進度）
const N_DEL = 3000;                 // 刪除工作檔案數（足以觀察進度）

function setupScanDir() {
  fs.rmSync(SCAN_DIR, { recursive: true, force: true });
  fs.mkdirSync(SCAN_DIR, { recursive: true });
  const buf = Buffer.alloc(BLOB);
  for (let i = 0; i < N_SCAN; i++) {
    buf.fill(String(i % 10));       // 10 種內容 → 10 組重複
    fs.writeFileSync(path.join(SCAN_DIR, `dup-${i}.bin`), buf);
  }
}
function setupDelDir() {
  fs.rmSync(DEL_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEL_DIR, { recursive: true });
  for (let i = 0; i < N_DEL; i++) fs.writeFileSync(path.join(DEL_DIR, `f${i}.txt`), 'x');
}
setupScanDir();
setupDelDir();

const server = spawn('node', ['server.js'], {
  cwd: PROJECT,
  env: { ...process.env, PORT: String(PORT), FM_DATA_DIR: DATA_DIR },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(label, cond) {
  results.push({ label, cond });
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : '  ← 失敗'}`);
}
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  try { return await res.json(); } catch { return {}; }
}
async function getJSON(url) {
  const res = await fetch(url);
  try { return await res.json(); } catch { return {}; }
}
async function waitState(jobId, states, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await getJSON(`${BASE}/api/dedup/status?id=${jobId}`);
    if (states.includes(s.state)) return s;
    await sleep(40);
  }
  return null;
}

async function main() {
  await sleep(1200);

  /* ---------- 掃描：進度、暫停、繼續 ---------- */
  let d = await postJSON(`${BASE}/api/dedup/start`, { dir: SCAN_DIR });
  check('1a) 建立掃描工作並回傳 jobId', d.ok && !!d.jobId);
  const scanId = d.jobId;

  let s = await getJSON(`${BASE}/api/dedup/status?id=${scanId}`);
  check('1b) 狀態含進度欄位', s.ok && typeof s.scanned === 'number'
    && typeof s.hashTotal === 'number' && typeof s.percent !== 'undefined' && typeof s.elapsedMs === 'number');

  let p = await postJSON(`${BASE}/api/dedup/pause`, { id: scanId });
  check('2a) 暫停後狀態為 paused', p.state === 'paused');
  // 允許暫停前已在進行中的那一項完成，之後進度必須完全靜止
  await sleep(300);
  const s1 = await getJSON(`${BASE}/api/dedup/status?id=${scanId}`);
  await sleep(300);
  s = await getJSON(`${BASE}/api/dedup/status?id=${scanId}`);
  check('2b) 暫停期間進度不再前進', s.state === 'paused'
    && s.hashed === s1.hashed && s.scanned === s1.scanned && s.files === s1.files);

  let r = await postJSON(`${BASE}/api/dedup/resume`, { id: scanId });
  check('3a) 繼續後狀態為 running', r.state === 'running');
  s = await waitState(scanId, ['done']);
  check('3b) 掃描完成且進度 100%', !!s && s.state === 'done' && s.percent === 100);
  check('3c) 完成後回報重複結果', !!s && s.groupCount === 10 && s.dupCount === N_SCAN && s.hashTotal === N_SCAN);

  p = await postJSON(`${BASE}/api/dedup/pause`, { id: scanId });
  check('3d) 已完成的工作無法暫停', p.state === 'done');

  /* ---------- 掃描：中止 ---------- */
  d = await postJSON(`${BASE}/api/dedup/start`, { dir: SCAN_DIR });
  const cancelId = d.jobId;
  let c = await postJSON(`${BASE}/api/dedup/cancel`, { id: cancelId });
  check('4a) 中止後狀態為 cancelled', c.state === 'cancelled');
  s = await waitState(cancelId, ['cancelled'], 5000);
  check('4b) 中止後不產出結果', !!s && s.groups == null);

  /* ---------- 刪除：進度、暫停、繼續 ---------- */
  const delPaths = fs.readdirSync(DEL_DIR).map((e) => path.join(DEL_DIR, e));
  d = await postJSON(`${BASE}/api/dedup/delete/start`, { paths: delPaths });
  check('5a) 建立刪除工作', d.ok && !!d.jobId);
  const delId = d.jobId;
  p = await postJSON(`${BASE}/api/dedup/pause`, { id: delId });
  check('5b) 刪除工作可暫停', p.state === 'paused' && p.type === 'delete');
  // 允許暫停前已在進行中的那一項完成，之後刪除數必須完全靜止
  await sleep(250);
  const d1 = await getJSON(`${BASE}/api/dedup/status?id=${delId}`);
  await sleep(300);
  s = await getJSON(`${BASE}/api/dedup/status?id=${delId}`);
  check('5c) 暫停期間不再刪除', s.state === 'paused' && s.deleted === d1.deleted && s.freed === d1.freed);
  r = await postJSON(`${BASE}/api/dedup/resume`, { id: delId });
  check('5d) 刪除工作可繼續', r.state === 'running');
  s = await waitState(delId, ['done'], 20000);
  check('5e) 刪除完成且進度 100%', !!s && s.state === 'done'
    && s.deleted === N_DEL && s.deleteTotal === N_DEL && s.percent === 100);
  check('5f) 檔案皆已刪除', fs.readdirSync(DEL_DIR).length === 0);

  /* ---------- 刪除：中止 ---------- */
  setupDelDir();
  d = await postJSON(`${BASE}/api/dedup/delete/start`, { paths: delPaths });
  const delCancelId = d.jobId;
  c = await postJSON(`${BASE}/api/dedup/cancel`, { id: delCancelId });
  check('6a) 刪除工作可中止', c.state === 'cancelled');
  s = await waitState(delCancelId, ['cancelled'], 5000);
  check('6b) 中止後保留剩餘檔案', !!s && s.state === 'cancelled' && fs.readdirSync(DEL_DIR).length > 0);

  /* ---------- 錯誤處理 ---------- */
  d = await postJSON(`${BASE}/api/dedup/start`, { dir: '/nonexistent-xyz' });
  check('7a) 無效目錄回傳錯誤', !d.ok && /資料夾無效/.test(d.error || ''));
  const res = await fetch(`${BASE}/api/dedup/status?id=no-such-job`);
  check('7b) 未知工作回傳 404', res.status === 404);
  d = await postJSON(`${BASE}/api/dedup/pause`, { id: 'no-such-job' });
  check('7c) 未知工作控制回傳錯誤', /不存在/.test(d.error || ''));

  const allOk = results.every((x) => x.cond);
  server.kill();
  fs.rmSync(SCAN_DIR, { recursive: true, force: true });
  fs.rmSync(DEL_DIR, { recursive: true, force: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(allOk ? '✅ 重整進度測試通過' : `❌ 重整進度測試失敗（${results.filter((x) => !x.cond).length} 項）`);
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
