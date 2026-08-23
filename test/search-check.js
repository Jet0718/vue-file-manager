/* 搜尋功能互動測試：頂部搜尋列 → 彈窗結果 → 引擎徽章 → 資料夾範圍 */
const { JSDOM, VirtualConsole } = require('jsdom');
const { spawn } = require('child_process');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn('node', ['server.js'], { cwd: PROJECT, env: { ...process.env, PORT: String(PORT), FM_DATA_DIR: '/tmp/fmtest-search-data' }, stdio: 'ignore' });
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

  // 1) 搜尋列存在
  console.log('1) 全域搜尋列:', !!d.querySelector('.global-search input'), '| 目前資料夾選項:', !!d.querySelector('.global-search .check'));

  // 2) 中文搜尋（博威）→ 彈窗 + Everything 徽章
  vm.searchQuery = '博威';
  console.log('  doSearch 是函式?', typeof vm.doSearch);
  const p = vm.doSearch();
  console.log('  doSearch 回傳?', typeof p);
  const done = await Promise.race([p.then(() => 'resolved'), new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
  console.log('  doSearch 完成?', done, '| search 狀態:', JSON.stringify(vm.search).slice(0, 200));
  await sleep(500);
  const badge = d.querySelector('.engine-badge');
  console.log('2) 搜尋「博威」: error=', vm.searchState.error, '| 彈窗=', !!d.querySelector('.search-modal'), '| 引擎=', vm.searchState.engine, '| 結果=', (vm.searchState.items || []).length,
    '| 徽章=', badge && badge.textContent.trim(), '| info=', vm.searchState.info);

  // 3) 結果操作（開啟/所在資料夾）
  const rows = [...d.querySelectorAll('.search-row')];
  console.log('3) 結果列數:', rows.length, '| 第一筆:', rows[0] && rows[0].querySelector('.fav-name').textContent.trim());
  const revealBtn = rows[0] && [...rows[0].querySelectorAll('.op')].find((b) => b.textContent.trim() === '所在資料夾');
  if (revealBtn) { revealBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(600); }
  console.log('   所在資料夾: 目前=', vm.selectedDir && vm.selectedDir.path, '| 反白=', vm.activeFile);

  // 4) 資料夾範圍搜尋（/mnt/c/TEST 內 ext:py）
  await vm.selectDir({ path: '/mnt/c/TEST', name: 'TEST' });
  await sleep(500);
  vm.searchScopeFolder = true;
  vm.searchQuery = 'ext:py';
  await vm.doSearch();
  await sleep(1500);
  const allInFolder = vm.searchState.items.every((it) => it.path.startsWith('/mnt/c/TEST/'));
  console.log('4) 資料夾範圍(ext:py in /mnt/c/TEST): 結果=', vm.searchState.items.length, '| 全部在資料夾內?', allInFolder);

  // 5) 空查詢防呆
  vm.searchQuery = '';
  await vm.doSearch();
  await sleep(300);
  console.log('5) 空查詢: toast=', vm.toast.msg);

  // 6) 關閉彈窗
  vm.closeSearch();
  console.log('6) 關閉後彈窗顯示?', !!d.querySelector('.search-modal'));

  console.log('JS 錯誤:', logs.length ? logs : '無');
  const ok = d.querySelector('.global-search input')
    && vm.searchState.engine === 'everything' && vm.searchState.items.length >= 1
    && badge && badge.textContent.includes('Everything')
    && allInFolder && vm.searchState.items.length >= 1
    && vm.toast.msg.includes('請輸入搜尋關鍵字')
    && !vm.searchState.show
    && logs.length === 0;
  window.close(); server.kill();
  const fs = require('fs');
  fs.rmSync('/tmp/fmtest-search-data', { recursive: true, force: true });
  console.log(ok ? '✅ 搜尋互動測試通過' : '❌ 搜尋互動測試失敗');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
