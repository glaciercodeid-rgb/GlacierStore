// ─────────────────────────────────────────────
//  GlacierStore — supabase-bridge.js
//  Jembatan localStorage <-> Supabase.
//  Tidak mengubah logic bisnis di admin.js/script.js sama sekali —
//  cuma menyuntik data terbaru ke localStorage (pull) dan mendorong
//  balik perubahan ke Supabase (push, admin.html saja).
// ─────────────────────────────────────────────
(function () {
  const STORAGE_KEY  = window.GLACIERCODE_STORAGE_KEY  || "glaciercode_catalog_v1";
  const SETTINGS_KEY = window.GLACIERCODE_SETTINGS_KEY || "glaciercode_site_settings_v1";

  // Konversi string datetime lokal (dari <input type="datetime-local">, format "YYYY-MM-DDTHH:mm")
  // ke ISO string DENGAN offset timezone lokal browser, supaya Supabase (timestamptz)
  // menyimpan waktu yang benar — bukan diinterpretasikan sebagai UTC.
  // Contoh input WIB: "2026-07-09T00:05" -> "2026-07-09T00:05:00+07:00"
  function toLocalISO(v) {
    if (!v) return null;
    const d = new Date(v); // browser parse sebagai local time
    if (isNaN(d)) return null;
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
    const mm2 = String(Math.abs(off) % 60).padStart(2, "0");
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm2}`;
  }

  // Normalisasi datetime dari Supabase (ISO dengan offset) ke "YYYY-MM-DDTHH:mm" local time
  // supaya getPromoStatus() di script.js membandingkan apples-to-apples.
  function fromSupabaseDate(v) {
    if (!v) return "";
    const d = new Date(v); // Supabase kirim ISO+offset, new Date() parse ke local
    if (isNaN(d)) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Ambil data terbaru dari Supabase -> tulis ke localStorage dengan format
  // yang SAMA PERSIS seperti yang dipakai admin.js/script.js selama ini.
  // Kalau Supabase kosong/gagal diakses, localStorage tidak disentuh
  // (otomatis fallback ke data lama / DEFAULT_GAMES).
  async function scPullCatalog() {
    const sb = window.supabaseClient;
    const [gamesRes, productsRes, settingsRes] = await Promise.all([
      sb.from("games").select("*").order("sort_order"),
      sb.from("products").select("*").order("sort_order"),
      sb.from("settings").select("value").eq("key", "site_settings").maybeSingle(),
    ]);
    if (gamesRes.error) throw gamesRes.error;
    if (!gamesRes.data || !gamesRes.data.length) return false; // belum ada data -> biarkan default

    const products = productsRes.data || [];
    const games = gamesRes.data.map((g) => ({
      id: g.id,
      name: g.name,
      initials: g.initials || "",
      imageUrl: g.image_url || "",
      from: g.from_label || "Cek admin",
      colors: [g.color_a || "#0b8f87", g.color_b || "#d97912"],
      status: g.status || "normal",
      maintenance: g.maintenance || {},
      featured: !!g.featured,
      sortOrder: g.sort_order || 0,
      products: products
        .filter((p) => p.game_id === g.id)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((p) => ({
          _id: p.id,
          name: p.name,
          category: p.category || "",
          costPrice: p.cost_price || "",
          sellingPrice: p.selling_price || "",
          promoPrice: p.promo_price || "",
          price: p.promo ? p.promo_price || p.selling_price || "" : p.selling_price || "",
          normal: p.promo ? p.selling_price || "" : "",
          promo: !!p.promo,
          promoBadge: p.promo_badge || "",
          promoStart: fromSupabaseDate(p.promo_start),
          promoEnd:   fromSupabaseDate(p.promo_end),
          status: p.status || "normal",
          sortOrder: p.sort_order || 0,
        })),
    }));

    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
    if (settingsRes.data && settingsRes.data.value) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsRes.data.value));
    }
    return true;
  }

  // Dorong state `games` (dari admin.js) ke Supabase.
  // Strategi: upsert semua games, hapus game yang sudah tidak ada,
  // lalu replace total tabel products untuk game-game yang tersisa
  // (paling sederhana & aman, katalog cuma puluhan baris jadi murah).
  async function scPushCatalog(games) {
    const sb = window.supabaseClient;

    const gameRows = games.map((g, i) => ({
      id: g.id,
      name: g.name,
      initials: g.initials || "",
      image_url: g.imageUrl || "",
      from_label: g.from || "Cek admin",
      color_a: (g.colors && g.colors[0]) || "#0b8f87",
      color_b: (g.colors && g.colors[1]) || "#d97912",
      status: g.status || "normal",
      maintenance: g.maintenance || {},
      featured: !!g.featured,
      sort_order: i,
    }));
    const { error: gErr } = await sb.from("games").upsert(gameRows, { onConflict: "id" });
    if (gErr) throw gErr;

    const keepIds = gameRows.map((g) => g.id);
    const { data: existingGames } = await sb.from("games").select("id");
    const staleIds = (existingGames || []).map((g) => g.id).filter((id) => !keepIds.includes(id));
    if (staleIds.length) await sb.from("games").delete().in("id", staleIds);

    if (keepIds.length) await sb.from("products").delete().in("game_id", keepIds);
    const productRows = [];
    games.forEach((g) => {
      (g.products || []).forEach((p, i) => {
        productRows.push({
          game_id: g.id,
          name: p.name,
          category: p.category || "",
          cost_price: p.costPrice || "",
          selling_price: p.sellingPrice || p.price || "",
          promo_price: p.promoPrice || (p.promo ? p.price : "") || "",
          promo: !!p.promo,
          promo_badge: p.promoBadge || "",
          promo_start: toLocalISO(p.promoStart),
          promo_end:   toLocalISO(p.promoEnd),
          status: p.status || "normal",
          sort_order: i,
        });
      });
    });
    if (productRows.length) {
      const { error: pErr } = await sb.from("products").insert(productRows);
      if (pErr) throw pErr;
    }
  }

  async function scPushSettings(settings) {
    const { error } = await window.supabaseClient
      .from("settings")
      .upsert({ key: "site_settings", value: settings }, { onConflict: "key" });
    if (error) throw error;
  }

  // ─── ANTRIAN SERIAL untuk push (cegah race condition) ──────────
  // Masalah sebelumnya: scPushCatalog melakukan "hapus semua produk →
  // insert ulang semua". Kalau saveGames() dipanggil dua kali berturut-turut
  // dengan cepat (misal drag-reorder lalu langsung toggle status), DUA proses
  // push bisa jalan BERSAMAAN dan saling tabrakan — proses kedua bisa
  // menghapus data yang baru ditulis proses pertama sebelum sempat insert ulang,
  // membuat produk hilang sementara/permanen.
  //
  // Solusinya: setiap panggilan push masuk ke satu antrian yang dijalankan
  // SATU PER SATU (serial, tidak paralel). Kalau ada beberapa panggilan
  // menumpuk sebelum antrian sempat jalan, yang benar-benar dikirim ke
  // Supabase cuma STATE TERAKHIR (yang paling baru) — bukan berkali-kali
  // dengan data yang sudah usang. Ini disebut pola "coalescing queue".
  let gamesPushChain = Promise.resolve();
  let pendingGamesState = null;

  function scPushCatalogSafe(games) {
    // Simpan snapshot state terbaru. Kalau dipanggil lagi sebelum antrian
    // sempat jalan, snapshot ini akan DITIMPA oleh yang lebih baru —
    // otomatis "melompati" state lama yang sudah usang.
    pendingGamesState = games;

    gamesPushChain = gamesPushChain
      .then(async () => {
        // Ambil state terbaru yang tersedia SAAT giliran ini benar-benar jalan,
        // bukan state saat scPushCatalogSafe() dipanggil.
        if (pendingGamesState === null) return;
        const toPush = pendingGamesState;
        pendingGamesState = null;
        await scPushCatalog(toPush);
      })
      .catch((e) => {
        console.error("Gagal sync games ke Supabase:", e);
      });

    return gamesPushChain;
  }

  let settingsPushChain = Promise.resolve();
  let pendingSettingsState = null;

  function scPushSettingsSafe(settings) {
    pendingSettingsState = settings;

    settingsPushChain = settingsPushChain
      .then(async () => {
        if (pendingSettingsState === null) return;
        const toPush = pendingSettingsState;
        pendingSettingsState = null;
        await scPushSettings(toPush);
      })
      .catch((e) => {
        console.error("Gagal sync settings ke Supabase:", e);
      });

    return settingsPushChain;
  }

  // Push SATU game saja (game row + produk-produknya), tidak menyentuh
  // game lain sama sekali. Dipakai oleh sistem Draft/Antrian supaya tiap
  // "Update" hanya memengaruhi game yang benar-benar diubah.
  async function scPushSingleGame(game) {
    const sb = window.supabaseClient;

    const gameRow = {
      id: game.id,
      name: game.name,
      initials: game.initials || "",
      image_url: game.imageUrl || "",
      from_label: game.from || "Cek admin",
      color_a: (game.colors && game.colors[0]) || "#0b8f87",
      color_b: (game.colors && game.colors[1]) || "#d97912",
      status: game.status || "normal",
      maintenance: game.maintenance || {},
      featured: !!game.featured,
      sort_order: game.sortOrder || 0,
    };
    const { error: gErr } = await sb.from("games").upsert(gameRow, { onConflict: "id" });
    if (gErr) throw gErr;

    await sb.from("products").delete().eq("game_id", game.id);

    const productRows = (game.products || []).map((p, i) => ({
      game_id: game.id,
      name: p.name,
      category: p.category || "",
      cost_price: p.costPrice || "",
      selling_price: p.sellingPrice || p.price || "",
      promo_price: p.promoPrice || (p.promo ? p.price : "") || "",
      promo: !!p.promo,
      promo_badge: p.promoBadge || "",
      promo_start: toLocalISO(p.promoStart),
      promo_end:   toLocalISO(p.promoEnd),
      status: p.status || "normal",
      sort_order: i,
    }));
    if (productRows.length) {
      const { error: pErr } = await sb.from("products").insert(productRows);
      if (pErr) throw pErr;
    }
  }

  window.scPushSingleGame = scPushSingleGame;

  // Hapus satu game dari Supabase. Produk-produknya ikut terhapus otomatis
  // lewat "on delete cascade" di skema tabel products (lihat 01_setup.sql).
  async function scDeleteGame(gameId) {
    const sb = window.supabaseClient;
    const { error } = await sb.from("games").delete().eq("id", gameId);
    if (error) throw error;
  }

  window.scDeleteGame = scDeleteGame;

  window.scPullCatalog = scPullCatalog;
  window.scPushCatalog = scPushCatalog;
  window.scPushSettings = scPushSettings;
  window.scPushSettingsSafe = scPushSettingsSafe;
})();
