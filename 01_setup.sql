-- ============================================================
-- GlacierStore — Supabase Setup: Tabel + RLS + Auth
-- ============================================================
-- Cara pakai:
-- 1. Buka project Supabase kamu → SQL Editor → New Query
-- 2. Copy-paste seluruh isi file ini → Run
-- 3. Lanjut ke langkah "Buat Akun Admin Pertama" di bagian paling bawah file ini
-- ============================================================

-- Ekstensi untuk generate UUID
create extension if not exists "pgcrypto";

-- ============================================================
-- 1) TABEL: admins
--    Menentukan siapa saja yang boleh masuk ke admin panel.
--    Terhubung ke auth.users bawaan Supabase Auth via kolom id.
-- ============================================================
create table if not exists public.admins (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  role        text not null default 'admin' check (role in ('admin','owner')),
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 2) TABEL: games
-- ============================================================
create table if not exists public.games (
  id           text primary key,               -- slug, mis. "free-fire"
  name         text not null,
  initials     text,
  image_url    text default '',
  from_label   text default 'Cek admin',
  color_a      text default '#0b8f87',
  color_b      text default '#d97912',
  status       text not null default 'normal' check (status in ('normal','maintenance','gangguan','segera-hadir')),
  maintenance  jsonb not null default '{}'::jsonb,
  sort_order   int not null default 0,
  featured     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.admins(id),
  updated_by   uuid references public.admins(id)
);

-- Migrasi: kalau tabel games sudah lebih dulu dibuat (sebelum status
-- "segera-hadir" ditambahkan), constraint lama perlu diperbarui juga.
-- Aman dijalankan ulang (idempotent) meski tabel baru saja dibuat di atas.
alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check
  check (status in ('normal','maintenance','gangguan','segera-hadir'));

-- ============================================================
-- 3) TABEL: products
-- ============================================================
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  game_id        text not null references public.games(id) on delete cascade,
  name           text not null,
  category       text default '',
  cost_price     text default '',
  selling_price  text default '',
  promo_price    text default '',
  promo          boolean not null default false,
  promo_badge    text default '',
  promo_start    timestamptz,
  promo_end      timestamptz,
  status         text not null default 'normal' check (status in ('normal','soldout','gangguan')),
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.admins(id),
  updated_by     uuid references public.admins(id)
);

create index if not exists products_game_id_idx on public.products(game_id);

-- ============================================================
-- 4) TABEL: settings (key/value, untuk brandName, jam operasional, dll)
-- ============================================================
create table if not exists public.settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.admins(id)
);

-- ============================================================
-- 5) TABEL: logs (activity log — siapa mengubah apa, kapan)
-- ============================================================
create table if not exists public.logs (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references public.admins(id),
  action      text not null,        -- contoh: 'update_price', 'delete_product', 'toggle_status'
  target      text not null,        -- contoh: 'games/free-fire' atau 'products/<uuid>'
  detail      jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 6) Trigger otomatis: update updated_at setiap kali baris diubah
-- ============================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_games_updated_at on public.games;
create trigger trg_games_updated_at
  before update on public.games
  for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists trg_settings_updated_at on public.settings;
create trigger trg_settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ============================================================
-- 7) ROW LEVEL SECURITY (RLS)
--    Aturan: semua orang boleh SELECT (baca) games & products,
--    tapi hanya admin terdaftar yang boleh INSERT/UPDATE/DELETE.
-- ============================================================

alter table public.games    enable row level security;
alter table public.products enable row level security;
alter table public.settings enable row level security;
alter table public.admins   enable row level security;
alter table public.logs     enable row level security;

-- Helper: cek apakah user yang sedang login terdaftar sebagai admin
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.admins where id = auth.uid()
  );
$$ language sql stable security definer;

-- ── games: baca boleh semua orang (termasuk pengunjung anonim) ──
drop policy if exists "games_select_public" on public.games;
create policy "games_select_public"
  on public.games for select
  using (true);

drop policy if exists "games_write_admin_only" on public.games;
create policy "games_write_admin_only"
  on public.games for insert
  with check (public.is_admin());

drop policy if exists "games_update_admin_only" on public.games;
create policy "games_update_admin_only"
  on public.games for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "games_delete_admin_only" on public.games;
create policy "games_delete_admin_only"
  on public.games for delete
  using (public.is_admin());

-- ── products: sama seperti games ──
drop policy if exists "products_select_public" on public.products;
create policy "products_select_public"
  on public.products for select
  using (true);

drop policy if exists "products_write_admin_only" on public.products;
create policy "products_write_admin_only"
  on public.products for insert
  with check (public.is_admin());

drop policy if exists "products_update_admin_only" on public.products;
create policy "products_update_admin_only"
  on public.products for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "products_delete_admin_only" on public.products;
create policy "products_delete_admin_only"
  on public.products for delete
  using (public.is_admin());

-- ── settings: baca boleh semua (untuk brandName, jam operasional dsb tampil di landing page) ──
drop policy if exists "settings_select_public" on public.settings;
create policy "settings_select_public"
  on public.settings for select
  using (true);

drop policy if exists "settings_write_admin_only" on public.settings;
create policy "settings_write_admin_only"
  on public.settings for insert
  with check (public.is_admin());

drop policy if exists "settings_update_admin_only" on public.settings;
create policy "settings_update_admin_only"
  on public.settings for update
  using (public.is_admin())
  with check (public.is_admin());

-- ── admins: hanya admin yang login boleh melihat daftar admin (tidak untuk publik) ──
drop policy if exists "admins_select_admin_only" on public.admins;
create policy "admins_select_admin_only"
  on public.admins for select
  using (public.is_admin());

-- Catatan: sengaja TIDAK ada policy insert/update/delete untuk admins di sini.
-- Menambah admin baru dilakukan manual lewat SQL Editor oleh kamu sendiri (lihat langkah di bawah),
-- supaya tidak ada celah orang mendaftarkan diri sendiri jadi admin dari sisi frontend.

-- ── logs: hanya admin yang boleh baca & tulis log ──
drop policy if exists "logs_select_admin_only" on public.logs;
create policy "logs_select_admin_only"
  on public.logs for select
  using (public.is_admin());

drop policy if exists "logs_insert_admin_only" on public.logs;
create policy "logs_insert_admin_only"
  on public.logs for insert
  with check (public.is_admin());

-- ============================================================
-- 8) Data awal untuk settings (opsional, sesuaikan dengan data.js kamu)
-- ============================================================
insert into public.settings (key, value)
values (
  'site_settings',
  '{
    "brandName": "GlacierStore",
    "whatsappNumber": "6281234567890",
    "telegramUsername": "iptstore_id",
    "adminHours": {
      "open": "08:00",
      "close": "22:00",
      "autoOffline": true,
      "manualClosed": false,
      "showCountdown": true,
      "disclaimer": "Jam Operasional bisa berubah sewaktu waktu",
      "lastOrderEnabled": true,
      "lastOrderMinutes": 15,
      "lastOrderMessage": "Last Order: Selesaikan pesananmu sekarang!"
    },
    "systemMaintenance": {
      "enabled": false,
      "start": "",
      "end": "",
      "message": "Website sedang dalam pemeliharaan sistem. Silakan kembali setelah pemeliharaan selesai.",
      "contactUrgent": true
    },
    "infoBanner": {
      "enabled": true,
      "message": "Informasi: Pemeliharaan rutin setiap hari pukul {maintenance_start} - {maintenance_end}. Jam operasional transaksi: {open} - {close}."
    }
  }'::jsonb
)
on conflict (key) do nothing;

-- ============================================================
-- SELESAI menjalankan SQL di atas. Langkah selanjutnya MANUAL:
-- ============================================================
--
-- LANGKAH A — Buat akun admin pertama:
--   1. Buka Supabase Dashboard → Authentication → Users → "Add user"
--   2. Isi email & password admin kamu, lalu Create user
--   3. Copy "User UID" yang muncul di daftar user tersebut
--   4. Kembali ke SQL Editor, jalankan (ganti dengan email & UID kamu):
--
--      insert into public.admins (id, email, role)
--      values ('TEMPEL-USER-UID-DI-SINI', 'emailkamu@gmail.com', 'owner');
--
--   Tanpa baris ini, walau akun bisa login, dia TIDAK dianggap admin
--   oleh RLS (is_admin() akan return false), jadi tidak bisa insert/update/delete apa pun.
--
-- LANGKAH B — Ambil kredensial untuk frontend:
--   Project Settings → API →
--     - "Project URL"      → jadi SUPABASE_URL
--     - "anon public" key  → jadi SUPABASE_ANON_KEY
--   Dua nilai ini AMAN ditaruh di frontend (bukan service_role key!),
--   karena semua akses tetap ditahan oleh RLS di atas.
--
-- LANGKAH C — Simpan sebagai Environment Variable di Vercel, BUKAN hardcode di JS:
--     NEXT_PUBLIC_SUPABASE_URL / VITE_SUPABASE_URL / dst (sesuai tooling kamu)
--     NEXT_PUBLIC_SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY / dst
--
-- JANGAN PERNAH menyimpan "service_role" key di file .js/.html manapun.
-- ============================================================