// ─────────────────────────────────────────────────────────────
//  GlacierStore — bulk-edit.js  (v3 — fix akses variable global)
//
//  PENTING: admin.js di-load dulu, lalu baru file ini, jadi
//  semua variable/function berikut bisa diakses langsung
//  tanpa prefix window.:
//    games, suppliers, activeGameId, saveGames,
//    renderProductPage, renderProductTable, toast,
//    normalizeGames, supplierNameById
// ─────────────────────────────────────────────────────────────

(function () {
  "use strict";

  // ── Util ──────────────────────────────────────────────────
  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  // Akses langsung ke global dari admin.js — bukan window.*
  function getGames()     { return typeof games     !== "undefined" ? games     : []; }
  function getSuppliers() { return typeof suppliers !== "undefined" ? suppliers : []; }
  function getActiveGameId() { return typeof activeGameId !== "undefined" ? activeGameId : ""; }

  function getSuppName(id) {
    if (!id) return "";
    // Gunakan supplierNameById() bawaan admin.js kalau ada
    if (typeof supplierNameById === "function") return supplierNameById(id);
    const s = getSuppliers().find(s => s.id === id);
    return s ? s.name : "";
  }

  // ── State Bulk Editor ─────────────────────────────────────
  let beGameId  = null;
  let selected  = new Set();

  // ── 1. Inject menu di sidebar ─────────────────────────────
  function injectBulkNav() {
    const rail = document.querySelector("[data-rail]");
    if (!rail || rail.querySelector("[data-nav='bulk']")) return;
    const productsBtn = rail.querySelector("[data-nav='products']");
    if (!productsBtn) return;

    const btn = document.createElement("button");
    btn.className = "rail-button";
    btn.type = "button";
    btn.setAttribute("data-nav", "bulk");
    btn.title = "Bulk Edit Produk";
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      <span>Bulk Edit</span>
    `;
    productsBtn.insertAdjacentElement("afterend", btn);
  }

  // ── 2. Inject halaman bulk ke DOM ────────────────────────
  function injectBulkPage() {
    if (document.querySelector("[data-page='bulk']")) return;
    const draft = document.querySelector("[data-page='draft']");
    if (!draft) return;

    const page = document.createElement("section");
    page.className = "admin-page";
    page.setAttribute("data-page", "bulk");
    page.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Bulk Edit Produk</h1>
          <p>Pilih game, centang produk, ubah beberapa field sekaligus.</p>
        </div>
        <div class="head-actions">
          <button class="primary-button" type="button" data-be-save>💾 Simpan Perubahan</button>
        </div>
      </div>

      <!-- Pilih game -->
      <div class="product-game-picker be-game-picker" data-be-game-picker></div>

      <!-- Toolbar -->
      <div class="be-toolbar">
        <div class="be-toolbar-left">
          <label class="be-check-all-label">
            <input type="checkbox" data-be-check-all />
            <span>Pilih Semua</span>
          </label>
          <span class="be-count-badge" data-be-count>0 dipilih</span>
        </div>
        <div class="be-toolbar-right">
          <div class="be-action-group">
            <select data-be-field class="be-select">
              <option value="">— Ubah field untuk yang dipilih —</option>
              <optgroup label="Status">
                <option value="status">Status Produk</option>
              </optgroup>
              <optgroup label="Harga">
                <option value="sellingPrice">Harga Jual</option>
                <option value="costPrice">Harga Modal</option>
                <option value="promoPrice">Harga Promo</option>
              </optgroup>
              <optgroup label="Promo">
                <option value="promoStatus">Aktif / Nonaktif Promo</option>
                <option value="promoStart">Mulai Promo</option>
                <option value="promoEnd">Akhir Promo</option>
              </optgroup>
              <optgroup label="Lainnya">
                <option value="supplierId">Supplier</option>
              </optgroup>
            </select>
            <div data-be-value-wrap class="be-value-wrap"></div>
            <button class="secondary-button" type="button" data-be-apply>Terapkan</button>
          </div>
        </div>
      </div>

      <!-- Grid card produk -->
      <div class="be-product-grid" data-be-product-grid>
        <p class="be-empty-hint">Pilih game di atas untuk mulai.</p>
      </div>
    `;
    draft.insertAdjacentElement("beforebegin", page);

    // Event listeners
    page.querySelector("[data-be-check-all]").addEventListener("change", onCheckAll);
    page.querySelector("[data-be-field]").addEventListener("change", onFieldChange);
    page.querySelector("[data-be-apply]").addEventListener("click", onApply);
    page.querySelector("[data-be-save]").addEventListener("click", onSave);

    page.querySelector("[data-be-game-picker]").addEventListener("click", e => {
      const btn = e.target.closest("[data-be-pick]");
      if (!btn) return;
      beGameId = btn.dataset.bePick;
      selected.clear();
      renderBEGamePicker();
      renderBEGrid();
    });

    // Klik card / checkbox
    page.querySelector("[data-be-product-grid]").addEventListener("change", e => {
      const cb = e.target.closest("[data-be-row-check]");
      if (!cb) return;
      const idx = Number(cb.dataset.beRowCheck);
      if (cb.checked) selected.add(idx); else selected.delete(idx);
      const card = page.querySelector(`[data-be-card="${idx}"]`);
      if (card) card.classList.toggle("is-checked", cb.checked);
      updateBECount();
      syncCheckAll();
    });

    page.querySelector("[data-be-product-grid]").addEventListener("click", e => {
      if (e.target.closest("[data-be-row-check]")) return;
      const card = e.target.closest("[data-be-card]");
      if (!card) return;
      const idx = Number(card.dataset.beCard);
      const cb = card.querySelector("[data-be-row-check]");
      if (!cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  // ── 3. Render game picker ─────────────────────────────────
  function renderBEGamePicker() {
    const picker = document.querySelector("[data-page='bulk'] [data-be-game-picker]");
    if (!picker) return;
    const gs = getGames();
    if (!gs.length) {
      picker.innerHTML = `<p style="color:#5f6672;font-size:13px">Belum ada game.</p>`;
      return;
    }
    picker.innerHTML = gs.map(g => `
      <button class="game-chip ${g.id === beGameId ? "is-active" : ""} ${g.status !== "normal" ? "is-maint" : ""}"
        type="button" data-be-pick="${esc(g.id)}">
        ${esc(g.initials)} <span>${esc(g.name)}</span>
      </button>
    `).join("");
  }

  // ── 4. Render grid card produk ────────────────────────────
  function renderBEGrid() {
    const grid = document.querySelector("[data-page='bulk'] [data-be-product-grid]");
    if (!grid) return;

    if (!beGameId) {
      grid.innerHTML = `<p class="be-empty-hint">Pilih game di atas untuk mulai.</p>`;
      return;
    }

    const g = getGames().find(x => x.id === beGameId);
    if (!g) {
      grid.innerHTML = `<p class="be-empty-hint">Game tidak ditemukan.</p>`;
      return;
    }
    if (!g.products || !g.products.length) {
      grid.innerHTML = `<p class="be-empty-hint">Game <strong>${esc(g.name)}</strong> belum punya produk.</p>`;
      return;
    }

    grid.innerHTML = g.products.map((p, i) => {
      const isChecked = selected.has(i);
      const sName = getSuppName(p.supplierId);
      const promoActive = p.promo && p.promoPrice;

      let statusClass = "be-badge-ok", statusLabel = "Normal";
      if (p.status === "soldout")  { statusClass = "be-badge-warn"; statusLabel = "Stok Habis"; }
      if (p.status === "gangguan") { statusClass = "be-badge-err";  statusLabel = "Gangguan"; }

      return `
        <div class="be-card ${isChecked ? "is-checked" : ""}" data-be-card="${i}">
          <div class="be-card-check-area">
            <input type="checkbox" class="be-cb" data-be-row-check="${i}" ${isChecked ? "checked" : ""} />
          </div>
          <div class="be-card-body">
            <div class="be-card-name">${esc(p.name)}</div>
            <div class="be-card-meta">
              <span class="be-badge ${statusClass}">${statusLabel}</span>
              ${promoActive ? `<span class="be-badge be-badge-promo">Promo</span>` : ""}
              ${sName ? `<span class="be-badge be-badge-supplier">${esc(sName)}</span>` : ""}
            </div>
            <div class="be-card-prices">
              <span>Jual: <strong>${esc(p.sellingPrice || p.price || "—")}</strong></span>
              ${p.costPrice ? `<span>Modal: <strong>${esc(p.costPrice)}</strong></span>` : ""}
              ${promoActive ? `<span>Promo: <strong>${esc(p.promoPrice)}</strong></span>` : ""}
            </div>
            ${p.promoStart || p.promoEnd ? `
            <div class="be-card-dates">
              ${p.promoStart ? `<span>Mulai: ${esc(p.promoStart.slice(0,16).replace("T"," "))}</span>` : ""}
              ${p.promoEnd   ? `<span>Selesai: ${esc(p.promoEnd.slice(0,16).replace("T"," "))}</span>`   : ""}
            </div>` : ""}
          </div>
        </div>
      `;
    }).join("");

    updateBECount();
    syncCheckAll();
  }

  // ── Pilih Semua ───────────────────────────────────────────
  function onCheckAll(e) {
    const g = getGames().find(x => x.id === beGameId);
    if (!g) return;
    if (e.target.checked) {
      g.products.forEach((_, i) => selected.add(i));
    } else {
      selected.clear();
    }
    renderBEGrid();
  }

  function syncCheckAll() {
    const cb = document.querySelector("[data-page='bulk'] [data-be-check-all]");
    if (!cb) return;
    const g = getGames().find(x => x.id === beGameId);
    const total = g?.products?.length || 0;
    if (!total || selected.size === 0)      { cb.checked = false; cb.indeterminate = false; }
    else if (selected.size === total)        { cb.checked = true;  cb.indeterminate = false; }
    else                                     { cb.checked = false; cb.indeterminate = true;  }
  }

  function updateBECount() {
    const el = document.querySelector("[data-page='bulk'] [data-be-count]");
    if (el) el.textContent = `${selected.size} dipilih`;
  }

  // ── Render input nilai ────────────────────────────────────
  function onFieldChange(e) {
    const field = e.target.value;
    const wrap  = document.querySelector("[data-page='bulk'] [data-be-value-wrap]");
    if (!wrap) return;
    if (!field) { wrap.innerHTML = ""; return; }

    if (field === "status") {
      wrap.innerHTML = `
        <select class="be-select" data-be-value>
          <option value="normal">Normal (Aktif)</option>
          <option value="soldout">Stok Habis</option>
          <option value="gangguan">Gangguan</option>
        </select>`;
    } else if (field === "promoStatus") {
      wrap.innerHTML = `
        <select class="be-select" data-be-value>
          <option value="on">Aktifkan Promo</option>
          <option value="off">Nonaktifkan Promo</option>
        </select>`;
    } else if (field === "supplierId") {
      const opts = getSuppliers()
        .map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)
        .join("");
      wrap.innerHTML = `
        <select class="be-select" data-be-value>
          <option value="">— Tidak ada —</option>
          ${opts}
        </select>`;
    } else if (field === "promoStart" || field === "promoEnd") {
      wrap.innerHTML = `<input type="datetime-local" class="be-input" data-be-value />`;
    } else {
      // sellingPrice | costPrice | promoPrice
      wrap.innerHTML = `<input type="text" class="be-input" data-be-value placeholder="Contoh: Rp15.000" />`;
    }
  }

  // ── Terapkan ke yang dipilih ──────────────────────────────
  function onApply() {
    if (selected.size === 0) {
      if (typeof toast === "function") toast("Pilih produk terlebih dahulu.", "error");
      return;
    }
    const field   = document.querySelector("[data-page='bulk'] [data-be-field]")?.value;
    const valueEl = document.querySelector("[data-page='bulk'] [data-be-value]");
    const value   = valueEl?.value ?? "";

    if (!field) {
      if (typeof toast === "function") toast("Pilih field yang ingin diubah.", "error");
      return;
    }

    const g = getGames().find(x => x.id === beGameId);
    if (!g) return;

    selected.forEach(i => {
      const p = g.products[i];
      if (!p) return;

      if (field === "status") {
        p.status = value;

      } else if (field === "promoStatus") {
        if (value === "on") {
          p.promo = true;
        } else {
          p.promo      = false;
          p.promoPrice = "";
          p.promoStart = "";
          p.promoEnd   = "";
          p.price      = p.sellingPrice || p.price;
          p.normal     = "";
        }

      } else if (field === "sellingPrice") {
        p.sellingPrice = value;
        if (!p.promoPrice) { p.price = value; p.normal = ""; }

      } else if (field === "costPrice") {
        p.costPrice = value;

      } else if (field === "promoPrice") {
        p.promoPrice = value;
        p.promo      = Boolean(value);
        if (value) { p.price = value; p.normal = p.sellingPrice; }
        else        { p.price = p.sellingPrice || p.price; p.normal = ""; }

      } else if (field === "promoStart") {
        p.promoStart = value;
        if (p.promoPrice) p.promo = true;

      } else if (field === "promoEnd") {
        p.promoEnd = value;
        if (p.promoPrice) p.promo = true;

      } else if (field === "supplierId") {
        p.supplierId = value;
      }
    });

    renderBEGrid();

    const labels = {
      status: "Status", promoStatus: "Status promo",
      sellingPrice: "Harga jual", costPrice: "Harga modal", promoPrice: "Harga promo",
      promoStart: "Mulai promo", promoEnd: "Akhir promo", supplierId: "Supplier",
    };
    if (typeof toast === "function")
      toast(`${labels[field] || field} diterapkan ke ${selected.size} produk.`);
  }

  // ── Simpan ────────────────────────────────────────────────
  function onSave() {
    if (typeof saveGames === "function") {
      saveGames();
      if (typeof toast === "function") toast("Perubahan disimpan ✓");
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  FILTER SUPPLIER — Manajemen Produk
  // ═══════════════════════════════════════════════════════════

  let supplierFilter = "";

  function injectSupplierFilter() {
    const productHead = document.querySelector(".product-head");
    if (!productHead || productHead.querySelector("[data-supplier-filter]")) return;

    const wrap = document.createElement("div");
    wrap.className = "supplier-filter-bar";
    wrap.innerHTML = `
      <label class="supplier-filter-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
        </svg>
        Filter Supplier:
        <select data-supplier-filter class="be-select"></select>
      </label>
    `;
    productHead.appendChild(wrap);

    wrap.querySelector("[data-supplier-filter]").addEventListener("change", e => {
      supplierFilter = e.target.value;
      if (!supplierFilter) {
        // Kembali ke render normal
        if (typeof renderProductTable === "function") renderProductTable();
      } else {
        renderFilteredTable();
      }
      updateProductSummaryWithFilter();
    });
  }

  function refreshSupplierFilterOptions() {
    const sel = document.querySelector("[data-supplier-filter]");
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML =
      `<option value="">Semua Supplier</option>` +
      getSuppliers().map(s =>
        `<option value="${esc(s.id)}">${esc(s.name)}</option>`
      ).join("") +
      `<option value="__none__">— Tanpa Supplier —</option>`;
    if (cur) sel.value = cur;
  }

  function renderFilteredTable() {
    if (!supplierFilter) return;

    const g = getGames().find(x => x.id === getActiveGameId());
    if (!g) return;
    const tbody = document.querySelector("[data-product-table]");
    if (!tbody) return;

    const filtered = g.products
      .map((p, i) => ({ p, i }))
      .filter(({ p }) =>
        supplierFilter === "__none__"
          ? !p.supplierId
          : p.supplierId === supplierFilter
      );

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="color:#5f6672;padding:20px;text-align:center">
        Tidak ada produk untuk supplier ini.
      </td></tr>`;
      return;
    }

    function getPS(p) {
      if (!p.promo && !p.promoPrice) return { label: "-", cls: "" };
      const now   = new Date();
      const start = p.promoStart ? new Date(p.promoStart) : null;
      const end   = p.promoEnd   ? new Date(p.promoEnd)   : null;
      if (start && start > now) return { label: "Scheduled",    cls: "status-scheduled" };
      if (end   && end   < now) return { label: "Expired Promo",cls: "status-expired"   };
      return { label: "Active", cls: "status-active" };
    }

    tbody.innerHTML = filtered.map(({ p, i }) => {
      const ps       = getPS(p);
      const unavail  = p.status !== "normal";
      const selVal   = p.sellingPrice || p.normal || p.price || "";
      const promoVal = p.promoPrice || (p.promo ? p.price : "") || "";
      const badge    = ps.cls
        ? `<span class="status-badge-table ${ps.cls}">${ps.label}</span>`
        : `<span class="muted-cell">—</span>`;
      const sBadge   = unavail
        ? `<span class="status-badge-table ${p.status === "soldout" ? "status-expired" : "status-scheduled"}">${p.status === "soldout" ? "Stok Habis" : "Gangguan"}</span>`
        : `<span class="status-badge-table status-active">Normal</span>`;
      const sName = getSuppName(p.supplierId);

      return `
        <tr class="${unavail ? "is-unavailable" : ""}"
            data-product-index="${i}" draggable="true" data-drag-product-index="${i}">
          <td class="drag-cell"><span class="drag-handle" title="Geser untuk urutkan">⠿</span></td>
          <td><strong>${esc(p.name)}</strong></td>
          <td>${sName ? `<span class="supplier-chip">${esc(sName)}</span>` : `<span class="muted-cell">—</span>`}</td>
          <td><input type="text" value="${esc(p.costPrice)}" data-inline-field="costPrice" /></td>
          <td><input type="text" value="${esc(selVal)}"      data-inline-field="sellingPrice" /></td>
          <td><input type="checkbox" ${p.promo || promoVal ? "checked" : ""} data-inline-field="promo" /></td>
          <td><input type="text" value="${esc(promoVal)}"    data-inline-field="promoPrice" /></td>
          <td>${badge}</td>
          <td>${sBadge}</td>
          <td>
            <div class="row-actions">
              <button class="icon-action"        type="button" data-edit-product="${i}"   title="Edit">✏️</button>
              <button class="icon-action danger"  type="button" data-delete-product="${i}" title="Hapus">🗑</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  function updateProductSummaryWithFilter() {
    const summary = document.querySelector("[data-product-summary]");
    const g = getGames().find(x => x.id === getActiveGameId());
    if (!summary || !g) return;
    if (!supplierFilter) {
      summary.textContent = `${g.products.length} varian. Status: ${g.status !== "normal" ? `⚠ ${g.status}` : "✅ Aktif"}`;
      return;
    }
    const filtered = g.products.filter(p =>
      supplierFilter === "__none__" ? !p.supplierId : p.supplierId === supplierFilter
    );
    const filterLabel = supplierFilter === "__none__"
      ? "Tanpa Supplier"
      : getSuppName(supplierFilter) || "Supplier";
    summary.textContent = `Menampilkan ${filtered.length} dari ${g.products.length} produk · Filter: ${filterLabel}`;
  }

  // ── Patch renderProductPage ───────────────────────────────
  function patchRenderProductPage() {
    if (window._bePatched) return;
    if (typeof renderProductPage !== "function") return;

    const orig = renderProductPage;
    // Re-assign ke global variable (bukan window.renderProductPage, tapi
    // karena renderProductPage adalah global let, kita assign ulang langsung)
    // Tidak bisa re-assign const/let dari scope lain; gunakan window sebagai bridge
    window.renderProductPage = function () {
      orig();
      injectSupplierFilter();
      refreshSupplierFilterOptions();
      if (supplierFilter) {
        renderFilteredTable();
        updateProductSummaryWithFilter();
      }
    };
    // Patch juga panggilan di admin.js yang mungkin memanggil via reference lokal —
    // tapi karena renderProductPage adalah let global, referensi langsung dari admin.js
    // masih ke fungsi lama. Yang bisa kita patch hanya via event & nav klik.

    window._bePatched = true;
  }

  // ── Hook navigasi sidebar ─────────────────────────────────
  function hookNavigation() {
    if (window._beNavHooked) return;
    document.querySelector("[data-rail]")?.addEventListener("click", e => {
      const btn = e.target.closest("[data-nav]");
      if (btn?.dataset.nav === "bulk") setTimeout(showBulkPage, 10);
    });
    window._beNavHooked = true;
  }

  function showBulkPage() {
    document.querySelectorAll(".admin-page.is-active").forEach(p => p.classList.remove("is-active"));
    document.querySelector("[data-page='bulk']")?.classList.add("is-active");
    document.querySelectorAll(".rail-button.is-active").forEach(b => b.classList.remove("is-active"));
    document.querySelector("[data-nav='bulk']")?.classList.add("is-active");
    const label = document.querySelector("[data-page-label]");
    if (label) label.textContent = "Bulk Edit";

    // Selalu sinkronkan game dari variable global terbaru
    if (!beGameId) {
      const first = getGames()[0];
      if (first) beGameId = first.id;
    }
    renderBEGamePicker();
    renderBEGrid();
  }

  // ── CSS ───────────────────────────────────────────────────
  function injectStyles() {
    if (document.querySelector("#be-styles")) return;
    const s = document.createElement("style");
    s.id = "be-styles";
    s.textContent = `
      /* Game picker bulk (reuse class yang sama) */
      .be-game-picker { margin-bottom: 20px; }

      /* Toolbar */
      .be-toolbar {
        display: flex; align-items: center; justify-content: space-between;
        flex-wrap: wrap; gap: 12px;
        background: #f0faf9; border: 1px solid #0b8f87;
        border-radius: 10px; padding: 12px 16px; margin-bottom: 20px;
      }
      .be-toolbar-left  { display: flex; align-items: center; gap: 12px; }
      .be-toolbar-right { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      .be-action-group  { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .be-check-all-label {
        display: flex; align-items: center; gap: 8px;
        font-size: 13px; font-weight: 700; cursor: pointer; user-select: none;
      }
      .be-check-all-label input[type="checkbox"] {
        width: 16px; height: 16px; cursor: pointer; accent-color: #0b8f87; flex-shrink: 0;
      }
      .be-count-badge {
        font-size: 12px; font-weight: 700; color: #0b8f87;
        background: #d6f5f3; padding: 3px 10px; border-radius: 20px; white-space: nowrap;
      }
      .be-select {
        padding: 7px 10px; border: 1px solid #d8dde2; border-radius: 8px;
        font: inherit; font-size: 13px; background: #fff; cursor: pointer;
      }
      .be-input {
        padding: 7px 10px; border: 1px solid #d8dde2; border-radius: 8px;
        font: inherit; font-size: 13px; background: #fff; min-width: 130px;
      }
      .be-select:focus, .be-input:focus {
        outline: 2px solid #0b8f87; outline-offset: 1px;
      }
      .be-value-wrap { display: flex; align-items: center; }

      /* Card grid */
      .be-product-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 12px;
      }
      .be-card {
        background: #fff; border: 2px solid #e8edf2; border-radius: 12px;
        padding: 14px; display: flex; gap: 12px; align-items: flex-start;
        cursor: pointer; transition: border-color .15s, box-shadow .15s, background .15s;
      }
      .be-card:hover  { border-color: #0b8f87; box-shadow: 0 2px 10px rgba(11,143,135,.12); }
      .be-card.is-checked { border-color: #0b8f87; background: #f0faf9; }
      .be-card-check-area { padding-top: 2px; flex-shrink: 0; }
      .be-cb { width: 18px; height: 18px; cursor: pointer; accent-color: #0b8f87; }
      .be-card-body { flex: 1; min-width: 0; }
      .be-card-name {
        font-weight: 700; font-size: 14px; color: #14171f;
        margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .be-card-meta { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
      .be-badge {
        font-size: 11px; font-weight: 700; padding: 2px 8px;
        border-radius: 20px; white-space: nowrap;
      }
      .be-badge-ok       { background: #d6f5f3; color: #0b8f87; }
      .be-badge-warn     { background: #fff3cd; color: #856404; }
      .be-badge-err      { background: #fdeceb; color: #b13d3d; }
      .be-badge-promo    { background: #ede9fe; color: #6f42c1; }
      .be-badge-supplier { background: #e2e8f0; color: #475569; }
      .be-card-prices {
        display: flex; flex-wrap: wrap; gap: 10px;
        font-size: 12px; color: #5f6672;
      }
      .be-card-prices strong { color: #14171f; }
      .be-card-dates {
        margin-top: 6px; font-size: 11px; color: #5f6672;
        display: flex; flex-direction: column; gap: 2px;
      }
      .be-empty-hint {
        color: #5f6672; padding: 32px 0;
        grid-column: 1 / -1; text-align: center;
      }

      /* Filter supplier di Manajemen Produk */
      .supplier-filter-bar {
        margin-top: 14px; padding-top: 14px; border-top: 1px solid #f0f2f4;
      }
      .supplier-filter-label {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 13px; font-weight: 700; color: #14171f; cursor: default;
      }
      .supplier-filter-label svg { color: #5f6672; flex-shrink: 0; }
      .supplier-filter-label select { font-weight: 400; }
    `;
    document.head.appendChild(s);
  }

  // ── INIT ──────────────────────────────────────────────────
  function init() {
    injectStyles();
    injectBulkNav();
    injectBulkPage();
    hookNavigation();
    patchRenderProductPage();
    // Inject filter ke products page kalau sedang aktif
    if (typeof currentPage !== "undefined" && currentPage === "products") {
      injectSupplierFilter();
      refreshSupplierFilterOptions();
    }
  }

  // bulk-edit.js di-load setelah admin.js sudah selesai (lewat await),
  // jadi tidak perlu setTimeout besar — cukup nextTick
  setTimeout(init, 0);

})();