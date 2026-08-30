/* archive.html 獨立分頁渲染測試：壓縮檔內容表格、還原目標預設值、無 JS 錯誤 */
const { JSDOM, VirtualConsole } = require('jsdom');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const PORT = 4393;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DIR = '/tmp/fmtest-archive-html';
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(TEST_DIR, 'sub'), { recursive: true });
fs.writeFileSync(path.join(TEST_DIR, 'a.txt'), 'hello 世界');
fs.writeFileSync(path.join(TEST_DIR, 'sub', '中文.txt'), '內容');
execSync(`tar -cf ${TEST_DIR}/sample.tar -C ${TEST_DIR} a.txt sub`);

const server = spawn('node', ['server.js'], {
  cwd: PROJECT,
  env: { ...process.env, PORT: String(PORT), FM_DATA_DIR: '/tmp/fmtest-archive-html-data' },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await sleep(1300);
  const logs = [];
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((m) => vc.on(m, (...a) => logs.push(m + ': ' + a.map(String).join(' '))));
  const dom = await JSDOM.fromURL(`${BASE}/archive.html?path=${encodeURIComponent(TEST_DIR + '/sample.tar')}`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) { window.fetch = (u, opts) => fetch(new URL(u, BASE).href, opts); window.confirm = () => true; },
  });
  const d = dom.window.document;
  // 等待表格渲染完成（最多 6 秒）
  let rows = [];
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    rows = [...d.querySelectorAll('tbody tr')];
    if (rows.length) break;
  }
  const names = rows.map((r) => r.querySelector('td.name').textContent);
  const status = d.getElementById('status').textContent;
  const dest = d.getElementById('destDir').value;
  console.log('1) 表格列數:', rows.length, '| 標題:', d.getElementById('title').textContent);
  console.log('2) 條目:', JSON.stringify(names));
  console.log('3) 狀態:', status, '| 還原目標預設:', dest);
  console.log('4) JS 錯誤:', logs.length ? logs : '無');

  const ok = rows.length === 3
    && names.some((n) => n.includes('a.txt'))
    && names.some((n) => n.includes('中文'))
    && /已列出 3 個項目/.test(status)
    && dest === TEST_DIR
    && logs.length === 0;

  dom.window.close();
  server.kill();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.rmSync('/tmp/fmtest-archive-html-data', { recursive: true, force: true });
  console.log(ok ? '✅ archive.html 渲染測試通過' : '❌ archive.html 渲染測試失敗');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
