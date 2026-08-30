/* 本機檔案管理系統 — Vue 模板（獨立檔案，方便單元驗證） */
(function (g) {
  const TEMPLATES = {

    root: `
<header class="topbar">
    <div class="brand">🗂 本機檔案管理</div>
    <div class="toolbar">
      <span v-if="meta.isWSL" class="wsl-badge" title="正在 WSL 環境執行，可透過 /mnt 瀏覽 Windows 磁碟">WSL 模式</span>
      <div class="global-search" title="使用 Everything 搜尋整個系統">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input v-model.trim="searchQuery" placeholder="Everything 全域搜尋…（Enter）" @keyup.enter="doSearch">
        <label class="check" title="勾選後僅搜尋目前資料夾"><input type="checkbox" v-model="searchScopeFolder"> 目前資料夾</label>
        <button class="btn" @click="doSearch">搜尋</button>
      </div>
      <button class="btn" @click="refreshAll" title="重新整理所有目錄">⟳ 重新整理</button>
      <label class="check" title="顯示／隱藏隱藏檔（檔名以 . 開頭）">
        <input type="checkbox" v-model="showHidden"> 顯示隱藏檔
      </label>
    </div>
  </header>

  <main class="layout">
    <aside class="sidebar" :style="{ '--sidebar-w': sidebarW + 'px' }">
      <div class="panel-tabs">
        <button class="ptab" :class="{ on: sidebarTab === 'dirs' }" @click="sidebarTab = 'dirs'">目錄</button>
        <button class="ptab" :class="{ on: sidebarTab === 'favs' }" @click="switchFavs">喜好</button>
        <button class="ptab" :class="{ on: sidebarTab === 'recent' }" @click="switchRecent">最近</button>
      </div>

      <!-- 目錄樹 -->
      <div v-show="sidebarTab === 'dirs'" class="tree">
        <tree-node v-for="r in roots" :key="r.path" :node="r" :app="self" mode="browse"></tree-node>
        <div v-if="!roots.length" class="tree-empty">載入中…</div>
      </div>

      <!-- 喜好資料夾 -->
      <div v-show="sidebarTab === 'favs'" class="favs">
        <div v-if="!favorites.length" class="tree-empty">尚未標記喜好資料夾<br>瀏覽時點選 ☆ 即可加入</div>
        <div v-for="f in favorites" :key="f.path" class="fav-row" @click="selectDir(f)">
          <span class="ficon" v-html="folderIcon()"></span>
          <div class="fav-main">
            <div class="fav-name" :title="f.path">{{ f.name }}</div>
            <div class="fav-path">{{ f.path }}</div>
          </div>
          <button class="op star" title="取消喜好" @click.stop="toggleFavorite(f.path)">★</button>
        </div>
      </div>

      <!-- 最近異動 -->
      <div v-show="sidebarTab === 'recent'" class="recent">
        <div class="recent-toolbar">
          <span class="recent-days">最近
            <input type="number" v-model.number="recentDays" min="1" max="365" @change="loadRecent">
            天內異動
          </span>
          <button class="btn" @click="loadRecent" title="重新掃描">⟳</button>
        </div>
        <div v-if="recentLoading" class="tree-empty">掃描中…</div>
        <div v-else-if="recentError" class="tree-empty rerr">{{ recentError }}</div>
        <div v-else-if="!recentItems.length" class="tree-empty">最近 {{ recentDays }} 天內沒有異動的項目</div>
        <div v-for="it in recentItems" :key="it.path" class="recent-row" @click="onRecentClick(it)">
          <span class="ficon" v-html="fileIcon(it)"></span>
          <div class="fav-main">
            <div class="fav-name" :title="it.path">{{ it.name }}</div>
            <div class="fav-path">{{ it.isDir ? '資料夾' : fmtSize(it.size) }} ｜ {{ fmtDate(it.mtime) }}</div>
          </div>
          <span class="recent-ops">
            <button class="op" v-if="!it.isDir" @click.stop="doOpen(it)">開啟</button>
            <button class="op" v-if="isPreviewable(it)" @click.stop="openPreview(it)">預覽</button>
            <button class="op" @click.stop="revealInDir(it)">所在資料夾</button>
          </span>
        </div>
      </div>
    </aside>

    <div class="divider" :class="{ dragging: resizing }" @mousedown.prevent="startResize" title="拖曳調整寬度"></div>

    <section class="content">
      <div class="breadcrumb" v-if="selectedDir">
        <template v-for="(c, i) in breadcrumbs" :key="i">
          <span class="crumb" :class="{ last: i === breadcrumbs.length - 1 }" @click="navTo(c.path)">{{ c.name }}</span>
          <span v-if="i < breadcrumbs.length - 1" class="crumb-sep">›</span>
        </template>
      </div>

      <div class="list-toolbar">
        <button v-if="selectedDir" class="star-lg" :class="{ on: isFav(selectedDir.path) }"
                @click="toggleFavorite(selectedDir.path)"
                :title="isFav(selectedDir.path) ? '取消此資料夾的喜好' : '將此資料夾加入喜好'">
          {{ isFav(selectedDir.path) ? '★ 已加入喜好' : '☆ 加入喜好' }}
        </button>
        <input class="search" v-model.trim="dirFilter" placeholder="篩選目前資料夾…">
        <select v-model="sortKey" title="排序方式">
          <option value="mtime">修改日期（新→舊）</option>
          <option value="name">名稱</option>
          <option value="size">大小</option>
        </select>
        <label class="check" title="資料夾固定顯示在最上方"><input type="checkbox" v-model="pinDirs"> 資料夾置頂</label>
        <button v-if="selectedDir" class="btn" @click="openDedup" title="掃描目前資料夾與子目錄，找尋內容相同的重複檔案（先比長度再比 sha256），預設勾選檔名較長者，確認後刪除">🔁 重整</button>
      </div>

      <!-- 批量操作工具列 -->
      <div v-if="selectionCount > 0" class="batch-bar">
        <span class="batch-count">已選取 {{ selectionCount }} 個項目</span>
        <button class="btn" @click="batchCopy" title="複製選取項目到其他資料夾">📋 複製</button>
        <button class="btn" @click="batchMove" title="搬移選取項目到其他資料夾">➡ 搬移</button>
        <button class="btn" @click="batchBackup" title="僅備份具封存標記（A）的檔案（無 .bak 時全備份 f-*.zip，否則差異備份 i-*.zip）">💾 備份</button>
        <button class="btn" @click="batchDownload" title="打包成 ZIP 下載">📦 下載 ZIP</button>
        <button class="btn danger-btn" @click="batchDelete" title="刪除選取項目">🗑 刪除</button>
        <button class="op" @click="clearSelection" title="清除選取">✕ 清除</button>
      </div>

      <div class="file-list">
        <div class="file-head">
          <span class="col-name">
            <label class="selbox" title="全選／取消全選" @click.stop><input type="checkbox" :checked="allSelected" @change="toggleSelectAll"></label>
            <span>名稱</span>
          </span>
          <span class="col-size">大小</span>
          <span class="col-date">修改日期</span>
          <span class="col-ops">操作</span>
        </div>
        <div v-if="!selectedDir" class="empty">請在左側樹狀目錄中選擇一個資料夾</div>
        <div v-else-if="loadingFiles" class="empty">載入中…</div>
        <div v-else-if="!visibleFiles.length" class="empty">此資料夾沒有符合的項目</div>
        <div v-for="f in visibleFiles" :key="f.path" class="file-row"
             :class="{ active: activeFile === f.path, selected: !!selectedSet[f.path] }"
             @click="onRowClick(f, $event)" @dblclick="onRowDbl(f)">
          <span class="col-name">
            <label class="selbox" @click.stop><input type="checkbox" :checked="!!selectedSet[f.path]" @change="toggleSelect(f)"></label>
            <span class="ficon" v-html="fileIcon(f)"></span>
            <button v-if="f.isDir" class="star" :class="{ on: isFav(f.path) }" @click.stop="toggleFavorite(f.path)"
                    :title="isFav(f.path) ? '取消喜好' : '加入喜好'">{{ isFav(f.path) ? '★' : '☆' }}</button>
            <span class="fname" :title="f.path">{{ f.name }}</span>
          </span>
          <span class="col-size">{{ f.isDir ? '—' : fmtSize(f.size) }}</span>
          <span class="col-date">{{ fmtDate(f.mtime) }}</span>
          <span class="col-ops">
            <button class="op" v-if="!f.isDir" @click.stop="doOpen(f)" title="以系統預設應用程式開啟">開啟</button>
            <button class="op" v-if="isPreviewable(f)" @click.stop="openPreview(f)" title="文字／Markdown／HTML 預覽">預覽</button>
            <button class="op" v-if="isArchive(f)" @click.stop="doPreviewArchive(f)" title="在獨立分頁檢視壓縮檔內容並可還原">壓縮檔</button>
            <button class="op" @click.stop="openDestModal('copy', f)" title="複製到其他資料夾">複製</button>
            <button class="op" @click.stop="openDestModal('move', f)" title="搬移到其他資料夾">搬移</button>
            <button class="op" @click.stop="openRename(f)" title="重新命名">更名</button>
            <button class="op" v-if="!f.isDir" @click.stop="doBackup(f)" title="僅備份具封存標記（A）的檔案至 .bak 資料夾">備份</button>
            <button class="op" v-if="!f.isDir" @click.stop="doDownload(f)" title="下載檔案">下載</button>
            <button class="op danger" @click.stop="doDelete(f)" title="刪除（無法復原）">刪除</button>
          </span>
        </div>
      </div>

      <footer class="statusbar" v-if="selectedDir">
        <span title="目前資料夾路徑">📂 {{ selectedDir.path }}</span>
        <span>{{ files.length }} 個項目 ｜ 合計 {{ fmtSize(totalSize) }}</span>
      </footer>
    </section>
  </main>

  <!-- 複製／搬移 目的地選取 -->
  <div class="modal-mask" v-if="destModal.show" @click.self="closeDestModal">
    <div class="modal" @click.stop>
      <h3>{{ destModal.mode === 'copy' ? '複製' : '搬移' }}：<em>{{ destModal.srcName }}</em></h3>
      <p class="hint">在下方樹狀目錄中選擇目的地資料夾，或直接輸入路徑：</p>
      <div class="modal-tree">
        <tree-node v-for="r in roots" :key="r.path" :node="r" :app="self" mode="pick"></tree-node>
        <div v-if="!roots.length" class="tree-empty">載入中…</div>
      </div>
      <div class="dest-input">
        <input v-model="destModal.dest" placeholder="例如 /home/user/Documents 或 C:\\Users\\user" @change="validateDest">
        <span v-if="destModal.destInfo" class="dest-info" :class="{ bad: !destModal.destOk }">
          {{ destModal.destOk ? '✓ 有效資料夾' : '✗ 無效路徑或與來源相同' }}
        </span>
      </div>
      <div class="modal-actions">
        <button class="btn" @click="closeDestModal">取消</button>
        <button class="btn primary" :disabled="!destModal.destOk" @click="confirmDest">
          {{ destModal.mode === 'copy' ? '確認複製' : '確認搬移' }}
        </button>
      </div>
    </div>
  </div>

  <!-- 文字／Markdown／HTML 預覽 -->
  <div class="modal-mask" v-if="preview.show" @click.self="closePreview">
    <div class="modal preview-modal" @click.stop>
      <div class="preview-head">
        <h3>預覽：<em>{{ preview.name }}</em></h3>
        <div class="preview-tools">
          <span class="preview-meta" v-if="preview.info">{{ preview.info }}</span>
          <button class="btn" @click="openInNewTab" title="以系統預設程式開啟或下載">在新分頁開啟</button>
          <button class="btn" @click="closePreview">✕ 關閉</button>
        </div>
      </div>
      <div class="preview-body">
        <div v-if="preview.loading" class="empty">載入中…</div>
        <div v-else-if="preview.error" class="preview-error">{{ preview.error }}</div>
        <iframe v-else-if="preview.kind === 'html'" class="preview-frame" :srcdoc="preview.content"></iframe>
        <iframe v-else-if="preview.kind === 'md'" class="preview-frame" :srcdoc="preview.rendered"></iframe>
        <pre v-else class="preview-txt">{{ preview.content }}</pre>
      </div>
    </div>
  </div>

  <!-- 搜尋結果 -->
  <div class="modal-mask" v-if="searchState.show" @click.self="closeSearch">
    <div class="modal search-modal" @click.stop>
      <div class="preview-head">
        <h3>搜尋：<em>{{ searchState.query }}</em></h3>
        <div class="preview-tools">
          <span class="engine-badge" :class="{ off: searchState.engine !== 'everything' }"
                :title="searchState.engine === 'everything' ? '由 Everything 索引搜尋' : 'Everything 不可用，使用本機搜尋（範圍有限）'">
            {{ searchState.engine === 'everything' ? '⚡ Everything' : '本機搜尋' }}
          </span>
          <span class="preview-meta" v-if="searchState.info">{{ searchState.info }}</span>
          <button class="btn" @click="closeSearch">✕ 關閉</button>
        </div>
      </div>
      <div class="search-body">
        <div v-if="searchState.loading" class="empty">搜尋中…</div>
        <div v-else-if="searchState.error" class="preview-error">{{ search.error }}</div>
        <div v-else-if="!searchState.items.length" class="empty">沒有符合「{{ searchState.query }}」的結果</div>
        <div v-for="it in searchState.items" :key="it.path" class="search-row" @click="onSearchClick(it)">
          <span class="ficon" v-html="fileIcon(it)"></span>
          <div class="fav-main">
            <div class="fav-name" :title="it.path">{{ it.name }}</div>
            <div class="fav-path">{{ it.path }}</div>
          </div>
          <span class="search-meta">
            <span v-if="!it.isDir">{{ fmtSize(it.size) }}</span>
            <span>{{ fmtDate(it.mtime) }}</span>
          </span>
          <span class="search-ops">
            <button v-if="it.isDir" class="op star" :class="{ on: isFav(it.path) }" @click.stop="toggleFavorite(it.path)"
                    :title="isFav(it.path) ? '取消喜好' : '加入喜好'">{{ isFav(it.path) ? '★' : '☆' }}</button>
            <button class="op" v-if="!it.isDir" @click.stop="doOpen(it)" title="以系統預設程式開啟">開啟</button>
            <button class="op" v-if="isPreviewable(it)" @click.stop="openPreview(it)" title="預覽">預覽</button>
            <button class="op" @click.stop="revealInDir(it)" title="在檔案列表中顯示">所在資料夾</button>
          </span>
        </div>
      </div>
    </div>
  </div>

  <!-- 更名 -->
  <div class="modal-mask" v-if="renameModal.show" @click.self="closeRename">
    <div class="modal rename-modal" @click.stop>
      <h3>更名：<em>{{ renameModal.oldName }}</em></h3>
      <div class="rename-input">
        <input v-model="renameModal.newName" @keyup.enter="confirmRename" @keyup.esc="closeRename"
               ref="renameInput" spellcheck="false">
      </div>
      <div v-if="renameModal.error" class="rename-error">{{ renameModal.error }}</div>
      <div class="modal-actions">
        <button class="btn" @click="closeRename">取消</button>
        <button class="btn primary" :disabled="!renameModal.newName.trim()" @click="confirmRename">確認更名</button>
      </div>
    </div>
  </div>

  <!-- 重整：找尋並刪除內容重複的檔案 -->
  <div class="modal-mask" v-if="dedupModal.show" @click.self="closeDedup">
    <div class="modal dedup-modal" @click.stop>
      <h3>🔁 重整：找尋重複檔案（<em>{{ selectedDir ? selectedDir.path : '' }}</em>）</h3>
      <p class="hint" v-if="dedupModal.loading">掃描中…（先依檔案長度分組，再以 sha256 比對內容）</p>
      <p class="hint" v-else-if="!dedupModal.error && dedupModal.groups.length">
        共 {{ dedupModal.groupCount }} 組重複、{{ dedupModal.dupCount }} 個檔案 ｜
        已勾選 <b>{{ dedupSelectedCount }}</b> 個，將釋放 <b>{{ fmtSize(dedupFreedSize) }}</b>
        （每組預設保留檔名最短者）
      </p>
      <div class="dedup-body">
        <div v-if="dedupModal.loading" class="empty">掃描中…</div>
        <div v-else-if="dedupModal.error" class="empty dedup-err">{{ dedupModal.error }}</div>
        <div v-else-if="!dedupModal.groups.length" class="empty">沒有內容相同的重複檔案 🎉</div>
        <template v-else>
          <div v-for="(g, gi) in dedupModal.groups" :key="gi" class="dedup-group">
            <div class="dedup-group-head">
              {{ g.files.length }} 個相同檔案 ｜ {{ fmtSize(g.size) }} ｜ sha256 {{ g.hash.slice(0, 12) }}…
            </div>
            <label v-for="f in g.files" :key="f.path" class="dedup-item" :class="{ checked: !!dedupSel[f.path], keep: !f.defaultChecked }" :title="f.path">
              <input type="checkbox" :checked="!!dedupSel[f.path]" @change="toggleDedup(f.path)">
              <span class="dedup-name">{{ f.name }}</span>
              <span class="dedup-meta">{{ f.defaultChecked ? '刪除' : '保留' }} ｜ {{ fmtDate(f.mtime) }}</span>
            </label>
          </div>
        </template>
      </div>
      <div class="modal-actions" v-if="!dedupModal.loading && !dedupModal.error && dedupModal.groups.length">
        <button class="btn" @click="resetDedup" title="依預設勾選（保留各組檔名最短者）">依預設</button>
        <button class="btn" @click="clearDedup" title="全部取消勾選">全不選</button>
        <span style="flex:1"></span>
        <button class="btn" @click="closeDedup">取消</button>
        <button class="btn danger-btn" @click="confirmDedup" title="刪除勾選的重複檔案">刪除勾選檔案</button>
      </div>
    </div>
  </div>

  <!-- 提示訊息 -->
  <transition name="fade">
    <div v-if="toast.show" class="toast" :class="toast.type">{{ toast.msg }}</div>
  </transition>
`,

    treeNode: `
<div class="tree-node">
  <div class="tree-row"
       :class="{ selected: isSelected, pickDest: isPickDest }"
       @click="mode === 'pick' ? onPick() : onClick()"
       :title="node.path">
    <span class="caret" :class="{ open: isExpanded }" @click.stop="onToggle">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </span>
    <span class="tn-icon" v-html="folderSvg"></span>
    <span class="tn-label">{{ node.name }}</span>
    <span v-if="loading" class="tn-meta">…</span>
    <span v-else-if="error" class="tn-meta err" title="讀取失敗">!</span>
  </div>
  <div v-if="isExpanded" class="tree-children">
    <template v-if="children.length">
      <tree-node v-for="c in children" :key="c.path" :node="c" :app="app" :mode="mode"></tree-node>
    </template>
    <div v-else-if="!loading" class="tree-empty">（無子資料夾）</div>
  </div>
</div>`,

  };
  g.TEMPLATES = TEMPLATES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
