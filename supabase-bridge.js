// ─────────────────────────────────────────────
//  GlacierStore — supabase-bridge.js
// ─────────────────────────────────────────────
(function () {
  const STORAGE_KEY  = window.GLACIERCODE_STORAGE_KEY  || "glaciercode_catalog_v1";
  const SETTINGS_KEY = window.GLACIERCODE_SETTINGS_KEY || "glaciercode_site_settings_v1";

  function toLocalISO(v) {
    if (!v) return null;
    const d = new Date(v);
    if (isNaN(d)) return null;
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
    const mm2 = String(Math.abs(off) % 60).padStart(2, "0");
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm2}`;
  }

  function fromSupabaseDate(v) {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d)) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function scPullCatalog() {
    const sb = window.supabaseClient;
    const [gamesRes, productsRes, settingsRes] = await Promise.all([
      sb.from("games").select("*").order("sort_order"),
      sb.from("products").select("*").order("sort_order"),
      sb.from("settings").select("value").eq("key", "site_settings").maybeSingle(),
    ]);
    if (gamesRes.error) throw gamesRes.error;
    if (!gamesRes.data || !gamesRes.data.length) return false;

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
          supplierId: p.supplier_id || "",
        })),
    }));

    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
    if (settingsRes.data && settingsRes.data.value) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsRes.data.value));
    }
    return true;
  }

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
          supplier_id: p.supplierId || null,
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

  let gamesPushChain = Promise.resolve();
  let pendingGamesState = null;

  function scPushCatalogSafe(games) {
    pendingGamesState = games;
    gamesPushChain = gamesPushChain
      .then(async () => {
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
      supplier_id: p.supplierId || null,
    }));
    if (productRows.length) {
      const { error: pErr } = await sb.from("products").insert(productRows);
      if (pErr) throw pErr;
    }
  }

  window.scPushSingleGame = scPushSingleGame;

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

  async function scPushOrder(order) {
    const sb = window.supabaseClient;
    const { error } = await sb.from("sales").insert({
      order_id: order.orderId,
      date: order.date,
      game_id: order.gameId,
      game_name: order.gameName,
      product_name: order.productName,
      price_value: order.priceValue,
      cost_value: order.costValue,
      profit_value: order.profitValue,
      buyer: order.buyer,
      nick: order.nick,
      ref: order.ref,
      qr_text: order.qrText,
      supplier_name: order.supplierName || "",
    });
    if (error) throw error;
  }

  async function scPullOrders() {
    const sb = window.supabaseClient;
    const { data, error } = await sb.from("sales").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    if (data && data.length) {
      const formatted = data.map(o => ({
        orderId: o.order_id,
        date: o.date,
        gameId: o.game_id,
        gameName: o.game_name,
        productName: o.product_name,
        priceValue: Number(o.price_value),
        costValue: Number(o.cost_value),
        profitValue: Number(o.profit_value),
        buyer: o.buyer || "",
        nick: o.nick || "",
        ref: o.ref || "",
        qrText: o.qr_text || "",
        createdAt: o.created_at,
      }));
      localStorage.setItem(window.GLACIERCODE_ORDERS_KEY || "glaciercode_orders_v1", JSON.stringify(formatted));
      return true;
    }
    return false;
  }

  window.scPushOrder = scPushOrder;
  window.scPullOrders = scPullOrders;

  async function scPullSuppliers() {
    const sb = window.supabaseClient;
    const { data, error } = await sb.from("suppliers").select("*").order("sort_order");
    if (error) throw error;
    if (data && data.length) {
      const formatted = data.map(s => ({
        id: s.id,
        name: s.name,
        sort_order: s.sort_order || 0,
      }));
      localStorage.setItem("glaciercode_suppliers_v1", JSON.stringify(formatted));
      return true;
    }
    return false;
  }

  async function scPushSuppliers(supplierList) {
    const sb = window.supabaseClient;
    const rows = supplierList.map((s, i) => ({
      id: s.id,
      name: s.name,
      sort_order: i,
    }));
    if (rows.length) {
      const { error } = await sb.from("suppliers").upsert(rows, { onConflict: "id" });
      if (error) {
        console.error("scPushSuppliers upsert error:", error);
        throw error;
      }
    }
    // hapus supplier yang sudah tidak ada di list lokal
    const keepIds = rows.map(r => r.id);
    const { data: existing, error: selErr } = await sb.from("suppliers").select("id");
    if (selErr) { console.warn("scPushSuppliers: gagal fetch existing:", selErr); return; }
    const stale = (existing || []).map(r => r.id).filter(id => !keepIds.includes(id));
    if (stale.length) {
      const { error: delErr } = await sb.from("suppliers").delete().in("id", stale);
      if (delErr) console.warn("scPushSuppliers: gagal hapus stale:", delErr);
    }
  }

  window.scPullSuppliers = scPullSuppliers;
  window.scPushSuppliers = scPushSuppliers;

  // ─── REALTIME SYNC ───────────────────────────────────────────
  // Subscribe ke perubahan tabel games, products, sales, suppliers, settings.
  // Setiap ada perubahan → pull ulang data terkait → update localStorage
  // → panggil callback onSync(table) agar admin.js bisa re-render.
  let realtimeChannel = null;

  async function scPullAll() {
    await scPullCatalog().catch(e => console.warn("Realtime: gagal pull catalog:", e));
    await scPullOrders().catch(e => console.warn("Realtime: gagal pull orders:", e));
    await scPullSuppliers().catch(e => console.warn("Realtime: gagal pull suppliers:", e));
  }

  function scStartRealtime(onSync) {
    const sb = window.supabaseClient;

    // Debounce: tunda 600ms agar burst changes hanya trigger 1x pull
    let debounceTimer = null;
    function scheduleSync(table) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        console.log("Realtime: perubahan terdeteksi di", table, "— pull ulang...");
        await scPullAll();
        if (typeof onSync === "function") onSync(table);
      }, 600);
    }

    realtimeChannel = sb
      .channel("glacierstore-admin-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "games" },
        () => scheduleSync("games"))
      .on("postgres_changes", { event: "*", schema: "public", table: "products" },
        () => scheduleSync("products"))
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" },
        () => scheduleSync("sales"))
      .on("postgres_changes", { event: "*", schema: "public", table: "suppliers" },
        () => scheduleSync("suppliers"))
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" },
        () => scheduleSync("settings"))
      .subscribe((status) => {
        console.log("Realtime status:", status);
      });

    return realtimeChannel;
  }

  function scStopRealtime() {
    if (realtimeChannel) {
      window.supabaseClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  window.scStartRealtime = scStartRealtime;
  window.scStopRealtime  = scStopRealtime;
  window.scPullAll       = scPullAll;

  async function scDeleteOrder(orderId) {
    const sb = window.supabaseClient;
    const { error } = await sb.from("sales").delete().eq("order_id", orderId);
    if (error) throw error;
  }
  window.scDeleteOrder = scDeleteOrder;
})();