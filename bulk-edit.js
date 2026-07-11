// ─────────────────────────────────────────────────────────────
//  GlacierStore — bulk-edit.js
//  Fitur Bulk Edit Produk (tambahan, tidak ubah logic existing)
//  Cara pakai: muat setelah admin.js di 2904.html
// ─────────────────────────────────────────────────────────────

(function () {

  // ── State ──────────────────────────────────────────────────
  let bulkEditActive = false;
  let bulkDirty      = {};   // { productIndex: true }
  let bulkGameId     = null; // game yang sedang di-bulk-edit

  // ── Inject tombol "Bulk Edit" di sebelah "+ Tambah Produk" ──
  function injectBulkEditButton() {
    const headActions = document.querySelector("[data-page='products'] .head-actions");
    if (!headActions || headActions.querySelector("[data-toggle-bulk-edit]")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary-button";
    btn.setAttribute("data-toggle-bulk-edit", "");
    btn.textContent = "✏️ Bulk Edit";
    headActions.insertBefore(btn, headActions.firstChild);

    btn.addEventListener("click", toggleBulkEdit);
  }

  // ── Inject toolbar Bulk Edit (muncul saat mode aktif) ──────
  function injectBulkToolbar() {
    const panel = document.querySelector(".product-panel");
    if (!panel || panel.querySelector("[data-bulk-edit-toolbar]")) return;

    const bar = document.createElement("div");
    bar.className = "bulk-edit-toolbar";
    bar.setAttribute("data-bulk-edit-toolbar", "");
    bar.hidden = true;
    bar.innerHTML = `
      <div class="bulk-toolbar-left">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;cursor:pointer;">
          <input type="checkbox" data-bulk-check-all /> Pilih Semua
        </label>
        <span class="bulk-selected-count" data-bulk-selected-count>0 dipilih</span>
      </div>
      <div class="bulk-toolbar-right">
        <div class="bulk-quick-actions" data-bulk-quick-actions style="display:none">
          <select data-bulk-field-action>
            <option value="">— Ubah field —</option>
            <option value="status">Status Produk</option>
            <option value="promoStatus">Aktifkan / Nonaktifkan Promo</option>
            <option value="promoEnd">Akhir Promo (semua pilihan)</option>
            <option value="promoStart">Mulai Promo (semua pilihan)</option>
          </select>
          <div data-bulk-value-wrap style="display:none">
            <!-- Konten dinamis sesuai field yang dipilih -->
          </div>
          <button class="primary-button" type="button" data-bulk-apply-action style="padding:8px 14px;font-size:13px">Terapkan</button>
        </div>
        <button class="primary-button" type="button" data-bulk-save-all style="padding:8px 16px;font-size:13px">💾 Simpan Semua</button>
        <button class="ghost-button" type="button" data-bulk-cancel style="padding:8px 14px;font-size:13px">Batal</button>
      </div>
    `;

    // Sisipkan tepat di atas tabel
    const tableWrap = panel.querySelector(".table-wrap");
    panel.insertBefore(bar, tableWrap);

    // Event: check all
    bar.querySelector("[data-bulk-check-all]").addEventListener("change", (e) => {
      document.querySelectorAll("[data-bulk-row-check]").forEach((cb) => {
        cb.checked = e.target.checked;
      });
      updateBulkSelectedCount();
      updateQuickActionsVisibility();
    });

    // Event: field action dropdown
    bar.querySelector("[data-bulk-field-action]").addEventListener("change", (e) => {
      renderBulkValueInput(e.target.value);
    });

    // Event: terapkan ke semua yang dipilih
    bar.querySelector("[data-bulk-apply-action]").addEventListener("click", applyBulkFieldAction);

    // Event: simpan semua
    bar.querySelector("[data-bulk-save-all]").addEventListener("click", saveBulkEdit);

    // Event: batal
    bar.querySelector("[data-bulk-cancel]").addEventListener("click", exitBulkEdit);
  }

  // ── Render input sesuai field yang dipilih ─────────────────
  function renderBulkValueInput(field) {
    const wrap = document.querySelector("[data-bulk-value-wrap]");
    if (!wrap) return;
    wrap.style.display = field ? "" : "none";

    if (field === "status") {
      wrap.innerHTML = `
        <select data-bulk-value style="padding:7px 10px;border:1px solid #d8dde2;border-radius:8px;font:inherit;font-size:13px">
          <option value="normal">Normal (Aktif)</option>
          <option value="soldout">Stok Habis</option>
          <option value="gangguan">Gangguan</option>
        </select>
      `;
    } else if (field === "promoStatus") {
      wrap.innerHTML = `
        <select data-bulk-value style="padding:7px 10px;border:1px solid #d8dde2;border-radius:8px;font:inherit;font-size:13px">
          <option value="on">Aktifkan Promo</option>
          <option value="off">Nonaktifkan Promo</option>
        </select>
      `;
    } else if (field === "promoEnd" || field === "promoStart") {
      wrap.innerHTML = `
        <input type="datetime-local" data-bulk-value
          style="padding:7px 10px;border:1px solid #d8dde2;border-radius:8px;font:inherit;font-size:13px" />
      `;
    } else {
      wrap.innerHTML = "";
    }
  }

  // ── Terapkan field action ke semua produk yang dicentang ───
  function applyBulkFieldAction() {
    const field = document.querySelector("[data-bulk-field-action]")?.value;
    const valueEl = document.querySelector("[data-bulk-value]");
    const value = valueEl?.value;

    if (!field || !value) {
      toast("Pilih field dan nilai yang ingin diterapkan.", "error");
      return;
    }

    const g = games.find((x) => x.id === bulkGameId);
    if (!g) return;

    let count = 0;
    document.querySelectorAll("[data-bulk-row-check]:checked").forEach((cb) => {
      const i = Number(cb.dataset.bulkRowCheck);
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
      } else if (field === "promoEnd") {
        p.promoEnd = value;
        if (p.promoPrice) p.promo = true;
      } else if (field === "promoStart") {
        p.promoStart = value;
        if (p.promoPrice) p.promo = true;
      }

      bulkDirty[i] = true;
      count++;
    });

    if (count === 0) {
      toast("Pilih produk terlebih dahulu.", "error");
      return;
    }

    // Re-render tabel bulk supaya nilai baru kelihatan
    renderBulkTable();
    toast(`${field === "status" ? "Status" : field === "promoStatus" ? "Status promo" : field === "promoEnd" ? "Akhir promo" : "Mulai promo"} diterapkan ke ${count} produk.`);
  }

  // ── Toggle Bulk Edit mode ──────────────────────────────────
  function toggleBulkEdit() {
    if (bulkEditActive) {
      exitBulkEdit();
    } else {
      enterBulkEdit();
    }
  }

  function enterBulkEdit() {
    bulkEditActive = true;
    bulkDirty = {};
    bulkGameId = activeGameId;

    const btn = document.querySelector("[data-toggle-bulk-edit]");
    if (btn) { btn.textContent = "✕ Keluar Bulk Edit"; btn.classList.add("danger"); }

    const toolbar = document.querySelector("[data-bulk-edit-toolbar]");
    if (toolbar) toolbar.hidden = false;

    // Sembunyikan tombol normal yang tidak relevan saat bulk edit
    const addBtn = document.querySelector("[data-open-product-modal]");
    if (addBtn) addBtn.style.display = "none";

    renderBulkTable();
  }

  function exitBulkEdit() {
    bulkEditActive = false;
    bulkDirty = {};
    bulkGameId = null;

    const btn = document.querySelector("[data-toggle-bulk-edit]");
    if (btn) { btn.textContent = "✏️ Bulk Edit"; btn.classList.remove("danger"); }

    const toolbar = document.querySelector("[data-bulk-edit-toolbar]");
    if (toolbar) toolbar.hidden = true;

    const addBtn = document.querySelector("[data-open-product-modal]");
    if (addBtn) addBtn.style.display = "";

    // Kembalikan tabel ke tampilan normal
    renderProductPage();
  }

  // ── Render tabel dalam mode bulk ───────────────────────────
  function renderBulkTable() {
    const g = games.find((x) => x.id === bulkGameId);
    if (!g) return;

    const tbody = document.querySelector("[data-product-table]");
    if (!tbody) return;

    if (!g.products.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="color:#5f6672;padding:20px;text-align:center">Belum ada produk.</td></tr>`;
      return;
    }

    tbody.innerHTML = g.products
      .map((p, i) => {
        const isDirty = bulkDirty[i];
        const sellingPrice = p.sellingPrice || p.normal || p.price || "";
        const promoPrice   = p.promoPrice   || (p.promo ? p.price : "") || "";
        const promoStart   = p.promoStart || "";
        const promoEnd     = p.promoEnd   || "";

        return `
        <tr class="bulk-row ${isDirty ? "bulk-row-dirty" : ""}" data-bulk-product-row="${i}">
          <td style="width:36px;text-align:center;">
            <input type="checkbox" data-bulk-row-check="${i}" style="width:16px;height:16px;cursor:pointer" />
          </td>
          <td style="min-width:140px;font-weight:700;font-size:13px">${esc(p.name)}</td>
          <td>
            <input type="text"
              class="bulk-input"
              value="${esc(sellingPrice)}"
              data-bulk-field="sellingPrice"
              data-bulk-index="${i}"
              placeholder="Harga Jual"
              title="Harga Jual"
            />
          </td>
          <td>
            <input type="checkbox"
              class="bulk-check"
              ${p.promo || promoPrice ? "checked" : ""}
              data-bulk-field="promo"
              data-bulk-index="${i}"
              title="Promo Aktif"
            />
          </td>
          <td>
            <input type="text"
              class="bulk-input"
              value="${esc(promoPrice)}"
              data-bulk-field="promoPrice"
              data-bulk-index="${i}"
              placeholder="Harga Promo"
              title="Harga Promo"
            />
          </td>
          <td>
            <input type="datetime-local"
              class="bulk-input bulk-input-date"
              value="${esc(promoStart)}"
              data-bulk-field="promoStart"
              data-bulk-index="${i}"
              title="Mulai Promo"
            />
          </td>
          <td>
            <input type="datetime-local"
              class="bulk-input bulk-input-date"
              value="${esc(promoEnd)}"
              data-bulk-field="promoEnd"
              data-bulk-index="${i}"
              title="Akhir Promo"
            />
          </td>
          <td>
            <select class="bulk-select" data-bulk-field="status" data-bulk-index="${i}" title="Status Produk">
              <option value="normal"  ${p.status === "normal"   ? "selected" : ""}>Normal</option>
              <option value="soldout" ${p.status === "soldout"  ? "selected" : ""}>Stok Habis</option>
              <option value="gangguan"${p.status === "gangguan" ? "selected" : ""}>Gangguan</option>
            </select>
          </td>
          <td style="width:60px;text-align:center">
            ${isDirty ? `<span class="bulk-dirty-badge" title="Ada perubahan belum disimpan">●</span>` : ""}
          </td>
        </tr>
      `;
      })
      .join("");

    // Attach event listeners untuk inline edit
    tbody.querySelectorAll("[data-bulk-field]").forEach((el) => {
      const eventName = el.type === "checkbox" ? "change" : "input";
      el.addEventListener(eventName, (e) => {
        handleBulkFieldChange(e.target);
      });
    });

    // Event: klik checkbox baris → update count
    tbody.querySelectorAll("[data-bulk-row-check]").forEach((cb) => {
      cb.addEventListener("change", () => {
        updateBulkSelectedCount();
        updateQuickActionsVisibility();
      });
    });

    updateBulkSelectedCount();
    updateQuickActionsVisibility();
  }

  // ── Handle perubahan field inline ─────────────────────────
  function handleBulkFieldChange(el) {
    const field = el.dataset.bulkField;
    const i     = Number(el.dataset.bulkIndex);
    const g     = games.find((x) => x.id === bulkGameId);
    if (!g) return;
    const p = g.products[i];
    if (!p) return;

    if (field === "promo") {
      p.promo = el.checked;
      if (!el.checked) {
        p.promoPrice = "";
        p.promoStart = "";
        p.promoEnd   = "";
        p.price  = p.sellingPrice || p.price;
        p.normal = "";
      }
    } else if (field === "sellingPrice") {
      p.sellingPrice = el.value.trim();
      if (!p.promoPrice) {
        p.price  = p.sellingPrice;
        p.normal = "";
      }
    } else if (field === "promoPrice") {
      p.promoPrice = el.value.trim();
      p.promo      = Boolean(p.promoPrice);
      p.price      = p.promoPrice || p.sellingPrice || p.price;
      p.normal     = p.promoPrice ? p.sellingPrice : "";
    } else if (field === "promoStart") {
      p.promoStart = el.value;
      if (p.promoPrice) p.promo = true;
    } else if (field === "promoEnd") {
      p.promoEnd = el.value;
      if (p.promoPrice) p.promo = true;
    } else if (field === "status") {
      p.status = el.value;
    }

    bulkDirty[i] = true;

    // Tandai baris dirty secara visual tanpa re-render penuh
    const row = document.querySelector(`[data-bulk-product-row="${i}"]`);
    if (row) {
      row.classList.add("bulk-row-dirty");
      let badge = row.querySelector(".bulk-dirty-badge");
      if (!badge) {
        const lastTd = row.querySelector("td:last-child");
        if (lastTd) lastTd.innerHTML = `<span class="bulk-dirty-badge" title="Ada perubahan belum disimpan">●</span>`;
      }
    }
  }

  // ── Simpan semua perubahan bulk ────────────────────────────
  function saveBulkEdit() {
    const dirtyCount = Object.keys(bulkDirty).length;
    if (dirtyCount === 0) {
      toast("Tidak ada perubahan untuk disimpan.", "warn");
      return;
    }

    saveGames(); // pakai saveGames() yang sudah di-patch di 2904.html (termasuk checkDirtyGames)
    toast(`${dirtyCount} produk berhasil disimpan ✓`);

    // Reset dirty state & re-render tabel
    bulkDirty = {};
    renderBulkTable();
  }

  // ── Update counter "N dipilih" ─────────────────────────────
  function updateBulkSelectedCount() {
    const checked = document.querySelectorAll("[data-bulk-row-check]:checked").length;
    const el = document.querySelector("[data-bulk-selected-count]");
    if (el) el.textContent = checked > 0 ? `${checked} dipilih` : "0 dipilih";
  }

  // ── Tampilkan / sembunyikan quick action bar ───────────────
  function updateQuickActionsVisibility() {
    const checked = document.querySelectorAll("[data-bulk-row-check]:checked").length;
    const qa = document.querySelector("[data-bulk-quick-actions]");
    if (qa) qa.style.display = checked > 0 ? "flex" : "none";
  }

  // ── Override thead saat mode bulk ─────────────────────────
  function overrideBulkTableHeader() {
    const thead = document.querySelector(".product-table thead tr");
    if (!thead) return;
    thead.innerHTML = `
      <th style="width:36px"></th>
      <th>Nama Produk</th>
      <th>Harga Jual</th>
      <th>Promo</th>
      <th>Harga Promo</th>
      <th>Mulai Promo</th>
      <th>Akhir Promo</th>
      <th>Status</th>
      <th></th>
    `;
  }

  function restoreTableHeader() {
    const thead = document.querySelector(".product-table thead tr");
    if (!thead) return;
    thead.innerHTML = `
      <th></th>
      <th>Nama Produk</th>
      <th>Supplier</th>
      <th>Harga Modal</th>
      <th>Harga Jual</th>
      <th>Promo</th>
      <th>Harga Promo</th>
      <th>Status Promo</th>
      <th>Status Produk</th>
      <th>Aksi</th>
    `;
  }

  // ── Patch renderProductPage agar setup bulk tetap terjaga ──
  // Wrap fungsi existing supaya setelah render normal,
  // kalau bulk mode aktif, langsung switch ke bulk view.
  const _origRenderProductPage = window.renderProductPage;
  window.renderProductPage = function () {
    _origRenderProductPage?.();
    injectBulkEditButton();
    injectBulkToolbar();

    // Kalau bulk mode masih aktif dan game-nya sama, render ulang bulk tabel
    if (bulkEditActive) {
      if (bulkGameId !== activeGameId) {
        // Game berganti, keluar bulk mode dulu
        exitBulkEdit();
      } else {
        overrideBulkTableHeader();
        renderBulkTable();
        const toolbar = document.querySelector("[data-bulk-edit-toolbar]");
        if (toolbar) toolbar.hidden = false;
        const addBtn = document.querySelector("[data-open-product-modal]");
        if (addBtn) addBtn.style.display = "none";
      }
    }
  };

  // ── CSS tambahan (inject ke <head>) ───────────────────────
  const style = document.createElement("style");
  style.textContent = `
    /* ── Bulk Edit Toolbar ── */
    .bulk-edit-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      background: #f0faf9;
      border: 1px solid #0b8f87;
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 12px;
    }
    .bulk-toolbar-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .bulk-toolbar-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .bulk-quick-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .bulk-selected-count {
      font-size: 12px;
      font-weight: 700;
      color: #0b8f87;
      background: #d6f5f3;
      padding: 3px 10px;
      border-radius: 20px;
    }

    /* ── Bulk row ── */
    .bulk-row { transition: background .15s; }
    .bulk-row:hover { background: #f8fffe; }
    .bulk-row-dirty { background: #fffbf0 !important; }
    .bulk-dirty-badge {
      color: #d97912;
      font-size: 16px;
      line-height: 1;
    }

    /* ── Bulk inputs ── */
    .bulk-input {
      width: 100%;
      min-width: 90px;
      padding: 6px 8px;
      border: 1px solid #d8dde2;
      border-radius: 6px;
      font: inherit;
      font-size: 12px;
      background: #fff;
      transition: border-color .15s;
    }
    .bulk-input:focus {
      outline: none;
      border-color: #0b8f87;
      box-shadow: 0 0 0 2px rgba(11,143,135,.15);
    }
    .bulk-input-date { min-width: 150px; font-size: 11px; }
    .bulk-select {
      padding: 6px 8px;
      border: 1px solid #d8dde2;
      border-radius: 6px;
      font: inherit;
      font-size: 12px;
      background: #fff;
      cursor: pointer;
    }
    .bulk-check {
      width: 16px;
      height: 16px;
      cursor: pointer;
      accent-color: #0b8f87;
    }

    /* ── Toggle bulk edit button ── */
    [data-toggle-bulk-edit].danger {
      background: #b13d3d !important;
      color: #fff !important;
      border-color: #b13d3d !important;
    }
  `;
  document.head.appendChild(style);

  // ── Init saat halaman products pertama kali aktif ──────────
  // Delay sedikit biar admin.js selesai render dulu
  setTimeout(() => {
    if (typeof renderProductPage === "function") {
      injectBulkEditButton();
      injectBulkToolbar();
    }
  }, 200);

})();
