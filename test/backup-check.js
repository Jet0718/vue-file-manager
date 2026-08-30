/* 備份作業測試：封存標記過濾＋全備份／差異備份（sha256 內容雜湊比對）／無差異結束／deflate 壓縮 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const PORT = 4396;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DIR = '/tmp/fmtest-backup';
const DATA_DIR = '/tmp/fmtest-backup-data';
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DIR, { recursive: true });
fs.mkdirSync(path.join(TEST_DIR, 'sub'), { recursive: true });
fs.writeFileSync(path.join(TEST_DIR, 'a.txt'), 'aaa');
fs.writeFileSync(path.join(TEST_DIR, 'sub', 'b.txt'), 'bbb');
fs.writeFileSync(path.join(TEST_DIR, 'c.txt'), 'ccc');
fs.writeFileSync(path.join(TEST_DIR, 'rep.txt'), 'compress me '.repeat(200)); // 可壓縮

const server = spawn('node', ['server.js'], {
  cwd: PROJECT,
  env: { ...process.env, PORT: String(PORT), FM_DATA_DIR: DATA_DIR },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postBackup(body) {
  const res = await fetch(`${BASE}/api/backup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** 極簡 zip 解析：讀出條目檔名＋壓縮方法（local header） */
function zipMeta(zipFile) {
  const buf = fs.readFileSync(zipFile);
  const out = [];
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const method = buf.readUInt16LE(off + 8);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.toString('utf8', off + 30, off + 30 + nameLen);
    const csize = buf.readUInt32LE(off + 18);
    const usize = buf.readUInt32LE(off + 22);
    out.push({ name, method, csize, usize });
    off += 30 + nameLen + extraLen + csize;
  }
  return out;
}

const results = [];
function check(label, cond) {
  results.push({ label, cond });
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : '  ← 失敗'}`);
}

async function main() {
  await sleep(1200);
  const bakDir = path.join(TEST_DIR, '.bak');
  const histFile = path.join(TEST_DIR, '.backup-history.json');
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

  // 1) 全備份（.bak 不存在）
  let d = await postBackup({ paths: ['a.txt', 'sub', 'c.txt', 'rep.txt'], dir: TEST_DIR });
  check('1a) 全備份：mode=full', d.ok && d.mode === 'full' && !d.skip);
  check('1b) 全備份：zip 檔名 f-YYYYMMDDHHmmss.zip', /^f-\d{14}\.zip$/.test(d.zip || ''));
  check('1c) 全備份：count=4', d.count === 4);
  check('1d) 全備份：.bak 資料夾與歷程文件已建立', fs.existsSync(bakDir) && fs.existsSync(histFile));
  let zips = fs.readdirSync(bakDir).filter((n) => n.endsWith('.zip'));
  check('1e) .bak 內僅一個 zip', zips.length === 1 && zips[0] === d.zip);
  const meta = zipMeta(path.join(bakDir, zips[0]));
  check('1f) zip 內含全部檔案（含子資料夾相對路徑）',
    JSON.stringify(meta.map((m) => m.name).sort()) === JSON.stringify(['a.txt', 'c.txt', 'rep.txt', 'sub/b.txt']));
  const rep = meta.find((m) => m.name === 'rep.txt');
  check('1g) 可壓縮檔案使用 deflate（method 8）', rep && rep.method === 8 && rep.csize < rep.usize);
  check('1h) 小檔案保留 store（method 0）', meta.find((m) => m.name === 'a.txt').method === 0);
  // deflate 內容 round-trip 驗證
  const raw = zlib.inflateRawSync(zipData(path.join(bakDir, zips[0]), rep));
  check('1i) deflate 內容可正確解壓（round-trip）', raw.toString() === 'compress me '.repeat(200));

  const hist = JSON.parse(fs.readFileSync(histFile, 'utf8'));
  check('1j) 歷程記錄含內容 sha256 雜湊', /^[0-9a-f]{64}$/.test(hist.files['a.txt'].hash || ''));
  check('1k) 歷程 hash 與檔案內容一致', hist.files['a.txt'].hash === sha('aaa'));

  // 2) 無異動再備份 → 提示訊息結束
  d = await postBackup({ paths: ['a.txt', 'sub', 'c.txt', 'rep.txt'], dir: TEST_DIR });
  check('2) 無差異：skip + 提示訊息', d.ok && d.skip === true && /無差異/.test(d.message || ''));

  // 3) 差異備份（修改 a.txt、新增 d.txt）
  fs.appendFileSync(path.join(TEST_DIR, 'a.txt'), 'more');
  fs.writeFileSync(path.join(TEST_DIR, 'd.txt'), 'ddd');
  await sleep(1100);
  d = await postBackup({ paths: ['a.txt', 'sub', 'c.txt', 'd.txt', 'rep.txt'], dir: TEST_DIR });
  check('3a) 差異備份：mode=incr', d.ok && d.mode === 'incr' && !d.skip);
  check('3b) 差異備份：zip 檔名 i-YYYYMMDDHHmmss.zip', /^i-\d{14}\.zip$/.test(d.zip || ''));
  check('3c) 差異備份：count=2', d.count === 2);
  const incrNames = zipMeta(path.join(bakDir, d.zip)).map((m) => m.name).sort();
  check('3d) 差異 zip 僅含異動檔案', JSON.stringify(incrNames) === JSON.stringify(['a.txt', 'd.txt']));
  const hist3 = JSON.parse(fs.readFileSync(histFile, 'utf8'));
  check('3e) 歷程已更新（a.txt 新內容 hash）', hist3.files['a.txt'] && hist3.files['a.txt'].hash === sha('aaamore'));
  check('3f) 歷程記錄備份清單', hist3.backups.length === 2 && hist3.backups[1].type === 'incr');

  // 4) 再跑一次 → 無差異
  d = await postBackup({ paths: ['a.txt', 'sub', 'c.txt', 'd.txt', 'rep.txt'], dir: TEST_DIR });
  check('4) 再次差異備份：無差異提示', d.ok && d.skip === true && /無差異/.test(d.message || ''));

  // 5) 內容雜湊比對：同大小不同內容、還原 mtime → 仍應抓到異動
  const origMtime = fs.statSync(path.join(TEST_DIR, 'c.txt')).mtimeMs;
  fs.writeFileSync(path.join(TEST_DIR, 'c.txt'), 'ccc2'); // 同長度不同內容
  const st = fs.statSync(path.join(TEST_DIR, 'c.txt'));
  fs.utimesSync(path.join(TEST_DIR, 'c.txt'), new Date(st.atimeMs), new Date(origMtime)); // 還原 mtime
  d = await postBackup({ paths: ['a.txt', 'sub', 'c.txt', 'd.txt', 'rep.txt'], dir: TEST_DIR });
  check('5a) 雜湊比對：同大小＋同 mtime 但內容不同 → 仍偵測為異動', d.ok && d.mode === 'incr' && d.count === 1);
  const hashNames = zipMeta(path.join(bakDir, d.zip)).map((m) => m.name);
  check('5b) 異動 zip 僅含 c.txt', JSON.stringify(hashNames) === JSON.stringify(['c.txt']));

  // 6) 刪除 b.txt 後備份 → 歷程應清除舊記錄
  fs.rmSync(path.join(TEST_DIR, 'sub', 'b.txt'));
  d = await postBackup({ paths: ['a.txt', 'sub', 'c.txt', 'd.txt', 'rep.txt'], dir: TEST_DIR });
  const hist6 = JSON.parse(fs.readFileSync(histFile, 'utf8'));
  check('6a) 刪檔後備份：無差異提示', d.ok && d.skip === true);
  check('6b) 歷程已清除已刪除檔案記錄', !hist6.files['sub/b.txt']);

  // 7) 單一檔案備份（path + dir）
  fs.appendFileSync(path.join(TEST_DIR, 'c.txt'), 'x');
  await sleep(1100);
  d = await postBackup({ path: 'c.txt', dir: TEST_DIR });
  check('7a) 單檔備份：mode=incr', d.ok && d.mode === 'incr' && d.count === 1);
  check('7b) 單檔備份：僅含 c.txt', JSON.stringify(zipMeta(path.join(bakDir, d.zip)).map((m) => m.name)) === JSON.stringify(['c.txt']));

  // 8) 選取範圍含 .bak 資料夾 → 不備份 .bak 自身
  d = await postBackup({ paths: ['a.txt', '.bak'], dir: TEST_DIR });
  check('8) 選取 .bak 資料夾時被略過（無差異提示）', d.ok && d.skip === true);

  const allOk = results.every((r) => r.cond);
  server.kill();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(allOk ? '✅ 備份測試通過' : `❌ 備份測試失敗（${results.filter((r) => !r.cond).length} 項）`);
  process.exit(allOk ? 0 : 1);
}

/** 從 zip 檔取出指定條目的原始（壓縮）資料區 */
function zipData(zipFile, entry) {
  const buf = fs.readFileSync(zipFile);
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.toString('utf8', off + 30, off + 30 + nameLen);
    const csize = buf.readUInt32LE(off + 18);
    if (name === entry.name) {
      return buf.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + csize);
    }
    off += 30 + nameLen + extraLen + csize;
  }
  throw new Error('找不到條目：' + entry.name);
}

main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
