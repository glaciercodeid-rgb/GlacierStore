-- ============================================================
-- GlacierStore — Migration: Tabel Categories
-- Jalankan di Supabase SQL Editor → New Query → Run
-- ============================================================

-- 1) TABEL: categories
--    Daftar kategori produk (Diamonds, UC, Robux, dll) yang dikelola admin.
--    Disimpan sebagai simple list dengan sort_order untuk urutan dropdown.
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.admins(id)
);

-- RLS untuk categories: baca semua orang, tulis hanya admin
alter table public.categories enable row level security;

drop policy if exists "categories_select_public" on public.categories;
create policy "categories_select_public"
  on public.categories for select using (true);

drop policy if exists "categories_insert_admin" on public.categories;
create policy "categories_insert_admin"
  on public.categories for insert with check (public.is_admin());

drop policy if exists "categories_update_admin" on public.categories;
create policy "categories_update_admin"
  on public.categories for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "categories_delete_admin" on public.categories;
create policy "categories_delete_admin"
  on public.categories for delete using (public.is_admin());

-- 2) Data awal: kategori default yang sebelumnya hardcoded di HTML
--    Aman dijalankan ulang (on conflict do nothing = idempotent)
insert into public.categories (name, sort_order) values
  ('Diamonds',   0),
  ('UC',         1),
  ('Points',     2),
  ('Robux',      3),
  ('Crystal',    4),
  ('Shard',      5),
  ('CP',         6),
  ('Membership', 7),
  ('Bundle',     8)
on conflict (name) do nothing;

-- ============================================================
-- SELESAI. Tidak perlu langkah tambahan.
-- Setelah ini, jalankan aplikasi admin — dropdown kategori
-- di form produk akan otomatis terisi dari tabel ini.
-- ============================================================
