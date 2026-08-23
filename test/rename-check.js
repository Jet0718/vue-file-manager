const { JSDOM, VirtualConsole } = require('jsdom');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DIR = path.join(os.homedir(), 'fmtest-rename');
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DIR, { recursive: true });
fs.writeFileSync(path.join(TEST_DIR, 'old-name.txt'), 'x');
fs.mkdirSync(path.join(TEST_DIR, 'old-folder'));
const server = spawn('node', ['server.js'], { cwd: PROJECT, env: { ...process.env, PORT: String(PORT), FM_DATA_DIR: '/tmp/fmtest-rename-data' }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  await sleep(1200);
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => logs.push('JSDOM_ERR: ' + (e.detail && e.detail.message ? e.detail.message : e.message)));
  ['log','warn','error'].forEach((m) => vc.on(m, (...a) => logs.push(m.toUpperCase() + ': ' + a.map(String).join(' '))));
  const dom = await JSDOM.fromURL(`${BASE}/`, {
    runScripts: 'dangerously', resources: undefined, pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) { window.fetch = (u, opts) => fetch(new URL(u, BASE).href, opts); window.confirm = () => true; },
  });
  const { window } = dom;
  const d = window.document;
  await sleep(800);
  for (const s of ['vendor/vue.global.prod.js', 'vendor/marked.min.js', 'js/templates.js', 'js/app.js']) {
    window.eval(await fetch(`${BASE}/${s}`).then((r) => r.text()));
  }
  const vm = window.__ROOT__;
  await sleep(500);
  await vm.selectDir({ path: TEST_DIR, name: 'fmtest-rename' });
  await sleep(600);

  // 1) 檔案更名
  const fileRow = [...d.querySelectorAll('.file-row')].find((r) => r.querySelector('.fname').textContent.trim() === 'old-name.txt');
  const renameBtn = [...fileRow.querySelectorAll('.op')].find((b) => b.textContent.trim() === '更名');
  console.log('1) 檔案列有更名按鈕?', !!renameBtn);
  renameBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  console.log('   彈窗開啟?', vm.renameModal.show, '| 輸入值:', vm.renameModal.newName);
  vm.renameModal.newName = 'new-name.txt';
  await vm.confirmRename();
  await sleep(600);
  console.log('   更名後: new-name.txt 存在?', fs.existsSync(path.join(TEST_DIR, 'new-name.txt')), '| toast:', vm.toast.msg);

  // 2) 資料夾更名
  const folderRow = [...d.querySelectorAll('.file-row')].find((r) => r.querySelector('.fname').textContent.trim() === 'old-folder');
  [...folderRow.querySelectorAll('.op')].find((b) => b.textContent.trim() === '更名').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  vm.renameModal.newName = 'new-folder';
  await vm.confirmRename();
  await sleep(600);
  console.log('2) 資料夾更名: new-folder 存在?', fs.existsSync(path.join(TEST_DIR, 'new-folder')), '| old-folder 移除?', !fs.existsSync(path.join(TEST_DIR, 'old-folder')));

  // 3) 錯誤處理：更名為已存在的名稱
  fs.writeFileSync(path.join(TEST_DIR, 'dup.txt'), 'x');
  await sleep(300);
  const row = [...d.querySelectorAll('.file-row')].find((r) => r.querySelector('.fname').textContent.trim() === 'new-name.txt');
  [...row.querySelectorAll('.op')].find((b) => b.textContent.trim() === '更名').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  vm.renameModal.newName = 'dup.txt';
  await vm.confirmRename();
  await sleep(500);
  console.log('3) 更名衝突: 錯誤訊息=', vm.renameModal.error, '| 原檔仍在?', fs.existsSync(path.join(TEST_DIR, 'new-name.txt')));

  console.log('JS 錯誤:', logs.length ? logs : '無');
  const ok = fs.existsSync(path.join(TEST_DIR, 'new-name.txt'))
    && fs.existsSync(path.join(TEST_DIR, 'new-folder'))
    && !fs.existsSync(path.join(TEST_DIR, 'old-folder'))
    && vm.renameModal.error.includes('已存在')
    && logs.length === 0;
  window.close(); server.kill();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.rmSync('/tmp/fmtest-rename-data', { recursive: true, force: true });
  console.log(ok ? '✅ 更名測試通過' : '❌ 更名測試失敗');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
