// ─────────────────────────────────────────────
//  GlacierStore — admin.js  (fully rebuilt)
// ─────────────────────────────────────────────
const STORAGE_KEY  = window.GLACIERCODE_STORAGE_KEY  || "glaciercode_catalog_v1";
const SETTINGS_KEY = window.GLACIERCODE_SETTINGS_KEY || "glaciercode_site_settings_v1";
const ORDERS_KEY   = window.GLACIERCODE_ORDERS_KEY    || "glaciercode_orders_v1";
const DEFAULT_GAMES    = window.GLACIERCODE_DEFAULT_GAMES    || [];
const DEFAULT_SETTINGS = window.GLACIERCODE_DEFAULT_SETTINGS || {};

// ─── helpers ─────────────────────────────────
function clone(v){ return JSON.parse(JSON.stringify(v)); }

function esc(v){
  return String(v ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function slugify(v){
  const s = String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
  return s || `game-${Date.now()}`;
}

function initials(v){
  return String(v||"GC").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase();
}

function parseMoney(v){ return Number(String(v||"").replace(/[^0-9]/g,"")) || 0; }
function formatIdr(v){ return `Rp${(Number(v)||0).toLocaleString("id-ID")}`; }

// Label status game: "maintenance", "gangguan", dan "segera-hadir" adalah status
// terpisah (masing-masing tampil apa adanya di halaman utama), tanpa batasan jumlah game.
function gameStatusLabel(status){
  if(status==="gangguan") return "Gangguan";
  if(status==="maintenance") return "Maintenance";
  if(status==="segera-hadir") return "Segera Hadir";
  return "Aktif";
}

function minutesFromTime(v){
  const [h,m] = String(v||"00:00").split(":").map(Number);
  return (h||0)*60+(m||0);
}

function formatDuration(ms){
  const t = Math.max(0,Math.floor(ms/1000));
  return [Math.floor(t/3600), Math.floor((t%3600)/60), t%60]
    .map(n=>String(n).padStart(2,"0")).join(":");
}

function toDatetimeInput(v){ return v ? String(v).slice(0,16) : ""; }

function guessCategory(name=""){
  const v = name.toLowerCase();
  if(v.includes("uc")) return "UC";
  if(v.includes("point")||v.includes("vp")) return "Points";
  if(v.includes("member")||v.includes("pass")) return "Membership";
  if(v.includes("bundle")) return "Bundle";
  return "Diamonds";
}

// ─── storage ─────────────────────────────────
function readGames(){
  try{
    const s = localStorage.getItem(STORAGE_KEY);
    if(!s) return clone(DEFAULT_GAMES);
    const p = JSON.parse(s);
    return Array.isArray(p) ? p : clone(DEFAULT_GAMES);
  }catch{ return clone(DEFAULT_GAMES); }
}

function readSettings(){
  try{
    const s = localStorage.getItem(SETTINGS_KEY);
    const p = s ? JSON.parse(s) : {};
    return mergeSettings(DEFAULT_SETTINGS, p);
  }catch{ return mergeSettings(DEFAULT_SETTINGS, {}); }
}

function mergeSettings(base, extra){
  return {
    ...base, ...extra,
    adminHours:       { ...(base.adminHours||{}),       ...(extra.adminHours||{})       },
    systemMaintenance:{ ...(base.systemMaintenance||{}), ...(extra.systemMaintenance||{}) },
    infoBanner:       { ...(base.infoBanner||{}),       ...(extra.infoBanner||{})       },
  };
}

function normalizeProduct(p, index = 0){
  const hasPromo = Boolean(p.promo || p.normal);
  return {
    name:        p.name || "Produk Baru",
    category:    p.category || guessCategory(p.name),
    costPrice:   p.costPrice || "",
    sellingPrice:p.sellingPrice || (hasPromo ? p.normal||p.price : p.price) || "",
    promoPrice:  p.promoPrice  || (hasPromo ? p.price : "") || "",
    price:       p.price || p.sellingPrice || "",
    normal:      p.normal || "",
    promo:       Boolean(p.promo || p.promoPrice),
    promoBadge:  p.promoBadge || (p.promo ? "Sale" : ""),
    promoStart:  p.promoStart || "",
    promoEnd:           p.promoEnd   || "",
    status:             p.status || "normal",
    _promoAutoSoldout:  Boolean(p._promoAutoSoldout),
    sortOrder:          index,
  };
}

function normalizeGames(source){
  return source.map((g,index)=>({
    ...g,
    id:          g.id || slugify(g.name||`game-${Date.now()}`),
    name:        g.name || "Game Baru",
    initials:    g.initials || initials(g.name||"GB"),
    imageUrl:    g.imageUrl || "",
    from:        g.from || "Cek admin",
    colors:      Array.isArray(g.colors) ? g.colors : ["#0b8f87","#d97912"],
    status:      g.status || "normal",
    maintenance: g.maintenance || {},
    sortOrder:   index,
    products:    (g.products||[]).map((p,i)=>normalizeProduct(p,i)),
  }));
}

// ─── state ────────────────────────────────────
let games        = normalizeGames(readGames());
let siteSettings = readSettings();
let orders       = readOrders();
let activeGameId = games[0]?.id || "";
let editingGameId       = null;
let editingProductIndex = null;
let maintenanceGameId   = null;
let currentPage  = "dashboard";
let salesDateFilter = "";
let salesGameFilter  = "all";
let salesOrderIdFilter = "";

function saveGames(){
  games = normalizeGames(games);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
}

function saveSettings(){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(siteSettings));
}

// ─── orders (penjualan) ───────────────────────
function readOrders(){
  try{
    const s = localStorage.getItem(ORDERS_KEY);
    const p = s ? JSON.parse(s) : [];
    return Array.isArray(p) ? p : [];
  }catch{ return []; }
}

function saveOrders(){
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
}

// Order ID: angka acak 6 digit, DIJAMIN tidak pernah duplikat di sistem.
// Dicek dua lapis: (1) ke variabel `orders` di memori, (2) langsung ke
// localStorage terbaru saat itu juga — supaya walau ada tab/perangkat lain
// yang baru saja menyimpan order, id yang di-generate tetap tidak bentrok.
function orderIdExists(id){
  if(orders.some(o=>o.orderId===id)) return true;
  try{
    const latest = JSON.parse(localStorage.getItem(ORDERS_KEY) || "[]");
    return Array.isArray(latest) && latest.some(o=>o.orderId===id);
  }catch{
    return false;
  }
}

function generateOrderId(){
  let id;
  let attempts = 0;
  do{
    id = String(Math.floor(100000 + Math.random() * 900000));
    attempts++;
    // fallback pengaman: kalau entah bagaimana 6 digit acak terus bentrok
    // ratusan kali (praktis mustahil), perpanjang jadi 7 digit supaya tidak infinite loop
    if(attempts > 500) id = String(Math.floor(1000000 + Math.random() * 9000000));
  }while(orderIdExists(id));
  return id;
}

// Simpan order dengan pengecekan akhir anti-duplikat tepat sebelum ditulis ke localStorage.
// Kalau ternyata id sudah kepakai (kasus langka lintas-tab), generate ulang otomatis.
function saveOrderSafely(order){
  let guard = 0;
  while(orderIdExists(order.orderId) && guard < 20){
    order.orderId = generateOrderId();
    guard++;
  }
  orders.push(order);
  saveOrders(); // simpan ke localStorage dulu (biar tampilan langsung update)
  
  // Kirim ke Supabase (async, jangan tunggu)
  window.scPushOrder(order).catch(e => {
    console.warn("Gagal push order ke Supabase:", e);
    toast("Transaksi tersimpan lokal, tetapi gagal sinkron ke cloud. Cek koneksi.", "warn");
  });
  
  return order;
}

// ─── DOM refs ─────────────────────────────────
const gameGrid      = document.querySelector("[data-game-grid]");
const productTable  = document.querySelector("[data-product-table]");
const selectedGameNameEl = document.querySelector("[data-selected-game-name]");
const productSummaryEl   = document.querySelector("[data-product-summary]");
const searchInput   = document.querySelector("[data-search]");
const filterSelect  = document.querySelector("[data-filter]");
const gameModal     = document.querySelector("[data-game-modal]");
const productModal  = document.querySelector("[data-product-modal]");
const maintenanceModal = document.querySelector("[data-maintenance-modal]");
const bulkModal     = document.querySelector("[data-bulk-modal]");
const saleModal      = document.querySelector("[data-sale-modal]");
const receiptModal   = document.querySelector("[data-receipt-modal]");
const gameForm      = document.querySelector("[data-game-form]");
const productForm   = document.querySelector("[data-product-form]");
const profitLine    = document.querySelector("[data-profit-line]");
const productGameNameEl = document.querySelector("[data-product-game-name]");

// ─── TOAST ───────────────────────────────────
function toast(message, type = "success"){
  const container = document.querySelector("[data-toast-container]");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(()=> el.classList.add("is-visible"));
  setTimeout(()=>{
    el.classList.remove("is-visible");
    setTimeout(()=> el.remove(), 300);
  }, 3200);
}

// ─── CONFIRM DIALOG ──────────────────────────
// `message` bisa berupa string biasa (ditampilkan sebagai teks), atau array
// of string (ditampilkan sebagai daftar ringkasan perubahan, mis. hasil dari
// buildDiffSummary()).
function confirm(title, message){
  return new Promise(resolve=>{
    const overlay = document.querySelector("[data-confirm-overlay]");
    const messageEl = document.querySelector("[data-confirm-message]");
    document.querySelector("[data-confirm-title]").textContent = title;
    if(Array.isArray(message)){
      messageEl.innerHTML = `<ul class="confirm-diff-list">${message.map(line=>`<li>${line}</li>`).join("")}</ul>`;
    } else {
      messageEl.textContent = message;
    }
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden","false");

    function onOk(){ cleanup(); resolve(true); }
    function onCancel(){ cleanup(); resolve(false); }
    function cleanup(){
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden","true");
      document.querySelector("[data-confirm-ok]").removeEventListener("click",onOk);
      document.querySelector("[data-confirm-cancel]").removeEventListener("click",onCancel);
    }
    document.querySelector("[data-confirm-ok]").addEventListener("click",onOk,{once:true});
    document.querySelector("[data-confirm-cancel]").addEventListener("click",onCancel,{once:true});
  });
}

// ─── NAVIGATION ──────────────────────────────
const PAGE_LABELS = {
  dashboard: "Dashboard",
  games:     "Katalog Game",
  products:  "Manajemen Produk",
  sales:     "Penjualan",
  capital:   "Modal",
  settings:  "Pengaturan",
};

function navigateTo(page){
  currentPage = page;
  document.querySelectorAll(".admin-page").forEach(el=>{
    el.classList.toggle("is-active", el.dataset.page === page);
  });
  document.querySelectorAll(".rail-button").forEach(btn=>{
    btn.classList.toggle("is-active", btn.dataset.nav === page);
  });
  document.querySelector("[data-page-label]").textContent = PAGE_LABELS[page] || page;
  if(page==="dashboard") renderDashboard();
  if(page==="games")     renderGameCards();
  if(page==="products")  renderProductPage();
  if(page==="sales")     renderSalesPage();
  if(page==="capital")   renderCapitalPage();
  if(page==="settings")  renderSettingsForm();
  closeRailDrawer();
}

document.querySelectorAll("[data-nav]").forEach(btn=>{
  btn.addEventListener("click",()=> navigateTo(btn.dataset.nav));
});

document.querySelectorAll("[data-nav-to]").forEach(btn=>{
  btn.addEventListener("click",()=> navigateTo(btn.dataset.navTo));
});

// ─── SIDEBAR MOBILE (drawer) ─────────────────
// Di layar sempit (mobile), sidebar (.rail) disembunyikan di luar layar lewat
// CSS dan baru digeser masuk saat class "is-open" ditambahkan. Ini yang
// menggantikan perilaku lama "sidebar hilang total tanpa cara buka lagi".
const railEl        = document.querySelector("[data-rail]");
const railOverlayEl = document.querySelector("[data-rail-overlay]");
const railToggleEl  = document.querySelector("[data-rail-toggle]");

function openRailDrawer(){
  railEl?.classList.add("is-open");
  railOverlayEl?.classList.add("is-open");
  railToggleEl?.setAttribute("aria-expanded","true");
}

function closeRailDrawer(){
  railEl?.classList.remove("is-open");
  railOverlayEl?.classList.remove("is-open");
  railToggleEl?.setAttribute("aria-expanded","false");
}

railToggleEl?.addEventListener("click", ()=>{
  const isOpen = railEl?.classList.contains("is-open");
  if(isOpen) closeRailDrawer(); else openRailDrawer();
});
railOverlayEl?.addEventListener("click", closeRailDrawer);

// ─── MODALS ──────────────────────────────────
function openModal(modal){
  modal?.classList.add("is-open");
  modal?.setAttribute("aria-hidden","false");
}

function closeModals(){
  [gameModal, productModal, maintenanceModal, bulkModal, saleModal, receiptModal].forEach(m=>{
    m?.classList.remove("is-open");
    m?.setAttribute("aria-hidden","true");
  });
  clearFormErrors();
}

document.querySelectorAll("[data-close-modal]").forEach(btn=>{
  btn.addEventListener("click", closeModals);
});

[gameModal,productModal,maintenanceModal,bulkModal].forEach(m=>{
  m?.addEventListener("click", e=>{ if(e.target===m) closeModals(); });
});

// ─── VALIDATION HELPERS ──────────────────────
function clearFormErrors(){
  document.querySelectorAll(".field-error").forEach(el=> el.textContent="");
}

function setError(key, msg){
  const el = document.querySelector(`[data-error="${key}"]`);
  if(el) el.textContent = msg;
}

function validateGameForm(data){
  clearFormErrors();
  let ok = true;
  if(!data.name){ setError("name","Nama game wajib diisi."); ok=false; }
  if(!data.initials){ setError("initials","Inisial wajib diisi."); ok=false; }
  if(data.imageUrl && !/^https?:\/\//.test(data.imageUrl)){
    setError("imageUrl","URL harus diawali https://"); ok=false;
  }
  return ok;
}

function validateProductForm(data){
  clearFormErrors();
  let ok = true;
  if(!data.name){ setError("pname","Nama produk wajib diisi."); ok=false; }
  if(!data.sellingPrice){ setError("sellingPrice","Harga jual wajib diisi."); ok=false; }
  if(data.promoPrice){
    const promo   = parseMoney(data.promoPrice);
    const selling = parseMoney(data.sellingPrice);
    if(promo>=selling){ setError("promoPrice","Harga promo harus lebih kecil dari harga jual."); ok=false; }
  }
  return ok;
}

function validateMaintenanceForm(){
  clearFormErrors();
  const reason = document.querySelector("[data-maintenance-reason]").value.trim();
  const start  = document.querySelector("[data-maintenance-start]").value;
  const end    = document.querySelector("[data-maintenance-end]").value;
  const enabled= document.querySelector("[data-maintenance-enabled]").checked;
  let ok = true;
  if(enabled && !reason){ setError("maintenance-reason","Alasan maintenance wajib diisi."); ok=false; }
  if(enabled && start && end && new Date(start)>=new Date(end)){
    setError("maintenance-reason","Waktu selesai harus setelah waktu mulai."); ok=false;
  }
  return ok;
}

// ─── SETTINGS FORM ───────────────────────────
function getNestedSetting(target, path){
  return path.split(".").reduce((v,p)=>v?.[p], target);
}

function setNestedSetting(target, path, value){
  const parts = path.split(".");
  let cur = target;
  parts.slice(0,-1).forEach(p=>{ cur[p]=cur[p]||{}; cur=cur[p]; });
  cur[parts.at(-1)] = value;
}

function readSettingsFromForm(){
  document.querySelectorAll("[data-setting]").forEach(f=>{
    setNestedSetting(siteSettings, f.dataset.setting, f.value);
  });
  document.querySelectorAll("[data-setting-check]").forEach(f=>{
    setNestedSetting(siteSettings, f.dataset.settingCheck, f.checked);
  });
}

function renderSettingsForm(){
  document.querySelectorAll("[data-setting]").forEach(f=>{
    f.value = getNestedSetting(siteSettings, f.dataset.setting) ?? "";
  });
  document.querySelectorAll("[data-setting-check]").forEach(f=>{
    f.checked = Boolean(getNestedSetting(siteSettings, f.dataset.settingCheck));
  });
  updateAdminCountdownPreview();
  updateMaintenanceStatusPreview();
}

function saveSiteSettings(){
  readSettingsFromForm();
  saveSettings();
  toast("Pengaturan berhasil disimpan ✓");
  updateAdminCountdownPreview();
  updateMaintenanceStatusPreview();
  if(currentPage==="dashboard") renderDashboard();
}

document.querySelector("[data-save-site-settings]").addEventListener("click", saveSiteSettings);

// Auto-sync in-memory on input (no auto-save)
document.querySelectorAll("[data-setting],[data-setting-check]").forEach(f=>{
  f.addEventListener("input",()=>{ readSettingsFromForm(); updateAdminCountdownPreview(); updateMaintenanceStatusPreview(); });
  f.addEventListener("change",()=>{ readSettingsFromForm(); updateAdminCountdownPreview(); updateMaintenanceStatusPreview(); });
});

// ─── COUNTDOWN PREVIEW ───────────────────────
function updateAdminCountdownPreview(){
  const open  = getNestedSetting(siteSettings,"adminHours.open")  || "08:00";
  const close = getNestedSetting(siteSettings,"adminHours.close") || "22:00";
  const manualClosed = Boolean(getNestedSetting(siteSettings,"adminHours.manualClosed"));
  const now   = new Date();
  const openMins  = minutesFromTime(open);
  const closeMins = minutesFromTime(close);
  const curMins   = now.getHours()*60 + now.getMinutes();
  const overnight = closeMins <= openMins;
  const online    = overnight
    ? curMins >= openMins || curMins < closeMins
    : curMins >= openMins && curMins < closeMins;

  const nextOpen = new Date(now);
  nextOpen.setHours(Number(open.slice(0,2)), Number(open.slice(3,5)), 0, 0);
  if(online || curMins >= openMins) nextOpen.setDate(nextOpen.getDate()+1);
  const el = document.querySelector("[data-admin-countdown-preview]");
  if(!el) return;
  if(manualClosed){
    el.textContent = "🔒 Ditutup Manual (jam tetap berjalan seperti biasa)";
  } else {
    el.textContent = online ? "Sedang Buka ✓" : formatDuration(nextOpen - now);
  }
}

// ─── MAINTENANCE STATUS PREVIEW ──────────────
function isMaintenanceActiveNow(){
  const m = siteSettings.systemMaintenance || {};
  if(!m.enabled) return false;
  const now   = new Date();
  const start = m.start ? new Date(m.start) : null;
  const end   = m.end   ? new Date(m.end)   : null;
  if(start && now < start) return false;
  if(end   && now > end)   return false;
  return true;
}

function getMaintenanceCountdown(){
  const m = siteSettings.systemMaintenance || {};
  if(!m.enabled) return null;
  const now   = new Date();
  const start = m.start ? new Date(m.start) : null;
  const end   = m.end   ? new Date(m.end)   : null;
  if(start && now < start) return { state:"scheduled", until: start };
  if(end   && now < end)   return { state:"active",    until: end   };
  return { state:"ended", until: null };
}

function updateMaintenanceStatusPreview(){
  const el = document.querySelector("[data-maintenance-status-preview]");
  if(!el) return;
  const info = getMaintenanceCountdown();
  if(!info){ el.textContent = "Tidak Aktif"; el.style.color="#2e9d68"; return; }
  if(info.state==="scheduled"){
    el.textContent = `Dijadwalkan — mulai ${formatDuration(info.until - new Date())}`;
    el.style.color = "#2e79b8";
  } else if(info.state==="active"){
    el.textContent = `🔴 AKTIF — selesai ${formatDuration(info.until - new Date())}`;
    el.style.color = "#b13d3d";
  } else {
    el.textContent = "Jadwal Sudah Selesai";
    el.style.color = "#858b93";
  }
}

// ─── DASHBOARD ───────────────────────────────
function renderDashboard(){
  const total   = games.length;
  const active  = games.filter(g=>g.status==="normal").length;
  const maint   = games.filter(g=>g.status==="maintenance").length;
  const gangguan= games.filter(g=>g.status==="gangguan").length;
  const prods   = games.reduce((a,g)=>a+g.products.length, 0);

  document.querySelector("[data-dashboard-stats]").innerHTML = `
    <div class="stat-card"><span>${total}</span><p>Total Game</p></div>
    <div class="stat-card is-good"><span>${active}</span><p>Game Aktif</p></div>
    <div class="stat-card is-warn"><span>${maint}</span><p>Maintenance</p></div>
    <div class="stat-card is-warn"><span>${gangguan}</span><p>Gangguan</p></div>
    <div class="stat-card"><span>${prods}</span><p>Total Produk</p></div>
  `;

  // Operational status
  const h = siteSettings.adminHours || {};
  const open = h.open||"08:00", close = h.close||"22:00";
  const now = new Date();
  const openMins = minutesFromTime(open), closeMins = minutesFromTime(close);
  const curMins = now.getHours()*60+now.getMinutes();
  const overnight = closeMins<=openMins;
  const online = overnight ? curMins>=openMins||curMins<closeMins : curMins>=openMins&&curMins<closeMins;
  // Manual override: kalau admin tutup manual, toko langsung dianggap tutup
  // TANPA mengubah jam operasional atau hitung mundurnya sama sekali.
  const shouldBeOnline = !h.manualClosed && (!h.autoOffline || online);

  const nextOpen = new Date(now);
  nextOpen.setHours(Number(open.slice(0,2)), Number(open.slice(3,5)), 0, 0);
  if(online || curMins>=openMins) nextOpen.setDate(nextOpen.getDate()+1);

  document.querySelector("[data-dash-operational]").innerHTML = h.manualClosed
    ? `<div class="live-badge is-offline">🔒 Tutup Manual — jam operasional tetap ${open} s/d ${close}</div>`
    : shouldBeOnline
      ? `<div class="live-badge is-online">🟢 Online — ${open} s/d ${close}</div>`
      : `<div class="live-badge is-offline">🔴 Offline — buka kembali ${formatDuration(nextOpen-now)}</div>`;

  // Maintenance status
  const mInfo = getMaintenanceCountdown();
  const maintEl = document.querySelector("[data-dash-maintenance]");
  if(!mInfo){
    maintEl.innerHTML = `<div class="live-badge is-online">✅ Tidak Ada Maintenance</div>`;
  } else if(mInfo.state==="scheduled"){
    maintEl.innerHTML = `<div class="live-badge is-scheduled">📅 Dijadwalkan — ${formatDuration(mInfo.until-now)}</div>`;
  } else if(mInfo.state==="active"){
    maintEl.innerHTML = `<div class="live-badge is-offline">🔴 Maintenance Aktif — selesai ${formatDuration(mInfo.until-now)}</div>`;
  } else {
    maintEl.innerHTML = `<div class="live-badge" style="color:#858b93">Jadwal sudah berakhir</div>`;
  }

  // Games with issues
  const badGames = games.filter(g=>g.status!=="normal");
  document.querySelector("[data-dash-maintenance-count]").textContent = badGames.length;
  document.querySelector("[data-dash-maintenance-list]").innerHTML = badGames.length
    ? badGames.map(g=>`
        <div class="dash-game-row">
          <span class="dash-game-icon">${esc(g.initials)}</span>
          <span>${esc(g.name)}</span>
          <span class="dash-status-tag">${gameStatusLabel(g.status)}</span>
          <button class="mini-button" type="button" data-dash-fix="${esc(g.id)}">Aktifkan Kembali</button>
        </div>
      `).join("")
    : `<p style="color:#5f6672;font-size:14px;margin:0">Semua game aktif. 🎉</p>`;
}

document.querySelector("[data-dash-maintenance-list]")?.addEventListener("click", async e=>{
  const btn = e.target.closest("[data-dash-fix]");
  if(!btn) return;
  const id = btn.dataset.dashFix;
  const game = games.find(g=>g.id===id);
  if(!game) return;
  const ok = await confirm("Aktifkan Kembali", `Aktifkan kembali "${game.name}"?`);
  if(!ok) return;
  game.status = "normal";
  game.maintenance = { ...(game.maintenance||{}), enabled:false };
  saveGames();
  renderDashboard();
  toast(`${game.name} kembali aktif ✓`);
});

// ─── GAME CARDS ──────────────────────────────
function renderGameCards(){
  const query  = (searchInput?.value||"").toLowerCase().trim();
  const filter = filterSelect?.value || "all";
  const filtered = games.filter(g=>{
    const matchSearch = !query || g.name.toLowerCase().includes(query);
    const matchFilter = filter==="all" || g.status===filter;
    return matchSearch && matchFilter;
  });

  gameGrid.innerHTML = filtered.map(g=>{
    const isMaint = g.status!=="normal";
    const label   = gameStatusLabel(g.status);
    const icon = g.imageUrl
      ? `<img src="${esc(g.imageUrl)}" alt="${esc(g.name)}" />`
      : esc(g.initials || initials(g.name));
    return `
      <article class="game-card-admin ${g.id===activeGameId?"is-selected":""} ${isMaint?"is-maintenance":""}" data-select-game="${esc(g.id)}" draggable="true" data-drag-game-id="${esc(g.id)}">
        ${isMaint?`<span class="maintenance-tag">${esc(label)}</span>`:""}
        <span class="drag-handle" title="Geser untuk urutkan">⠿</span>
        <span class="game-icon">${icon}</span>
        <div class="game-info">
          <h3>${esc(g.name)}</h3>
          <p>${g.products.length} varian produk</p>
        </div>
        <button class="switch ${isMaint?"is-off":""}" type="button" title="Toggle maintenance" data-toggle-game="${esc(g.id)}"></button>
        <p class="status-text">Status: ${isMaint?`🔧 ${label}`:"✅ Aktif"}</p>
        <div class="game-buttons">
          <button class="mini-button" type="button" data-edit-game="${esc(g.id)}">✏️ Edit Info</button>
          <button class="mini-button" type="button" data-manage-products="${esc(g.id)}">📦 Kelola Produk</button>
          <button class="mini-button" type="button" data-maintenance-game="${esc(g.id)}">🔧 Jadwal Maint.</button>
          <button class="delete-button" type="button" data-delete-game="${esc(g.id)}">🗑 Hapus</button>
        </div>
      </article>
    `;
  }).join("") || `<p style="color:#5f6672;padding:20px 0">Tidak ada game yang cocok.</p>`;
}

gameGrid?.addEventListener("click", async e=>{
  const toggle = e.target.closest("[data-toggle-game]");
  if(toggle){
    const g = games.find(x=>x.id===toggle.dataset.toggleGame);
    if(!g) return;
    // Tombol switch cepat ini khusus untuk mode "Maintenance". Untuk menandai
    // game sebagai "Gangguan", gunakan tombol "🔧 Jadwal Maint." dan pilih
    // Tipe Status = Gangguan pada modal.
    const next = g.status==="normal" ? "maintenance" : "normal";
    if(next==="maintenance"){
      const ok = await confirm("Aktifkan Maintenance", `Masukkan "${g.name}" ke mode maintenance?`);
      if(!ok) return;
    } else {
      const ok = await confirm("Normalkan Kembali", `Kembalikan "${g.name}" ke status Aktif (Normal)?`);
      if(!ok) return;
    }
    g.status = next;
    // Bersihkan start/end lama: ini toggle manual, bukan jadwal otomatis.
    // Kalau tidak dibersihkan, jadwal lama yang sudah lewat waktu selesainya
    // akan membuat checkAutoMaintenance() langsung mengembalikannya ke normal.
    g.maintenance = { ...(g.maintenance||{}), type:"maintenance", enabled: next==="maintenance", start:"", end:"" };
    saveGames();
    renderGameCards();
    if(currentPage==="dashboard") renderDashboard();
    toast(`${g.name} → ${next==="maintenance"?"Maintenance":"Aktif"}`);
    return;
  }

  const edit = e.target.closest("[data-edit-game]");
  if(edit){ openGameEditor(edit.dataset.editGame); return; }

  const manage = e.target.closest("[data-manage-products]");
  if(manage){
    activeGameId = manage.dataset.manageProducts;
    navigateTo("products");
    return;
  }

  const maint = e.target.closest("[data-maintenance-game]");
  if(maint){ openMaintenanceEditor(maint.dataset.maintenanceGame); return; }

  const del = e.target.closest("[data-delete-game]");
  if(del){
    const g = games.find(x=>x.id===del.dataset.deleteGame);
    if(!g) return;
    if(games.length<=1){ toast("Minimal 1 game harus ada.","error"); return; }
    const ok = await confirm("Hapus Game", `Hapus "${g.name}" dan semua produknya secara permanen?`);
    if(!ok) return;
    games = games.filter(x=>x.id!==del.dataset.deleteGame);
    if(activeGameId===del.dataset.deleteGame) activeGameId = games[0]?.id||"";
    saveGames();
    renderGameCards();
    if(currentPage==="dashboard") renderDashboard();
    toast(`${g.name} dihapus.`);
    return;
  }

  const card = e.target.closest("[data-select-game]");
  if(card){ activeGameId = card.dataset.selectGame; renderGameCards(); }
});

searchInput?.addEventListener("input", renderGameCards);
filterSelect?.addEventListener("change", renderGameCards);

// ─── DRAG & DROP: urutan game ─────────────────
let draggedGameId = null;

gameGrid?.addEventListener("dragstart", e=>{
  const card = e.target.closest("[data-drag-game-id]");
  if(!card) return;
  draggedGameId = card.dataset.dragGameId;
  card.classList.add("is-dragging");
  e.dataTransfer.effectAllowed = "move";
});

gameGrid?.addEventListener("dragend", e=>{
  const card = e.target.closest("[data-drag-game-id]");
  card?.classList.remove("is-dragging");
  draggedGameId = null;
});

gameGrid?.addEventListener("dragover", e=>{
  if(!draggedGameId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const overCard = e.target.closest("[data-drag-game-id]");
  gameGrid.querySelectorAll(".game-card-admin").forEach(el=>el.classList.remove("is-drag-over"));
  if(overCard && overCard.dataset.dragGameId!==draggedGameId) overCard.classList.add("is-drag-over");
});

gameGrid?.addEventListener("drop", e=>{
  e.preventDefault();
  const overCard = e.target.closest("[data-drag-game-id]");
  gameGrid.querySelectorAll(".game-card-admin").forEach(el=>el.classList.remove("is-drag-over"));
  if(!draggedGameId || !overCard) return;
  const targetId = overCard.dataset.dragGameId;
  if(targetId===draggedGameId) return;

  const fromIndex = games.findIndex(g=>g.id===draggedGameId);
  const toIndex   = games.findIndex(g=>g.id===targetId);
  if(fromIndex===-1 || toIndex===-1) return;

  const [moved] = games.splice(fromIndex,1);
  games.splice(toIndex,0,moved);
  games.forEach((g,i)=> g.sortOrder = i); // sinkron dengan kolom sort_order Supabase nanti
  saveGames();
  renderGameCards();
  if(currentPage==="dashboard") renderDashboard();
  toast("Urutan game diperbarui ✓");
});

// ─── GAME FORM ────────────────────────────────
function openGameEditor(gameId=null){
  editingGameId = gameId;
  const g = games.find(x=>x.id===gameId);
  clearFormErrors();
  gameForm.name.value     = g?.name     || "";
  gameForm.initials.value = g?.initials || "";
  gameForm.imageUrl.value = g?.imageUrl || "";
  gameForm.from.value     = g?.from     || "";
  gameForm.colorA.value   = g?.colors?.[0] || "#0b8f87";
  gameForm.colorB.value   = g?.colors?.[1] || "#d97912";
  document.querySelector("#game-modal-title").textContent = gameId ? "Edit Game" : "Tambah Game Baru";
  openModal(gameModal);
}

function saveGameFromForm(){
  const fd = new FormData(gameForm);
  const data = {
    name:     String(fd.get("name")||"").trim(),
    initials: String(fd.get("initials")||"").trim().toUpperCase(),
    imageUrl: String(fd.get("imageUrl")||"").trim(),
    from:     String(fd.get("from")||"").trim() || "Cek admin",
    colors:   [String(fd.get("colorA")||"#0b8f87"), String(fd.get("colorB")||"#d97912")],
  };
  if(!validateGameForm(data)) return;

  if(editingGameId){
    const g = games.find(x=>x.id===editingGameId);
    if(g){ Object.assign(g, data); activeGameId = g.id; }
    toast(`${data.name} berhasil diperbarui ✓`);
  } else {
    const base = slugify(data.name);
    const id = games.some(g=>g.id===base) ? `${base}-${Date.now()}` : base;
    games.push({ id, ...data, featured:false, status:"normal", products:[], maintenance:{} });
    activeGameId = id;
    toast(`${data.name} ditambahkan ✓`);
  }

  saveGames();
  closeModals();
  renderGameCards();
  if(currentPage==="dashboard") renderDashboard();
}

document.querySelector("[data-open-game-modal]").addEventListener("click", ()=> openGameEditor(null));
document.querySelector("[data-save-game]").addEventListener("click", saveGameFromForm);

// ─── PRODUCT PAGE ─────────────────────────────
function renderProductPage(){
  // Render game picker chips
  const picker = document.querySelector("[data-product-game-picker]");
  picker.innerHTML = games.map(g=>`
    <button class="game-chip ${g.id===activeGameId?"is-active":""} ${g.status!=="normal"?"is-maint":""}"
      type="button" data-pick-game="${esc(g.id)}">
      ${esc(g.initials)} <span>${esc(g.name)}</span>
    </button>
  `).join("");

  renderProductTable();
}

document.querySelector("[data-product-game-picker]")?.addEventListener("click", e=>{
  const btn = e.target.closest("[data-pick-game]");
  if(!btn) return;
  activeGameId = btn.dataset.pickGame;
  renderProductPage();
});

function activeGame(){ return games.find(g=>g.id===activeGameId)||games[0]||null; }

function getPromoStatus(p){
  if(!p.promo && !p.promoPrice) return { label:"-", cls:"" };
  const now = new Date();
  const start = p.promoStart ? new Date(p.promoStart) : null;
  const end   = p.promoEnd   ? new Date(p.promoEnd)   : null;
  if(start && start>now) return { label:"Scheduled", cls:"status-scheduled" };
  if(end   && end<now)   return { label:"Expired Promo", cls:"status-expired" };
  return { label:"Active", cls:"status-active" };
}

function renderProductTable(){
  const g = activeGame();
  if(!g){ productTable.innerHTML=`<tr><td colspan="9">Pilih game terlebih dahulu.</td></tr>`; return; }

  selectedGameNameEl.textContent = g.name;
  productGameNameEl.textContent  = g.name;
  productSummaryEl.textContent   = `${g.products.length} varian. Status: ${g.status!=="normal"?`⚠ ${gameStatusLabel(g.status)}`:"✅ Aktif"}`;

  if(!g.products.length){
    productTable.innerHTML=`<tr><td colspan="9" style="color:#5f6672;padding:20px;text-align:center">Belum ada produk. Klik "+ Tambah Produk" untuk mulai.</td></tr>`;
    return;
  }

  productTable.innerHTML = g.products.map((p,i)=>{
    const ps = getPromoStatus(p);
    const unavail = p.status!=="normal";
    const selVal  = p.sellingPrice || p.normal || p.price || "";
    const promoVal= p.promoPrice || (p.promo ? p.price:"") || "";
    const badge   = ps.cls
      ? `<span class="status-badge-table ${ps.cls}">${ps.label}</span>`
      : `<span class="muted-cell">—</span>`;
    const statusBadge = unavail
      ? `<span class="status-badge-table ${p.status==="soldout"?"status-expired":"status-scheduled"}">${p.status==="soldout"?"Stok Habis":"Gangguan"}</span>`
      : `<span class="status-badge-table status-active">Normal</span>`;
    return `
      <tr class="${unavail?"is-unavailable":""}" data-product-index="${i}" draggable="true" data-drag-product-index="${i}">
        <td class="drag-cell"><span class="drag-handle" title="Geser untuk urutkan">⠿</span></td>
        <td><strong>${esc(p.name)}</strong></td>
        <td><input type="text" value="${esc(p.costPrice)}" data-inline-field="costPrice" /></td>
        <td><input type="text" value="${esc(selVal)}" data-inline-field="sellingPrice" /></td>
        <td><input type="checkbox" ${p.promo||promoVal?"checked":""} data-inline-field="promo" /></td>
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

productTable?.addEventListener("change", e=>{
  const row = e.target.closest("[data-product-index]");
  if(!row || !e.target.matches("[data-inline-field]")) return;
  updateInlineProduct(row);
  renderProductTable();
});

productTable?.addEventListener("click", async e=>{
  const edit = e.target.closest("[data-edit-product]");
  if(edit){ openProductEditor(Number(edit.dataset.editProduct)); return; }

  const del = e.target.closest("[data-delete-product]");
  if(del){
    const g = activeGame();
    const i = Number(del.dataset.deleteProduct);
    const p = g?.products[i];
    if(!p) return;
    const ok = await confirm("Hapus Produk", `Hapus produk "${p.name}"?`);
    if(!ok) return;
    g.products.splice(i,1);
    saveGames();
    renderProductPage();
    toast(`Produk "${p.name}" dihapus.`);
  }
});

// ─── DRAG & DROP: urutan produk ───────────────
let draggedProductIndex = null;

productTable?.addEventListener("dragstart", e=>{
  const row = e.target.closest("[data-drag-product-index]");
  if(!row) return;
  draggedProductIndex = Number(row.dataset.dragProductIndex);
  row.classList.add("is-dragging");
  e.dataTransfer.effectAllowed = "move";
});

productTable?.addEventListener("dragend", e=>{
  const row = e.target.closest("[data-drag-product-index]");
  row?.classList.remove("is-dragging");
  draggedProductIndex = null;
});

productTable?.addEventListener("dragover", e=>{
  if(draggedProductIndex===null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const overRow = e.target.closest("[data-drag-product-index]");
  productTable.querySelectorAll("tr").forEach(el=>el.classList.remove("is-drag-over"));
  if(overRow && Number(overRow.dataset.dragProductIndex)!==draggedProductIndex) overRow.classList.add("is-drag-over");
});

productTable?.addEventListener("drop", e=>{
  e.preventDefault();
  const overRow = e.target.closest("[data-drag-product-index]");
  productTable.querySelectorAll("tr").forEach(el=>el.classList.remove("is-drag-over"));
  if(draggedProductIndex===null || !overRow) return;
  const toIndex = Number(overRow.dataset.dragProductIndex);
  if(toIndex===draggedProductIndex) return;

  const g = activeGame();
  if(!g) return;
  const [moved] = g.products.splice(draggedProductIndex,1);
  g.products.splice(toIndex,0,moved);
  g.products.forEach((p,i)=> p.sortOrder = i); // sinkron dengan kolom sort_order Supabase nanti
  saveGames();
  renderProductTable();
  toast("Urutan produk diperbarui ✓");
});

function updateInlineProduct(row){
  const g = activeGame();
  const i = Number(row.dataset.productIndex);
  const p = g?.products[i];
  if(!p) return;
  row.querySelectorAll("[data-inline-field]").forEach(f=>{
    const key = f.dataset.inlineField;
    p[key] = key==="promo" ? f.checked : f.value.trim();
  });
  p.promo = Boolean(p.promo || p.promoPrice);
  p.price  = p.promoPrice || p.sellingPrice || p.price;
  p.normal = p.promoPrice ? p.sellingPrice : "";
  saveGames();
}

// ─── PRODUCT EDITOR ──────────────────────────
function openProductEditor(index=null){
  const g = activeGame();
  if(!g){ toast("Pilih game terlebih dahulu.","error"); return; }
  editingProductIndex = index;
  clearFormErrors();
  const p = index===null ? null : g.products[index];
  productForm.name.value        = p?.name || "";
  productForm.category.value    = p?.category || "Diamonds";
  productForm.costPrice.value   = p?.costPrice || "";
  productForm.sellingPrice.value= p?.sellingPrice || p?.normal || p?.price || "";
  productForm.promoPrice.value  = p?.promoPrice || (p?.promo ? p?.price:"") || "";
  productForm.promoBadge.value  = p?.promoBadge || "";
  productForm.autoSchedule.checked = Boolean(p?.promoStart||p?.promoEnd);
  productForm.promoStart.value  = toDatetimeInput(p?.promoStart);
  productForm.promoEnd.value    = toDatetimeInput(p?.promoEnd);
  productForm.status.value      = p?.status || "normal";
  document.querySelector("#product-modal-title").textContent = index===null ? "Tambah Produk Baru" : "Edit Produk";
  updateProfitLine();
  openModal(productModal);
}

function saveProductFromForm(){
  const g = activeGame();
  if(!g) return;
  const fd = new FormData(productForm);
  const sellingPrice = String(fd.get("sellingPrice")||"").trim();
  const promoPrice   = String(fd.get("promoPrice")||"").trim();
  const data = {
    name:        String(fd.get("name")||"").trim(),
    category:    String(fd.get("category")||"Diamonds"),
    costPrice:   String(fd.get("costPrice")||"").trim(),
    sellingPrice,
    promoPrice,
    price:       promoPrice || sellingPrice,
    normal:      promoPrice ? sellingPrice : "",
    promo:       Boolean(promoPrice),
    promoBadge:  String(fd.get("promoBadge")||"").trim(),
    promoStart:  String(fd.get("promoStart")||""),
    promoEnd:    String(fd.get("promoEnd")||""),
    status:      String(fd.get("status")||"normal"),
  };
  if(!validateProductForm(data)) return;

  if(editingProductIndex===null){
    g.products.push(data);
    toast(`Produk "${data.name}" ditambahkan ✓`);
  } else {
    g.products[editingProductIndex] = data;
    toast(`Produk "${data.name}" diperbarui ✓`);
  }

  saveGames();
  closeModals();
  renderProductPage();
}

document.querySelector("[data-open-product-modal]").addEventListener("click", ()=> openProductEditor(null));
document.querySelector("[data-save-product]").addEventListener("click", saveProductFromForm);

function updateProfitLine(){
  const cost    = parseMoney(productForm.costPrice.value);
  const selling = parseMoney(productForm.promoPrice.value || productForm.sellingPrice.value);
  if(!cost || !selling){ profitLine.textContent="Kalkulasi Profit: —"; return; }
  const profit = selling - cost;
  const margin = selling ? (profit/selling)*100 : 0;
  profitLine.textContent = `Profit: ${formatIdr(profit)} / ${margin.toFixed(1)}% (berdasarkan ${productForm.promoPrice.value?"Harga Promo":"Harga Jual"})`;
}

productForm?.addEventListener("input", updateProfitLine);
productForm?.addEventListener("change", updateProfitLine);

// ─── GLOBAL PRICE ADJUSTER ───────────────────
document.querySelector("[data-apply-adjust]")?.addEventListener("click", async ()=>{
  const g = activeGame();
  if(!g){ toast("Pilih game terlebih dahulu.","error"); return; }
  const type    = document.querySelector("[data-adjust-type]").value;
  const raw     = document.querySelector("[data-adjust-value]").value.trim();
  const percent = raw.includes("%");
  const amount  = Number(raw.replace(/[^0-9.]/g,""));
  if(!amount){ toast("Masukkan nilai penyesuaian.","error"); return; }

  const ok = await confirm(
    "Sesuaikan Semua Harga",
    `${type==="increase"?"Naikkan":"Turunkan"} harga semua produk "${g.name}" sebesar ${raw}?`
  );
  if(!ok) return;

  g.products.forEach(p=>{
    const base  = parseMoney(p.sellingPrice||p.normal||p.price);
    const delta = percent ? base*(amount/100) : amount;
    const next  = type==="decrease" ? base-delta : base+delta;
    p.sellingPrice = formatIdr(Math.max(0,Math.round(next)));
    if(!p.promoPrice) p.price = p.sellingPrice;
  });
  saveGames();
  renderProductPage();
  toast(`Harga ${g.name} berhasil disesuaikan ✓`);
});

// ─── MAINTENANCE EDITOR ──────────────────────
function openMaintenanceEditor(gameId){
  const g = games.find(x=>x.id===gameId);
  if(!g) return;
  maintenanceGameId = gameId;
  const m = g.maintenance || {};
  document.querySelector("#maintenance-title").textContent = `Status — ${g.name}`;
  document.querySelector("[data-maintenance-type]").value      = (g.status==="gangguan"||g.status==="maintenance"||g.status==="segera-hadir") ? g.status : (m.type||"maintenance");
  document.querySelector("[data-maintenance-enabled]").checked = g.status!=="normal" || Boolean(m.enabled);
  const scheduleStillValid = m.end && new Date(m.end) > new Date();
  document.querySelector("[data-maintenance-start]").value    = scheduleStillValid ? toDatetimeInput(m.start) : "";
  document.querySelector("[data-maintenance-end]").value      = scheduleStillValid ? toDatetimeInput(m.end) : "";
  document.querySelector("[data-maintenance-reason]").value   = m.reason || `Server ${g.name} sedang gangguan, kembali pukul 20:00 WIB`;
  document.querySelector("[data-telegram-enabled]").checked   = Boolean(m.telegramEnabled);
  document.querySelector("[data-telegram-start]").value       = m.telegramStart || "PEMBERITAHUAN: Layanan {game_name} sedang dalam perbaikan rutin mulai {start_time}. Mohon bersabar!";
  document.querySelector("[data-telegram-end]").value         = m.telegramEnd   || "Layanan {game_name} telah kembali normal. Terima kasih atas kesabaran Anda!";
  document.querySelector("[data-telegram-channel]").value     = m.telegramChannel || "";
  clearFormErrors();
  updateTelegramPreview();
  openModal(maintenanceModal);
}

async function saveMaintenance(){
  const g = games.find(x=>x.id===maintenanceGameId);
  if(!g) return;
  if(!validateMaintenanceForm()) return;

  const enabled = document.querySelector("[data-maintenance-enabled]").checked;
  const typeRaw = document.querySelector("[data-maintenance-type]").value;
  const type    = (typeRaw==="gangguan"||typeRaw==="segera-hadir") ? typeRaw : "maintenance";
  const newStatus = enabled ? type : "normal";

  // Ringkasan perubahan untuk popup konfirmasi
  const oldLabel = gameStatusLabel(g.status);
  const newLabel = gameStatusLabel(newStatus);
  if(oldLabel === newLabel){
    // Status levelnya sama, tapi mungkin jadwal/pesan berubah — tetap minta konfirmasi sederhana.
    const ok = await confirm("Konfirmasi Perubahan", [`Simpan pengaturan status untuk <b>${esc(g.name)}</b>?`]);
    if(!ok) return;
  } else {
    const ok = await confirm("Konfirmasi Perubahan Status", [
      `Game: <b>${esc(g.name)}</b>`,
      `Status: <b>${esc(oldLabel)}</b> → <b>${esc(newLabel)}</b>`,
    ]);
    if(!ok) return;
  }

  g.status = newStatus;
  let start = document.querySelector("[data-maintenance-start]").value;
  let end   = document.querySelector("[data-maintenance-end]").value;
  // Kalau jam selesai yang terisi sudah lewat, itu bukan jadwal yang masih berlaku —
  // abaikan supaya checkAutoMaintenance() tidak langsung mengembalikan status ke normal.
  if (end && new Date(end) <= new Date()) { start = ""; end = ""; }
  g.maintenance = {
    enabled,
    type,
    start,
    end,
    reason:         document.querySelector("[data-maintenance-reason]").value.trim(),
    telegramEnabled:document.querySelector("[data-telegram-enabled]").checked,
    telegramStart:  document.querySelector("[data-telegram-start]").value.trim(),
    telegramEnd:    document.querySelector("[data-telegram-end]").value.trim(),
    telegramChannel:document.querySelector("[data-telegram-channel]").value.trim(),
  };
  saveGames();
  closeModals();
  if(currentPage==="games")    renderGameCards();
  if(currentPage==="products") renderProductPage();
  if(currentPage==="dashboard") renderDashboard();
  toast(`Status ${g.name} disimpan: ${enabled ? gameStatusLabel(type) : "Aktif"} ✓`);
}

document.querySelector("[data-save-maintenance]").addEventListener("click", saveMaintenance);

function updateTelegramPreview(){
  const g = games.find(x=>x.id===maintenanceGameId) || activeGame();
  const start    = document.querySelector("[data-maintenance-start]")?.value || "-";
  const template = document.querySelector("[data-telegram-start]")?.value   || "";
  const preview  = template.replaceAll("{game_name}", g?.name||"Game").replaceAll("{start_time}", start);
  document.querySelector("[data-telegram-preview]").textContent = preview;
}

maintenanceModal?.addEventListener("input",  updateTelegramPreview);
maintenanceModal?.addEventListener("change", updateTelegramPreview);

// ─── BULK MAINTENANCE ─────────────────────────
document.querySelectorAll("[data-open-bulk-modal]").forEach(btn=>{
  btn.addEventListener("click", ()=> openModal(bulkModal));
});

document.querySelector("[data-activate-bulk]")?.addEventListener("click", async ()=>{
  const scope   = document.querySelector("[data-bulk-scope]").value;
  const message = document.querySelector("[data-bulk-message]").value.trim();
  if(!message){ toast("Tulis pesan maintenance terlebih dahulu.","error"); return; }

  const ok = await confirm("Aktifkan Bulk Maintenance", `Masukkan ${scope==="all"?"semua game":"seluruh website"} ke mode maintenance?`);
  if(!ok) return;

  siteSettings.systemMaintenance = { ...(siteSettings.systemMaintenance||{}), enabled:true, message };
  saveSettings();

  if(scope==="all"){
    games.forEach(g=>{
      g.status = "maintenance";
      g.maintenance = { ...(g.maintenance||{}), type:"maintenance", enabled:true, reason:message, start:"", end:"" };
    });
  }

  saveGames();
  closeModals();
  renderSettingsForm();
  if(currentPage==="games")     renderGameCards();
  if(currentPage==="products")  renderProductPage();
  if(currentPage==="dashboard") renderDashboard();
  toast("Bulk maintenance diaktifkan ✓");
});

document.querySelector("[data-deactivate-bulk]")?.addEventListener("click", async ()=>{
  const ok = await confirm("Aktifkan Kembali Semua", "Nonaktifkan maintenance dan aktifkan kembali semua game?");
  if(!ok) return;

  siteSettings.systemMaintenance = { ...(siteSettings.systemMaintenance||{}), enabled:false };
  saveSettings();
  games.forEach(g=>{
    g.status = "normal";
    g.maintenance = { ...(g.maintenance||{}), enabled:false };
  });
  saveGames();
  closeModals();
  renderSettingsForm();
  if(currentPage==="games")     renderGameCards();
  if(currentPage==="products")  renderProductPage();
  if(currentPage==="dashboard") renderDashboard();
  toast("Semua game kembali aktif ✓");
});

// ─── SALES (PENJUALAN) ────────────────────────
function isSameLocalDay(dateStr, target){
  if(!dateStr) return false;
  const d = new Date(dateStr);
  return d.getFullYear()===target.getFullYear() && d.getMonth()===target.getMonth() && d.getDate()===target.getDate();
}

function sumProfit(list){
  return list.reduce((total,o)=> total + (Number(o.profitValue)||0), 0);
}
function sumRevenue(list){
  return list.reduce((total,o)=> total + (Number(o.priceValue)||0), 0);
}
function sumCost(list){
  return list.reduce((total,o)=> total + (Number(o.costValue)||0), 0);
}

function ordersToday(){
  const now = new Date();
  return orders.filter(o=> isSameLocalDay(o.date, now));
}
function ordersThisMonth(){
  const now = new Date();
  return orders.filter(o=>{
    const d = new Date(o.date);
    return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
  });
}
function ordersThisYear(){
  const now = new Date();
  return orders.filter(o=> new Date(o.date).getFullYear()===now.getFullYear());
}

// ─── halaman Penjualan: ringkasan berbasis KEUNTUNGAN ──
function renderSalesSummary(){
  // ✅ PERBAIKAN: pakai orders asli, bukan hasil filter
  const list = orders; 
  
  const now  = new Date();

  const todayList = list.filter(o=> isSameLocalDay(o.date, now));
  const monthList = list.filter(o=>{
    const d = new Date(o.date);
    return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
  });
  const yearList  = list.filter(o=> new Date(o.date).getFullYear()===now.getFullYear());

  const stats = [
    { label:"Transaksi Hari Ini",  value: todayList.length, money:false },
    { label:"Untung Hari Ini",     value: formatIdr(sumProfit(todayList)), money:true },
    { label:"Untung Bulan Ini",    value: formatIdr(sumProfit(monthList)), money:true },
    { label:"Untung Tahun Ini",    value: formatIdr(sumProfit(yearList)),  money:true },
  ];

  const el = document.querySelector("[data-sales-summary]");
  if(!el) return;
  el.innerHTML = stats.map(s=>`
    <div class="stat-card${s.money ? " is-good" : ""}">
      <span>${esc(s.value)}</span>
      <p>${esc(s.label)}</p>
    </div>
  `).join("");
}

function populateSalesGameFilter(){
  const sel = document.querySelector("[data-sales-game-filter]");
  if(!sel) return;
  const current = sel.value || "all";
  sel.innerHTML = `<option value="all">Semua Game</option>` +
    games.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");
  sel.value = games.some(g=>g.id===current) ? current : "all";
}

// Filter: kalau pilih game tertentu dan game itu tidak ada transaksi, hasilnya kosong.
// Pilih "Semua Game" baru menggabungkan seluruh transaksi.
function getFilteredOrders(){
  return orders
    .filter(o=> salesGameFilter==="all" || o.gameId===salesGameFilter)
    .filter(o=> !salesDateFilter || (o.date && o.date.slice(0,10)===salesDateFilter))
    .filter(o=> !salesOrderIdFilter || (o.orderId && o.orderId.includes(salesOrderIdFilter)))
    .sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
}

function renderSalesTable(){
  const body = document.querySelector("[data-sales-table-body]");
  if(!body) return;
  const list = getFilteredOrders();

  if(list.length===0){
    body.innerHTML = `<tr><td colspan="8" class="empty-state">Belum ada transaksi tercatat untuk filter ini.</td></tr>`;
    return;
  }

  body.innerHTML = list.map(o=>`
    <tr>
      <td>${esc(formatOrderDate(o.date))}</td>
      <td>${esc(o.orderId)}</td>
      <td>${esc(o.gameName)}</td>
      <td>${esc(o.productName)}</td>
      <td>${esc(formatIdr(o.priceValue))}</td>
      <td class="is-profit">${esc(formatIdr(o.profitValue))}</td>
      <td><button class="ghost-button" type="button" data-view-receipt="${esc(o.orderId)}">Lihat Struk</button></td>
      <td><button class="delete-button" type="button" data-delete-sale="${esc(o.orderId)}">Hapus</button></td>
    </tr>
  `).join("");
}

function formatOrderDate(dateStr){
  if(!dateStr) return "-";
  const d = new Date(dateStr);
  if(Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("id-ID",{ day:"2-digit", month:"short", year:"numeric" });
}

function renderSalesPage(){
  populateSalesGameFilter();
  renderSalesSummary();
  renderSalesTable();
}

// ─── halaman Modal: rekap total modal yang keluar, dikelompokkan per game ──
function renderCapitalPage(){
  const today = ordersToday();
  const month = ordersThisMonth();
  const year  = ordersThisYear();

  const stats = [
    { label:"Modal Keluar Hari Ini",  value: formatIdr(sumCost(today)) },
    { label:"Modal Keluar Bulan Ini", value: formatIdr(sumCost(month)) },
    { label:"Modal Keluar Tahun Ini", value: formatIdr(sumCost(year))  },
    { label:"Total Semua Transaksi",  value: formatIdr(sumCost(orders)) },
  ];

  const summaryEl = document.querySelector("[data-capital-summary]");
  if(summaryEl){
    summaryEl.innerHTML = stats.map(s=>`
      <div class="stat-card">
        <span>${esc(s.value)}</span>
        <p>${esc(s.label)}</p>
      </div>
    `).join("");
  }

  const body = document.querySelector("[data-capital-table-body]");
  if(!body) return;

  if(orders.length===0){
    body.innerHTML = `<tr><td colspan="5" class="empty-state">Belum ada transaksi tercatat.</td></tr>`;
    return;
  }

  // Kelompokkan transaksi per game
  const byGame = {};
  orders.forEach(o=>{
    const key = o.gameId || o.gameName || "-";
    if(!byGame[key]){
      byGame[key] = { gameName: o.gameName, count:0, cost:0, revenue:0, profit:0 };
    }
    byGame[key].count++;
    byGame[key].cost    += Number(o.costValue)||0;
    byGame[key].revenue += Number(o.priceValue)||0;
    byGame[key].profit  += Number(o.profitValue)||0;
  });

  body.innerHTML = Object.values(byGame).map(g=>`
    <tr>
      <td>${esc(g.gameName)}</td>
      <td>${esc(g.count)}</td>
      <td>${esc(formatIdr(g.cost))}</td>
      <td>${esc(formatIdr(g.revenue))}</td>
      <td class="is-profit">${esc(formatIdr(g.profit))}</td>
    </tr>
  `).join("");
}

// ─── SALE MODAL: harga jual & modal otomatis dari katalog produk ──
function populateSaleForm(){
  const gameSel = document.querySelector("[data-sale-game]");
  gameSel.innerHTML = games.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");
  populateSaleProductOptions();
  document.querySelector("[data-sale-buyer]").value = "";
  document.querySelector("[data-sale-nick]").value = "";
  document.querySelector("[data-sale-ref]").value = "";
  document.querySelector("[data-sale-qrtext]").value = "";
}

function populateSaleProductOptions(){
  const gameId = document.querySelector("[data-sale-game]").value;
  const game = games.find(g=>g.id===gameId);
  const productSel = document.querySelector("[data-sale-product]");
  const products = game ? game.products : [];
  productSel.innerHTML = products.length
    ? products.map(p=>`<option value="${esc(p.name)}" data-price="${esc(parseMoney(p.sellingPrice||p.price))}" data-cost="${esc(parseMoney(p.costPrice))}">${esc(p.name)}</option>`).join("")
    : `<option value="">(Game ini belum punya produk)</option>`;
  applySaleProductPrice();
}

function applySaleProductPrice(){
  const productSel = document.querySelector("[data-sale-product]");
  const opt = productSel.selectedOptions[0];
  const price = Number(opt?.dataset.price || 0);
  const cost  = Number(opt?.dataset.cost  || 0);
  const profit = price - cost;

  document.querySelector("[data-sale-price]").value = formatIdr(price);
  document.querySelector("[data-sale-cost]").value  = formatIdr(cost);
  const profitEl = document.querySelector("[data-sale-profit-preview]");
  if(profitEl){
    profitEl.textContent = formatIdr(profit);
    profitEl.classList.toggle("is-negative", profit < 0);
  }
}

document.addEventListener("change", e=>{
  if(e.target.matches("[data-sale-game]")) populateSaleProductOptions();
  if(e.target.matches("[data-sale-product]")) applySaleProductPrice();
});

document.addEventListener("click", e=>{
  if(e.target.closest("[data-open-sale-modal]")){
    populateSaleForm();
    clearFormErrors();
    openModal(saleModal);
    return;
  }
  if(e.target.closest("[data-save-sale]")){
    saveSaleFromForm();
    return;
  }
  if(e.target.closest("[data-download-receipt-png]")){
    downloadReceiptPng();
    return;
  }
  if(e.target.closest("[data-download-receipt-pdf]")){
    downloadReceiptPdf();
    return;
  }
});

function saveSaleFromForm(){
  clearFormErrors();
  const gameId = document.querySelector("[data-sale-game]").value;
  const game = games.find(g=>g.id===gameId);
  const productSel = document.querySelector("[data-sale-product]");
  const productName = productSel.value || "";
  const selectedOpt = productSel.selectedOptions[0];

  if(!productName){
    setError("sale-price","Pilih game yang sudah punya produk untuk dicatat");
    return;
  }

  const priceValue = Number(selectedOpt?.dataset.price || 0);
  const costValue  = Number(selectedOpt?.dataset.cost  || 0);
  const profitValue= priceValue - costValue;

  const buyer  = document.querySelector("[data-sale-buyer]").value.trim();
  const nick   = document.querySelector("[data-sale-nick]").value.trim();
  const ref    = document.querySelector("[data-sale-ref]").value.trim();
  const qrText = document.querySelector("[data-sale-qrtext]").value.trim();

  const now = new Date();
  const order = {
    orderId: generateOrderId(),
    date: now.toISOString().slice(0,10),
    createdAt: now.toISOString(),
    gameId: game?.id || "",
    gameName: game?.name || "-",
    productName,
    priceValue,
    costValue,
    profitValue,
    buyer,
    nick,
    ref,
    qrText,
  };

  saveOrderSafely(order);
  closeModals();
  renderSalesPage();
  if(currentPage==="capital") renderCapitalPage();
  toast("Transaksi berhasil dicatat ✓");
  openReceipt(order.orderId);
}

document.querySelector("[data-sales-table-body]")?.addEventListener("click", async e=>{
  const viewBtn = e.target.closest("[data-view-receipt]");
  if(viewBtn){ openReceipt(viewBtn.dataset.viewReceipt); return; }

  const delBtn = e.target.closest("[data-delete-sale]");
  if(delBtn){
    const ok = await confirm("Hapus Transaksi","Transaksi ini akan dihapus permanen. Lanjutkan?");
    if(!ok) return;
    orders = orders.filter(o=>o.orderId!==delBtn.dataset.deleteSale);
    saveOrders();
    renderSalesPage();
    if(currentPage==="capital") renderCapitalPage();
    toast("Transaksi dihapus","warn");
  }
});

document.querySelector("[data-sales-orderid-filter]")?.addEventListener("input", e=>{
  salesOrderIdFilter = e.target.value.trim();
  renderSalesPage();
});
document.querySelector("[data-sales-date-filter]")?.addEventListener("change", e=>{
  salesDateFilter = e.target.value;
  renderSalesPage();
});
document.querySelector("[data-sales-game-filter]")?.addEventListener("change", e=>{
  salesGameFilter = e.target.value;
  renderSalesPage();
});
document.querySelector("[data-sales-clear-filter]")?.addEventListener("click", ()=>{
  salesDateFilter = "";
  salesGameFilter = "all";
  salesOrderIdFilter = "";
  const orderIdInput = document.querySelector("[data-sales-orderid-filter]");
  const dateInput = document.querySelector("[data-sales-date-filter]");
  const gameSelect = document.querySelector("[data-sales-game-filter]");
  if(orderIdInput) orderIdInput.value = "";
  if(dateInput) dateInput.value = "";
  if(gameSelect) gameSelect.value = "all";
  renderSalesPage();
});

// ─── RECEIPT (STRUK) ──────────────────────────
function openReceipt(orderId){
  const order = orders.find(o=>o.orderId===orderId);
  if(!order){ toast("Transaksi tidak ditemukan","warn"); return; }

  const brand = siteSettings.brandName || "GlacierStore";
  document.querySelector("[data-receipt-brand]").textContent = brand;
  document.querySelector("[data-receipt-brand-footer]").textContent = brand;

  const logoSlot = document.querySelector("[data-receipt-logo-slot]");
  if(logoSlot){
    logoSlot.innerHTML = "";
    const img = document.createElement("img");
    img.src = "/assets/logo-icon.png";
    img.alt = brand;
    img.style.cssText = "height:56px;width:auto;display:block;margin:0 auto 4px;";
    logoSlot.appendChild(img);
  }
  document.querySelector("[data-receipt-order-id]").textContent = "#" + order.orderId;
  document.querySelector("[data-receipt-date]").textContent = new Date(order.createdAt).toLocaleString("id-ID");
  document.querySelector("[data-receipt-product]").textContent = `${order.gameName} - ${order.productName}`;
  document.querySelector("[data-receipt-price]").textContent = formatIdr(order.priceValue);
  document.querySelector("[data-receipt-buyer]").textContent = order.buyer || "-";
  document.querySelector("[data-receipt-total]").textContent = formatIdr(order.priceValue);

  const nickWrap = document.querySelector("[data-receipt-nick-wrap]");
  const nickEl   = document.querySelector("[data-receipt-nick]");
  if(order.nick){ nickEl.textContent = order.nick; nickWrap.hidden = false; }
  else{ nickWrap.hidden = true; }

  const refWrap = document.querySelector("[data-receipt-ref-wrap]");
  const refEl   = document.querySelector("[data-receipt-ref]");
  if(order.ref){ refEl.textContent = "RefID: " + order.ref; refWrap.hidden = false; }
  else{ refWrap.hidden = true; }

  const qrBox = document.querySelector("[data-receipt-qr]");
  qrBox.innerHTML = "";
  if(order.qrText && window.QRCode){
    qrBox.hidden = false;
    new window.QRCode(qrBox, { text: order.qrText, width: 120, height: 120, correctLevel: window.QRCode.CorrectLevel.H });
  } else {
    qrBox.hidden = true;
  }

  openModal(receiptModal);
}

async function downloadReceiptPng(){
  const node = document.querySelector("[data-receipt-paper]");
  if(!node || !window.html2canvas) { toast("Gagal memuat komponen download","warn"); return; }
  try{
    const canvas = await window.html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
    const link = document.createElement("a");
    const orderId = document.querySelector("[data-receipt-order-id]").textContent.replace("#","");
    link.download = `struk-${orderId}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }catch{
    toast("Gagal membuat gambar struk","warn");
  }
}

async function downloadReceiptPdf(){
  const node = document.querySelector("[data-receipt-paper]");
  if(!node || !window.html2canvas || !window.jspdf){ toast("Gagal memuat komponen download","warn"); return; }
  try{
    const canvas = await window.html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const widthMm  = 58; // ukuran struk kecil (thermal-like)
    const heightMm = (canvas.height * widthMm) / canvas.width;
    const pdf = new jsPDF({ unit:"mm", format:[widthMm, heightMm] });
    pdf.addImage(imgData, "PNG", 0, 0, widthMm, heightMm);
    const orderId = document.querySelector("[data-receipt-order-id]").textContent.replace("#","");
    pdf.save(`struk-${orderId}.pdf`);
  }catch{
    toast("Gagal membuat PDF struk","warn");
  }
}

// ─── AUTO-MAINTENANCE TICK ───────────────────
// Check every minute if scheduled maintenance should toggle game status
function checkAutoMaintenance(){
  const now = new Date();
  let changed = false;
  games.forEach(g=>{
    const m = g.maintenance || {};
    if(!m.enabled) return;
    const start = m.start ? new Date(m.start) : null;
    const end   = m.end   ? new Date(m.end)   : null;
    if(start && end){
      const type = m.type==="gangguan" ? "gangguan" : "maintenance";
      const shouldBeMaint = now >= start && now < end;
      const shouldBeNormal= now >= end;
      if(shouldBeMaint && g.status!==type){
        g.status = type; changed = true;
      } else if(shouldBeNormal && g.status!=="normal"){
        g.status = "normal";
        g.maintenance = { ...m, enabled:false };
        changed = true;
      }
    }
  });
  if(changed){
    saveGames();
    if(currentPage==="games")     renderGameCards();
    if(currentPage==="products")  renderProductPage();
    if(currentPage==="dashboard") renderDashboard();
  }
  updateAdminCountdownPreview();
  updateMaintenanceStatusPreview();
  if(currentPage==="dashboard") renderDashboard();
}

setInterval(checkAutoMaintenance, 10000); // every 10s

// ─── AUTO PROMO CHECK ─────────────────────────
// Cek promo expired/active setiap 10 detik.
// Jika ada produk promo expired → set status soldout, simpan ke localStorage,
// DAN langsung push ke Supabase (bypass draft queue) supaya setelah refresh
// data tidak balik ke semula.
function checkAutoPromo(){
  const now = new Date();
  const affectedGames = [];

  games.forEach(g=>{
    let gameChanged = false;
    (g.products||[]).forEach(p=>{
      const hasPromo = p.promo || p.promoPrice;
      if(!hasPromo) return;

      const start = p.promoStart ? new Date(p.promoStart) : null;
      const end   = p.promoEnd   ? new Date(p.promoEnd)   : null;
      if(!end) return; // promo manual tanpa jadwal, skip

      const isExpired   = end < now;
      const isScheduled = start && start > now;
      const isActive    = !isScheduled && !isExpired;

      // Promo expired → otomatis soldout, tandai dengan flag supaya bisa di-reset
      if(isExpired && p.status === "normal"){
        p.status = "soldout";
        p._promoAutoSoldout = true;
        gameChanged = true;
      }

      // Promo aktif kembali (admin perpanjang jadwal) → reset hanya kalau
      // soldout-nya memang dari auto-expired, bukan dari admin manual.
      if(isActive && p._promoAutoSoldout && p.status === "soldout"){
        p.status = "normal";
        p._promoAutoSoldout = false;
        gameChanged = true;
      }
    });
    if(gameChanged) affectedGames.push(g);
  });

  if(affectedGames.length){
    // Simpan ke localStorage
    saveGames();
    // Push langsung ke Supabase (bypass draft queue) — ini perubahan otomatis
    // sistem, bukan edit admin, jadi tidak perlu lewat "Draft Perubahan".
    // Setelah push, update syncedSnapshot di draft-queue supaya perubahan ini
    // tidak muncul sebagai "Belum Disimpan" di halaman Draft.
    if(window.scPushSingleGame){
      affectedGames.forEach(async g=>{
        try{
          await window.scPushSingleGame(g);
          // Update snapshot supaya draft-queue tidak mendeteksi ini sebagai dirty
          if(window.GlacierDraft) window.GlacierDraft.snapshotAllGamesAsSynced();
        }catch(e){
          console.warn("checkAutoPromo: gagal push ke Supabase, akan dicoba interval berikutnya:", e);
        }
      });
    }
    if(currentPage==="products") renderProductPage();
  }

  // Re-render tabel promo label (scheduled/active/expired) meski tidak ada perubahan status
  // supaya label badge terupdate otomatis saat waktu berubah.
  if(currentPage==="products") renderProductTable();
}

setInterval(checkAutoPromo, 10000); // every 10s

// ─── INIT ─────────────────────────────────────
saveGames(); // normalize on boot
navigateTo("dashboard");

// Ekspos fungsi readOrders ke global agar bisa dipanggil dari HTML
window.readOrders = readOrders;