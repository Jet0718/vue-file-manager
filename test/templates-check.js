/* 模板語法驗證：使用 Vue 編譯器檢查 templates.js 內的模板是否有語法錯誤 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');

// 在 vm sandbox 中載入 Vue global build（提供 jsdom 的 document，供編譯器解碼 HTML entity）
const vueCode = fs.readFileSync(path.join(root, 'public/vendor/vue.global.prod.js'), 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const vueSandbox = { console, document: dom.window.document };
vm.createContext(vueSandbox);
vm.runInContext(vueCode, vueSandbox);
const Vue = vueSandbox.Vue;

// 載入模板
const tplCode = fs.readFileSync(path.join(root, 'public/js/templates.js'), 'utf8');
const tplSandbox = {};
vm.createContext(tplSandbox);
vm.runInContext(tplCode, tplSandbox);
const T = tplSandbox.TEMPLATES;

let fail = 0;
for (const [key, tpl] of Object.entries(T)) {
  try {
    Vue.compile(tpl);
    console.log(`✓ 模板 ${key} 編譯通過`);
  } catch (e) {
    fail++;
    console.error(`✗ 模板 ${key} 編譯失敗：${e.message}`);
  }
}
process.exit(fail ? 1 : 0);
