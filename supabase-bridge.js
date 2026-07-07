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
          promoStart: p.promo_start || "",
          promoEnd: p.promo_end || "",
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
          promo_start: p.promoStart || null,
          promo_end: p.promoEnd || null,
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

  window.scPushCatalogSafe = scPushCatalogSafe;
  window.scPushSettingsSafe = scPushSettingsSafe;

  window.scPullCatalog = scPullCatalog;
  window.scPushCatalog = scPushCatalog;
  window.scPushSettings = scPushSettings;
})();
