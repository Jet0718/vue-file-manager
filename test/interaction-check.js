/* 互動測試：預覽、複製／搬移／備份、喜好分頁、最近分頁、WSL */
const { JSDOM, VirtualConsole } = require('jsdom');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;

// 測試目錄放在家目錄下，讓「最近」掃描能涵蓋
const TEST_DIR = path.join(os.homedir(), 'fmtest2');
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(TEST_DIR, 'docs'), { recursive: true });
fs.writeFileSync(path.join(TEST_DIR, 'report.pdf'), 'pdf-bytes');
fs.writeFileSync(path.join(TEST_DIR, 'photo.png'), 'png-bytes');
fs.writeFileSync(path.join(TEST_DIR, 'notes.txt'), 'hello text');
fs.writeFileSync(path.join(TEST_DIR, 'doc.md'), '# 文件標題\n\n**粗體**內容\n\n- 項目一\n- 項目二');
fs.writeFileSync(path.join(TEST_DIR, 'page.html'), '<html><body><h1>HTML 測試</h1></body></html>');
fs.writeFileSync(path.join(TEST_DIR, 'song.mp3'), 'mp3-bytes');
fs.writeFileSync(path.join(TEST_DIR, 'docs', 'plan.docx'), 'docx-bytes');
// 最近異動測試檔（不同 mtime）
fs.writeFileSync(path.join(TEST_DIR, 'recent-new.txt'), 'new');
fs.writeFileSync(path.join(TEST_DIR, 'recent-mid.txt'), 'mid');
fs.writeFileSync(path.join(TEST_DIR, 'recent-old.txt'), 'old');
const now = Date.now();
fs.utimesSync(path.join(TEST_DIR, 'recent-new.txt'), new Date(now), new Date(now));
fs.utimesSync(path.join(TEST_DIR, 'recent-mid.txt'), new Date(now - 3 * 86400000), new Date(now - 3 * 86400000));
fs.utimesSync(path.join(TEST_DIR, 'recent-old.txt'), new Date(now - 30 * 86400000), new Date(now - 30 * 86400000));

const server = spawn('node', ['server.js'], {
  cwd: PROJECT,
  env: {
    ...process.env,
    PORT: String(PORT),
    FM_RECENT_ROOTS: `${TEST_DIR}:4`,
    FM_DATA_DIR: '/tmp/fmtest-data', // 測試用獨立資料夾，不影響真實喜好資料
  },
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

  console.log('0) WSL:', vm.meta.isWSL, '| 分頁按鈕:', [...d.querySelectorAll('.ptab')].map((b) => b.textContent.trim()).join('/'));

  // 1) 導覽到測試目錄
  await vm.selectDir({ path: TEST_DIR, name: 'fmtest2' });
  await sleep(600);
  const rows = [...d.querySelectorAll('.file-row')];
  const names = rows.map((r) => r.querySelector('.fname').textContent.trim());
  console.log('1) 檔案列:', names.join(', '));
  console.log('   資料夾列有星號?', rows.filter((r) => r.querySelector('.star')).length > 0);

  // 2) 喜好：加入目前資料夾
  await vm.toggleFavorite(TEST_DIR);
  await sleep(400);
  const starLg = d.querySelector('.star-lg');
  console.log('2) 加入喜好: isFav=', vm.isFav(TEST_DIR), '| 大星號狀態:', starLg && starLg.textContent.trim(), '| toast:', vm.toast.msg);

  // 3) 喜好分頁
  vm.switchFavs();
  await sleep(400);
  const favRows = [...d.querySelectorAll('.fav-row')];
  console.log('3) 喜好分頁: 顯示', favRows.length, '筆 | 名稱:', favRows.map((r) => r.querySelector('.fav-name').textContent.trim()).join(', '));

  // 4) 喜好分頁點選導覽（找出測試項目 fmtest2，而非第一個）
  const favTarget = [...d.querySelectorAll('.fav-row')].find((r) => r.querySelector('.fav-name').textContent.trim() === 'fmtest2');
  if (favTarget) favTarget.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(500);
  console.log('4) 點喜好項目導覽: 目前資料夾 =', vm.selectedDir && vm.selectedDir.path);

  // 5) 取消喜好
  await vm.toggleFavorite(TEST_DIR);
  await sleep(400);
  console.log('5) 取消喜好: isFav=', vm.isFav(TEST_DIR), '| 喜好清單剩:', vm.favorites.length, '筆');

  // 6) 最近分頁（預設 14 天）
  vm.switchRecent();
  await sleep(1500);
  const recentNames = [...d.querySelectorAll('.recent-row .fav-name')].map((e) => e.textContent.trim());
  console.log('6) 最近(14天):', recentNames.length, '筆 | 含 recent-new.txt?', recentNames.includes('recent-new.txt'),
    '| 含 recent-mid.txt?', recentNames.includes('recent-mid.txt'), '| 含 recent-old.txt(30天前)?', recentNames.includes('recent-old.txt'));

  // 7) 改為 1 天
  vm.recentDays = 1;
  await vm.loadRecent();
  await sleep(1200);
  const recentNames1 = [...d.querySelectorAll('.recent-row .fav-name')].map((e) => e.textContent.trim());
  console.log('7) 最近(1天): 含 recent-new.txt?', recentNames1.includes('recent-new.txt'),
    '| 含 recent-mid.txt(3天前)?', recentNames1.includes('recent-mid.txt'), '| localStorage:', window.localStorage.getItem('fm-recent-days'));

  // 8) 最近分頁「所在資料夾」（用仍在 1 天清單中的 recent-new.txt）
  const newRow = [...d.querySelectorAll('.recent-row')].find((r) => r.querySelector('.fav-name').textContent.trim() === 'recent-new.txt');
  if (newRow) {
    const btn = [...newRow.querySelectorAll('.op')].find((b) => b.textContent.trim() === '所在資料夾');
    if (btn) {
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(500);
      console.log('8) 所在資料夾: 目前資料夾 =', vm.selectedDir && vm.selectedDir.path, '| 反白檔案 =', vm.activeFile);
    } else console.log('8) 無「所在資料夾」按鈕');
  } else console.log('8) recent-new.txt 不在清單');

  // 9) 檔案列星號切換（docs 資料夾）
  vm.sidebarTab = 'dirs';
  const docsRow = rows.find((r) => r.querySelector('.fname').textContent.trim() === 'docs');
  const starBtn = docsRow.querySelector('.star');
  starBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(500);
  console.log('9) 檔案列星號: docs 已加入喜好?', vm.isFav(path.join(TEST_DIR, 'docs')), '| toast:', vm.toast.msg);
  await vm.toggleFavorite(path.join(TEST_DIR, 'docs'));
  await sleep(400);

  // 10) 預覽（回歸）
  await vm.openPreview({ name: 'doc.md', path: path.join(TEST_DIR, 'doc.md') });
  await sleep(600);
  const mdFrame = d.querySelector('.preview-frame');
  console.log('10) Markdown 預覽: 渲染含<h1>?', mdFrame && mdFrame.getAttribute('srcdoc').includes('<h1>'));
  vm.closePreview();

  // 11) 複製／備份／搬移（回歸）
  const pdfRow = rows.find((r) => r.querySelector('.fname').textContent.includes('report.pdf'));
  [...pdfRow.querySelectorAll('.op')].find((b) => b.textContent.trim() === '複製').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  vm.destModal.dest = path.join(TEST_DIR, 'docs');
  await sleep(400);
  await vm.confirmDest();
  await sleep(500);
  const copyOk = fs.existsSync(path.join(TEST_DIR, 'docs', 'report.pdf'));
  const bakBtn = [...d.querySelectorAll('.file-row')].find((r) => r.querySelector('.fname').textContent.includes('report.pdf')).querySelectorAll('.op');
  [...bakBtn].find((b) => b.textContent.trim() === '備份').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(600);
  const bakOk = fs.existsSync(path.join(TEST_DIR, 'bak', 'report.pdf'));
  const mvBtn = [...d.querySelectorAll('.file-row')].find((r) => r.querySelector('.fname').textContent.includes('notes.txt')).querySelectorAll('.op');
  [...mvBtn].find((b) => b.textContent.trim() === '搬移').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  vm.destModal.dest = path.join(TEST_DIR, 'docs');
  await sleep(400);
  await vm.confirmDest();
  await sleep(500);
  const moveOk = fs.existsSync(path.join(TEST_DIR, 'docs', 'notes.txt')) && !fs.existsSync(path.join(TEST_DIR, 'notes.txt'));
  console.log('11) 複製:', copyOk, '| 備份:', bakOk, '| 搬移:', moveOk);

  console.log('JS 錯誤:', logs.length ? logs : '無');

  const ok = vm.meta.isWSL
    && names.length === 10
    && rows.filter((r) => r.querySelector('.star')).length >= 1
    && favRows.length === 1
    && vm.selectedDir.path === TEST_DIR
    && !vm.isFav(TEST_DIR)
    && recentNames.includes('recent-new.txt') && recentNames.includes('recent-mid.txt') && !recentNames.includes('recent-old.txt')
    && recentNames1.includes('recent-new.txt') && !recentNames1.includes('recent-mid.txt')
    && window.localStorage.getItem('fm-recent-days') === '1'
    && mdFrame && mdFrame.getAttribute('srcdoc').includes('<h1>')
    && copyOk && bakOk && moveOk
    && logs.length === 0;

  window.close();
  server.kill();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.rmSync('/tmp/fmtest-data', { recursive: true, force: true });
  console.log(ok ? '✅ 互動測試全部通過' : '❌ 互動測試失敗');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
