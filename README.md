# FORGE

> **Foundation Of Resilience, Growth & Excellence**

FORGE is a competitive community web application that transforms learning, character development, and community interaction into a real-time multiplayer quiz experience.

Players challenge one another in knowledge duels, earn Forge Points (FP), unlock achievements, maintain Fire Streaks, and compete on weekly leaderboards.

---

## Features

### Multiplayer Duel

* Real-time 1 vs 1 duel
* Duel invitation system
* Accept / Reject invitation (10 second timeout)
* Live answer synchronization
* Countdown timer
* Result animation

### Forge Points (FP)

* Dynamic FP calculation
* Maximum 100 FP per duel
* Bonus based on:

  * Correct answers
  * Remaining answer time

### Fire Streak

Maintain consecutive active duel days.

* Daily streak
* Animated flame
* Weekly statistics

### Leaderboard

* Weekly Ranking
* Lifetime Ranking
* Hall of Legends
* Weekly Champion Recap

### Achievement Badges

Unlock badges by completing milestones.

Examples:

* First Duel
* First Victory
* Win Streak
* Fire Streak
* Weekly Champion
* Lifetime FP

### Question System

Supports:

* Text Questions
* Image Questions

Question categories include:

* Bible
* Geography
* Technology
* Mathematics
* Psychology
* Economy
* General Knowledge
* Leadership
* Moral & Character
* Health
* Reflection

### Community

Members can:

* View other members
* Add Favourite
* Add Friend
* Invite Duel

### User Profile

Each account contains:

* Given ID
* Username
* Avatar
* Gender
* City
* Weekly FP
* Lifetime FP
* Statistics

### Audio

Background music automatically changes:

* Idle Mode
* Duel Mode

Sound effects:

* Victory
* Defeat
* Notifications

### Progressive Web App (PWA)

Supports:

* Add to Home Screen
* Mobile friendly
* Install like a native app

---

# Tech Stack

Frontend

* HTML
* CSS
* Vanilla JavaScript

Backend

* Vercel Serverless Functions

Database

* Supabase PostgreSQL

Realtime

* Supabase Realtime

Deployment

* Vercel

---

# Project Structure

```
api/
public/
supabase/
scripts/
```

---

# Environment Variables

Create `.env.local`

```env
SUPABASE_URL=

SUPABASE_SERVICE_ROLE_KEY=

SUPABASE_ANON_KEY=
```

---

# Installation

Install dependencies

```bash
npm install
```

Run locally

```bash
npm run dev
```

---

# Database

Run

```
schema.sql
```

If upgrading an existing database, run migration files instead of recreating the schema.

---

# Deployment

Push repository to GitHub.

Import project into Vercel.

Add Environment Variables.

Deploy.

---

# Gameplay

1. Register
2. Login
3. Challenge another member
4. Answer five questions
5. Earn Forge Points
6. Unlock badges
7. Maintain Fire Streak
8. Reach Hall of Legends

---

# Roadmap

Upcoming features

* Ranked Seasons
* Spectator Mode
* Tournament Bracket
* Daily Missions
* Guild / Community
* AI Generated Questions
* Admin Dashboard
* Push Notifications
* Replay Duel
* Statistics Dashboard
* Mobile Application (Android & iOS)

---

# License

Private Project

Copyright © FORGE Community
