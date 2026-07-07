// ─────────────────────────────────────────────────────────────
//  draft-queue.js — Sistem Draft & Antrian Update
// ─────────────────────────────────────────────────────────────
// Cara kerja:
//   1. Semua edit di admin panel (harga, tambah game, dst) TETAP tersimpan
//      ke localStorage seperti biasa (supaya tampilan admin langsung update),
//      TAPI TIDAK otomatis dikirim ke Supabase lagi.
//   2. Game yang datanya berbeda dari "versi terakhir yang tersinkron ke
//      Supabase" otomatis muncul di halaman "Draft Perubahan" dengan status.
//   3. User klik "Update" (per game) atau "Update Semua" untuk benar-benar
//      mengirim perubahan ke Supabase — SATU PER SATU (tidak paralel),
//      supaya tidak ada risiko tabrakan seperti sebelumnya.
//   4. Tiap game yang diproses statusnya berubah: antri -> proses -> terupdate/gagal.
//   5. "Batalkan" mengembalikan game itu ke versi terakhir yang tersinkron
//      (membuang edit lokal yang belum di-update).

const DRAFT_STATUS_LABEL = {
  dirty: "Belum Disimpan",
  antri: "Antri",
  proses: "Proses...",
  terupdate: "✓ Terupdate",
  gagal: "✕ Gagal",
};

// snapshot: gameId -> JSON string game versi terakhir yang SUDAH tersinkron ke Supabase
let syncedSnapshot = {};
// status: gameId -> 'dirty' | 'antri' | 'proses' | 'terupdate' | 'gagal'
let draftStatus = {};
// aksi: gameId -> 'update' (edit/tambah biasa) | 'delete' (game ini akan dihapus)
let draftAction = {};
// urutan antrian yang sedang diproses (array of gameId)
let updateQueue = [];
let isProcessingQueue = false;

function statusLabelFor(gameId, status) {
  const isDelete = draftAction[gameId] === "delete";
  if (status === "dirty") return isDelete ? "Akan Dihapus" : "Belum Disimpan";
  if (status === "terupdate") return isDelete ? "✓ Terhapus" : "✓ Terupdate";
  if (status === "gagal") return isDelete ? "✕ Gagal Hapus" : "✕ Gagal";
  return DRAFT_STATUS_LABEL[status] || status;
}

// Bandingkan game saat ini vs versi tersinkron terakhir, hasilkan ringkasan
// singkat APA yang berubah (bukan cuma "ada perubahan").
function describeChanges(gameId) {
  if (draftAction[gameId] === "delete") {
    return "Game ini beserta semua produknya akan dihapus dari database.";
  }

  const snapshotJson = syncedSnapshot[gameId];
  const game = games.find((g) => g.id === gameId);
  if (!game) return "";
  if (!snapshotJson) return "Game baru — belum pernah tersimpan ke database.";

  let oldGame;
  try { oldGame = JSON.parse(snapshotJson); } catch { oldGame = null; }
  if (!oldGame) return "Ada perubahan pada game ini.";

  const changes = [];
  if (oldGame.name !== game.name) changes.push(`Nama: "${oldGame.name}" → "${game.name}"`);
  if (oldGame.status !== game.status) changes.push(`Status game: ${oldGame.status} → ${game.status}`);
  if (oldGame.from !== game.from) changes.push(`Label harga: "${oldGame.from}" → "${game.from}"`);

  const oldProducts = {};
  (oldGame.products || []).forEach((p) => { oldProducts[p.name] = p; });
  const newProducts = {};
  (game.products || []).forEach((p) => { newProducts[p.name] = p; });

  Object.keys(newProducts).forEach((name) => {
    const op = oldProducts[name];
    const np = newProducts[name];
    if (!op) { changes.push(`+ Produk baru: "${name}"`); return; }
    if (op.sellingPrice !== np.sellingPrice) {
      changes.push(`"${name}": harga ${op.sellingPrice || "-"} → ${np.sellingPrice || "-"}`);
    }
    if (Boolean(op.promo) !== Boolean(np.promo) || op.promoPrice !== np.promoPrice) {
      if (np.promo) changes.push(`"${name}": promo jadi ${np.promoPrice || "-"}`);
      else if (op.promo) changes.push(`"${name}": promo dinonaktifkan`);
    }
    if (op.status !== np.status) changes.push(`"${name}": status ${op.status} → ${np.status}`);
  });
  Object.keys(oldProducts).forEach((name) => {
    if (!newProducts[name]) changes.push(`- Produk dihapus: "${name}"`);
  });

  if (changes.length === 0) return "Ada perubahan kecil (urutan produk, dll).";

  const MAX_SHOWN = 3;
  const shown = changes.slice(0, MAX_SHOWN);
  const remaining = changes.length - shown.length;
  return shown.join(" · ") + (remaining > 0 ? ` · +${remaining} perubahan lainnya` : "");
}

function snapshotAllGamesAsSynced() {
  syncedSnapshot = {};
  games.forEach((g) => {
    syncedSnapshot[g.id] = JSON.stringify(g);
  });
  draftStatus = {};
  draftAction = {};
}

// Dipanggil tiap kali saveGames() jalan (lihat patch di admin.html).
// Membandingkan state `games` sekarang vs snapshot tersinkron terakhir,
// DUA ARAH: (1) game yang isinya berubah/baru, (2) game yang HILANG dari
// `games` (berarti dihapus lokal) tapi masih ada di Supabase.
function checkDirtyGames() {
  const currentIds = games.map((g) => g.id);

  // (1) Game yang masih ada: cek apakah isinya beda dari snapshot tersinkron
  games.forEach((g) => {
    const json = JSON.stringify(g);
    const isSame = syncedSnapshot[g.id] === json;
    const currentStatus = draftStatus[g.id];
    if (isSame) {
      if (currentStatus === "dirty" || currentStatus === "gagal") {
        delete draftStatus[g.id];
        delete draftAction[g.id];
      }
    } else if (!currentStatus || currentStatus === "dirty" || currentStatus === "gagal" || currentStatus === "terupdate") {
      draftStatus[g.id] = "dirty";
      draftAction[g.id] = "update";
    }
    // kalau status 'antri'/'proses', biarkan apa adanya (jangan ditimpa)
  });

  // (2) Game yang ADA di snapshot tersinkron tapi SUDAH TIDAK ADA di `games`
  // sekarang -> berarti dihapus lokal, tandai sebagai draft "akan dihapus".
  Object.keys(syncedSnapshot).forEach((id) => {
    if (currentIds.includes(id)) return; // masih ada, bukan kasus ini
    const currentStatus = draftStatus[id];
    if (!currentStatus || currentStatus === "dirty" || currentStatus === "gagal") {
      draftStatus[id] = "dirty";
      draftAction[id] = "delete";
    }
    // status 'antri'/'proses'/'terupdate' dibiarkan (biar proses/hasil kelihatan)
  });

  renderDraftPage();
  updateDraftBadge();
}

function getDirtyGameIds() {
  return Object.keys(draftStatus).filter((id) => draftStatus[id] === "dirty");
}

function getActionableGameIds() {
  // dirty (belum disimpan) ATAU gagal (perlu di-retry) — dua-duanya butuh perhatian user
  return Object.keys(draftStatus).filter((id) => draftStatus[id] === "dirty" || draftStatus[id] === "gagal");
}

function updateDraftBadge() {
  const badge = document.querySelector("[data-draft-badge]");
  if (!badge) return;
  const count = getActionableGameIds().length;
  badge.textContent = count > 0 ? String(count) : "";
  badge.hidden = count === 0;
}

// ─── ANTRIAN: proses satu-per-satu, tidak paralel ───
function queueGame(gameId) {
  if (draftStatus[gameId] === "antri" || draftStatus[gameId] === "proses") return;
  draftStatus[gameId] = "antri";
  updateQueue.push(gameId);
  renderDraftPage();
  processQueue();
}

function queueAllDirty() {
  getDirtyGameIds().forEach((id) => queueGame(id));
}

async function processQueue() {
  if (isProcessingQueue) return; // sudah ada proses jalan, jangan mulai proses kedua
  isProcessingQueue = true;

  while (updateQueue.length > 0) {
    const gameId = updateQueue.shift();
    const action = draftAction[gameId] || "update";

    draftStatus[gameId] = "proses";
    renderDraftPage();

    try {
      if (action === "delete") {
        await window.scDeleteGame(gameId);
        delete syncedSnapshot[gameId]; // sudah benar-benar hilang, tidak perlu dibandingkan lagi
      } else {
        const game = games.find((g) => g.id === gameId);
        if (!game) throw new Error("Game tidak ditemukan (mungkin sudah dihapus sebelum sempat diproses).");
        await window.scPushSingleGame(game);
        syncedSnapshot[gameId] = JSON.stringify(game);
      }
      draftStatus[gameId] = "terupdate";
    } catch (e) {
      console.error(`Gagal proses "${gameId}" (${action}) ke Supabase:`, e);
      draftStatus[gameId] = "gagal";
    }
    renderDraftPage();
    updateDraftBadge();
  }

  isProcessingQueue = false;
}

// ─── BATALKAN: buang edit lokal, kembalikan ke versi tersinkron terakhir ───
// Berlaku untuk 3 kasus:
//   1. Game baru ditambah lokal (belum pernah tersinkron) -> batal = hapus total
//   2. Game diedit (masih ada, isinya beda dari tersinkron) -> batal = kembalikan isinya
//   3. Game dihapus lokal (statusnya "Akan Dihapus") -> batal = kembalikan lagi ke daftar
function cancelDraft(gameId) {
  const snapshotJson = syncedSnapshot[gameId];
  const index = games.findIndex((g) => g.id === gameId);

  if (!snapshotJson) {
    // Kasus 1: belum pernah tersinkron sama sekali
    if (index !== -1) games.splice(index, 1);
  } else if (index === -1) {
    // Kasus 3: sedang berstatus "akan dihapus" -> munculkan lagi dari snapshot
    games.push(JSON.parse(snapshotJson));
  } else {
    // Kasus 2: edit biasa -> kembalikan ke versi tersinkron
    games[index] = JSON.parse(snapshotJson);
  }

  delete draftStatus[gameId];
  delete draftAction[gameId];
  _saveGamesSilent(); // simpan ke localStorage TANPA memicu checkDirtyGames lagi jadi dirty
  renderGameCards?.();
  renderProductPage?.();
  renderDashboard?.();
  renderDraftPage();
  updateDraftBadge();
}

// Simpan ke localStorage tanpa memicu deteksi "dirty" ulang (dipakai oleh cancelDraft)
function _saveGamesSilent() {
  games = normalizeGames(games);
  localStorage.setItem(window.GLACIERCODE_STORAGE_KEY || "glaciercode_catalog_v1", JSON.stringify(games));
}

// ─── RENDER halaman Draft ───
function renderDraftPage() {
  const container = document.querySelector("[data-draft-list]");
  if (!container) return; // halaman draft belum ada di DOM / belum aktif

  const entries = Object.keys(draftStatus);
  if (entries.length === 0) {
    container.innerHTML = `<p style="color:#5f6672;padding:20px 0">Tidak ada perubahan yang menunggu. Semua data sudah tersinkron ✓</p>`;
    const btnAll = document.querySelector("[data-update-all]");
    if (btnAll) btnAll.disabled = true;
    return;
  }

  const btnAll = document.querySelector("[data-update-all]");
  if (btnAll) btnAll.disabled = getDirtyGameIds().length === 0;

  container.innerHTML = entries
    .map((gameId) => {
      const game = games.find((g) => g.id === gameId);
      let name = game?.name;
      if (!name) {
        // Game sudah tidak ada di `games` (kasus "akan dihapus") -> ambil nama
        // dari snapshot terakhir yang tersinkron, supaya baris ini tetap
        // menampilkan nama yang jelas, bukan cuma id mentah.
        try { name = JSON.parse(syncedSnapshot[gameId] || "{}").name; } catch { /* noop */ }
      }
      name = name || gameId;

      const status = draftStatus[gameId];
      const isDelete = draftAction[gameId] === "delete";
      const statusClass = `draft-status draft-status-${status}`;
      const canAct = status === "dirty" || status === "gagal";
      const actionLabel = isDelete ? "Hapus Sekarang" : "Update";
      const cancelLabel = isDelete ? "Batalkan Penghapusan" : "Batalkan";

      return `
        <div class="draft-row" data-draft-row="${gameId}">
          <div class="draft-row-name">
            ${name}${isDelete ? " <em style=\"color:#b13d3d;font-weight:400\">(akan dihapus)</em>" : ""}
            <div class="draft-row-desc">${describeChanges(gameId)}</div>
          </div>
          <div class="${statusClass}">${statusLabelFor(gameId, status)}</div>
          <div class="draft-row-actions">
            ${canAct ? `<button class="mini-button" type="button" data-queue-one="${gameId}">${actionLabel}</button>` : ""}
            ${canAct ? `<button class="delete-button" type="button" data-cancel-draft="${gameId}">${cancelLabel}</button>` : ""}
          </div>
        </div>
      `;
    })
    .join("");
}

document.querySelector("[data-draft-list]")?.addEventListener("click", (e) => {
  const queueBtn = e.target.closest("[data-queue-one]");
  if (queueBtn) { queueGame(queueBtn.dataset.queueOne); return; }

  const cancelBtn = e.target.closest("[data-cancel-draft]");
  if (cancelBtn) { cancelDraft(cancelBtn.dataset.cancelDraft); return; }
});

document.querySelector("[data-update-all]")?.addEventListener("click", () => {
  queueAllDirty();
});

// ─── INIT: begitu draft-queue.js selesai dimuat (setelah pull awal selesai),
// simpan snapshot data yang BARU DITARIK dari Supabase sebagai "versi tersinkron".
snapshotAllGamesAsSynced();
updateDraftBadge();

window.GlacierDraft = { checkDirtyGames, snapshotAllGamesAsSynced };
