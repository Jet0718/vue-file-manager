/* 重整（去重）測試：掃描目前資料夾與子目錄，依長度＋sha256 找重複、預設勾選檔名較長者、刪除勾選檔案 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const PORT = 4390;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DIR = '/tmp/fmtest-dedup';
const DATA_DIR = '/tmp/fmtest-dedup-data';
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(TEST_DIR, 'sub'), { recursive: true });
fs.mkdirSync(path.join(TEST_DIR, 'deep', 'nested'), { recursive: true });
// 重複內容 ×3（檔名長短不同）
fs.writeFileSync(path.join(TEST_DIR, 'report.txt'), 'important data');
fs.writeFileSync(path.join(TEST_DIR, 'report-copy-2024-final.txt'), 'important data');
fs.writeFileSync(path.join(TEST_DIR, 'sub', 'backup-report-copy-extra-long-name.txt'), 'important data');
// 重複內容 ×2（子目錄內）
fs.writeFileSync(path.join(TEST_DIR, 'deep', 'nested', 'note.txt'), 'other content');
fs.writeFileSync(path.join(TEST_DIR, 'sub', 'note-copy.txt'), 'other content');
// 同大小但內容不同 → 不應被視為重複
fs.writeFileSync(path.join(TEST_DIR, 'same-size-1.txt'), 'AAAAAAAAAA');
fs.writeFileSync(path.join(TEST_DIR, 'same-size-2.txt'), 'BBBBBBBBBB');

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
  return res.json();
}

async function main() {
  await sleep(1200);

  // 1) 掃描
  let d = await postJSON(`${BASE}/api/dedup`, { dir: TEST_DIR });
  check('1a) 掃描：找到 2 組重複', d.ok && d.groupCount === 2);
  check('1b) 掃描：共 5 個重複檔案', d.dupCount === 5);
  const byName = {};
  for (const g of d.groups) for (const f of g.files) byName[f.name] = { group: g, file: f };

  // 2) 預設勾選：檔名較長者被勾選，最短者保留
  check('2a) report.txt（最短）預設不勾選', byName['report.txt'].file.defaultChecked === false);
  check('2b) report-copy-2024-final.txt 預設勾選', byName['report-copy-2024-final.txt'].file.defaultChecked === true);
  check('2c) backup-report-copy-extra-long-name.txt 預設勾選', byName['backup-report-copy-extra-long-name.txt'].file.defaultChecked === true);
  check('2d) note.txt 預設不勾選', byName['note.txt'].file.defaultChecked === false);
  check('2e) note-copy.txt 預設勾選', byName['note-copy.txt'].file.defaultChecked === true);

  // 3) 同大小不同內容 → 不列入
  check('3) 同大小但內容不同被雜湊排除', !byName['same-size-1.txt'] && !byName['same-size-2.txt']);

  // 4) 每組 hash 相同
  const g1 = byName['report.txt'].group;
  const g2 = byName['note.txt'].group;
  check('4) 每組內容 hash 一致', new Set(g1.files.map((f) => f.hash === g1.hash)).size === 1
    && g1.files.every(() => true) && g1.hash.length === 64 && g2.hash.length === 64);

  // 5) 刪除勾選的檔案
  const toDelete = [byName['report-copy-2024-final.txt'].file.path, byName['backup-report-copy-extra-long-name.txt'].file.path, byName['note-copy.txt'].file.path];
  d = await postJSON(`${BASE}/api/delete`, { paths: toDelete });
  check('5a) 刪除勾選檔案：deleted=3', d.ok && d.deleted === 3);
  check('5b) 保留檔仍在', fs.existsSync(path.join(TEST_DIR, 'report.txt')) && fs.existsSync(path.join(TEST_DIR, 'deep', 'nested', 'note.txt')));
  check('5c) 勾選檔已刪除', !fs.existsSync(path.join(TEST_DIR, 'report-copy-2024-final.txt'))
    && !fs.existsSync(path.join(TEST_DIR, 'sub', 'backup-report-copy-extra-long-name.txt'))
    && !fs.existsSync(path.join(TEST_DIR, 'sub', 'note-copy.txt')));

  // 6) 刪除後再掃描 → 無重複
  d = await postJSON(`${BASE}/api/dedup`, { dir: TEST_DIR });
  check('6) 刪除後再掃描無重複', d.ok && d.groupCount === 0 && d.dupCount === 0);

  // 7) 錯誤處理：無效目錄
  d = await postJSON(`${BASE}/api/dedup`, { dir: '/nonexistent-dir-xyz' });
  check('7) 無效目錄回傳錯誤', !d.ok && /資料夾無效/.test(d.error || ''));

  const allOk = results.every((r) => r.cond);
  server.kill();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(allOk ? '✅ 重整測試通過' : `❌ 重整測試失敗（${results.filter((r) => !r.cond).length} 項）`);
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
