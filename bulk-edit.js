// ─────────────────────────────────────────────────────────────
//  GlacierStore — bulk-edit.js  (rebuild v2)
//  • Halaman Bulk Edit sendiri (bukan overlay tabel)
//  • Pilih game dulu → produk tampil sebagai card
//  • Semua field bisa di-bulk: status, promo, harga promo,
//    harga jual, harga modal, promo start/end, supplier
//  • Filter supplier di halaman Manajemen Produk
//  • Tidak menyentuh logika admin.js yang existing
// ─────────────────────────────────────────────────────────────

(function () {
  "use strict";

  // ── Util ──────────────────────────────────────────────────
  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  function supplierName(id) {
    if (!id || !window.suppliers) return "";
    const s = window.suppliers.find(s => s.id === id);
    return s ? s.name : "";
  }

  function allSuppliers() {
    return window.suppliers || [];
  }

  // ── State ─────────────────────────────────────────────────
  let beGameId = null;        // game yang dipilih di bulk editor
  let selected = new Set();   // index produk yang dicentang

  // ── NAV: tambah item "Bulk Edit" ke sidebar ───────────────
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

  // ── PAGE: inject halaman bulk ke DOM ─────────────────────
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

      <div class="be-game-picker" data-be-game-picker></div>

      <div class="be-toolbar" data-be-toolbar>
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
                <option value="promoStatus">Aktif/Nonaktif Promo</option>
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

      <div class="be-product-grid" data-be-product-grid>
        <p class="be-empty-hint">Pilih game di atas untuk mulai.</p>
      </div>
    `;
    draft.insertAdjacentElement("beforebegin", page);

    // Events di halaman bulk
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

    page.querySelector("[data-be-product-grid]").addEventListener("change", e => {
      const cb = e.target.closest("[data-be-row-check]");
      if (!cb) return;
      const idx = Number(cb.dataset.beRowCheck);
      if (cb.checked) selected.add(idx);
      else selected.delete(idx);
      // Update visual card
      const card = page.querySelector(`[data-be-card="${idx}"]`);
      if (card) card.classList.toggle("is-checked", cb.checked);
      updateBECount();
      syncCheckAll();
    });

    // Klik pada card (bukan checkbox) toggle centang
    page.querySelector("[data-be-product-grid]").addEventListener("click", e => {
      const card = e.target.closest("[data-be-card]");
      if (!card) return;
      if (e.target.closest("[data-be-row-check]")) return; // biarkan checkbox handle sendiri
      const idx = Number(card.dataset.beCard);
      const cb = card.querySelector("[data-be-row-check]");
      if (!cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  // ── Render pilih game di bulk page ────────────────────────
  function renderBEGamePicker() {
    const picker = document.querySelector("[data-page='bulk'] [data-be-game-picker]");
    if (!picker) return;
    picker.innerHTML = (window.games || []).map(g => `
      <button class="game-chip ${g.id === beGameId ? "is-active" : ""} ${g.status !== "normal" ? "is-maint" : ""}"
        type="button" data-be-pick="${esc(g.id)}">
        ${esc(g.initials)} <span>${esc(g.name)}</span>
      </button>
    `).join("");
  }

  // ── Render grid card produk ────────────────────────────────
  function renderBEGrid() {
    const grid = document.querySelector("[data-page='bulk'] [data-be-product-grid]");
    if (!grid) return;

    const g = (window.games || []).find(x => x.id === beGameId);
    if (!g) {
      grid.innerHTML = `<p class="be-empty-hint">Pilih game di atas untuk mulai.</p>`;
      return;
    }
    if (!g.products.length) {
      grid.innerHTML = `<p class="be-empty-hint">Game ini belum punya produk.</p>`;
      return;
    }

    grid.innerHTML = g.products.map((p, i) => {
      const isChecked = selected.has(i);
      const sName = supplierName(p.supplierId);
      const promoActive = p.promo && p.promoPrice;
      let statusClass = "be-badge-ok", statusLabel = "Normal";
      if (p.status === "soldout") { statusClass = "be-badge-warn"; statusLabel = "Stok Habis"; }
      if (p.status === "gangguan") { statusClass = "be-badge-err"; statusLabel = "Gangguan"; }

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
              ${p.promoStart ? `<span>Mulai: ${esc(p.promoStart.slice(0, 16).replace("T", " "))}</span>` : ""}
              ${p.promoEnd ? `<span>Selesai: ${esc(p.promoEnd.slice(0, 16).replace("T", " "))}</span>` : ""}
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
    const g = (window.games || []).find(x => x.id === beGameId);
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
    const g = (window.games || []).find(x => x.id === beGameId);
    if (!g || !g.products.length) { cb.checked = false; cb.indeterminate = false; return; }
    if (selected.size === 0) { cb.checked = false; cb.indeterminate = false; }
    else if (selected.size === g.products.length) { cb.checked = true; cb.indeterminate = false; }
    else { cb.checked = false; cb.indeterminate = true; }
  }

  function updateBECount() {
    const el = document.querySelector("[data-page='bulk'] [data-be-count]");
    if (el) el.textContent = `${selected.size} dipilih`;
  }

  // ── Render input nilai sesuai field ───────────────────────
  function onFieldChange(e) {
    const field = e.target.value;
    const wrap = document.querySelector("[data-page='bulk'] [data-be-value-wrap]");
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
      const opts = allSuppliers().map(s =>
        `<option value="${esc(s.id)}">${esc(s.name)}</option>`
      ).join("");
      wrap.innerHTML = `
        <select class="be-select" data-be-value>
          <option value="">— Tidak ada —</option>
          ${opts}
        </select>`;
    } else if (field === "promoStart" || field === "promoEnd") {
      wrap.innerHTML = `<input type="datetime-local" class="be-input" data-be-value />`;
    } else {
      // sellingPrice, costPrice, promoPrice
      wrap.innerHTML = `<input type="text" class="be-input" data-be-value placeholder="Contoh: Rp15.000" />`;
    }
  }

  // ── Terapkan ke semua yang dipilih ────────────────────────
  function onApply() {
    if (selected.size === 0) {
      if (window.toast) window.toast("Pilih produk terlebih dahulu.", "error");
      return;
    }
    const field = document.querySelector("[data-page='bulk'] [data-be-field]")?.value;
    const valueEl = document.querySelector("[data-page='bulk'] [data-be-value]");
    const value = valueEl?.value ?? "";

    if (!field) {
      if (window.toast) window.toast("Pilih field yang ingin diubah.", "error");
      return;
    }

    const g = (window.games || []).find(x => x.id === beGameId);
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
          p.promo = false;
          p.promoPrice = "";
          p.promoStart = "";
          p.promoEnd = "";
          p.price = p.sellingPrice || p.price;
          p.normal = "";
        }
      } else if (field === "sellingPrice") {
        p.sellingPrice = value;
        if (!p.promoPrice) { p.price = value; p.normal = ""; }
      } else if (field === "costPrice") {
        p.costPrice = value;
      } else if (field === "promoPrice") {
        p.promoPrice = value;
        p.promo = Boolean(value);
        if (value) { p.price = value; p.normal = p.sellingPrice; }
        else { p.price = p.sellingPrice || p.price; p.normal = ""; }
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
      status: "Status", promoStatus: "Status promo", sellingPrice: "Harga jual",
      costPrice: "Harga modal", promoPrice: "Harga promo",
      promoStart: "Mulai promo", promoEnd: "Akhir promo", supplierId: "Supplier"
    };
    if (window.toast) window.toast(`${labels[field] || field} diterapkan ke ${selected.size} produk.`);
  }

  // ── Simpan ────────────────────────────────────────────────
  function onSave() {
    if (typeof window.saveGames === "function") {
      window.saveGames();
      if (window.toast) window.toast("Perubahan disimpan ✓");
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  FILTER SUPPLIER di halaman Manajemen Produk
  // ═══════════════════════════════════════════════════════════

  let supplierFilter = "";  // "" = semua, "__none__" = tanpa supplier, atau id supplier

  function injectSupplierFilter() {
    const productHead = document.querySelector(".product-head");
    if (!productHead || productHead.querySelector("[data-supplier-filter]")) return;

    const filterWrap = document.createElement("div");
    filterWrap.className = "supplier-filter-bar";
    filterWrap.innerHTML = `
      <label class="supplier-filter-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
        </svg>
        Filter Supplier:
        <select data-supplier-filter class="be-select">
          <option value="">Semua Supplier</option>
        </select>
      </label>
    `;
    productHead.appendChild(filterWrap);

    filterWrap.querySelector("[data-supplier-filter]").addEventListener("change", e => {
      supplierFilter = e.target.value;
      applySupplierFilter();
    });
  }

  function refreshSupplierFilterOptions() {
    const sel = document.querySelector("[data-supplier-filter]");
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML =
      `<option value="">Semua Supplier</option>` +
      allSuppliers().map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("") +
      `<option value="__none__">— Tanpa Supplier —</option>`;
    // Pertahankan pilihan sebelumnya kalau masih valid
    if (current) sel.value = current;
  }

  function applySupplierFilter() {
    if (!supplierFilter) {
      // Tidak ada filter → render normal via admin.js
      if (typeof window._origRenderProductTable === "function") {
        window._origRenderProductTable();
      }
      updateProductSummary();
      return;
    }

    const g = (window.games || []).find(x => x.id === window.activeGameId);
    if (!g) return;

    const tbody = document.querySelector("[data-product-table]");
    if (!tbody) return;

    const filtered = g.products
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => {
        if (supplierFilter === "__none__") return !p.supplierId;
        return p.supplierId === supplierFilter;
      });

    updateProductSummary(filtered.length, g.products.length);

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="color:#5f6672;padding:20px;text-align:center">
        Tidak ada produk untuk supplier ini.
      </td></tr>`;
      return;
    }

    function getPS(p) {
      if (!p.promo && !p.promoPrice) return { label: "-", cls: "" };
      const now = new Date();
      const start = p.promoStart ? new Date(p.promoStart) : null;
      const end = p.promoEnd ? new Date(p.promoEnd) : null;
      if (start && start > now) return { label: "Scheduled", cls: "status-scheduled" };
      if (end && end < now) return { label: "Expired Promo", cls: "status-expired" };
      return { label: "Active", cls: "status-active" };
    }

    tbody.innerHTML = filtered.map(({ p, i }) => {
      const ps = getPS(p);
      const unavail = p.status !== "normal";
      const selVal = p.sellingPrice || p.normal || p.price || "";
      const promoVal = p.promoPrice || (p.promo ? p.price : "") || "";
      const badge = ps.cls
        ? `<span class="status-badge-table ${ps.cls}">${ps.label}</span>`
        : `<span class="muted-cell">—</span>`;
      const statusBadge = unavail
        ? `<span class="status-badge-table ${p.status === "soldout" ? "status-expired" : "status-scheduled"}">${p.status === "soldout" ? "Stok Habis" : "Gangguan"}</span>`
        : `<span class="status-badge-table status-active">Normal</span>`;
      const sName = supplierName(p.supplierId);
      return `
        <tr class="${unavail ? "is-unavailable" : ""}" data-product-index="${i}" draggable="true" data-drag-product-index="${i}">
          <td class="drag-cell"><span class="drag-handle" title="Geser untuk urutkan">⠿</span></td>
          <td><strong>${esc(p.name)}</strong></td>
          <td>${sName ? `<span class="supplier-chip">${esc(sName)}</span>` : `<span class="muted-cell">—</span>`}</td>
          <td><input type="text" value="${esc(p.costPrice)}" data-inline-field="costPrice" /></td>
          <td><input type="text" value="${esc(selVal)}" data-inline-field="sellingPrice" /></td>
          <td><input type="checkbox" ${p.promo || promoVal ? "checked" : ""} data-inline-field="promo" /></td>
          <td><input type="text" value="${esc(promoVal)}" data-inline-field="promoPrice" /></td>
          <td>${badge}</td>
          <td>${statusBadge}</td>
          <td>
            <div class="row-actions">
              <button class="icon-action" type="button" data-edit-product="${i}" title="Edit">✏️</button>
              <button class="icon-action danger" type="button" data-delete-product="${i}" title="Hapus">🗑</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  function updateProductSummary(shown, total) {
    const summary = document.querySelector("[data-product-summary]");
    const g = (window.games || []).find(x => x.id === window.activeGameId);
    if (!summary || !g) return;
    if (shown != null && shown !== total) {
      const filterLabel = supplierFilter === "__none__"
        ? "Tanpa Supplier"
        : supplierName(supplierFilter) || "Supplier";
      summary.textContent = `Menampilkan ${shown} dari ${total} produk · Filter: ${filterLabel}`;
    } else {
      summary.textContent = `${g.products.length} varian. Status: ${g.status !== "normal" ? `⚠ ${g.status}` : "✅ Aktif"}`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Patch renderProductPage bawaan admin.js
  // ═══════════════════════════════════════════════════════════

  function patchRenderProductPage() {
    if (window._bePatched) return;
    if (typeof window.renderProductPage !== "function") return;

    // Simpan original juga untuk renderProductTable
    if (typeof window.renderProductTable === "function") {
      window._origRenderProductTable = window.renderProductTable;
    }

    const origRPP = window.renderProductPage;
    window.renderProductPage = function () {
      origRPP();
      injectSupplierFilter();
      refreshSupplierFilterOptions();
      // Terapkan filter kalau aktif
      if (supplierFilter) applySupplierFilter();
    };

    window._bePatched = true;
  }

  // ═══════════════════════════════════════════════════════════
  //  Hook navigasi sidebar
  // ═══════════════════════════════════════════════════════════

  function hookNavigation() {
    if (window._beNavHooked) return;

    document.querySelector("[data-rail]")?.addEventListener("click", e => {
      const btn = e.target.closest("[data-nav]");
      if (btn && btn.dataset.nav === "bulk") {
        setTimeout(showBulkPage, 10);
      }
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

    renderBEGamePicker();
    if (beGameId) renderBEGrid();
    else {
      // Auto-pilih game pertama kalau belum ada pilihan
      const firstGame = (window.games || [])[0];
      if (firstGame) {
        beGameId = firstGame.id;
        renderBEGamePicker();
        renderBEGrid();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CSS
  // ═══════════════════════════════════════════════════════════
  function injectStyles() {
    if (document.querySelector("#be-styles")) return;
    const style = document.createElement("style");
    style.id = "be-styles";
    style.textContent = `
      /* ── Bulk Edit: game picker ── */
      .be-game-picker {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 20px;
      }

      /* ── Bulk Edit: toolbar ── */
      .be-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        background: #f0faf9;
        border: 1px solid #0b8f87;
        border-radius: 10px;
        padding: 12px 16px;
        margin-bottom: 20px;
      }
      .be-toolbar-left {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .be-check-all-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        user-select: none;
      }
      .be-check-all-label input[type="checkbox"] {
        width: 16px;
        height: 16px;
        cursor: pointer;
        accent-color: #0b8f87;
        flex-shrink: 0;
      }
      .be-count-badge {
        font-size: 12px;
        font-weight: 700;
        color: #0b8f87;
        background: #d6f5f3;
        padding: 3px 10px;
        border-radius: 20px;
        white-space: nowrap;
      }
      .be-toolbar-right { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      .be-action-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

      .be-select {
        padding: 7px 10px;
        border: 1px solid #d8dde2;
        border-radius: 8px;
        font: inherit;
        font-size: 13px;
        background: #fff;
        cursor: pointer;
      }
      .be-input {
        padding: 7px 10px;
        border: 1px solid #d8dde2;
        border-radius: 8px;
        font: inherit;
        font-size: 13px;
        background: #fff;
        min-width: 130px;
      }
      .be-select:focus, .be-input:focus {
        outline: 2px solid #0b8f87;
        outline-offset: 1px;
      }
      .be-value-wrap { display: flex; align-items: center; }

      /* ── Bulk Edit: card grid ── */
      .be-product-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 12px;
      }
      .be-card {
        background: #fff;
        border: 2px solid #e8edf2;
        border-radius: 12px;
        padding: 14px;
        display: flex;
        gap: 12px;
        align-items: flex-start;
        cursor: pointer;
        transition: border-color .15s, box-shadow .15s, background .15s;
      }
      .be-card:hover {
        border-color: #0b8f87;
        box-shadow: 0 2px 10px rgba(11,143,135,.12);
      }
      .be-card.is-checked {
        border-color: #0b8f87;
        background: #f0faf9;
      }
      .be-card-check-area { padding-top: 2px; flex-shrink: 0; }
      .be-cb {
        width: 18px;
        height: 18px;
        cursor: pointer;
        accent-color: #0b8f87;
      }
      .be-card-body { flex: 1; min-width: 0; }
      .be-card-name {
        font-weight: 700;
        font-size: 14px;
        color: #14171f;
        margin-bottom: 6px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .be-card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 8px;
      }
      .be-badge {
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 20px;
        white-space: nowrap;
      }
      .be-badge-ok       { background: #d6f5f3; color: #0b8f87; }
      .be-badge-warn     { background: #fff3cd; color: #856404; }
      .be-badge-err      { background: #fdeceb; color: #b13d3d; }
      .be-badge-promo    { background: #ede9fe; color: #6f42c1; }
      .be-badge-supplier { background: #e2e8f0; color: #475569; }
      .be-card-prices {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 12px;
        color: #5f6672;
      }
      .be-card-prices strong { color: #14171f; }
      .be-card-dates {
        margin-top: 6px;
        font-size: 11px;
        color: #5f6672;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .be-empty-hint {
        color: #5f6672;
        padding: 32px 0;
        grid-column: 1 / -1;
        text-align: center;
      }

      /* ── Filter Supplier di Manajemen Produk ── */
      .supplier-filter-bar {
        margin-top: 14px;
        padding-top: 14px;
        border-top: 1px solid #f0f2f4;
      }
      .supplier-filter-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 700;
        color: #14171f;
        cursor: default;
      }
      .supplier-filter-label svg { color: #5f6672; flex-shrink: 0; }
      .supplier-filter-label select { font-weight: 400; }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════
  function init() {
    injectStyles();
    injectBulkNav();
    injectBulkPage();
    hookNavigation();
    patchRenderProductPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 350));
  } else {
    setTimeout(init, 350);
  }

})();