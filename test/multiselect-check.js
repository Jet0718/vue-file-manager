/* 複選 + 批量操作測試 */
const { JSDOM, VirtualConsole } = require('jsdom');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DIR = path.join(os.homedir(), 'fmtest-multi');

fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(TEST_DIR, 'dest'), { recursive: true });
for (const n of ['a.txt', 'b.md', 'c.pdf', 'd.png', 'e.txt']) {
  fs.writeFileSync(path.join(TEST_DIR, n), 'content-' + n);
}

const server = spawn('node', ['server.js'], {
  cwd: PROJECT,
  env: { ...process.env, PORT: String(PORT), FM_DATA_DIR: '/tmp/fmtest-multi-data' },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await sleep(1200);
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => logs.push('JSDOM_ERR: ' + (e.detail && e.detail.message ? e.detail.message : e.message)));
  ['log', 'warn', 'error'].forEach((m) => vc.on(m, (...a) => logs.push(m.toUpperCase() + ': ' + a.map(String).join(' '))));

  const dom = await JSDOM.fromURL(`${BASE}/`, {
    runScripts: 'dangerously',
    resources: undefined,
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = (u, opts) => fetch(new URL(u, BASE).href, opts);
      window.confirm = () => true;
    },
  });
  const { window } = dom;
  const d = window.document;
  await sleep(800);
  for (const s of ['vendor/vue.global.prod.js', 'vendor/marked.min.js', 'js/templates.js', 'js/app.js']) {
    window.eval(await fetch(`${BASE}/${s}`).then((r) => r.text()));
  }
  const vm = window.__ROOT__;
  await sleep(500);

  // 1) 導覽 + 勾選框存在
  await vm.selectDir({ path: TEST_DIR, name: 'fmtest-multi' });
  await sleep(600);
  const checkboxes = [...d.querySelectorAll('.file-row .selbox input')];
  console.log('1) 檔案列:', d.querySelectorAll('.file-row').length, '| 勾選框:', checkboxes.length, '| 全選框:', !!d.querySelector('.file-head .selbox input'));

  // 2) 勾選 2 個檔案 → 批量列出現
  const rows = [...d.querySelectorAll('.file-row')];
  rows[0].querySelector('.selbox input').dispatchEvent(new window.MouseEvent('change', { bubbles: true }));
  rows[1].querySelector('.selbox input').dispatchEvent(new window.MouseEvent('change', { bubbles: true }));
  await sleep(200);
  console.log('2) 選取數:', vm.selectionCount, '| 批量列:', d.querySelector('.batch-bar') ? '出現' : '未出現',
    '| 批量按鈕:', [...(d.querySelector('.batch-bar') ? d.querySelector('.batch-bar').querySelectorAll('.btn') : [])].map((b) => b.textContent.trim()).join(','));

  // 3) Ctrl+點選切換
  const row2 = rows[2];
  row2.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
  await sleep(200);
  console.log('3) Ctrl+點選後選取數:', vm.selectionCount, '| selected 樣式列:', d.querySelectorAll('.file-row.selected').length);

  // 4) 全選／取消全選
  vm.toggleSelectAll();
  await sleep(200);
  console.log('4) 全選後:', vm.selectionCount, '筆');
  vm.toggleSelectAll();
  await sleep(200);
  console.log('   取消全選後:', vm.selectionCount, '筆');

  // 5) 批量複製到 dest
  vm.toggleSelectAll();
  await sleep(200);
  vm.batchCopy();
  await sleep(300);
  console.log('5) 批量複製彈窗:', !!d.querySelector('.modal'), '| 標題:', d.querySelector('.modal h3') && d.querySelector('.modal h3').textContent.trim());
  vm.destModal.dest = path.join(TEST_DIR, 'dest');
  await sleep(400);
  await vm.confirmDest();
  await sleep(600);
  const copied = ['a.txt', 'b.md', 'c.pdf', 'd.png', 'e.txt'].every((n) => fs.existsSync(path.join(TEST_DIR, 'dest', n)));
  console.log('   複製結果: dest 內 5 個檔案都在?', copied, '| toast:', vm.toast.msg, '| 選取清除?', vm.selectionCount === 0);

  // 6) 批量備份（新流程：.bak 內產生全備份 f-*.zip，內含全部具標記檔案）
  vm.toggleSelectAll();
  await sleep(200);
  vm.batchBackup();
  await sleep(900);
  const bakFiles = fs.existsSync(path.join(TEST_DIR, '.bak')) ? fs.readdirSync(path.join(TEST_DIR, '.bak')) : [];
  const bakCount = bakFiles.filter((n) => /^f-\d{14}\.zip$/.test(n)).length;
  console.log('6) 批量備份: .bak 內全備份 zip 數:', bakCount, '| toast:', vm.toast.msg);

  // 7) 批量刪除（a.txt 與 b.md）
  vm.clearSelection();
  vm.selectedSet[path.join(TEST_DIR, 'a.txt')] = true;
  vm.selectedSet[path.join(TEST_DIR, 'b.md')] = true;
  await sleep(200);
  vm.batchDelete();
  await sleep(700);
  console.log('7) 批量刪除: a.txt 存在?', fs.existsSync(path.join(TEST_DIR, 'a.txt')), '| b.md 存在?', fs.existsSync(path.join(TEST_DIR, 'b.md')), '| toast:', vm.toast.msg);

  // 8) 批量 ZIP 下載
  vm.clearSelection();
  vm.selectedSet[path.join(TEST_DIR, 'c.pdf')] = true;
  vm.selectedSet[path.join(TEST_DIR, 'd.png')] = true;
  let zipOpened = null;
  const origOpen = window.open;
  window.open = (u) => { zipOpened = u; return null; };
  await vm.batchDownload();
  await sleep(800);
  window.open = origOpen;
  console.log('8) ZIP: window.open 呼叫 =', zipOpened);
  let zipValid = false;
  if (zipOpened) {
    const res = await fetch(new URL(zipOpened, BASE));
    const buf = Buffer.from(await res.arrayBuffer());
    const p = require('child_process').spawnSync('python3', ['-c', `
import sys, zipfile, io
data = sys.stdin.buffer.read()
z = zipfile.ZipFile(io.BytesIO(data))
print(sorted(z.namelist()))
`], { input: buf });
    zipValid = p.stdout.toString().includes("'c.pdf'") && p.stdout.toString().includes("'d.png'");
    console.log('   ZIP 內容驗證:', p.stdout.toString().trim(), zipValid ? '✓' : '✗');
  }

  console.log('JS 錯誤:', logs.length ? logs : '無');
  console.log('DEBUG 條件:', JSON.stringify({ boxes: checkboxes.length, selCount: vm.selectionCount, bar: !!d.querySelector('.batch-bar'), copied, bakCount, zipValid, logs: logs.length }));
  const ok = checkboxes.length === 6
    && vm.selectionCount === 2
    && d.querySelector('.batch-bar') !== null
    && copied && bakCount === 1
    && !fs.existsSync(path.join(TEST_DIR, 'a.txt')) && !fs.existsSync(path.join(TEST_DIR, 'b.md'))
    && zipValid
    && logs.length === 0;
  window.close();
  server.kill();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.rmSync('/tmp/fmtest-multi-data', { recursive: true, force: true });
  console.log('ok =', ok);
  console.log(ok ? '✅ 複選批量測試通過' : '❌ 複選批量測試失敗');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
