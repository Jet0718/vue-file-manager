/* 重整進度 UI 測試：處理中顯示進度面板，並可暫停／繼續 */
const { JSDOM, VirtualConsole } = require('jsdom');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const PORT = 4392;
const BASE = `http://127.0.0.1:${PORT}`;
const SCAN_DIR = '/tmp/fmtest-dedup-progress-ui';
const DATA_DIR = '/tmp/fmtest-dedup-progress-ui-data';

const N_SCAN = 800;
const BLOB = 128 * 1024;
fs.rmSync(SCAN_DIR, { recursive: true, force: true });
fs.mkdirSync(SCAN_DIR, { recursive: true });
{
  const buf = Buffer.alloc(BLOB);
  for (let i = 0; i < N_SCAN; i++) {
    buf.fill(String(i % 10));
    fs.writeFileSync(path.join(SCAN_DIR, `dup-${i}.bin`), buf);
  }
}

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
  await vm.selectDir({ path: SCAN_DIR, name: 'fmtest-dedup-progress-ui' });
  await sleep(600);

  const findBtn = (text) => [...window.document.querySelectorAll('.dedup-progress button')]
    .find((b) => b.textContent.includes(text));

  // 1) 點「重整」→ 出現進度面板與暫停／中止按鈕
  const btn = [...window.document.querySelectorAll('.list-toolbar .btn')].find((b) => b.textContent.includes('重整'));
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(350);
  const panel = window.document.querySelector('.dedup-progress');
  check('1a) 顯示進度面板', !!panel && vm.dedupBusy === true);
  check('1b) 面板含暫停與中止按鈕', !!findBtn('暫停') && !!findBtn('中止'));
  check('1c) 顯示進度文字與目前檔案', (panel ? panel.textContent : '').includes('掃描'));

  // 2) 暫停 → 進度靜止
  findBtn('暫停').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  check('2a) 點暫停後狀態為 paused', vm.dedupModal.state === 'paused');
  // 允許暫停前已在進行中的那一項完成，之後進度必須靜止
  await sleep(400);
  const frozen = vm.dedupModal.hashed;
  await sleep(400);
  check('2b) 暫停期間進度不再前進', vm.dedupModal.state === 'paused' && vm.dedupModal.hashed === frozen);

  // 3) 繼續 → 完成並列出結果
  findBtn('繼續').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  check('3a) 點繼續後狀態為 running', vm.dedupModal.state === 'running');
  for (let i = 0; i < 80 && vm.dedupModal.loading; i++) await sleep(200);
  await sleep(200);
  check('3b) 完成後關閉進度面板', !vm.dedupBusy && !window.document.querySelector('.dedup-progress'));
  check('3c) 完成後列出 10 組重複', vm.dedupModal.groupCount === 10 && vm.dedupModal.dupCount === N_SCAN);
  check('3d) 群組已渲染於畫面', window.document.querySelectorAll('.dedup-group').length === 10);
  check('3e) 無 JS 錯誤', logs.length === 0);

  const allOk = results.every((x) => x.cond);
  if (!allOk && logs.length) console.log('JS 記錄：', logs);
  window.close();
  server.kill();
  fs.rmSync(SCAN_DIR, { recursive: true, force: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(allOk ? '✅ 重整進度 UI 測試通過' : `❌ 重整進度 UI 測試失敗（${results.filter((x) => !x.cond).length} 項）`);
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
