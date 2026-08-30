/* 壓縮檔預覽與還原測試：ZIP/TAR 列示、還原（覆蓋／略過）、路徑穿越防護 */
const { spawn } = require('child_process');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const PORT = 4395;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DIR = '/tmp/fmtest-archive';
const DATA_DIR = '/tmp/fmtest-archive-data';
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(TEST_DIR, 'src', 'sub'), { recursive: true });
fs.writeFileSync(path.join(TEST_DIR, 'src', 'a.txt'), 'hello 世界');
fs.writeFileSync(path.join(TEST_DIR, 'src', 'sub', '中文.txt'), '內容');
fs.writeFileSync(path.join(TEST_DIR, 'src', 'big.txt'), 'pad '.repeat(500));

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

/** 用 zlib 直接建立 deflate zip（與伺服器 buildZip 相容） */
function buildTestZip(file, entries) {
  const enc = new TextEncoder();
  const parts = [];
  let offset = 0;
  const dt = new Date();
  const dosTime = ((dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate()) & 0xffff;
  const central = [];
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = Buffer.from(e.data, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, payload);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + payload.length;
  }
  const cdStart = offset;
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16); eocd.writeUInt16LE(0, 20);
  fs.writeFileSync(file, Buffer.concat([...parts, ...central, eocd]));
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
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

  // 建立測試用 zip 與 tar
  const zipFile = path.join(TEST_DIR, 'sample.zip');
  const tarFile = path.join(TEST_DIR, 'sample.tar');
  buildTestZip(zipFile, [
    { name: 'a.txt', data: 'hello 世界' },
    { name: 'sub/中文.txt', data: '內容' },
    { name: 'big.txt', data: 'pad '.repeat(500) },
  ]);
  const { execSync } = require('child_process');
  execSync(`tar -cf "${tarFile}" -C "${path.join(TEST_DIR, 'src')}" a.txt sub`);

  // 1) zip 預覽
  let d = await getJSON(`${BASE}/api/archive?path=${encodeURIComponent(zipFile)}`);
  const zipNames = (d.entries || []).map((e) => e.name).sort();
  check('1a) zip 預覽：3 個條目', d.ok && d.count === 3);
  check('1b) zip 預覽：條目名稱正確（含中文）', JSON.stringify(zipNames) === JSON.stringify(['a.txt', 'big.txt', 'sub/中文.txt']));
  const big = d.entries.find((e) => e.name === 'big.txt');
  check('1c) zip 預覽：deflate 條目有原始/壓縮大小', big && big.method === 'deflate' && big.size === 2000 && big.compressed < big.size);

  // 2) tar 預覽
  d = await getJSON(`${BASE}/api/archive?path=${encodeURIComponent(tarFile)}`);
  const tarNames = (d.entries || []).map((e) => e.name).sort();
  check('2a) tar 預覽：條目正確', d.ok && tarNames.includes('a.txt') && tarNames.includes('sub/中文.txt'));

  // 3) 還原 zip 至新目錄（覆蓋）
  const rest1 = path.join(TEST_DIR, 'restore1');
  fs.mkdirSync(rest1);
  d = await postJSON(`${BASE}/api/restore`, { zip: zipFile, destDir: rest1, overwrite: true });
  check('3a) 還原 zip：全部成功', d.ok && d.restored === 3 && d.skipped === 0);
  check('3b) 還原內容正確', fs.readFileSync(path.join(rest1, 'a.txt'), 'utf8') === 'hello 世界'
    && fs.readFileSync(path.join(rest1, 'sub', '中文.txt'), 'utf8') === '內容');
  check('3c) 還原 deflate 條目正確', fs.readFileSync(path.join(rest1, 'big.txt'), 'utf8') === 'pad '.repeat(500));

  // 4) 還原 tar
  const rest2 = path.join(TEST_DIR, 'restore2');
  fs.mkdirSync(rest2);
  d = await postJSON(`${BASE}/api/restore`, { zip: tarFile, destDir: rest2, overwrite: true });
  check('4a) 還原 tar：全部成功', d.ok && d.restored === 2);
  check('4b) 還原 tar 內容正確', fs.readFileSync(path.join(rest2, 'a.txt'), 'utf8') === 'hello 世界'
    && fs.readFileSync(path.join(rest2, 'sub', '中文.txt'), 'utf8') === '內容');

  // 5) overwrite=false：既有檔案應略過
  fs.writeFileSync(path.join(rest1, 'a.txt'), 'KEEP');
  d = await postJSON(`${BASE}/api/restore`, { zip: zipFile, destDir: rest1, overwrite: false });
  check('5a) 不覆蓋：3 個既有檔案全部略過', d.ok && d.skipped === 3 && d.restored === 0);
  check('5b) 既有檔案未被覆蓋', fs.readFileSync(path.join(rest1, 'a.txt'), 'utf8') === 'KEEP');

  // 6) 路徑穿越防護（zip-slip）
  const evilZip = path.join(TEST_DIR, 'evil.zip');
  buildTestZip(evilZip, [{ name: '../evil.txt', data: 'pwned' }]);
  const rest3 = path.join(TEST_DIR, 'restore3');
  fs.mkdirSync(rest3);
  d = await postJSON(`${BASE}/api/restore`, { zip: evilZip, destDir: rest3, overwrite: true });
  check('6a) zip-slip：不安全條目被拒絕', d.ok && d.restored === 0 && (d.errors || []).length === 1);
  check('6b) zip-slip：檔案未逃出目標目錄', !fs.existsSync(path.join(TEST_DIR, 'evil.txt')));

  // 7) 還原預設目標：.bak 內的 zip 預設還原至其上一層
  const bakDir = path.join(TEST_DIR, '.bak');
  fs.mkdirSync(bakDir);
  fs.copyFileSync(zipFile, path.join(bakDir, 'f-test.zip'));
  d = await postJSON(`${BASE}/api/restore`, { zip: path.join(bakDir, 'f-test.zip'), overwrite: true });
  check('7) .bak 內 zip 預設還原至原始目錄', d.ok && d.destDir === TEST_DIR && d.restored === 3);

  // 8) 不支援格式錯誤訊息
  fs.writeFileSync(path.join(TEST_DIR, 'x.gz'), 'gzip data');
  d = await getJSON(`${BASE}/api/archive?path=${encodeURIComponent(path.join(TEST_DIR, 'x.gz'))}`);
  check('8) 不支援格式回傳錯誤', !d.ok && /ZIP|RAR|7Z|TAR/.test(d.error || ''));

  const allOk = results.every((r) => r.cond);
  server.kill();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(allOk ? '✅ 壓縮檔測試通過' : `❌ 壓縮檔測試失敗（${results.filter((r) => !r.cond).length} 項）`);
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
