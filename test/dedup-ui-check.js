/* 重整 UI 測試：重整按鈕 → modal 渲染群組與預設勾選 → 確認刪除長檔名重複檔案 */
const { JSDOM, VirtualConsole } = require('jsdom');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const PORT = 4389;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DIR = '/tmp/fmtest-dedup-ui';
const DATA_DIR = '/tmp/fmtest-dedup-ui-data';
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(TEST_DIR, 'sub'), { recursive: true });
fs.writeFileSync(path.join(TEST_DIR, 'short.txt'), 'dup data');
fs.writeFileSync(path.join(TEST_DIR, 'a-very-long-filename-copy.txt'), 'dup data');
fs.writeFileSync(path.join(TEST_DIR, 'sub', 'another-long-name-copy.txt'), 'dup data');
fs.writeFileSync(path.join(TEST_DIR, 'unique.txt'), 'unique');

const server = spawn('node', ['server.js'], {
  cwd: PROJECT,
  env: { ...process.env, PORT: String(PORT), FM_DATA_DIR: DATA_DIR },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await sleep(1300);
  const logs = [];
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((m) => vc.on(m, (...a) => logs.push(m + ': ' + a.map(String).join(' '))));
  const dom = await JSDOM.fromURL(`${BASE}/`, {
    runScripts: 'dangerously', resources: undefined, pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) { window.fetch = (u, opts) => fetch(new URL(u, BASE).href, opts); window.confirm = () => true; },
  });
  const { window } = dom;
  await sleep(800);
  for (const s of ['vendor/vue.global.prod.js', 'vendor/marked.min.js', 'js/templates.js', 'js/app.js']) {
    window.eval(await fetch(`${BASE}/${s}`).then((r) => r.text()));
  }
  const vm = window.__ROOT__;
  await sleep(500);
  await vm.selectDir({ path: TEST_DIR, name: 'fmtest-dedup-ui' });
  await sleep(600);

  // 1) 重整按鈕存在
  const btn = [...window.document.querySelectorAll('.list-toolbar .btn')].find((b) => b.textContent.includes('重整'));
  console.log('1) 重整按鈕存在?', !!btn);
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(1500);

  // 2) modal 開啟、群組載入、預設勾選
  const groups = window.document.querySelectorAll('.dedup-group');
  const items = [...window.document.querySelectorAll('.dedup-item')];
  const checkedItems = items.filter((i) => i.querySelector('input').checked);
  console.log('2) modal:', vm.dedupModal.show, '| 群組:', vm.dedupModal.groupCount, '| 條目:', items.length);
  console.log('3) 預設勾選:', checkedItems.length, '個 ｜ 釋放:', vm.fmtSize(vm.dedupFreedSize));

  // 3) 確認刪除
  await vm.confirmDedup();
  await sleep(700);
  console.log('4) toast:', vm.toast.msg, '| modal 關閉:', !vm.dedupModal.show);
  console.log('5) 短檔名保留?', fs.existsSync(path.join(TEST_DIR, 'short.txt')),
    '| 長檔名已刪除?', !fs.existsSync(path.join(TEST_DIR, 'a-very-long-filename-copy.txt'))
      && !fs.existsSync(path.join(TEST_DIR, 'sub', 'another-long-name-copy.txt')));
  console.log('6) JS 錯誤:', logs.length ? logs : '無');

  const ok = !!btn
    && vm.dedupModal.show === false
    && vm.dedupModal.groupCount === 1
    && items.length === 3
    && checkedItems.length === 2
    && /已刪除 2 個重複檔案/.test(vm.toast.msg)
    && fs.existsSync(path.join(TEST_DIR, 'short.txt'))
    && !fs.existsSync(path.join(TEST_DIR, 'a-very-long-filename-copy.txt'))
    && logs.length === 0;

  window.close();
  server.kill();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(ok ? '✅ 重整 UI 測試通過' : '❌ 重整 UI 測試失敗');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
