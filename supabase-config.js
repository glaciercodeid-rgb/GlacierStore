// ─── KONFIGURASI SUPABASE ──────────────────────────────────────
// URL project & publishable key ini AMAN ditaruh di file frontend publik —
// keduanya memang didesain untuk itu. Keamanan sebenarnya dijaga oleh Row
// Level Security (RLS) yang sudah diatur lewat 01_setup.sql (cuma admin
// terdaftar yang boleh insert/update/delete; publik cuma boleh baca).
//
// JANGAN PERNAH taruh "service_role" / "secret key" di file manapun yang
// ikut di-upload ke GitHub/Vercel — itu kunci yang melewati semua RLS.
window.SUPABASE_URL = "https://pkzbzgcjjyjfsvgzlrhs.supabase.co";
window.SUPABASE_KEY = "sb_publishable_aF0RD2p5xPGU8Eqa0zw2Iw_TZdJKcJV";

window.supabaseClient = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
