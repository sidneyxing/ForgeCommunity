# FORGE

<p align="center">
  <img src="public/image/logo.png" width="180">
</p>

<h1 align="center">
Foundation Of Resilience, Growth & Excellence
</h1>

<p align="center">

Real-time Multiplayer Community Quiz Platform

</p>

---

# About

FORGE adalah platform komunitas berbasis web yang menggabungkan pembelajaran, kompetisi, dan pembangunan karakter melalui sistem duel pengetahuan secara realtime.

Peserta dapat saling menantang duel, memperoleh Forge Points (FP), mempertahankan Fire Streak, membuka Achievement Badge, serta bersaing di Weekly Leaderboard.

---

# Features

## Multiplayer Duel

- Real-time 1 vs 1 Duel
- Duel Invitation
- Accept / Reject (10s timeout)
- Live Score Sync
- 5 Questions
- Countdown Timer
- Confetti Victory
- Lose Sound Effect

---

## Forge Points (FP)

Perhitungan FP berdasarkan:

- Jawaban benar
- Kecepatan menjawab

Maximum

```
100 FP / Duel
```

---

## Fire Streak

- Daily Active Streak
- Weekly Tracking
- Animated Flame

---

## Leaderboard

- Weekly Ranking
- Lifetime Ranking
- Hall of Legends

---

## Achievement Badge

Unlock badge berdasarkan:

- Duel
- Win
- FP
- Fire Streak
- Weekly Champion

---

## Question Types

Supported

- Text Question
- Image Question

Categories

- Bible
- Geography
- Mathematics
- Technology
- Psychology
- Economy
- Health
- Leadership
- Moral
- General Knowledge
- Reflection

---

## Community

Member dapat

- Favorite
- Friend
- Duel
- Online Status

---

## Audio

Background Music

- Idle Mode
- Duel Mode

Sound Effects

- Victory
- Lose
- Notification

---

## Progressive Web App

- Add To Home Screen
- Mobile Friendly
- Responsive
- Offline Ready (Static Assets)

---

# Tech Stack

Frontend

- HTML5
- CSS3
- Vanilla JavaScript

Backend

- Vercel Serverless Function

Database

- Supabase PostgreSQL

Realtime

- Supabase Realtime

Hosting

- Vercel

---

# Project Structure

```
forge-community
│
├── api
│   ├── [...path].js          # Main API Router
│   └── data.js               # Initial Question & Badge Seeder
│
├── public
│   ├── image
│   ├── sounds
│   ├── app.js
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── styles.css
│   └── sw.js
│
├── scripts
│   ├── check-static.mjs
│   └── local-env.mjs
│
├── supabase
│   ├── schema.sql
│   ├── realtime-duel-migration.sql
│   └── weekly-ui-fix-migration.sql
│
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── vercel.json
```

---

# Environment Variables

Create

```
.env.local
```

```
SUPABASE_URL=

SUPABASE_SERVICE_ROLE_KEY=

SUPABASE_ANON_KEY=
```

---

# Local Development

Install

```bash
npm install
```

Run

```bash
npm run local
```

Syntax Check

```bash
npm run check
```

---

# Deployment

## GitHub

```bash
git add .
git commit -m "your message"
git push
```

---

## Vercel

Import GitHub Repository

Environment Variables

```
SUPABASE_URL

SUPABASE_SERVICE_ROLE_KEY

SUPABASE_ANON_KEY
```

Deploy

---

# Database

New Installation

Run

```
supabase/schema.sql
```

Existing Installation

Run only

```
supabase/realtime-duel-migration.sql
```

---

# Gameplay

Register

↓

Login

↓

Challenge Player

↓

Answer 5 Questions

↓

Earn Forge Points

↓

Unlock Badges

↓

Maintain Fire Streak

↓

Reach Hall of Legends

---

# Future Roadmap

- Tournament Mode
- Ranked Seasons
- Replay Duel
- AI Generated Questions
- Admin Dashboard
- Push Notification
- Guild / Clan
- Mobile App (Android / iOS)
- Spectator Mode
- Daily Mission
- Seasonal Badge

---

# License

Private Repository

Copyright © FORGE Community
