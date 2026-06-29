# FORGE

**Foundation Of Resilience, Growth & Excellence**

FORGE adalah web app komunitas untuk duel quiz realtime, Forge Points, Fire Streak, Weekly Leaderboard, Achievement Badge, dan Member Arena.

Versi ini sudah dirapikan supaya logic soal harian tidak lagi bergantung pada frontend. Tampilan UI/UX tetap memakai file `public/index.html`, `public/styles.css`, dan `public/app.js` yang sama; perubahan utama ada di database function dan API matchmaking.

---

## Fitur Inti

### 1. Auth & Account

- Register akun dengan nama, username, WhatsApp, email, kota, gender, dan password.
- Login menggunakan session token.
- Change password dari halaman Settings.
- Admin reset password lewat endpoint khusus jika `ADMIN_USERS` dan `ADMIN_RESET_KEY` sudah diisi.

### 2. Multiplayer Duel

- User menekan **Mulai Duel**.
- API memasukkan user ke `duel_queue`.
- Jika ada lawan online, database membuat duel realtime 1 vs 1.
- Setiap duel memakai 5 soal dari `daily_question_pool` hari itu.
- Timer dan tampilan duel tetap di-handle oleh frontend.

### 3. Daily Question Pool

Logic baru:

```text
questions
  bank semua soal

        ↓ setiap tanggal baru / saat Start Duel pertama hari itu

daily_question_pool
  50 soal per hari
  10 kategori × 5 soal

        ↓ setiap duel

duel_questions
  5 soal random dari pool hari itu
```

Kategori harian:

```text
Logika & Matematika
Geografi
Teknologi
Pengetahuan Umum
Kesehatan
Psikologi
Karakter & Moral
Ekonomi
Alkitab
Bahasa Inggris
```

Aturan penting:

- `questions.active` tetap menjadi kontrol admin.
- `questions.used_in_pool` menjadi penanda soal sudah pernah masuk pool harian.
- Saat 50 soal masuk pool, `used_in_pool = true`.
- Soal dengan `used_in_pool = true` tidak akan masuk pool lagi pada hari berikutnya.
- Jika stok unused sudah habis, function otomatis mulai siklus baru dengan reset `used_in_pool = false` untuk soal aktif.
- Pool bersifat **self-healing**: kalau hari ini belum ada pool, Start Duel pertama akan otomatis membuat pool.

### 4. Forge Points & Badge

- FP dihitung berdasarkan jawaban benar dan kecepatan menjawab.
- Badge terbuka dari jumlah duel, kemenangan, win streak, lifetime FP, kategori jawaban benar, dan weekly rank.

### 5. Leaderboard & Hall of Legends

- Weekly leaderboard memakai `weekly_fp`.
- Lifetime progress memakai `lifetime_fp`.
- Weekly snapshot disimpan di `weekly_rank_snapshots`.

---

## Struktur Folder

```text
forge-community/
│
├── api/
│   ├── [...path].js
│   └── data.js
│
├── public/
│   ├── app.js
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── styles.css
│   └── sw.js
│
├── supabase/
│   ├── schema.sql
│   ├── run_existing_database_update.sql
│   └── migrations/
│       └── 20260629_self_healing_daily_pool.sql
│
├── scripts/
│   └── check-static.mjs
│
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── vercel.json
```

---

## Penjelasan Tiap File

### `api/[...path].js`

Main backend router untuk semua endpoint `/api/*`.

Tugas utama:

- Membaca path API dari Vercel rewrite.
- Auth: register, login, logout, session check.
- Account: profile, settings, change password, admin reset password.
- Members: list member, online status, favorite member, invite duel.
- Duel: matchmaking, get duel, answer, finish, status sync.
- Leaderboard dan badge.
- Memanggil Supabase RPC untuk daily question pool dan matchmaking.

Catatan update:

- `startDuel()` sekarang tidak memilih soal di frontend/API.
- `joinMatchmaking()` menyerahkan pemilihan soal ke RPC `match_duel_queue()`.
- `dailyDuelQuestions()` mengambil 5 soal dari RPC `get_daily_duel_question_ids()`.
- Tidak ada lagi logic API yang mengubah `questions.active = false`.

### `api/data.js`

Seeder data awal untuk badge dan contoh questions.

Tugas utama:

- Menyediakan `seedQuestions`.
- Menyediakan daftar badge.
- Dipakai oleh `ensureSeed()` di backend saat tabel masih kosong.

Catatan:

- Untuk produksi, soal utama tetap lebih baik dimasukkan langsung ke table `questions` di Supabase.
- Seeder ini hanya cadangan agar project baru tidak benar-benar kosong.

### `public/index.html`

Struktur halaman utama FORGE.

Tugas utama:

- Auth page: login, register, bantuan lupa password.
- App shell: sidebar, topbar, home, duel, members, leaderboard, badge, about, settings.
- Elemen-elemen dengan `id` yang dikontrol oleh `public/app.js`.

Catatan:

- Tidak ada perubahan UI/UX utama di file ini.

### `public/styles.css`

Seluruh styling FORGE.

Tugas utama:

- Warna brand, layout, responsive mobile, card, sidebar, duel arena, leaderboard, badge, settings.
- Style Forge Points diamond, avatar, Fire Streak, modal, dan toast.

Catatan:

- File ini dipertahankan supaya tampilan tidak berubah.

### `public/app.js`

Frontend logic di browser.

Tugas utama:

- Fetch API.
- Menyimpan session token di localStorage.
- Render dashboard, member list, leaderboard, badge, settings.
- Menjalankan UI duel: timer, jawaban, progress bar, result screen.
- Realtime event memakai Supabase Realtime.
- Audio background dan sound effect.

Catatan:

- UI flow tetap sama.
- Pemilihan soal harian tidak ada di frontend; frontend hanya menerima duel yang sudah dibuat oleh backend/database.

### `public/sw.js`

Service worker untuk Progressive Web App.

Tugas utama:

- Cache shell assets: HTML, CSS, JS, manifest, logo.
- Menghindari cache untuk route `/api/*`.
- Membantu app tetap cepat saat dibuka ulang.

### `public/manifest.webmanifest`

Konfigurasi PWA.

Tugas utama:

- Nama aplikasi.
- Icon aplikasi.
- Warna tema.
- Mode display saat ditambahkan ke home screen.

### `supabase/schema.sql`

Schema full untuk instalasi database baru.

Tugas utama:

- Membuat semua table utama.
- Membuat index.
- Mengaktifkan RLS.
- Membuat function daily pool.
- Membuat function matchmaking.
- Membuat helper cleanup weekly snapshot.

Gunakan file ini hanya untuk database baru/kosong.

### `supabase/run_existing_database_update.sql`

Migration aman untuk database yang sudah aktif.

Tugas utama:

- Menambah `questions.used_in_pool` jika belum ada.
- Menambah `questions.last_pooled_date` jika belum ada.
- Mengembalikan `active = true` untuk soal yang sempat dibuat false oleh logic lama.
- Membuat ulang function daily pool dan matchmaking versi baru.

Gunakan file ini untuk project kamu sekarang.

### `supabase/migrations/20260629_self_healing_daily_pool.sql`

Isi sama dengan `run_existing_database_update.sql`, tetapi disimpan sebagai migration historis.

Tugas utama:

- Dokumentasi perubahan database.
- Bisa dipakai kalau nanti project memakai sistem migration yang lebih rapi.

### `scripts/check-static.mjs`

Script pengecekan file penting.

Tugas utama:

- Memastikan file utama frontend, API, dan schema ada.
- Dipanggil oleh `npm run check`.

### `package.json`

Konfigurasi Node/Vercel project.

Tugas utama:

- Menentukan dependency: `@supabase/supabase-js`.
- Script local dev: `npm run local`.
- Script deploy: `npm run deploy`.
- Script check: `npm run check`.

### `vercel.json`

Konfigurasi Vercel.

Tugas utama:

- Rewrite semua `/api/*` ke `api/[...path].js`.
- Header khusus untuk `manifest.webmanifest`.

### `.env.example`

Template environment variables.

Tugas utama:

- Daftar variable yang perlu diisi di `.env.local` atau Vercel Environment Variables.

### `.gitignore`

Daftar file/folder yang tidak perlu masuk Git.

Tugas utama:

- Mengabaikan `node_modules`, `.vercel`, dan file `.env` lokal.

---

## Cara Update Project Aktif

### 1. Backup dulu

Sebelum replace file, backup project dan database.

### 2. Replace file code

Copy isi ZIP ini ke project kamu.

Folder assets lama tetap dipakai:

```text
public/image/
public/badges/
public/gif/
public/sounds/
```

ZIP ini tidak mengubah asset gambar/suara.

### 3. Run migration database

Di Supabase SQL Editor, jalankan:

```text
supabase/run_existing_database_update.sql
```

### 4. Test generate pool hari ini

```sql
select public.generate_daily_question_pool(
  (now() at time zone 'Asia/Makassar')::date,
  5,
  false
);
```

Cek total:

```sql
select count(*)
from public.daily_question_pool
where pool_date = (now() at time zone 'Asia/Makassar')::date;
```

Harusnya `50`.

Cek per kategori:

```sql
select category_key, count(*)
from public.daily_question_pool
where pool_date = (now() at time zone 'Asia/Makassar')::date
group by category_key
order by category_key;
```

Harusnya masing-masing `5`.

### 5. Test start duel

Minimal perlu 2 akun online.

Alur:

```text
Akun A klik Mulai Duel
Akun B klik Mulai Duel
Database match otomatis
Duel dibuat
5 soal random masuk duel_questions
```

---

## Cron Opsional

Karena pool sudah self-healing, cron tidak wajib.

Namun kalau ingin pool dibuat otomatis setiap jam 00.00 WITA, bisa pakai Supabase cron:

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'forge-generate-daily-question-pool-midnight-wita',
  '0 16 * * *',
  $$
  select public.generate_daily_question_pool(
    (now() at time zone 'Asia/Makassar')::date,
    5,
    false
  );
  $$
);
```

Penjelasan:

```text
00.00 WITA = 16.00 UTC hari sebelumnya
```

---

## Local Development

Install dependency:

```bash
npm install
```

Jalankan lokal:

```bash
npm run local
```

Cek syntax:

```bash
npm run check
```

---

## Environment Variables

Isi di `.env.local` untuk local, dan di Vercel Environment Variables untuk production.

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
ADMIN_USERS=
ADMIN_RESET_KEY=
RESEND_API_KEY=
RESET_FROM_EMAIL=FORGE <onboarding@resend.dev>
```

Minimal yang wajib:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
```

---

## Deployment

```bash
git add .
git commit -m "clean daily question pool architecture"
git push
```

Vercel akan deploy otomatis jika repository sudah tersambung.

---

## Catatan Penting

1. Jangan filter soal duel dengan `questions.active = true` dari frontend.
2. Soal duel harus mengikuti `duel_questions` yang sudah dibuat database.
3. `active` dipakai admin untuk mematikan soal.
4. `used_in_pool` dipakai sistem untuk rotasi soal harian.
5. Daily pool lama tidak perlu dihapus; setiap tanggal punya pool sendiri.
6. Kalau semua soal sudah pernah masuk pool, sistem otomatis memulai siklus baru.

---

Private project. Copyright © FORGE Community.
