const STORAGE_KEY = window.GLACIERCODE_STORAGE_KEY || "glaciercode_catalog_v1";
const SETTINGS_KEY = window.GLACIERCODE_SETTINGS_KEY || "glaciercode_site_settings_v1";
const DEFAULT_GAMES = window.GLACIERCODE_DEFAULT_GAMES || [];
const DEFAULT_SETTINGS = window.GLACIERCODE_DEFAULT_SETTINGS || {};

function clone(source) {
  return JSON.parse(JSON.stringify(source));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readStoredGames() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return clone(DEFAULT_GAMES);
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : clone(DEFAULT_GAMES);
  } catch {
    return clone(DEFAULT_GAMES);
  }
}

function readSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    const parsed = stored ? JSON.parse(stored) : {};
    return mergeSettings(DEFAULT_SETTINGS, parsed);
  } catch {
    return mergeSettings(DEFAULT_SETTINGS, {});
  }
}

function mergeSettings(base, extra) {
  return {
    ...base,
    ...extra,
    adminHours: { ...(base.adminHours || {}), ...(extra.adminHours || {}) },
    systemMaintenance: { ...(base.systemMaintenance || {}), ...(extra.systemMaintenance || {}) },
    infoBanner: { ...(base.infoBanner || {}), ...(extra.infoBanner || {}) },
  };
}

function isUnavailable(item) {
  return item?.status && item.status !== "normal";
}

function statusText(item, fallback) {
  if (item?.status === "soldout") return "Stok habis";
  if (item?.status === "maintenance") return "Maintenance";
  if (item?.status === "gangguan") return "Gangguan";
  if (item?.status === "segera-hadir") return "Segera Hadir";
  return fallback;
}

function isComingSoon(item) {
  return item?.status === "segera-hadir";
}

function minutesFromTime(value) {
  const [hour, minute] = String(value || "00:00").split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function minutesUntilClose(hours, now = new Date()) {
  const openMinutes = minutesFromTime(hours.open || "08:00");
  const closeMinutes = minutesFromTime(hours.close || "22:00");
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const overnight = closeMinutes <= openMinutes;
  let diff = closeMinutes - currentMinutes;
  if (overnight && diff < 0) diff += 24 * 60;
  return diff;
}

function getOperationalState(now = new Date()) {
  const hours = settings.adminHours || {};
  const open = hours.open || "08:00";
  const close = hours.close || "22:00";
  const openMinutes = minutesFromTime(open);
  const closeMinutes = minutesFromTime(close);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const overnight = closeMinutes <= openMinutes;
  const online = overnight
    ? currentMinutes >= openMinutes || currentMinutes < closeMinutes
    : currentMinutes >= openMinutes && currentMinutes < closeMinutes;

  const nextOpen = new Date(now);
  nextOpen.setHours(Number(open.slice(0, 2)), Number(open.slice(3, 5)), 0, 0);
  if (online || currentMinutes >= openMinutes) nextOpen.setDate(nextOpen.getDate() + 1);

  const manuallyClosed = Boolean(hours.manualClosed);

  return { 
    online: !manuallyClosed && (!hours.autoOffline || online), 
    open, 
    close, 
    nextOpen 
  };
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function isGlobalMaintenanceActive(now = new Date()) {
  const maintenance = settings.systemMaintenance || {};
  if (!maintenance.enabled) return false;
  const start = maintenance.start ? new Date(maintenance.start) : null;
  const end = maintenance.end ? new Date(maintenance.end) : null;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

function generateOrderId(){
  let id;
  let attempts = 0;
  do{
    id = String(Math.floor(100000 + Math.random() * 900000));
    attempts++;
    if(attempts > 500) id = String(Math.floor(1000000 + Math.random() * 9000000));
  }while(orders.some(o=>o.orderId===id));
  return id;
}

function parseMoney(v){ return Number(String(v||"").replace(/[^0-9]/g,"")) || 0; }

let games = readStoredGames();
let settings = readSettings();
let orders = [];

const header = document.querySelector("[data-header]");
const gameGrid = document.querySelector("[data-game-grid]");
const priceGrid = document.querySelector("[data-price-grid]");
const selectedGameName = document.querySelector("[data-selected-game-name]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const drawer = document.querySelector("[data-drawer]");
const drawerOverlay = document.querySelector("[data-menu-overlay]");
const drawerLinks = document.querySelectorAll("[data-drawer-link]");
const contactModal = document.querySelector("[data-contact-modal]");
const gateModal = document.querySelector("[data-gate-modal]");

let activeGameId = games.find((game) => !isUnavailable(game))?.id || games[0]?.id || "";
let selectedProductKey = "";
let priceObserver = null;
let tickTimer = null;
let offlineGateDismissed = false;
let bannerDismissed = false;

function formatProductKey(gameId, productName) {
  return `${gameId}:${productName}`;
}

function getActiveGame() {
  return games.find((game) => game.id === activeGameId) || games[0] || null;
}

function getSelectedProduct() {
  const game = getActiveGame();
  if (!game) return null;
  return game.products.find((product) => formatProductKey(game.id, product.name) === selectedProductKey) || null;
}

function setHeaderState() {
  header.classList.toggle("is-scrolled", window.scrollY > 10);
}

function ensureActiveGame() {
  if (games.some((game) => game.id === activeGameId && !isUnavailable(game))) return;
  activeGameId = games.find((game) => !isUnavailable(game))?.id || games[0]?.id || "";
  selectedProductKey = "";
}

function renderSettingsText() {
  const brandName = settings.brandName || "GlacierStore";
  document.title = `${brandName} - Top Up Game`;
  document.querySelectorAll("[data-brand], [data-brand-inline], [data-brand-footer]").forEach((node) => {
    const logoImg = node.querySelector("img");
    if (logoImg) {
      logoImg.alt = brandName;
      return;
    }
    node.textContent = brandName;
  });

  const hours = settings.adminHours || {};
  document.querySelector("[data-footer-hours]").textContent = `Admin ${hours.open || "08:00"} - ${hours.close || "22:00"}`;
  document.querySelector("[data-footer-disclaimer]").textContent =
    hours.disclaimer || "Jam Operasional bisa berubah sewaktu waktu";

  const banner = settings.infoBanner || {};
  const bannerNode = document.querySelector("[data-info-banner]");
  bannerNode.hidden = !banner.enabled || bannerDismissed;
  if (typeof updateBannerHeight === "function") updateBannerHeight();
  document.querySelector("[data-info-message]").textContent = String(banner.message || "")
    .replaceAll("{open}", hours.open || "08:00")
    .replaceAll("{close}", hours.close || "22:00")
    .replaceAll("{maintenance_start}", settings.systemMaintenance?.start ? formatTimeOnly(settings.systemMaintenance.start) : "00:00")
    .replaceAll("{maintenance_end}", settings.systemMaintenance?.end ? formatTimeOnly(settings.systemMaintenance.end) : "04:00");
}

function renderOperationalStatus() {
  const state = getOperationalState();
  const hours = settings.adminHours || {};
  const adminStatus = document.querySelector("[data-admin-status]");
  const heroStatus = document.querySelector("[data-hero-status]");
  const content = state.online
    ? `
      <strong><span class="dot is-online"></span>Admin: Online</strong>
      <small>(${state.open} - ${state.close})</small>
      <em>${escapeHtml(hours.disclaimer || "Jam Operasional bisa berubah sewaktu waktu")}</em>
    `
    : `
      <strong><span class="dot is-offline"></span>Admin: Offline</strong>
      <small>Buka kembali dalam:</small>
      <b>${formatDuration(state.nextOpen - new Date())}</b>
      <em>${escapeHtml(hours.disclaimer || "Jam Operasional bisa berubah sewaktu waktu")}</em>
    `;

  adminStatus.innerHTML = content;
  heroStatus.innerHTML = content;

  const lastOrderNote = document.querySelector("[data-last-order-note]");
  const lastOrderMinutes = Number(hours.lastOrderMinutes) || 0;
  const withinLastOrderWindow =
    hours.lastOrderEnabled &&
    state.online &&
    lastOrderMinutes > 0 &&
    minutesUntilClose(hours, new Date()) <= lastOrderMinutes;
  lastOrderNote.textContent = withinLastOrderWindow ? hours.lastOrderMessage || "" : "";

  if (!state.online && hours.autoOffline && hours.showCountdown && !offlineGateDismissed) {
    if (!gateModal.classList.contains("is-open")) {
      openGate("Admin sedang offline", "Kami akan buka kembali dalam:", state.nextOpen, false);
    } else if (!gateChainToContact) {
      updateGateCountdown(state.nextOpen);
    }
  }
}

function renderGames() {
  ensureActiveGame();
  gameGrid.innerHTML = games
    .map((game) => {
      const disabled = isUnavailable(game);
      const comingSoon = isComingSoon(game);
      const activeClass = game.id === activeGameId ? " is-active" : "";
      const unavailableClass = disabled ? (comingSoon ? " is-coming-soon" : " is-unavailable") : "";
      const colors = `--game-a: ${game.colors?.[0] || "#0b8f87"}; --game-b: ${game.colors?.[1] || "#d97912"};`;
      const badge = disabled ? `<span class="status-badge">${escapeHtml(statusText(game, "Gangguan"))}</span>` : "";
      const thumb = game.imageUrl
        ? `<span class="game-thumb has-image" aria-hidden="true"><img src="${escapeHtml(game.imageUrl)}" alt="" loading="lazy" /></span>`
        : `<span class="game-thumb" aria-hidden="true">${escapeHtml(game.initials || "GS")}</span>`;

      return `
        <button class="game-card${activeClass}${unavailableClass}" type="button" data-game-id="${escapeHtml(game.id)}" aria-pressed="${game.id === activeGameId}" ${disabled ? "disabled" : ""} style="${colors}">
          ${badge}
          ${thumb}
          <span class="game-name">${escapeHtml(game.name)}</span>
          <span class="game-note">${escapeHtml(disabled ? (comingSoon ? "Segera Hadir" : statusText(game, "Gangguan")) : game.from)}</span>
        </button>
      `;
    })
    .join("");
}

function renderPrices(animate = true) {
  ensureActiveGame();
  const activeGame = getActiveGame();

  if (!activeGame) {
    selectedGameName.textContent = "Game";
    priceGrid.innerHTML = '<p class="empty-state">Belum ada game yang tersedia.</p>';
    updateCheckout();
    return;
  }

  selectedGameName.textContent = activeGame.name;

  if (isUnavailable(activeGame)) {
    priceGrid.innerHTML = isComingSoon(activeGame)
      ? `<p class="empty-state">${escapeHtml(activeGame.name)} akan segera hadir di GlacierStore. Nantikan ya!</p>`
      : `<p class="empty-state">${escapeHtml(activeGame.name)} sedang ${statusText(activeGame, "gangguan")}. Cek lagi nanti atau hubungi admin.</p>`;
    updateCheckout();
    return;
  }

  if (!activeGame.products.length) {
    priceGrid.innerHTML = '<p class="empty-state">Belum ada harga untuk game ini. Hubungi admin untuk cek ketersediaan.</p>';
    updateCheckout();
    return;
  }

  const firstAvailableProduct = activeGame.products.find((product) => !isUnavailable(product));
  const selectedStillValid = activeGame.products.some((product) => {
    return formatProductKey(activeGame.id, product.name) === selectedProductKey && !isUnavailable(product);
  });

  if (!selectedStillValid) {
    selectedProductKey = firstAvailableProduct ? formatProductKey(activeGame.id, firstAvailableProduct.name) : "";
  }

  priceGrid.innerHTML = activeGame.products
    .map((product, index) => {
      const key = formatProductKey(activeGame.id, product.name);
      const disabled = isUnavailable(product);
      const selectedClass = key === selectedProductKey ? " is-selected" : "";
      const unavailableClass = disabled ? " is-unavailable" : "";
      const statusBadge = disabled
        ? `<span class="status-badge price-status">${escapeHtml(statusText(product, "Gangguan"))}</span>`
        : "";
      const promoMarkup = product.promo
        ? `
          <span class="promo-badge">${escapeHtml(product.promoBadge || "PROMO")}</span>
          <h3>${escapeHtml(product.name)}</h3>
          <p class="price-normal">${escapeHtml(product.normal || product.sellingPrice || product.price)}</p>
          <p class="price-promo">${escapeHtml(product.price)}</p>
        `
        : `
          <h3>${escapeHtml(product.name)}</h3>
          <p class="price-value">${escapeHtml(product.price)}</p>
        `;

      return `
        <button class="price-card${selectedClass}${unavailableClass}" type="button" data-product-key="${escapeHtml(key)}" ${disabled ? "disabled" : ""} style="--stagger: ${index * 35}ms">
          ${statusBadge}
          ${promoMarkup}
        </button>
      `;
    })
    .join("");

  updateCheckout();
  observePriceCards(animate);
}

function updateCheckout() {
  const game = getActiveGame();
  const product = getSelectedProduct();
  document.querySelector("[data-order-game]").textContent = game?.name || "-";
  document.querySelector("[data-order-product]").textContent = product?.name || "-";
  document.querySelector("[data-order-price]").textContent = product?.price || "-";
}

function observePriceCards(animate) {
  const cards = [...document.querySelectorAll(".price-card")];
  if (priceObserver) priceObserver.disconnect();

  if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cards.forEach((card) => card.classList.add("is-visible"));
    return;
  }

  priceObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        cards.forEach((card) => {
          card.style.animationDelay = card.style.getPropertyValue("--stagger");
          card.classList.add("is-visible");
        });
        observer.disconnect();
      });
    },
    { threshold: 0.15 }
  );

  cards.forEach((card) => priceObserver.observe(card));
}

function switchGame(gameId, card) {
  if (card.disabled) return;
  card.classList.remove("is-popping");
  void card.offsetWidth;
  card.classList.add("is-popping");

  if (gameId === activeGameId) return;
  activeGameId = gameId;
  selectedProductKey = "";
  document.querySelectorAll(".game-card").forEach((item) => {
    const isActive = item.dataset.gameId === activeGameId;
    item.classList.toggle("is-active", isActive);
    item.setAttribute("aria-pressed", String(isActive));
  });

  priceGrid.classList.add("is-switching");
  window.setTimeout(() => {
    renderPrices(false);
    priceGrid.classList.remove("is-switching");
    window.setTimeout(() => {
      document.querySelectorAll(".price-card").forEach((item) => item.classList.add("is-visible"));
    }, 30);
  }, 150);

  updateZoneIdVisibility();
}

function updateZoneIdVisibility() {
  const field = document.querySelector("[data-zone-id-field]");
  if (!field) return;
  const needsZoneId = activeGameId === "mobile-legends";
  field.hidden = !needsZoneId;
  if (!needsZoneId) {
    const input = document.querySelector("[data-zone-id]");
    if (input) input.value = "";
  }
}

function showContactModal() {
  const game = getActiveGame();
  const product = getSelectedProduct();
  const userId = document.querySelector("[data-user-id]").value.trim() || "-";
  const zoneIdField = document.querySelector("[data-zone-id-field]");
  const showsZoneId = zoneIdField && !zoneIdField.hidden;
  const zoneId = showsZoneId ? (document.querySelector("[data-zone-id]").value.trim() || "-") : "";
  const zoneLine = showsZoneId ? `\nZone ID: ${zoneId}` : "";
  const message = encodeURIComponent(
    `Halo admin ${settings.brandName || "GlacierStore"}, saya mau top up.\nGame: ${game?.name || "-"}\nNominal: ${product?.name || "-"}\nHarga: ${product?.price || "-"}\nUser ID: ${userId}${zoneLine}`
  );
  document.querySelector("[data-contact-wa]").href = `https://wa.me/${settings.whatsappNumber || "6281234567890"}?text=${message}`;
  document.querySelector("[data-contact-telegram]").href = `https://t.me/${settings.telegramUsername || "iptstore_id"}?text=${message}`;
  contactModal.classList.add("is-open");
  contactModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");
}

function showUserIdError() {
  const input = document.querySelector("[data-user-id]");
  const note  = document.querySelector("[data-last-order-note]");
  if (!input) return;

  // tampilkan pesan error di bawah tombol (pakai elemen yang sama dengan last order note)
  const prev = note?.textContent || "";
  if (note) {
    note.textContent = "⚠ Masukkan User ID kamu dulu sebelum melanjutkan.";
    note.classList.add("uid-error-note");
  }

  // highlight input
  input.classList.add("uid-input-error");
  input.focus();

  // shake animasi
  input.classList.add("uid-shake");
  input.addEventListener("animationend", () => input.classList.remove("uid-shake"), { once: true });

  // hilangkan error saat user mulai ngetik
  const clearError = () => {
    input.classList.remove("uid-input-error");
    if (note) {
      note.classList.remove("uid-error-note");
      if (note.textContent.startsWith("⚠")) note.textContent = "";
    }
    input.removeEventListener("input", clearError);
  };
  input.addEventListener("input", clearError);
}

function openContactModal() {
  // Validasi User ID dulu
  const userIdVal = document.querySelector("[data-user-id]")?.value.trim();
  if (!userIdVal) {
    showUserIdError();
    return;
  }

  const maintenanceActive = isGlobalMaintenanceActive();
  if (maintenanceActive) {
    showMaintenanceGate();
    return;
  }
  
  const state = getOperationalState();
  const hours = settings.adminHours || {};
  
  const shouldShowOfflineGate = 
    (!state.online && hours.autoOffline) || 
    (hours.manualClosed === true);

  if (shouldShowOfflineGate) {
    openGate(
      "Admin sedang offline",
      "Kamu tetap bisa menghubungi admin, tapi pesanan diproses saat admin online.",
      state.nextOpen,
      false,
      { chainToContact: true }
    );
    return;
  }

  showContactModal();
}

function closeContactModal() {
  contactModal.classList.remove("is-open");
  contactModal.setAttribute("aria-hidden", "true");
  if (!gateModal.classList.contains("is-open")) document.body.classList.remove("is-locked");
}

let gateChainToContact = false;

function openGate(title, message, untilDate, locked, options = {}) {
  gateChainToContact = Boolean(options.chainToContact);
  document.querySelector("[data-gate-title]").textContent = title;
  document.querySelector("[data-gate-message]").textContent = message;
  document.querySelector("[data-gate-modal]").classList.toggle("is-locked-gate", locked);
  
  const urgentBtn = document.querySelector("[data-urgent-contact]");
  if (urgentBtn) {
    const maintenance = settings.systemMaintenance || {};
    if (maintenance.contactUrgent === false) {
      urgentBtn.style.display = "none";
    } else {
      urgentBtn.style.display = "";
    }
  }

  gateModal.classList.add("is-open");
  gateModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");

  // ✅ PAKSA COUNTDOWN BERJALAN SETIAP DETIK
  if (untilDate) {
    // Hapus interval lama kalau ada
    if (window.gateCountdownInterval) {
      clearInterval(window.gateCountdownInterval);
    }
    // Jalankan update pertama
    updateGateCountdown(untilDate);
    // Set interval setiap 1 detik
    window.gateCountdownInterval = setInterval(() => {
      updateGateCountdown(untilDate);
    }, 1000);
  } else {
    document.querySelector("[data-gate-countdown]").textContent = "--:--:--";
  }
}

function updateGateCountdown(untilDate) {
  const node = document.querySelector("[data-gate-countdown]");
  if (!untilDate) {
    node.textContent = "--:--:--";
    return;
  }
  node.textContent = formatDuration(new Date(untilDate) - new Date());
}

function closeGate() {
  // Hapus interval saat popup ditutup
  if (window.gateCountdownInterval) {
    clearInterval(window.gateCountdownInterval);
    window.gateCountdownInterval = null;
  }
  
  if (gateModal.classList.contains("is-locked-gate")) return;
  offlineGateDismissed = true;
  gateModal.classList.remove("is-open");
  gateModal.setAttribute("aria-hidden", "true");
  if (!contactModal.classList.contains("is-open")) document.body.classList.remove("is-locked");

  if (gateChainToContact) {
    gateChainToContact = false;
    showContactModal();
  }
}

function showMaintenanceGate() {
  const maintenance = settings.systemMaintenance || {};
  openGate(
    "Kami sedang melakukan pemeliharaan sistem",
    maintenance.message || "Website sedang dalam pemeliharaan.",
    maintenance.end,
    true
  );
  const urgentBtn = document.querySelector("[data-urgent-contact]");
  if (urgentBtn) {
    if (maintenance.contactUrgent === false) {
      urgentBtn.style.display = "none";
    } else {
      urgentBtn.style.display = "";
    }
  }
}

function openDrawer() {
  drawer.classList.add("is-open");
  drawerOverlay.classList.add("is-open");
  menuToggle.setAttribute("aria-expanded", "true");
  document.body.classList.add("is-locked");
}

function closeDrawer() {
  drawer.classList.remove("is-open");
  drawerOverlay.classList.remove("is-open");
  menuToggle.setAttribute("aria-expanded", "false");
  if (!contactModal.classList.contains("is-open") && !gateModal.classList.contains("is-open")) {
    document.body.classList.remove("is-locked");
  }
}

function toggleDrawer() {
  drawer.classList.contains("is-open") ? closeDrawer() : openDrawer();
}

function startTicker() {
  window.clearInterval(tickTimer);
  tickTimer = window.setInterval(() => {
    renderOperationalStatus();
    if (isGlobalMaintenanceActive()) showMaintenanceGate();
  }, 1000);
}

function updateBannerHeight() {
  const banner = document.querySelector("[data-info-banner]");
  const h = (!banner || banner.hidden) ? 0 : banner.getBoundingClientRect().height;
  document.documentElement.style.setProperty("--banner-h", h + "px");
}

const bannerResizeObserver = new ResizeObserver(updateBannerHeight);
const bannerEl = document.querySelector("[data-info-banner]");
if (bannerEl) bannerResizeObserver.observe(bannerEl);
updateBannerHeight();

window.addEventListener("scroll", setHeaderState, { passive: true });

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    games = readStoredGames();
    renderGames();
    renderPrices(false);
  }
  if (event.key === SETTINGS_KEY) {
    const prevEnabled = settings.infoBanner?.enabled;
    settings = readSettings();
    if (!prevEnabled && settings.infoBanner?.enabled) {
      bannerDismissed = false;
    }
    renderSettingsText();
    renderOperationalStatus();
    if (isGlobalMaintenanceActive()) showMaintenanceGate();
  }
});

gameGrid.addEventListener("click", (event) => {
  const card = event.target.closest(".game-card");
  if (!card || card.disabled) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--tap-x", `${event.clientX - rect.left}px`);
  card.style.setProperty("--tap-y", `${event.clientY - rect.top}px`);
  switchGame(card.dataset.gameId, card);
});

priceGrid.addEventListener("click", (event) => {
  const card = event.target.closest(".price-card");
  if (!card || card.disabled) return;
  selectedProductKey = card.dataset.productKey;
  document.querySelectorAll(".price-card").forEach((item) => {
    item.classList.toggle("is-selected", item.dataset.productKey === selectedProductKey);
  });
  updateCheckout();
});

document.querySelector("[data-open-contact]").addEventListener("click", openContactModal);
document.querySelector("[data-close-contact]").addEventListener("click", closeContactModal);
document.querySelector("[data-close-gate]").addEventListener("click", closeGate);
document.querySelector("[data-urgent-contact]").addEventListener("click", (event) => {
  event.preventDefault();
  showContactModal();
});
document.querySelector("[data-close-banner]").addEventListener("click", () => {
  bannerDismissed = true;
  document.querySelector("[data-info-banner]").hidden = true;
  updateBannerHeight();
});

contactModal.addEventListener("click", (event) => {
  if (event.target === contactModal) closeContactModal();
});

menuToggle.addEventListener("click", toggleDrawer);
drawerOverlay.addEventListener("click", closeDrawer);
drawerLinks.forEach((link) => link.addEventListener("click", closeDrawer));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeContactModal();
    closeGate();
    closeDrawer();
  }
});

setHeaderState();
renderSettingsText();
renderOperationalStatus();
renderGames();
renderPrices(true);
updateZoneIdVisibility();
if (isGlobalMaintenanceActive()) showMaintenanceGate();
startTicker();


document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener("click", function(e) {
    const href = this.getAttribute("href");
    if (href === "#") return;
    if (!href.startsWith("#")) return; 
    e.preventDefault();
    const targetElement = document.querySelector(href);
    if (targetElement) {
      const headerHeight = document.querySelector(".site-header")?.offsetHeight || 64;
      const topPosition = targetElement.getBoundingClientRect().top + window.scrollY - headerHeight;
      window.scrollTo({ top: topPosition, behavior: "smooth" });
    }
  });
});