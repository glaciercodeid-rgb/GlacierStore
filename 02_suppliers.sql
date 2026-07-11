-- ============================================================
-- GlacierStore — Migration: Supplier + Sales RLS
-- Jalankan di Supabase SQL Editor → New Query → Run
-- ============================================================

-- 1) TABEL: suppliers
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.admins(id)
);

-- 2) Tambah kolom supplier_id ke products (nullable, 1 supplier per produk)
alter table public.products
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

-- 3) Tambah kolom supplier_name ke sales (snapshot nama saat transaksi dicatat)
alter table public.sales
  add column if not exists supplier_name text default '';

-- RLS untuk suppliers: baca semua orang, tulis hanya admin
alter table public.suppliers enable row level security;

drop policy if exists "suppliers_select_public" on public.suppliers;
create policy "suppliers_select_public"
  on public.suppliers for select using (true);

drop policy if exists "suppliers_insert_admin" on public.suppliers;
create policy "suppliers_insert_admin"
  on public.suppliers for insert with check (public.is_admin());

drop policy if exists "suppliers_update_admin" on public.suppliers;
create policy "suppliers_update_admin"
  on public.suppliers for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "suppliers_delete_admin" on public.suppliers;
create policy "suppliers_delete_admin"
  on public.suppliers for delete using (public.is_admin());

-- ============================================================
-- RLS untuk tabel sales
-- ============================================================
alter table public.sales enable row level security;

-- Hanya admin yang boleh baca catatan penjualan
drop policy if exists "sales_select_admin_only" on public.sales;
create policy "sales_select_admin_only"
  on public.sales for select
  using (public.is_admin());

-- Hanya admin yang boleh insert
drop policy if exists "sales_insert_admin_only" on public.sales;
create policy "sales_insert_admin_only"
  on public.sales for insert
  with check (public.is_admin());

-- Hanya admin yang boleh hapus
drop policy if exists "sales_delete_admin_only" on public.sales;
create policy "sales_delete_admin_only"
  on public.sales for delete
  using (public.is_admin());
