# FORGE

**Foundation Of Resilience, Growth & Excellence**

FORGE adalah web app komunitas untuk duel quiz realtime, Forge Points, Fire Streak, Weekly Leaderboard, Achievement Badge, dan Member Arena.

Sistem ini dibuat dengan frontend static, API serverless di Vercel, dan database Supabase. Logic duel, limit harian, question pool, dan weekly leaderboard dikendalikan dari backend/database supaya hasilnya konsisten di semua device.

---

## Fitur Inti

### 1. Auth & Account

- Register akun dengan nama, username, WhatsApp, email, kota, gender, dan password.
- Login menggunakan session token.
- Change password dari halaman Settings.
- Admin reset password melalui endpoint khusus jika `ADMIN_USERS` dan `ADMIN_RESET_KEY` sudah diisi.
- Bantuan lupa password sementara diarahkan ke WhatsApp admin sampai email sender siap.

### 2. Member Arena

- Menampilkan semua member FORGE.
- Status online dihitung dari `last_seen_at`.
- User bisa menandai member favorit.
- User bisa invite duel langsung dari halaman Members.
- Tombol invite memiliki status pending agar user tidak menekan invite berkali-kali.

### 3. Multiplayer Duel

- User menekan **Mulai Duel** untuk masuk matchmaking.
- API memasukkan user ke `duel_queue`.
- Jika ada lawan online, database membuat duel 1 vs 1.
- Dua player masuk ke room duel yang sama.
- Duel memakai 5 soal dari question pool harian.
- Setiap soal memiliki timer 10 detik.
- Jawaban disimpan ke `duel_answers`.
- Hasil duel dihitung setelah kedua player selesai atau setelah melewati deadline.

### 4. Daily Question Pool

Daily pool dibuat otomatis berdasarkan tanggal WIB.

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

- `questions.active` adalah kontrol admin untuk mengaktifkan atau mematikan soal.
- `questions.used_in_pool` adalah penanda rotasi pool harian.
- Saat soal masuk daily pool, `used_in_pool = true`.
- Soal dengan `used_in_pool = true` tidak masuk pool berikutnya sampai stok kategori habis.
- Jika stok unused habis, sistem otomatis memulai siklus baru dengan reset `used_in_pool = false` untuk soal aktif.
- Pool bersifat self-healing: jika pool hari ini belum ada, Start Duel pertama otomatis membuat pool.

### 5. Limit Harian & Reset WIB

- Maksimal duel harian: 7 duel per user.
- Perhitungan **Duel Hari Ini** reset setiap **00:00 WIB**.
- Fire Streak memakai tanggal WIB.
- Daily question pool memakai tanggal WIB.
- Weekly leaderboard reset setiap **Senin 00:00 WIB**.

### 6. Forge Points & Badge

- FP dihitung berdasarkan jawaban benar dan kecepatan menjawab.
- Lifetime FP disimpan di `users.lifetime_fp`.
- Weekly FP disimpan di `users.weekly_fp`.
- Badge terbuka dari jumlah duel, kemenangan, win streak, lifetime FP, kategori jawaban benar, dan weekly rank.

### 7. Leaderboard & Hall of Legends

- Leaderboard utama menampilkan Rank, Pemain, Level, dan FP Mingguan.
- Weekly leaderboard memakai `weekly_fp`.
- Lifetime progress memakai `lifetime_fp`.
- Weekly snapshot disimpan di `weekly_rank_snapshots`.
- Hall of Legends menampilkan Top 3 Last Week, Fire Streak, dan Lifetime FP.

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
│       └── 20260702_wib_reset_and_duel_stability.sql
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

## Penjelasan File Utama

### `api/[...path].js`

Main backend router untuk semua endpoint `/api/*`.

Tugas utama:

- Auth: register, login, logout, session check.
- Account: profile, settings, change password, admin reset password.
- Members: list member, online status, favorite member, invite duel.
- Duel: matchmaking, get duel, answer, finish, status sync.
- Leaderboard dan badge.
- Daily reset, Fire Streak, dan weekly reset berdasarkan WIB.
- Memanggil Supabase RPC untuk daily question pool dan matchmaking.

### `api/data.js`

Seeder data awal untuk badge dan contoh questions.

Tugas utama:

- Menyediakan `seedQuestions`.
- Menyediakan daftar badge.
- Dipakai oleh `ensureSeed()` saat tabel masih kosong.

Untuk produksi, soal utama tetap lebih baik dikelola langsung dari table `questions` di Supabase.

### `public/index.html`

Struktur halaman utama FORGE.

Tugas utama:

- Auth page: login, register, bantuan lupa password.
- App shell: sidebar, topbar, home, duel, members, leaderboard, badge, about, settings.
- Elemen-elemen dengan `id` yang dikontrol oleh `public/app.js`.

### `public/styles.css`

Seluruh styling FORGE.

Tugas utama:

- Warna brand, layout, responsive mobile, card, sidebar, duel arena, leaderboard, badge, settings.
- Style Forge Points diamond, avatar, Fire Streak, modal, dan toast.

### `public/app.js`

Frontend logic di browser.

Tugas utama:

- Fetch API.
- Menyimpan session token di localStorage.
- Render dashboard, member list, leaderboard, badge, settings.
- Menjalankan UI duel: countdown start, timer soal, jawaban, progress bar, waiting result, result screen.
- Realtime event memakai Supabase Realtime.
- Audio background dan sound effect.

### `supabase/schema.sql`

Schema full untuk instalasi database baru.

Tugas utama:

- Membuat semua table utama.
- Membuat index.
- Mengaktifkan RLS.
- Membuat function daily pool.
- Membuat function matchmaking.
- Membuat helper cleanup weekly snapshot.

Gunakan file ini untuk database baru/kosong.

### `supabase/run_existing_database_update.sql`

Migration aman untuk database yang sudah aktif.

Tugas utama:

- Menyesuaikan function daily pool ke WIB.
- Menyesuaikan function matchmaking ke WIB.
- Memastikan kolom daily pool tersedia.
- Mengembalikan `questions.active = true` untuk soal yang sempat dibuat false oleh logic lama.
- Menjaga reset harian dan weekly leaderboard berdasarkan WIB.

Gunakan file ini untuk project yang sudah berjalan.

---

## Cara Update Project Aktif

### 1. Backup project dan database

Backup folder project dan export database sebelum replace file.

### 2. Replace file code

Copy isi ZIP ini ke project kamu.

Folder asset lama tetap dipakai:

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

### 4. Test tanggal WIB

```sql
select
  now() as utc_time,
  now() at time zone 'Asia/Jakarta' as wib_time,
  (now() at time zone 'Asia/Jakarta')::date as wib_date;
```

### 5. Test generate pool hari ini

```sql
select public.generate_daily_question_pool(
  (now() at time zone 'Asia/Jakarta')::date,
  5,
  false
);
```

Cek total:

```sql
select count(*)
from public.daily_question_pool
where pool_date = (now() at time zone 'Asia/Jakarta')::date;
```

Harusnya `50`.

Cek per kategori:

```sql
select category_key, count(*)
from public.daily_question_pool
where pool_date = (now() at time zone 'Asia/Jakarta')::date
group by category_key
order by category_key;
```

Harusnya masing-masing `5`.

### 6. Test start duel

Minimal perlu 2 akun online.

```text
Akun A klik Mulai Duel
Akun B klik Mulai Duel
Database match otomatis
Duel dibuat
5 soal masuk duel_questions
Kedua player melihat countdown yang sama
Soal muncul setelah countdown selesai
```

### 7. Test reset harian

Setelah lewat 00:00 WIB:

```sql
select count(*)
from public.duels
where status <> 'cancelled'
  and started_at >= date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';
```

Duel sebelum 00:00 WIB tidak boleh ikut masuk hitungan hari baru.

---

## Cron Opsional

Karena pool sudah self-healing, cron tidak wajib.

Jika ingin pool dibuat otomatis setiap **00:00 WIB**, gunakan Supabase cron:

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'forge-generate-daily-question-pool-midnight-wib',
  '0 17 * * *',
  $$
  select public.generate_daily_question_pool(
    (now() at time zone 'Asia/Jakarta')::date,
    5,
    false
  );
  $$
);
```

Penjelasan:

```text
00:00 WIB = 17:00 UTC hari sebelumnya
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

Cek file static dan syntax:

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
git commit -m "stabilize duel flow and align reset to WIB"
git push
```

Vercel akan deploy otomatis jika repository sudah tersambung.

---

## Catatan Penting

1. Jangan memilih soal duel dari frontend.
2. Soal duel harus mengikuti `duel_questions` yang dibuat backend/database.
3. `questions.active` dipakai admin untuk mematikan soal.
4. `questions.used_in_pool` dipakai sistem untuk rotasi daily pool.
5. Daily reset memakai WIB, bukan timezone server Vercel.
6. Weekly leaderboard reset setiap Senin 00:00 WIB.
7. Jika semua soal sudah pernah masuk pool, sistem otomatis memulai siklus baru.

---

Private project. Copyright © FORGE Community.
