# Setup Supabase — GlacierStore (Tahap 1: Tabel + RLS + Auth)

Tahap ini **belum** mengubah `admin.js`/`script.js` untuk pakai Supabase — masih
localStorage seperti sekarang. Tujuannya cuma menyiapkan pondasi database &
keamanannya dulu di sisi Supabase, supaya tahap berikutnya (menyambungkan
admin panel ke Supabase) tinggal pasang.

## Langkah 1 — Jalankan SQL

1. Buka project Supabase kamu (buat dulu di https://supabase.com kalau belum ada)
2. Sidebar kiri → **SQL Editor** → **New Query**
3. Copy seluruh isi `01_setup.sql` → paste → **Run**

Ini akan membuat:
- Tabel `games`, `products`, `settings`, `admins`, `logs`
- Kolom `created_at` / `updated_at` otomatis di semua tabel
- RLS aktif di semua tabel, dengan aturan:
  - **Baca (`SELECT`)** → boleh semua orang, termasuk pengunjung anonim (perlu, karena landing page publik harus bisa menampilkan katalog)
  - **Tulis (`INSERT`/`UPDATE`/`DELETE`)** → hanya user yang terdaftar di tabel `admins`

## Langkah 2 — Buat akun admin pertama

Instruksinya ada di bagian paling bawah `01_setup.sql`, ringkasnya:

1. **Authentication → Users → Add user** → isi email & password kamu
2. Copy **User UID**-nya
3. Jalankan di SQL Editor:
   ```sql
   insert into public.admins (id, email, role)
   values ('USER-UID-KAMU', 'emailkamu@gmail.com', 'owner');
   ```

Tanpa langkah ini, akun kamu bisa login tapi **tidak dianggap admin** oleh
RLS — semua percobaan insert/update/delete akan ditolak database. Ini
sengaja, supaya sekadar "punya akun Supabase Auth" tidak otomatis berarti
"boleh ubah data".

## Langkah 3 — Cara mengecek RLS benar-benar jalan (opsional tapi disarankan)

Di SQL Editor, coba jalankan sebagai anon (tanpa login) — harus GAGAL:
```sql
update public.games set name = 'Test Hack' where id = 'free-fire';
```
Kalau RLS aktif dengan benar, ini akan menolak dengan error
`new row violates row-level security policy`.

Baca data harus tetap berhasil tanpa login:
```sql
select name, status from public.games;
```

## Langkah 4 — Ambil kredensial untuk frontend

**Project Settings → API**:
- `Project URL` → nanti jadi `SUPABASE_URL`
- `anon public` key → nanti jadi `SUPABASE_ANON_KEY`

Dua nilai ini aman ditaruh di kode frontend (bukan `service_role`!) karena
semua akses tetap ditahan RLS. **Jangan pernah** taruh `service_role` key di
file `.js`/`.html` manapun — itu kunci yang melewati semua RLS.

Simpan sebagai **Environment Variables di Vercel** (Project Settings →
Environment Variables), jangan hardcode langsung di JS.

## Yang BELUM dikerjakan di tahap ini (menyusul di tahap berikutnya)

- Halaman `login.html` + redirect kalau belum login
- Mengganti `readGames()/saveGames()` di `admin.js` dari localStorage ke query Supabase
- Migrasi data games/products yang sekarang ada di `data.js` ke tabel Supabase
- Supabase Realtime supaya landing page auto-update saat admin menyimpan perubahan

Kabari kalau mau lanjut ke salah satu bagian di atas.
