# FORGE Arena

FORGE = Foundation Of Resilience, Growth & Excellence.

Web app duel quiz komunitas dengan login/register nomor WhatsApp, Arena Members, friend/favourite, request duel accept/decline, leaderboard, badges, duel 5 soal x 10 detik, Forge Points, fire streak harian, riwayat duel, sound effect, confetti saat menang, dan efek shake abu saat kalah.

## Stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Vercel Serverless Functions di folder `api/`
- Database: Supabase Postgres
- Auth: username/password dengan PBKDF2 hash dan HttpOnly session cookie
- Deploy target: Vercel

## Struktur penting

| File / Folder | Fungsi |
|---|---|
| `public/index.html` | Struktur UI FORGE |
| `public/styles.css` | Style premium FORGE |
| `public/app.js` | Logic frontend, duel timer, audio, confetti |
| `api/[...path].js` | Backend API Vercel |
| `api/data.js` | Seed pertanyaan dan badge awal |
| `supabase/schema.sql` | Schema database Supabase |
| `public/sounds/` | Tempat isi sound effect |
| `public/forge-logo.png` | Logo avatar FORGE |

## Setup Supabase

1. Buka Supabase Dashboard.
2. Buat project baru.
3. Masuk ke `SQL Editor`.
4. Buka file `supabase/schema.sql`, copy semua isinya, lalu klik `Run`.
5. Masuk `Project Settings > API`.
6. Simpan dua data ini:
   - `Project URL`
   - `service_role key`

Penting: `service_role key` hanya boleh disimpan di environment variable Vercel/server. Jangan taruh di `public/`, HTML, CSS, atau JavaScript frontend.

## Setup local

1. Install Node.js LTS.
2. Buka terminal di folder project ini.
3. Install dependency:

```bash
npm install
```

4. Buat file `.env.local` dari contoh:

```bash
cp .env.example .env.local
```

Di Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

5. Isi `.env.local`:

```text
SUPABASE_URL=https://PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=SERVICE_ROLE_KEY_KAMU
```

6. Cek project:

```bash
npm run check
```

7. Jalankan local:

```bash
npm run dev
```

Biasanya app terbuka di `http://localhost:3000`.

## Deploy ke Vercel

Cara termudah:

1. Buka Vercel Dashboard.
2. Klik `Add New > Project`.
3. Import folder/repository project FORGE ini.
4. Di bagian Environment Variables, isi:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Klik `Deploy`.
6. Setelah deploy selesai, buka domain Vercel yang diberikan.

Lewat terminal:

```bash
npx vercel login
npx vercel --prod
```

Saat diminta project name, pakai `forge-arena` atau nama yang kamu mau.

## Sound effect

Isi file audio ke path berikut:

| File | Dipakai untuk |
|---|---|
| `public/sounds/button-click.mp3` | Klik tombol |
| `public/sounds/duel-start.mp3` | Duel mulai |
| `public/sounds/clock-tick.mp3` | Tick timer saat quiz |
| `public/sounds/correct.mp3` | Jawaban benar |
| `public/sounds/wrong.mp3` | Jawaban salah |
| `public/sounds/win.mp3` | Menang |
| `public/sounds/lose.mp3` | Kalah |

Kalau file belum ada, app tetap berjalan dengan fallback tone. Di HP, audio baru bisa menyala setelah user melakukan tap pertama karena aturan browser mobile.

## Isi pertanyaan baru

Pertanyaan masuk ke tabel `questions` di Supabase.

Contoh SQL:

```sql
insert into public.questions (
  id, category, subcategory, question,
  option_a, option_b, option_c, option_d,
  correct_option, explanation, difficulty, active
) values (
  'q_admin_001',
  'Integritas',
  'Kejujuran',
  'Temanmu menyontek dan mengajakmu ikut. Apa tindakan terbaik?',
  'Ikut agar diterima',
  'Menolak dengan sopan dan tetap jujur',
  'Memberi jawaban sedikit',
  'Diam lalu ikut',
  'B',
  'Integritas berarti melakukan yang benar walau tidak dilihat.',
  'easy',
  true
);
```

## Catatan penting

- Register tidak memakai email dan tidak memakai OTP.
- Lupa password diarahkan ke contact person WhatsApp.
- Avatar selalu logo FORGE, tetapi warna lingkaran avatar bisa diganti lewat pengaturan profil.
- Fire streak dihitung per hari aktif duel, bukan per jumlah duel.
- Batas duel adalah 7 duel per hari per akun.
- Database ada di Supabase, schema-nya ada di `supabase/schema.sql`, dan koneksi backend ada di `api/[...path].js`.
