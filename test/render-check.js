/* 真實渲染測試：jsdom 載入頁面 → 依序執行三個 script → 驗證 Vue 掛載、樹狀目錄、檔案列表、操作按鈕 */
const { JSDOM, VirtualConsole } = require('jsdom');
const { spawn } = require('child_process');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn('node', ['server.js'], { cwd: PROJECT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await sleep(1200);
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => logs.push('JSDOM_ERR: ' + (e.detail && e.detail.message ? e.detail.message : e.message)));
  ['log', 'warn', 'error'].forEach((m) => vc.on(m, (...a) => logs.push(m.toUpperCase() + ': ' + a.map(String).join(' '))));

  const dom = await JSDOM.fromURL(`${BASE}/`, {
    runScripts: 'dangerously',
    resources: undefined, // 手動依序載入 script，避免 jsdom 非同步資源載入的時序問題
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

  // 輪詢等 Vue 完成非同步載入（roots + files）
  let treeRows = 0, fileRows = 0;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    treeRows = d.querySelectorAll('.tree-row').length;
    fileRows = d.querySelectorAll('.file-row').length;
    if (treeRows > 0 && fileRows > 0) break;
  }

  const brand = d.querySelector('.brand');
  const fileHead = d.querySelector('.file-head');
  const status = d.querySelector('.statusbar');
  const ficonCount = d.querySelectorAll('.ficon svg').length;
  const opsButtons = [...new Set([...d.querySelectorAll('.file-row .op')].map((b) => b.textContent.trim()))];
  const wslBadge = d.querySelector('.wsl-badge');
  const divider = d.querySelector('.divider');
  const headInList = d.querySelector('.file-list .file-head');
  const sidebarW = d.querySelector('.sidebar').style.getPropertyValue('--sidebar-w');
  const sortOptions = [...d.querySelectorAll('.list-toolbar select option')].map((o) => o.textContent.trim());
  const crumbs = [...d.querySelectorAll('.crumb')].map((c) => c.textContent.trim());

  console.log('品牌標題 :', brand && brand.textContent.trim());
  console.log('樹狀節點 :', treeRows, '筆');
  console.log('檔案列   :', fileRows, '筆');
  console.log('麵包屑   :', crumbs.join(' › '));
  console.log('欄位標題 :', fileHead && [...fileHead.children].map((c) => c.textContent.trim()).join(' | '));
  console.log('類型圖示 :', ficonCount, '個 SVG');
  console.log('操作按鈕 :', opsButtons.join(', '));
  console.log('WSL 模式  :', wslBadge ? wslBadge.textContent.trim() : '(無)');
  console.log('分隔條     :', divider ? '有' : '無', '| 側欄寬度變數:', sidebarW);
  console.log('表頭位置   :', headInList ? '在清單捲動框內（sticky）' : '錯誤！');
  console.log('排序選項 :', sortOptions.join(' | '));
  console.log('狀態列   :', status && status.textContent.trim().replace(/\s+/g, ' '));
  console.log('JS 錯誤  :', logs.length ? logs : '無');

  const ok = treeRows > 0 && fileRows > 0 && brand !== null && divider !== null && headInList !== null && logs.length === 0;
  window.close();
  server.kill();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('測試失敗：', e); server.kill(); process.exit(1); });
