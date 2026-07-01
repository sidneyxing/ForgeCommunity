import { createClient } from "@supabase/supabase-js";
import { pbkdf2Sync, randomBytes, webcrypto } from "node:crypto";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_DUEL_LIMIT = 7;
const DUEL_HISTORY_LIMIT = 7;
const DAILY_QUESTION_POOL_SIZE = 50;
const DUEL_QUESTION_COUNT = 5;
const QUESTION_ROLLING_WINDOW_DAYS = 60;
const QUESTION_POOL_RETENTION_DAYS = 70;
const QUESTION_TIME_LIMIT_MS = 10 * 1000;
const DUEL_REQUEST_WAIT_MS = 20 * 1000;
const DUEL_START_BUFFER_MS = 5 * 1000;
const ONLINE_CUTOFF_MS = 2 * 60 * 1000;
const MATCH_QUEUE_STALE_MS = 15 * 1000;
const DUEL_SETTLE_GRACE_MS = 15 * 1000;
const SESSION_DAYS = 180;
const SESSION_KEEP_PER_USER = 1;
const DATA_RETENTION_DAYS = 30;
const APP_TIME_ZONE = "Asia/Jakarta";
const DAILY_CATEGORY_QUESTION_COUNT = 5;
const RESET_CODE_TTL_MS = 15 * 60 * 1000;

const QUESTION_CATEGORIES = [
  { key: "bible", label: "Alkitab", counter: "bible_correct", aliases: ["alkitab", "bible"] },
  { key: "character", label: "Karakter & Moral", counter: "character_correct", aliases: ["karakter & moral", "moral & character", "moral", "character", "karakter", "refleksi", "kepemimpinan", "situational"] },
  { key: "technology", label: "Teknologi", counter: "technology_correct", aliases: ["teknologi", "technology", "tech"] },
  { key: "geography", label: "Geografi", counter: "geography_correct", aliases: ["geografi", "geography", "nations", "world"] },
  { key: "logic", label: "Logika & Matematika", counter: "logic_correct", aliases: ["logika & matematika", "logika", "matematika", "logic", "math"] },
  { key: "general", label: "Pengetahuan Umum", counter: "general_correct", aliases: ["pengetahuan umum", "general", "knowledge", "umum"] },
  { key: "health", label: "Kesehatan", counter: "health_correct", aliases: ["kesehatan", "health", "medical", "wellness"] },
  { key: "psychology", label: "Psikologi", counter: "psychology_correct", aliases: ["psikologi", "psychology", "komunikasi", "mind"] },
  { key: "economy", label: "Ekonomi", counter: "economy_correct", aliases: ["ekonomi", "economy", "keuangan", "financial", "finance"] },
  { key: "english", label: "Bahasa Inggris", counter: "english_correct", aliases: ["bahasa inggris", "english", "grammar", "vocabulary"] },
];

const CATEGORY_BY_KEY = new Map(QUESTION_CATEGORIES.map((category) => [category.key, category]));
const CATEGORY_THRESHOLDS = [25, 50, 100, 250, 500, 750, 1000, 2500, 5000, 10000];
const CATEGORY_BADGE_START = {
  bible: 41,
  character: 51,
  technology: 61,
  geography: 71,
  logic: 81,
  general: 91,
  health: 101,
  psychology: 111,
  economy: 121,
  english: 131,
};
let seedPromise;
let seedModulePromise;
let weeklySeasonCheckedKey;
let maintenanceLastRunAt = 0;

export default async function handler(req, res) {
  try {
    const method = req.method.toUpperCase();
    const path = resolveApiPath(req);

    if (method === "GET" && path === "/health") {
      return send(res, 200, {
        ok: true,
        service: "FORGE API",
        supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
        adminResetConfigured: Boolean(process.env.ADMIN_RESET_KEY),
        adminUsersConfigured: adminIdentifiers().length > 0,
        resendConfigured: Boolean(process.env.RESEND_API_KEY),
        sender: process.env.RESET_FROM_ADDRESS || process.env.RESET_FROM_EMAIL || "onboarding@resend.dev",
      });
    }

    if (method === "GET" && path === "/realtime-config") return realtimeConfig(res);

    const db = getSupabase();

    // Auth/reset routes must stay light and public. Do not run seed/weekly jobs here,
    // so a password-reset email cannot fail because of unrelated maintenance work.
    if (method === "POST" && path === "/auth/register") return register(req, res, db);
    if (method === "POST" && path === "/auth/login") return login(req, res, db);
    if (method === "POST" && path === "/auth/logout") return logout(req, res, db);

    // Kalau nanti sudah beli domain dan domain sender Resend sudah verified,
    // route reset email ini bisa diaktifkan lagi. Untuk sementara user diarahkan hubungi WA admin.
    if (method === "POST" && path === "/auth/reset/request") return requestPasswordReset(req, res, db);
    if (method === "POST" && path === "/auth/reset/confirm") return confirmPasswordReset(req, res, db);

    // Tool sementara untuk admin reset password tanpa perlu generate hash manual.
    // Tetap wajib login sebagai admin + mengisi ADMIN_RESET_KEY.
    if (method === "POST" && path === "/admin/reset-password") {
      const adminUser = await requireUser(req, db);
      return adminResetPassword(req, res, db, adminUser);
    }

    await ensureSeedOnce(db);
    await ensureWeeklySeason(db);

    const user = await requireUser(req, db);
    if (method === "GET" && path === "/me") return send(res, 200, await mePayload(db, user));
    if (method === "POST" && path === "/me/password") return changeMyPassword(req, res, db, user);
    if (method === "PATCH" && path === "/me/profile") return updateProfile(req, res, db, user);
    if (method === "PATCH" && path === "/me/settings") return updateSettings(req, res, db, user);
    if (method === "GET" && path === "/members") return members(req, res, db, user);
    if (method === "POST" && /^\/members\/[^/]+\/relation$/.test(path)) return relation(req, res, db, user, path.split("/")[2]);
    if (method === "POST" && /^\/members\/[^/]+\/invite$/.test(path)) return inviteDuelRequest(res, db, user, path.split("/")[2]);
    if (method === "GET" && path === "/duel-requests") return duelRequests(res, db, user);
    if (method === "POST" && /^\/duel-requests\/[^/]+\/respond$/.test(path)) return respondDuelRequest(req, res, db, user, path.split("/")[2]);
    if (method === "GET" && path === "/leaderboard") return leaderboard(res, db, user);
    if (method === "GET" && path === "/badges") return badges(res, db, user);
    if (method === "POST" && path === "/duel/start") return startDuel(res, db, user);
    if (method === "GET" && path === "/duel/matchmaking/status") return matchmakingStatus(res, db, user);
    if (method === "POST" && path === "/duel/matchmaking/cancel") return cancelMatchmaking(res, db, user);
    if (method === "GET" && /^\/duel\/[^/]+$/.test(path)) return getDuel(res, db, user, path.split("/")[2]);
    if (method === "GET" && /^\/duel\/[^/]+\/status$/.test(path)) return duelStatus(res, db, user, path.split("/")[2]);
    if (method === "POST" && path === "/duel/answer") return answerDuel(req, res, db, user);
    if (method === "POST" && path === "/duel/finish") return finishDuel(req, res, db, user);

    return send(res, 404, { error: "API route not found." });
  } catch (error) {
    console.error("FORGE_API_ERROR", {
      message: error?.message || "Server error",
      status: error?.status || 500,
      stack: error?.stack,
    });
    return send(res, error.status || 500, { error: error.message || "Server error" });
  }
}

function resolveApiPath(req) {
  const urlPath = new URL(req.url || "/", "http://localhost").pathname;
  const cleanUrlPath = urlPath.replace(/^\/api/, "") || "/";

  if (cleanUrlPath && cleanUrlPath !== "/" && cleanUrlPath !== "/[...path].js") {
    return cleanUrlPath;
  }

  const pathParts = Array.isArray(req.query.path)
    ? req.query.path
    : req.query.path
      ? [req.query.path]
      : [];

  return `/${pathParts.join("/")}`;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw Object.assign(new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."), { status: 500 });
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function send(res, status, payload, headers = {}) {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function realtimeConfig(res) {
  const url = process.env.SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return send(res, 200, { enabled: Boolean(url && anonKey), url, anonKey });
}

function body(req) {
  return req.body && typeof req.body === "object" ? req.body : {};
}

function id(prefix = "id") {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function randomGivenId() {
  return String(Math.floor(1000000 + Math.random() * 9000000));
}

async function digest(value) {
  const buffer = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hashPassword(password, salt = id("salt")) {
  const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored = "") {
  const [salt] = stored.split(":");
  return Boolean(salt) && hashPassword(password, salt) === stored;
}

function cookie(req, name) {
  const raw = req.headers.cookie || "";
  const found = raw.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : "";
}

function bearerToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function sessionCookie(token, expired = false) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = expired ? 0 : 60 * 60 * 24 * SESSION_DAYS;
  return `forge_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

function zonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function timeZoneOffsetMs(date, timeZone = APP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const asUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
  return asUtc - date.getTime();
}

function startOfTodayIso(date = new Date()) {
  const parts = zonedParts(date);
  const localMidnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const offset = timeZoneOffsetMs(new Date(localMidnightAsUtc));
  return new Date(localMidnightAsUtc - offset).toISOString();
}

function dateKey(date = new Date()) {
  const parts = zonedParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function weekKey(date = new Date()) {
  const parts = zonedParts(date);
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = localDate.getUTCDay() || 7;
  localDate.setUTCDate(localDate.getUTCDate() - weekday + 1);
  return localDate.toISOString().slice(0, 10);
}

function todayDate() {
  return dateKey();
}

function yesterdayDate() {
  return dateKey(new Date(new Date(startOfTodayIso()).getTime() - ONE_DAY_MS));
}

function daysAgoDate(days) {
  return dateKey(new Date(new Date(startOfTodayIso()).getTime() - days * ONE_DAY_MS));
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function answerPoints(answer) {
  if (!answer.is_correct) return 0;
  const elapsedMs = Math.max(0, Math.min(QUESTION_TIME_LIMIT_MS, Number(answer.answer_time_ms || QUESTION_TIME_LIMIT_MS)));
  const remainingMs = Math.max(0, QUESTION_TIME_LIMIT_MS - elapsedMs);
  return 50 + Math.round((remainingMs / QUESTION_TIME_LIMIT_MS) * 50);
}

function duelPoints(answers) {
  const total = answers.reduce((sum, answer) => sum + answerPoints(answer), 0);
  return Math.min(100, Math.round(total / DUEL_QUESTION_COUNT));
}

function participantSide(duel, userId) {
  if (duel.user_id === userId) return "user";
  if (duel.opponent_id === userId) return "opponent";
  return "";
}

function isDuelParticipant(duel, userId) {
  return Boolean(participantSide(duel, userId));
}

function resultForSide(result, side) {
  if (side !== "opponent" || result === "draw") return result;
  if (result === "win") return "lose";
  if (result === "lose") return "win";
  return result;
}

function resultForDuel(duel) {
  if (duel.status !== "finished") return null;
  const userFp = Number(duel.fp_awarded ?? duel.user_score ?? 0);
  const opponentFp = Number(duel.opponent_fp_awarded ?? duel.opponent_score ?? 0);
  if (userFp > opponentFp) return "win";
  if (userFp < opponentFp) return "lose";
  return "draw";
}

function scoreForSide(duel, side) {
  return side === "opponent"
    ? { mine: Number(duel.opponent_score || 0), theirs: Number(duel.user_score || 0) }
    : { mine: Number(duel.user_score || 0), theirs: Number(duel.opponent_score || 0) };
}

function isRecentlyOnline(user) {
  return Boolean(user?.last_seen_at && Date.now() - new Date(user.last_seen_at).getTime() <= ONLINE_CUTOFF_MS);
}

function duelAnswerDeadlineMs(duel) {
  const startsAt = duel.starts_at || duel.started_at;
  return new Date(startsAt).getTime() + (DUEL_QUESTION_COUNT * QUESTION_TIME_LIMIT_MS) + DUEL_SETTLE_GRACE_MS;
}

async function duelsTodayCount(db, userId) {
  const result = await db
    .from("duels")
    .select("id", { count: "exact", head: true })
    .or(`user_id.eq.${userId},opponent_id.eq.${userId}`)
    .gte("started_at", startOfTodayIso());
  if (result.error) throw result.error;
  return result.count || 0;
}

function ensureSeedOnce(db) {
  seedPromise ||= ensureSeed(db).catch((error) => {
    seedPromise = undefined;
    throw error;
  });
  return seedPromise;
}

async function loadSeedData() {
  // Keep seed data as a lazy import so public auth/reset routes do not crash
  // when api/data.js is missing or not copied during deployment.
  seedModulePromise ||= import("./data.js").catch((error) => {
    seedModulePromise = undefined;
    const message = error?.code === "ERR_MODULE_NOT_FOUND"
      ? "api/data.js belum ada di deployment. Copy data.js ke folder api/ karena [...path].js memakai import ./data.js."
      : error?.message || "Seed data gagal dimuat.";
    throw Object.assign(new Error(message), { status: 500 });
  });
  return seedModulePromise;
}

async function ensureSeed(db) {
  const { makeBadgeSeeds, seedQuestions } = await loadSeedData();
  const badgeSeeds = makeBadgeSeeds();
  const badgeCount = await db.from("badges").select("id", { count: "exact", head: true });
  if (!badgeCount.error && !badgeCount.count) {
    unwrap(await db.from("badges").insert(badgeSeeds));
  } else {
    unwrap(await db.from("badges").upsert(badgeSeeds, { onConflict: "id" }));
  }

  const questionCount = await db.from("questions").select("id", { count: "exact", head: true });
  if (!questionCount.error && !questionCount.count) {
    unwrap(await db.from("questions").insert(seedQuestions.map((q, index) => ({
      id: `q_${String(index + 1).padStart(3, "0")}`,
      category: q[0],
      question: q[2],
      option_a: q[3],
      option_b: q[4],
      option_c: q[5],
      option_d: q[6],
      correct_option: q[7],
      active: true,
    }))));
  }

  const userCount = await db.from("users").select("id", { count: "exact", head: true });
  if (!userCount.error && !userCount.count) {
    const demoHash = hashPassword("ForgeDemo123!");
    const samples = [
      ["Valiant", "valiant", "+628100000001", "Manado", "male", 12450, 90, 2, "#d4af37"],
      ["Lunara", "lunara", "+628100000002", "Tomohon", "female", 8200, 62, 8, "#9b111e"],
      ["Aether", "aether", "+628100000003", "Bitung", "male", 6320, 51, 5, "#2f6f9f"],
      ["Zenith", "zenith", "+628100000004", "Minahasa", "female", 4480, 34, 3, "#6a4fb3"],
      ["Nyx", "nyx", "+628100000005", "Manado", "female", 3180, 28, 1, "#2f8e5f"],
    ];
    const users = samples.map(([name, username, phone, city, gender, fp, wins, streak]) => ({
      id: id("user"),
      given_id: randomGivenId(),
      name,
      username,
      phone,
      city,
      gender,
      password_hash: demoHash,
      lifetime_fp: fp,
      weekly_fp: Math.floor(fp / 4),
      wins,
      fire_streak_days: streak,
      last_fire_date: todayDate(),
      last_seen_at: new Date().toISOString(),
    }));
    unwrap(await db.from("users").insert(users));
    unwrap(await db.from("user_settings").insert(users.map((user) => ({ user_id: user.id }))));
  }
}

async function ensureWeeklySeason(db) {
  const currentWeek = weekKey();
  if (weeklySeasonCheckedKey === currentWeek) return;

  const state = unwrap(await db.from("system_settings").select("value").eq("key", "current_week_key").maybeSingle());

  if (!state) {
    unwrap(await db.from("system_settings").upsert({
      key: "current_week_key",
      value: currentWeek,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" }));
    weeklySeasonCheckedKey = currentWeek;
    return;
  }

  if (state.value === currentWeek) {
    weeklySeasonCheckedKey = currentWeek;
    return;
  }

  const previousWeek = state.value;
  const existingSnapshot = await db
    .from("weekly_rank_snapshots")
    .select("week_key", { count: "exact", head: true })
    .eq("week_key", previousWeek);

  if (!existingSnapshot.error && !existingSnapshot.count) {
    const leaders = unwrap(await db
      .from("users")
      .select("id, weekly_fp, lifetime_fp, created_at")
      .gt("weekly_fp", 0)
      .order("weekly_fp", { ascending: false })
      .order("lifetime_fp", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(3));

    if (leaders.length) {
      unwrap(await db.from("weekly_rank_snapshots").upsert(leaders.map((leader, index) => ({
        week_key: previousWeek,
        user_id: leader.id,
        rank: index + 1,
        weekly_fp: leader.weekly_fp,
      })), { onConflict: "week_key,rank" }));

      for (const leader of leaders) {
        await awardBadges(db, leader.id);
      }
    }
  }

  unwrap(await db.from("users").update({ weekly_fp: 0 }).neq("id", ""));
  unwrap(await db.from("system_settings").upsert({
    key: "current_week_key",
    value: currentWeek,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" }));
  weeklySeasonCheckedKey = currentWeek;
}

async function generateUniqueGivenId(db) {
  for (let i = 0; i < 8; i += 1) {
    const candidate = randomGivenId();
    const row = unwrap(await db.from("users").select("id").eq("given_id", candidate).maybeSingle());
    if (!row) return candidate;
  }
  return String(Date.now()).slice(-7);
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function randomResetCode() {
  const value = Number(`0x${randomBytes(4).toString("hex")}`) % 1000000;
  return String(value).padStart(6, "0");
}

function badgeNumber(badge = {}) {
  const match = String(badge.id || "").match(/_(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function badgeGroupOrder(badge = {}) {
  const number = badgeNumber(badge);
  if (number <= 10) return 10;   // Duel count
  if (number <= 20) return 20;   // Wins
  if (number <= 30) return 30;   // Win streak
  if (number <= 40) return 40;   // Lifetime FP
  if (number <= 50) return 50;   // Bible
  if (number <= 60) return 60;   // Character
  if (number <= 70) return 70;   // Technology
  if (number <= 80) return 80;   // Geography
  if (number <= 90) return 90;   // Logic
  if (number <= 100) return 100; // General knowledge
  if (number <= 110) return 110; // Health
  if (number <= 120) return 120; // Psychology
  if (number <= 130) return 130; // Economy
  if (number <= 140) return 140; // English
  if (number <= 150) return 150; // Weekly ranks
  return 999;
}

function compareBadgesByGroup(a, b) {
  return badgeGroupOrder(a) - badgeGroupOrder(b) || badgeNumber(a) - badgeNumber(b) || String(a.name || "").localeCompare(String(b.name || ""));
}

const SECRET_BADGE_NAMES = new Set([
  "flawless round",
  "speed strike",
  "clutch victor",
  "perfect brain",
  "top ten week",
  "bronze week",
  "silver week",
  "gold week",
  "c for christ",
  "peak of forge",
]);

function isSecretBadge(badge = {}) {
  const number = badgeNumber(badge);
  const normalizedName = String(badge.name || "").trim().toLowerCase();
  return (number >= 141 && number <= 150) || SECRET_BADGE_NAMES.has(normalizedName);
}

function adminIdentifiers() {
  return String(process.env.ADMIN_USERS || process.env.ADMIN_USERNAMES || process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminUser(user = {}) {
  const allowed = adminIdentifiers();
  if (!allowed.length) return false;
  const candidates = [user.id, user.username, user.email, user.given_id]
    .filter(Boolean)
    .map((item) => String(item).trim().toLowerCase());
  return allowed.some((item) => candidates.includes(item));
}

function normalizeSenderEmail(value = "") {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function resetSenderFromEnv() {
  const directFrom = normalizeSenderEmail(process.env.RESET_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || "");
  if (directFrom) return directFrom;

  const fromEmail = normalizeSenderEmail(process.env.RESET_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "");
  const fromName = normalizeSenderEmail(process.env.RESET_FROM_NAME || "FORGE");
  if (fromEmail) return `${fromName} <${fromEmail}>`;

  return "FORGE <onboarding@resend.dev>";
}

function resendErrorMessage(status, detail = "") {
  const message = String(detail || "").trim();
  if (status === 403 && /own email address|verify a domain|resend\.dev|domain/i.test(message)) {
    return "Resend menolak pengiriman. Kalau memakai onboarding@resend.dev, email tujuan harus sama dengan email akun Resend. Untuk kirim ke user lain, verify domain dulu di Resend lalu pakai sender dari domain itu.";
  }
  if (status === 401 || /api key|unauthorized|invalid/i.test(message)) {
    return "RESEND_API_KEY tidak valid atau belum tersimpan di Environment Variables Vercel.";
  }
  if (status === 422 || /from|sender|domain/i.test(message)) {
    return "RESET_FROM_EMAIL belum benar. Format aman: FORGE <onboarding@resend.dev> atau FORGE <noreply@domain-terverifikasi.com>.";
  }
  return message || "Cek RESEND_API_KEY, RESET_FROM_EMAIL, dan domain sender Resend.";
}

async function sendPasswordResetEmail(email, code) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = resetSenderFromEnv();
  const replyTo = normalizeSenderEmail(process.env.RESET_REPLY_TO_EMAIL || process.env.FORGE_SUPPORT_EMAIL || "");
  const timeoutMs = Math.max(3000, Math.min(15000, Number(process.env.RESEND_TIMEOUT_MS || 8000)));

  if (!apiKey) {
    throw Object.assign(new Error("Email reset belum dikonfigurasi admin. Isi RESEND_API_KEY di Environment Variables Vercel."), { status: 500 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let responseText = "";
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "user-agent": "FORGE-reset/1.0",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Kode Reset Password FORGE",
        text: `Kode reset password FORGE kamu: ${code}. Kode berlaku 15 menit. Abaikan email ini kalau kamu tidak meminta reset password.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#2a211e"><p>Kode reset password FORGE kamu:</p><h1 style="letter-spacing:6px;color:#9b111e">${code}</h1><p>Kode berlaku 15 menit.</p><p>Abaikan email ini kalau kamu tidak meminta reset password.</p></div>`,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    responseText = await response.text().catch(() => "");
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    throw Object.assign(new Error(isAbort
      ? "Email reset timeout saat menghubungi Resend. Coba lagi, atau cek Vercel Function Region/network."
      : `Email reset gagal terhubung ke Resend: ${error.message || "network error"}`), { status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let detail = responseText;
    try {
      const parsed = responseText ? JSON.parse(responseText) : null;
      detail = parsed?.message || parsed?.error || parsed?.name || responseText;
    } catch {
      // Keep raw text if Resend returns non-JSON.
    }
    throw Object.assign(new Error(`Email reset gagal dikirim via Resend (${response.status}). ${resendErrorMessage(response.status, detail)}`), { status: 502 });
  }
}

async function requestPasswordReset(req, res, db) {
  // Kalau nanti sudah beli domain dan domain sender Resend sudah verified,
  // aktifkan kembali logic kirim kode 6 digit via Resend di sini.
  // Untuk sementara, reset password dibantu manual oleh admin via WhatsApp.
  return send(res, 503, {
    error: "Fitur reset password lewat email belum aktif. Silakan hubungi admin FORGE via WhatsApp 081392187414 untuk bantuan reset password.",
    disabled: true,
    contact: "081392187414",
  });
}

async function confirmPasswordReset(req, res, db) {
  // Kalau nanti sudah beli domain, endpoint confirm kode email bisa diaktifkan lagi.
  return send(res, 503, {
    error: "Fitur reset password lewat email belum aktif. Silakan hubungi admin FORGE via WhatsApp 081392187414.",
    disabled: true,
    contact: "081392187414",
  });
}

async function adminResetPassword(req, res, db, adminUser) {
  const data = body(req);
  const configuredKey = String(process.env.ADMIN_RESET_KEY || "").trim();
  const adminKey = String(data.adminKey || "").trim();
  const identifier = String(data.identifier || data.username || data.email || "").trim();
  const newPassword = String(data.newPassword || data.password || "");

  if (!isAdminUser(adminUser)) {
    return send(res, 403, { error: "Fitur reset password user hanya untuk akun admin." });
  }
  if (!configuredKey) {
    return send(res, 500, { error: "ADMIN_RESET_KEY belum diisi di Environment Variables Vercel." });
  }
  if (!adminKey || await digest(adminKey) !== await digest(configuredKey)) {
    return send(res, 403, { error: "Admin key salah. Reset password ditolak." });
  }
  if (identifier.length < 3) {
    return send(res, 400, { error: "Isi username, email, atau ID pemain yang valid." });
  }
  if (newPassword.length < 8) {
    return send(res, 400, { error: "Password baru minimal 8 karakter." });
  }

  const normalizedIdentifier = normalizeEmail(identifier);
  const usernameIdentifier = identifier.toLowerCase();
  let user = unwrap(await db.from("users").select("id, username, email, given_id").eq("username", usernameIdentifier).maybeSingle());
  if (!user && isValidEmail(normalizedIdentifier)) {
    user = unwrap(await db.from("users").select("id, username, email, given_id").eq("email", normalizedIdentifier).maybeSingle());
  }
  if (!user) {
    user = unwrap(await db.from("users").select("id, username, email, given_id").eq("given_id", identifier).maybeSingle());
  }
  if (!user) {
    return send(res, 404, { error: "Akun tidak ditemukan. Cek lagi username, email, atau ID pemain." });
  }

  unwrap(await db.from("users").update({ password_hash: hashPassword(newPassword) }).eq("id", user.id));
  await db.from("sessions").delete().eq("user_id", user.id);

  return send(res, 200, {
    ok: true,
    message: `Password @${user.username} berhasil direset. User harus login dengan password baru.`,
    user: { username: user.username, email: user.email, given_id: user.given_id },
  });
}

async function register(req, res, db) {
  const data = body(req);
  const name = String(data.name || "").trim();
  const username = String(data.username || "").trim().toLowerCase();
  const phone = String(data.phone || "").trim();
  const email = normalizeEmail(data.email);
  const password = String(data.password || "");
  const city = String(data.city || "").trim();
  const gender = ["male", "female"].includes(data.gender) ? data.gender : "male";
  if (name.length < 2) return send(res, 400, { error: "Nama minimal 2 karakter." });
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return send(res, 400, { error: "Username harus 3-24 karakter: huruf, angka, underscore." });
  if (!/^\+?[0-9][0-9\s-]{7,18}$/.test(phone)) return send(res, 400, { error: "Nomor WhatsApp tidak valid." });
  if (!isValidEmail(email)) return send(res, 400, { error: "Email aktif tidak valid." });
  if (password.length < 8) return send(res, 400, { error: "Password minimal 8 karakter." });
  if (city.length < 2 || city.length > 60) return send(res, 400, { error: "Kota wajib diisi, maksimal 60 karakter." });

  const existingUsername = unwrap(await db.from("users").select("id").eq("username", username).maybeSingle());
  const existingPhone = unwrap(await db.from("users").select("id").eq("phone", phone).maybeSingle());
  const existingEmail = unwrap(await db.from("users").select("id").eq("email", email).maybeSingle());
  if (existingUsername || existingPhone || existingEmail) return send(res, 400, { error: "Username, nomor WhatsApp, atau email sudah dipakai." });

  const userId = id("user");
  unwrap(await db.from("users").insert({
    id: userId,
    given_id: await generateUniqueGivenId(db),
    name,
    username,
    phone,
    email,
    city,
    gender,
    password_hash: hashPassword(password),
  }));
  unwrap(await db.from("user_settings").insert({ user_id: userId }));
  return send(res, 200, { ok: true });
}

async function login(req, res, db) {
  const data = body(req);
  const username = String(data.username || "").trim().toLowerCase();
  const user = unwrap(await db.from("users").select("*").eq("username", username).maybeSingle());
  if (!user || !verifyPassword(String(data.password || ""), user.password_hash)) {
    return send(res, 401, { error: "Username atau password salah." });
  }
  const token = id("sess");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * ONE_DAY_MS).toISOString();
  await db.from("sessions").delete().eq("user_id", user.id);
  unwrap(await db.from("sessions").insert({
    token_hash: await digest(token),
    user_id: user.id,
    expires_at: expiresAt,
    user_agent: req.headers["user-agent"] || "",
    ip_hint: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
  }));
  await runStorageMaintenance(db, user.id);
  await db.from("users").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);
  return send(res, 200, { ok: true, sessionToken: token }, { "Set-Cookie": sessionCookie(token) });
}

async function logout(req, res, db) {
  const token = bearerToken(req) || cookie(req, "forge_session");
  if (token) await db.from("sessions").delete().eq("token_hash", await digest(token));
  return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", true) });
}

async function requireUser(req, db) {
  const token = bearerToken(req) || cookie(req, "forge_session");
  if (!token) throw Object.assign(new Error("Silakan login dulu."), { status: 401 });
  const session = unwrap(await db.from("sessions").select("user_id, expires_at").eq("token_hash", await digest(token)).maybeSingle());
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error("Session expired."), { status: 401 });
  }
  const user = unwrap(await db.from("users").select("*").eq("id", session.user_id).single());
  await Promise.all([
    db.from("users").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id),
    db.from("sessions").update({ expires_at: new Date(Date.now() + SESSION_DAYS * ONE_DAY_MS).toISOString() }).eq("token_hash", await digest(token)),
  ]);
  return user;
}

async function settingsFor(db, userId) {
  let settings = unwrap(await db.from("user_settings").select("*").eq("user_id", userId).maybeSingle());
  if (!settings) {
    settings = unwrap(await db.from("user_settings").insert({ user_id: userId }).select("*").single());
  }
  return settings;
}

async function mePayload(db, user) {
  const settings = await settingsFor(db, user.id);
  await runStorageMaintenance(db, user.id);
  await cleanupDuelHistory(db, user.id);
  await awardBadges(db, user.id);
  const unlocked = await db.from("user_badges").select("badge_id", { count: "exact", head: true }).eq("user_id", user.id);
  const total = await db.from("badges").select("id", { count: "exact", head: true });
  const leaders = unwrap(await db.from("users").select("id, username, weekly_fp, lifetime_fp, created_at").order("weekly_fp", { ascending: false }).order("lifetime_fp", { ascending: false }).order("created_at", { ascending: true }).limit(200));
  const myRank = leaders.findIndex((row) => row.id === user.id) + 1 || null;
  const duelsToday = await duelsTodayCount(db, user.id);
  const duelRows = unwrap(await db
    .from("duels")
    .select("id, status, user_id, opponent_id, opponent_name, user_score, opponent_score, fp_awarded, opponent_fp_awarded, started_at, finished_at")
    .or(`user_id.eq.${user.id},opponent_id.eq.${user.id}`)
    .eq("status", "finished")
    .order("started_at", { ascending: false })
    .limit(DUEL_HISTORY_LIMIT));
  const otherUserIds = [...new Set(duelRows
    .map((duel) => duel.user_id === user.id ? duel.opponent_id : duel.user_id)
    .filter(Boolean))];
  const otherUsers = otherUserIds.length
    ? unwrap(await db.from("users").select("id, username").in("id", otherUserIds))
    : [];
  const otherById = new Map(otherUsers.map((row) => [row.id, row]));
  const duelHistory = duelRows.map((duel) => {
    const side = participantSide(duel, user.id);
    const opponentId = side === "user" ? duel.opponent_id : duel.user_id;
    return {
      ...duel,
      opponent_name: otherById.get(opponentId)?.username || duel.opponent_name || "Forge Rival",
      result: resultForSide(resultForDuel(duel), side),
      user_score: side === "user" ? duel.user_score : duel.opponent_score,
      opponent_score: side === "user" ? duel.opponent_score : duel.user_score,
      fp_awarded: side === "user" ? duel.fp_awarded : Number(duel.opponent_fp_awarded || 0),
    };
  });
  const { password_hash, ...safeUser } = user;
  return {
    user: { ...safeUser, settings, is_admin: isAdminUser(user) },
    dashboard: {
      unlockedBadges: unlocked.count || 0,
      totalBadges: total.count || 0,
      myRank,
      top3: leaders.slice(0, 3).map((row, index) => ({ ...row, rank: index + 1 })),
      duelsToday,
      dailyDuelLimit: DAILY_DUEL_LIMIT,
      duelHistory,
    },
  };
}

async function cleanupDuelHistory(db, userId) {
  const oldRows = unwrap(await db
    .from("duels")
    .select("id")
    .or(`user_id.eq.${userId},opponent_id.eq.${userId}`)
    .eq("status", "finished")
    .order("started_at", { ascending: false })
    .range(DUEL_HISTORY_LIMIT, 1000));
  if (oldRows.length) {
    unwrap(await db.from("duels").delete().in("id", oldRows.map((row) => row.id)));
  }
}

async function runStorageMaintenance(db, userId = null) {
  const now = Date.now();
  if (userId) await trimUserSessions(db, userId);
  if (now - maintenanceLastRunAt < 5 * 60 * 1000) return;
  maintenanceLastRunAt = now;
  await Promise.all([
    cleanupExpiredSessions(db),
    cleanupExpiredPasswordResetCodes(db),
    cleanupExpiredDuelRequests(db),
    cleanupDuelRequestHistory(db),
    cleanupMatchQueue(db),
    cleanupOldDuels(db),
    cleanupOldWeeklySnapshots(db),
  ]);
}

async function cleanupExpiredSessions(db) {
  await db.from("sessions").delete().lt("expires_at", new Date().toISOString());
}

async function cleanupExpiredPasswordResetCodes(db) {
  await db.from("password_reset_codes").delete().lt("expires_at", new Date().toISOString());
  await db.from("password_reset_codes").delete().not("used_at", "is", null).lt("used_at", new Date(Date.now() - ONE_DAY_MS).toISOString());
}

async function trimUserSessions(db, userId) {
  const oldSessions = unwrap(await db
    .from("sessions")
    .select("token_hash")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(SESSION_KEEP_PER_USER, 1000));
  if (oldSessions.length) {
    await db.from("sessions").delete().in("token_hash", oldSessions.map((session) => session.token_hash));
  }
}

async function cleanupDuelRequestHistory(db) {
  await cleanupAcceptedFinishedDuelRequests(db);
  const now = Date.now();
  await db.from("duel_requests").delete().in("status", ["declined", "cancelled"]).lt("responded_at", new Date(now - 60 * 60 * 1000).toISOString());
  await db.from("duel_requests").delete().eq("status", "accepted").lt("responded_at", new Date(now - 10 * 60 * 1000).toISOString());
}

async function cleanupAcceptedFinishedDuelRequests(db) {
  const rows = unwrap(await db
    .from("duel_requests")
    .select("id, duel_id")
    .eq("status", "accepted")
    .not("duel_id", "is", null)
    .limit(100));
  if (!rows.length) return;

  const duelIds = [...new Set(rows.map((row) => row.duel_id).filter(Boolean))];
  const activeDuels = duelIds.length
    ? unwrap(await db.from("duels").select("id").in("id", duelIds).eq("status", "active"))
    : [];
  const activeDuelIds = new Set(activeDuels.map((duel) => duel.id));
  const staleRequestIds = rows.filter((row) => !activeDuelIds.has(row.duel_id)).map((row) => row.id);
  if (staleRequestIds.length) {
    await db.from("duel_requests").update({ status: "cancelled", responded_at: new Date().toISOString() }).in("id", staleRequestIds);
  }
}

async function cleanupMatchQueue(db) {
  const now = Date.now();
  await db.from("duel_queue").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("status", "waiting").lt("last_seen_at", new Date(now - MATCH_QUEUE_STALE_MS).toISOString());
  await db.from("duel_queue").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("status", "matched").lt("updated_at", new Date(now - 2 * 60 * 1000).toISOString());
  await db.from("duel_queue").delete().eq("status", "cancelled").lt("updated_at", new Date(now - 60 * 60 * 1000).toISOString());
}

async function cleanupOldDuels(db) {
  const now = Date.now();
  await db.from("duels").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("status", "active").lt("started_at", new Date(now - 30 * 60 * 1000).toISOString());
  await db.from("duels").delete().in("status", ["finished", "cancelled"]).lt("finished_at", new Date(now - DATA_RETENTION_DAYS * ONE_DAY_MS).toISOString());
}

async function cleanupOldWeeklySnapshots(db) {
  // Hall of Legends only needs recent weekly winners.
  // Once a weekly snapshot is older than 2 weeks, remove it automatically.
  await db.from("weekly_rank_snapshots").delete().lt("week_key", daysAgoDate(14));
}

async function changeMyPassword(req, res, db, user) {
  const data = body(req);
  const currentPassword = String(data.currentPassword || data.oldPassword || "");
  const newPassword = String(data.newPassword || data.password || "");
  const confirmPassword = String(data.confirmPassword || "");

  if (!currentPassword) return send(res, 400, { error: "Password lama wajib diisi." });
  if (newPassword.length < 8) return send(res, 400, { error: "Password baru minimal 8 karakter." });
  if (confirmPassword && newPassword !== confirmPassword) return send(res, 400, { error: "Konfirmasi password baru tidak sama." });
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return send(res, 401, { error: "Password lama salah." });
  }
  if (verifyPassword(newPassword, user.password_hash)) {
    return send(res, 400, { error: "Password baru tidak boleh sama dengan password lama." });
  }

  unwrap(await db.from("users").update({ password_hash: hashPassword(newPassword) }).eq("id", user.id));

  // Tetap pertahankan sesi login saat ini, tapi hapus sesi lama di device lain.
  const token = bearerToken(req) || cookie(req, "forge_session");
  if (token) {
    const tokenHash = await digest(token);
    await db.from("sessions").delete().eq("user_id", user.id).neq("token_hash", tokenHash);
  }

  return send(res, 200, { ok: true, message: "Password berhasil diganti." });
}

async function updateProfile(req, res, db, user) {
  const data = body(req);
  const name = String(data.name || "").trim();
  const username = String(data.username || "").trim().toLowerCase();
  const phone = String(data.phone || "").trim();
  const email = normalizeEmail(data.email);
  const city = String(data.city || "").trim();
  const gender = ["male", "female"].includes(data.gender) ? data.gender : "";
  if (name.length < 2) return send(res, 400, { error: "Nama minimal 2 karakter." });
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return send(res, 400, { error: "Username harus 3-24 karakter." });
  if (!/^\+?[0-9][0-9\s-]{7,18}$/.test(phone)) return send(res, 400, { error: "Nomor WhatsApp tidak valid." });
  if (!isValidEmail(email)) return send(res, 400, { error: "Email aktif tidak valid." });
  if (city.length > 60) return send(res, 400, { error: "Nama kota maksimal 60 karakter." });
  const usernameExists = unwrap(await db.from("users").select("id").eq("username", username).neq("id", user.id).maybeSingle());
  if (usernameExists) return send(res, 400, { error: "Username sudah dipakai." });
  const phoneExists = unwrap(await db.from("users").select("id").eq("phone", phone).neq("id", user.id).maybeSingle());
  if (phoneExists) return send(res, 400, { error: "Nomor WhatsApp sudah dipakai." });
  const emailExists = unwrap(await db.from("users").select("id").eq("email", email).neq("id", user.id).maybeSingle());
  if (emailExists) return send(res, 400, { error: "Email sudah dipakai." });
  unwrap(await db.from("users").update({ name, username, phone, email, city, gender }).eq("id", user.id));
  return send(res, 200, { ok: true });
}

async function updateSettings(req, res, db, user) {
  const data = body(req);
  const musicEnabled = data.music_enabled === undefined ? true : Boolean(data.music_enabled);
  const sfxEnabled = data.sfx_enabled === undefined ? true : Boolean(data.sfx_enabled);
  unwrap(await db.from("user_settings").upsert({
    user_id: user.id,
    music_enabled: musicEnabled,
    sfx_enabled: sfxEnabled,
  }, { onConflict: "user_id" }));
  return send(res, 200, { ok: true });
}

async function members(req, res, db, user) {
  const q = String(req.query.q || "").trim();
  const tab = String(req.query.tab || "all");
  const rels = unwrap(await db.from("relationships").select("owner_id, target_id, is_favourite").eq("owner_id", user.id));
  const relByTarget = new Map(rels.map((rel) => [rel.target_id, rel]));
  let query = db.from("users").select("id, given_id, name, username, phone, city, gender, lifetime_fp, weekly_fp, wins, losses, draws, total_correct, total_answer_time_ms, total_answers, current_win_streak, fire_streak_days, last_seen_at").neq("id", user.id);
  if (q) query = query.or(`username.ilike.%${q}%,name.ilike.%${q}%,given_id.ilike.%${q}%`);
  if (tab === "favourites") {
    const ids = rels.filter((rel) => rel.is_favourite).map((rel) => rel.target_id);
    if (!ids.length) return send(res, 200, { members: [] });
    query = query.in("id", ids);
  }
  const rows = unwrap(await query.order("weekly_fp", { ascending: false }).order("username", { ascending: true }).limit(80));
  const onlineCutoff = Date.now() - ONLINE_CUTOFF_MS;
  const members = rows.map((member) => {
    const rel = relByTarget.get(member.id) || {};
    const online = member.last_seen_at && new Date(member.last_seen_at).getTime() > onlineCutoff;
    return { ...member, online, is_friend: true, is_favourite: Boolean(rel.is_favourite) };
  }).filter((member) => tab !== "online" || member.online);
  return send(res, 200, { members });
}

async function relation(req, res, db, user, targetId) {
  if (targetId === user.id) return send(res, 400, { error: "Tidak bisa menandai diri sendiri." });
  const data = body(req);
  if (data.type !== "favourite") return send(res, 200, { ok: true, relation: { is_friend: true, is_favourite: false } });
  const current = unwrap(await db.from("relationships").select("owner_id, target_id, is_favourite").eq("owner_id", user.id).eq("target_id", targetId).maybeSingle());
  let next;
  if (!current) {
    next = unwrap(await db.from("relationships").insert({ owner_id: user.id, target_id: targetId, is_favourite: true }).select("owner_id, target_id, is_favourite").single());
  } else {
    next = unwrap(await db.from("relationships").update({ is_favourite: !current.is_favourite }).eq("owner_id", user.id).eq("target_id", targetId).select("owner_id, target_id, is_favourite").single());
  }
  return send(res, 200, { ok: true, relation: { is_friend: true, is_favourite: Boolean(next.is_favourite) } });
}

async function inviteDuelRequest(res, db, user, targetId) {
  if (targetId === user.id) return send(res, 400, { error: "Tidak bisa invite diri sendiri." });
  await cleanupExpiredDuelRequests(db);
  const [myCount, member] = await Promise.all([
    duelsTodayCount(db, user.id),
    db.from("users").select("id, last_seen_at").eq("id", targetId).maybeSingle(),
  ]);
  if (myCount >= DAILY_DUEL_LIMIT) return send(res, 429, { error: `Limit ${DAILY_DUEL_LIMIT} duel per hari sudah tercapai.` });
  if (member.error) throw member.error;
  const target = member.data;
  if (!target) return send(res, 404, { error: "Member tidak ditemukan." });
  if (!isRecentlyOnline(target)) return send(res, 400, { error: "Member sedang offline, tidak bisa di-invite duel." });
  const opponentTodayCount = await duelsTodayCount(db, targetId);
  if (opponentTodayCount >= DAILY_DUEL_LIMIT) return send(res, 429, { error: `Lawan sudah mencapai limit ${DAILY_DUEL_LIMIT}/${DAILY_DUEL_LIMIT} hari ini.` });

  // Prevent repeated taps from creating many pending invites and making the UI/server unstable.
  // While one outgoing invite is still alive, return that invite instead of inserting/refreshing another one.
  const existingOutgoing = unwrap(await db
    .from("duel_requests")
    .select("*")
    .eq("requester_id", user.id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle());

  if (existingOutgoing) {
    return send(res, 200, {
      ok: true,
      alreadyPending: true,
      request: existingOutgoing,
      expires_in_ms: Math.max(0, new Date(existingOutgoing.expires_at).getTime() - Date.now()),
    });
  }

  const expiresAt = new Date(Date.now() + DUEL_REQUEST_WAIT_MS).toISOString();
  const request = unwrap(await db.from("duel_requests").insert({ id: id("req"), requester_id: user.id, target_id: targetId, status: "pending", expires_at: expiresAt }).select("*").single());
  return send(res, 200, { ok: true, request, expires_in_ms: DUEL_REQUEST_WAIT_MS });
}

async function duelRequests(res, db, user) {
  await cleanupExpiredDuelRequests(db);
  let rows = unwrap(await db
    .from("duel_requests")
    .select("id, created_at, expires_at, requester_id, target_id, status, duel_id")
    .or(`target_id.eq.${user.id},requester_id.eq.${user.id}`)
    .in("status", ["pending", "accepted"])
    .order("created_at", { ascending: false })
    .limit(20));

  // Jangan kirim lagi request accepted lama yang duel-nya sudah selesai/cancelled.
  // Ini mencegah polling invite lama memanggil beginDuel() lagi setelah duel pertama selesai.
  const acceptedDuelIds = [...new Set(rows
    .filter((row) => row.status === "accepted" && row.duel_id)
    .map((row) => row.duel_id))];
  if (acceptedDuelIds.length) {
    const activeDuels = unwrap(await db
      .from("duels")
      .select("id, status")
      .in("id", acceptedDuelIds)
      .eq("status", "active"));
    const activeDuelIds = new Set(activeDuels.map((duel) => duel.id));
    const staleAcceptedIds = rows
      .filter((row) => row.status === "accepted" && row.duel_id && !activeDuelIds.has(row.duel_id))
      .map((row) => row.id);
    if (staleAcceptedIds.length) {
      await db.from("duel_requests").update({ status: "cancelled", responded_at: new Date().toISOString() }).in("id", staleAcceptedIds);
    }
    rows = rows.filter((row) => row.status !== "accepted" || (row.duel_id && activeDuelIds.has(row.duel_id)));
  }

  const requesterIds = [...new Set(rows.map((row) => row.requester_id))];
  const targetIds = [...new Set(rows.map((row) => row.target_id))];
  const userIds = [...new Set([...requesterIds, ...targetIds])];
  const requesters = requesterIds.length
    ? unwrap(await db.from("users").select("id, username, name").in("id", requesterIds))
    : [];
  const users = userIds.length
    ? unwrap(await db.from("users").select("id, username, name").in("id", userIds))
    : [];
  const byId = new Map(requesters.map((requester) => [requester.id, requester]));
  const userById = new Map(users.map((row) => [row.id, row]));
  const incoming = rows.filter((row) => row.target_id === user.id && row.status === "pending");
  const outgoing = rows.filter((row) => row.requester_id === user.id);
  const nowMs = Date.now();
  const withCountdown = (row) => ({
    ...row,
    expires_in_ms: Math.max(0, new Date(row.expires_at).getTime() - nowMs),
  });
  return send(res, 200, {
    requests: incoming.map((row) => ({
      ...withCountdown(row),
      id: row.id,
      created_at: row.created_at,
      expires_at: row.expires_at,
      requester_id: row.requester_id,
      requester_username: byId.get(row.requester_id)?.username || "member",
      requester_name: byId.get(row.requester_id)?.name || "Member",
    })),
    outgoing: outgoing.map((row) => ({
      ...withCountdown(row),
      id: row.id,
      status: row.status,
      created_at: row.created_at,
      expires_at: row.expires_at,
      duel_id: row.duel_id,
      target_id: row.target_id,
      target_username: userById.get(row.target_id)?.username || "member",
      target_name: userById.get(row.target_id)?.name || "Member",
    })),
  });
}

async function respondDuelRequest(req, res, db, user, requestId) {
  const data = body(req);
  await cleanupExpiredDuelRequests(db);
  const row = unwrap(await db.from("duel_requests").select("*").eq("id", requestId).eq("target_id", user.id).eq("status", "pending").maybeSingle());
  if (!row) return send(res, 404, { error: "Request duel tidak ditemukan." });
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    unwrap(await db.from("duel_requests").update({ status: "cancelled", responded_at: new Date().toISOString() }).eq("id", requestId));
    return send(res, 400, { error: "Waktu accept sudah lewat 20 detik." });
  }
  if (data.action !== "accept") {
    unwrap(await db.from("duel_requests").update({ status: "declined", responded_at: new Date().toISOString() }).eq("id", requestId));
    return send(res, 200, { ok: true });
  }
  const duel = await createDuel(db, user, row.requester_id);
  unwrap(await db.from("duel_requests").update({ status: "accepted", responded_at: new Date().toISOString(), duel_id: duel.id }).eq("id", requestId));
  return send(res, 200, { ok: true, duel });
}

async function cleanupExpiredDuelRequests(db) {
  await db
    .from("duel_requests")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());
}

async function leaderboard(res, db, viewer = null) {
  await cleanupOldWeeklySnapshots(db);
  const rows = unwrap(await db
    .from("users")
    .select("id, name, username, gender, lifetime_fp, weekly_fp, fire_streak_days")
    .order("weekly_fp", { ascending: false })
    .order("lifetime_fp", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(200));

  const ranked = rows.map((row, index) => ({
    id: row.id,
    name: row.name,
    username: row.username,
    gender: row.gender,
    lifetime_fp: Number(row.lifetime_fp || 0),
    weekly_fp: Number(row.weekly_fp || 0),
    fire_streak_days: Number(row.fire_streak_days || 0),
    rank: index + 1,
    is_me: row.id === viewer?.id,
  }));

  const fire = [...rows]
    .sort((a, b) => Number(b.fire_streak_days || 0) - Number(a.fire_streak_days || 0))
    .slice(0, 3)
    .map(({ username, fire_streak_days }) => ({ username, fire_streak_days }));

  const lifetime = [...rows]
    .sort((a, b) => Number(b.lifetime_fp || 0) - Number(a.lifetime_fp || 0))
    .slice(0, 3)
    .map(({ username, lifetime_fp }) => ({ username, lifetime_fp }));

  const latestSnapshot = unwrap(await db
    .from("weekly_rank_snapshots")
    .select("week_key")
    .order("week_key", { ascending: false })
    .limit(1)
    .maybeSingle());
  const previousWeekRows = latestSnapshot
    ? unwrap(await db
      .from("weekly_rank_snapshots")
      .select("user_id, week_key, rank, weekly_fp, created_at")
      .eq("week_key", latestSnapshot.week_key)
      .order("rank", { ascending: true })
      .limit(3))
    : [];
  const snapshotUserIds = [...new Set(previousWeekRows.map((row) => row.user_id))];
  const snapshotUsers = snapshotUserIds.length
    ? unwrap(await db.from("users").select("id, name, username").in("id", snapshotUserIds))
    : [];
  const snapshotByUser = new Map(snapshotUsers.map((user) => [user.id, user]));
  const lastWinners = previousWeekRows.map((row) => ({
    ...row,
    name: snapshotByUser.get(row.user_id)?.name || "Member",
    username: snapshotByUser.get(row.user_id)?.username || "member",
  }));

  return send(res, 200, {
    rows: ranked,
    legends: { lastWeek: lastWinners, fire, lifetime },
    weekly: {
      currentWeek: weekKey(),
      recapAt: "Minggu 23:50 WIB",
      resetAt: "Senin 00:00 WIB",
      lastWinners,
    },
  });
}

async function badges(res, db, user) {
  await awardBadges(db, user.id);
  const badgeRows = unwrap(await db.from("badges").select("id, name, description, img_url"));
  const earned = unwrap(await db.from("user_badges").select("*").eq("user_id", user.id));
  const earnedById = new Map(earned.map((item) => [item.badge_id, item.earned_at]));
  const badges = badgeRows
    .map((badge) => {
      const earnedAt = earnedById.get(badge.id) || null;
      if (!earnedAt) {
        const secret = isSecretBadge(badge);
        return {
          id: badge.id,
          name: secret ? "???" : badge.name,
          real_name: badge.name,
          description: secret
            ? "Nama dan syarat badge ini masih tersembunyi sampai kamu berhasil membukanya."
            : "Syarat badge ini masih tersembunyi sampai kamu berhasil membukanya.",
          img_url: null,
          earned_at: null,
          locked: true,
          secret_locked: secret,
        };
      }
      return { ...badge, real_name: badge.name, earned_at: earnedAt, locked: false, secret_locked: false };
    })
    .sort((a, b) => {
      if (a.earned_at && !b.earned_at) return -1;
      if (!a.earned_at && b.earned_at) return 1;
      return compareBadgesByGroup(a, b);
    });
  return send(res, 200, { total: badges.length, unlocked: earned.length, badges });
}

async function startDuel(res, db, user) {
  return send(res, 200, await joinMatchmaking(db, user));
}

async function joinMatchmaking(db, user) {
  // Question selection is now owned by the database RPC.
  // This keeps the frontend/API from accidentally bypassing the daily 50-question pool.
  const rpcResult = await db.rpc("match_duel_queue", {
    p_user_id: user.id,
    p_question_ids: [],
    p_day_start: startOfTodayIso(),
    p_daily_limit: DAILY_DUEL_LIMIT,
  });

  if (rpcResult.error) {
    throw normalizeDuelPoolError(rpcResult.error);
  }

  const result = rpcResult.data;
  const match = Array.isArray(result) ? result[0] : result;

  if (!match?.matched || !match.duel_id) {
    return {
      waiting: true,
      message: "Menunggu lawan online. Jangan tutup halaman ini.",
      queue: { staleInMs: MATCH_QUEUE_STALE_MS },
    };
  }

  const duel = unwrap(await db.from("duels").select("*").eq("id", match.duel_id).single());
  return { duel: await duelPayload(db, duel, user.id) };
}

function normalizeDuelPoolError(error) {
  const message = String(error?.message || "");

  if (message.includes("LIMIT_REACHED")) {
    return Object.assign(new Error(`Limit ${DAILY_DUEL_LIMIT} duel per hari sudah tercapai.`), { status: 429 });
  }

  if (message.includes("QUESTION_POOL_NOT_READY") || message.includes("DAILY_POOL_GENERATION_FAILED")) {
    return Object.assign(new Error(`Bank soal minimal ${DUEL_QUESTION_COUNT} pertanyaan belum tersedia.`), { status: 500 });
  }

  if (message.includes("NOT_ENOUGH_ACTIVE_QUESTIONS")) {
    return Object.assign(new Error(`Stok soal harian belum cukup. Pastikan setiap kategori punya minimal ${DAILY_CATEGORY_QUESTION_COUNT} soal aktif.`), { status: 400 });
  }

  if (message.includes("DAILY_POOL_INCOMPLETE")) {
    return Object.assign(new Error("Daily question pool hari ini belum lengkap. Jalankan ulang generate_daily_question_pool atau coba start duel sekali lagi."), { status: 500 });
  }

  return error;
}

async function matchmakingStatus(res, db, user) {
  const queue = unwrap(await db
    .from("duel_queue")
    .select("status, duel_id, last_seen_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle());
  if (!queue || queue.status === "cancelled") {
    return send(res, 200, { waiting: false, cancelled: true });
  }

  if (queue.status === "matched" && queue.duel_id) {
    const duel = unwrap(await db.from("duels").select("*").eq("id", queue.duel_id).maybeSingle());
    if (duel && isDuelParticipant(duel, user.id)) {
      return send(res, 200, { waiting: false, duel: await duelPayload(db, duel, user.id) });
    }
  }

  if (queue.status === "waiting" && new Date(queue.last_seen_at).getTime() <= Date.now() - MATCH_QUEUE_STALE_MS) {
    unwrap(await db.from("duel_queue").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("status", "waiting"));
    return send(res, 200, { waiting: false, cancelled: true });
  }

  unwrap(await db.from("duel_queue").update({
    updated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }).eq("user_id", user.id).eq("status", "waiting"));
  return send(res, 200, { waiting: true });
}

async function cancelMatchmaking(res, db, user) {
  unwrap(await db.from("duel_queue").update({
    status: "cancelled",
    updated_at: new Date().toISOString(),
  }).eq("user_id", user.id).eq("status", "waiting"));
  return send(res, 200, { ok: true });
}

async function getDuel(res, db, user, duelId) {
  const duel = unwrap(await db.from("duels").select("*").eq("id", duelId).maybeSingle());
  if (!duel || !isDuelParticipant(duel, user.id)) return send(res, 404, { error: "Duel tidak ditemukan." });
  return send(res, 200, { duel: await duelPayload(db, duel, user.id) });
}

async function duelStatus(res, db, user, duelId) {
  const duel = unwrap(await db.from("duels").select("*").eq("id", duelId).maybeSingle());
  if (!duel || !isDuelParticipant(duel, user.id)) return send(res, 404, { error: "Duel tidak ditemukan." });
  return send(res, 200, { status: await duelStatusPayload(db, duel, user.id) });
}

async function ensureDailyQuestionPool(db, force = false) {
  // Self-healing daily pool.
  // The database function creates 50 questions/day: 10 categories x 5 questions.
  // When a question enters a pool, questions.used_in_pool becomes true, but active stays true for admin control.
  const result = await db.rpc("generate_daily_question_pool", {
    p_pool_date: todayDate(),
    p_per_category: DAILY_CATEGORY_QUESTION_COUNT,
    p_force_regenerate: Boolean(force),
  });

  if (result.error) {
    throw normalizeDuelPoolError(result.error);
  }

  return Number(result.data || 0);
}

async function dailyDuelQuestions(db) {
  const result = await db.rpc("get_daily_duel_question_ids", {
    p_pool_date: todayDate(),
    p_limit: DUEL_QUESTION_COUNT,
  });

  if (result.error) {
    throw normalizeDuelPoolError(result.error);
  }

  const selectedIds = Array.isArray(result.data) ? result.data : [];
  if (selectedIds.length < DUEL_QUESTION_COUNT) {
    throw Object.assign(new Error(`Bank soal minimal ${DUEL_QUESTION_COUNT} pertanyaan belum tersedia.`), { status: 500 });
  }

  const rows = unwrap(await db.from("questions").select("*").in("id", selectedIds));
  const byId = new Map(rows.map((question) => [question.id, question]));
  return selectedIds.map((questionId) => byId.get(questionId)).filter(Boolean);
}

async function duelQuestions(db, duelId) {
  const rows = unwrap(await db
    .from("duel_questions")
    .select("question_id, position")
    .eq("duel_id", duelId)
    .order("position", { ascending: true }));
  const ids = rows.map((row) => row.question_id);
  if (!ids.length) return [];
  const questions = unwrap(await db.from("questions").select("*").in("id", ids));
  const byId = new Map(questions.map((question) => [question.id, question]));
  return rows.map((row) => byId.get(row.question_id)).filter(Boolean);
}

async function duelPayload(db, duel, viewerId) {
  const questions = await ensureDuelQuestionSet(db, duel);
  const opponentId = participantSide(duel, viewerId) === "user" ? duel.opponent_id : duel.user_id;
  const opponent = opponentId
    ? unwrap(await db.from("users").select("id, username, gender").eq("id", opponentId).maybeSingle())
    : null;
  return duelPayloadFromQuestions(duel, questions, viewerId, opponent);
}

async function ensureDuelQuestionSet(db, duel) {
  let questions = await duelQuestions(db, duel.id);
  if (questions.length >= DUEL_QUESTION_COUNT) return questions;

  const existingAnswers = await db
    .from("duel_answers")
    .select("duel_id", { count: "exact", head: true })
    .eq("duel_id", duel.id);
  if (existingAnswers.error) throw existingAnswers.error;

  if (duel.status !== "active" || Number(existingAnswers.count || 0) > 0) {
    throw Object.assign(new Error("Soal duel tidak lengkap. Duel ini tidak bisa dilanjutkan."), { status: 409 });
  }

  const selectedQuestions = await dailyDuelQuestions(db);
  if (selectedQuestions.length < DUEL_QUESTION_COUNT) {
    throw Object.assign(new Error(`Bank soal minimal ${DUEL_QUESTION_COUNT} pertanyaan belum tersedia.`), { status: 500 });
  }

  await db.from("duel_questions").delete().eq("duel_id", duel.id);
  unwrap(await db.from("duel_questions").insert(selectedQuestions.map((question, index) => ({
    duel_id: duel.id,
    question_id: question.id,
    position: index + 1,
  }))));

  questions = await duelQuestions(db, duel.id);
  if (questions.length < DUEL_QUESTION_COUNT) {
    throw Object.assign(new Error("Soal duel gagal dimuat. Coba mulai duel baru."), { status: 500 });
  }
  return questions;
}

function duelPayloadFromQuestions(duel, questions, viewerId, opponent = null) {
  const side = participantSide(duel, viewerId) || "user";
  const score = scoreForSide(duel, side);
  return {
    id: duel.id,
    mode: duel.opponent_id ? "realtime" : "unmatched",
    side,
    opponent_id: opponent?.id || (side === "user" ? duel.opponent_id : duel.user_id),
    status: duel.status,
    starts_at: duel.starts_at || duel.started_at,
    server_now: new Date().toISOString(),
    result: resultForSide(resultForDuel(duel), side),
    opponent_name: opponent?.username || duel.opponent_name || "Forge Rival",
    opponent_gender: opponent?.gender || "male",
    opponent_score: score.theirs,
    questions,
  };
}

async function duelStatusPayload(db, duel, viewerId) {
  const side = participantSide(duel, viewerId);
  const answers = unwrap(await db
    .from("duel_answers")
    .select("duel_id, question_id, user_id, selected_option, is_correct, answer_time_ms, answered_at")
    .eq("duel_id", duel.id)
    .order("answered_at", { ascending: true }));
  const mineId = side === "opponent" ? duel.opponent_id : duel.user_id;
  const theirsId = side === "opponent" ? duel.user_id : duel.opponent_id;
  const mine = answers.filter((answer) => answer.user_id === mineId);
  const theirs = answers.filter((answer) => answer.user_id === theirsId);
  const score = scoreForSide(duel, side);
  const publicAnswer = (answer) => ({
    questionId: answer.question_id,
    isCorrect: Boolean(answer.is_correct),
    answeredAt: answer.answered_at,
  });
  return {
    duelId: duel.id,
    status: duel.status,
    server_now: new Date().toISOString(),
    result: resultForSide(resultForDuel(duel), side),
    mineAnswered: mine.length,
    opponentAnswered: duel.opponent_id ? theirs.length : Math.min(mine.length, DUEL_QUESTION_COUNT),
    mineAnswers: mine.map(publicAnswer),
    opponentAnswers: duel.opponent_id ? theirs.map(publicAnswer) : [],
    mineScore: duel.status === "finished" ? score.mine : mine.filter((answer) => answer.is_correct).length,
    opponentScore: duel.status === "finished" ? score.theirs : duel.opponent_id ? theirs.filter((answer) => answer.is_correct).length : Number(duel.opponent_score || 0),
    fpAwarded: side === "opponent" ? Number(duel.opponent_fp_awarded || 0) : Number(duel.fp_awarded || 0),
  };
}

async function createDuel(db, user, opponentId = null) {
  if (!opponentId) {
    throw Object.assign(new Error("Menunggu lawan online. Duel tidak dibuat dengan bot/template offline."), { status: 400 });
  }
  const todayCount = await duelsTodayCount(db, user.id);
  if (todayCount >= DAILY_DUEL_LIMIT) throw Object.assign(new Error(`Limit ${DAILY_DUEL_LIMIT} duel per hari sudah tercapai.`), { status: 429 });
  const opponentTodayCount = await duelsTodayCount(db, opponentId);
  if (opponentTodayCount >= DAILY_DUEL_LIMIT) {
    throw Object.assign(new Error(`Lawan sudah mencapai limit ${DAILY_DUEL_LIMIT} duel hari ini.`), { status: 429 });
  }

  const questions = await dailyDuelQuestions(db);
  if (questions.length < DUEL_QUESTION_COUNT) {
    throw Object.assign(new Error(`Bank soal minimal ${DUEL_QUESTION_COUNT} pertanyaan belum tersedia.`), { status: 500 });
  }

  const opponent = unwrap(await db.from("users").select("id, username, gender, last_seen_at").eq("id", opponentId).neq("id", user.id).maybeSingle());
  if (!opponent) throw Object.assign(new Error("Lawan tidak ditemukan."), { status: 404 });
  if (!isRecentlyOnline(opponent)) throw Object.assign(new Error("Lawan sedang offline, duel dibatalkan."), { status: 400 });

  const duelId = id("duel");
  try {
    unwrap(await db.from("duels").insert({
      id: duelId,
      user_id: user.id,
      opponent_id: opponent.id,
      opponent_name: opponent.username,
      starts_at: new Date(Date.now() + DUEL_START_BUFFER_MS).toISOString(),
    }));
    unwrap(await db.from("duel_questions").insert(questions.map((question, index) => ({
      duel_id: duelId,
      question_id: question.id,
      position: index + 1,
    }))));
  } catch (error) {
    await db.from("duels").delete().eq("id", duelId);
    throw error;
  }

  const duel = unwrap(await db.from("duels").select("*").eq("id", duelId).single());
  return duelPayloadFromQuestions(duel, questions, user.id, opponent);
}

async function answerDuel(req, res, db, user) {
  const data = body(req);
  const duel = unwrap(await db.from("duels").select("*").eq("id", data.duelId).eq("status", "active").maybeSingle());
  if (!duel) return send(res, 404, { error: "Duel tidak aktif." });
  if (!isDuelParticipant(duel, user.id)) return send(res, 403, { error: "Kamu bukan participant duel ini." });
  const question = unwrap(await db.from("questions").select("*").eq("id", data.questionId).maybeSingle());
  if (!question) return send(res, 404, { error: "Soal tidak ditemukan." });
  const linkedQuestion = unwrap(await db.from("duel_questions").select("duel_id, position").eq("duel_id", data.duelId).eq("question_id", data.questionId).maybeSingle());
  if (!linkedQuestion) return send(res, 400, { error: "Soal ini bukan bagian dari duel." });

  const clientPosition = Number(data.position || 0);
  if (clientPosition && clientPosition !== Number(linkedQuestion.position || 0)) {
    return send(res, 409, { error: "Urutan soal tidak cocok. Refresh duel lalu coba lagi." });
  }

  const startsAtMs = new Date(duel.starts_at || duel.started_at || Date.now()).getTime();
  if (Date.now() + 750 < startsAtMs) {
    return send(res, 400, { error: "Duel belum mulai. Jawaban terlalu cepat ditolak." });
  }

  const selected = ["A", "B", "C", "D"].includes(data.selectedOption) ? data.selectedOption : null;
  const isCorrect = selected === question.correct_option;
  unwrap(await db.from("duel_answers").upsert({
    duel_id: data.duelId,
    question_id: data.questionId,
    user_id: user.id,
    selected_option: selected,
    is_correct: isCorrect,
    answer_time_ms: Math.max(0, Math.min(QUESTION_TIME_LIMIT_MS, Number(data.answerTimeMs || QUESTION_TIME_LIMIT_MS))),
    answered_at: new Date().toISOString(),
  }, { onConflict: "duel_id,question_id,user_id" }));
  const refreshed = unwrap(await db.from("duels").select("*").eq("id", data.duelId).single());
  return send(res, 200, { isCorrect, status: await duelStatusPayload(db, refreshed, user.id) });
}

async function finishDuel(req, res, db, user) {
  const data = body(req);
  let duel = unwrap(await db.from("duels").select("*").eq("id", data.duelId).maybeSingle());
  if (!duel || !isDuelParticipant(duel, user.id)) return send(res, 404, { error: "Duel tidak aktif." });
  if (duel.status === "finished") return sendFinishedDuel(res, db, duel, user.id, []);
  const answers = unwrap(await db.from("duel_answers").select("*").eq("duel_id", data.duelId).eq("user_id", user.id));
  const pastDeadline = Date.now() >= duelAnswerDeadlineMs(duel);
  if (answers.length < DUEL_QUESTION_COUNT && !pastDeadline) return send(res, 400, { error: "Jawab semua pertanyaan dulu." });
  if (duel.opponent_id) {
    const allAnswers = unwrap(await db.from("duel_answers").select("*").eq("duel_id", data.duelId));
    const userAnswers = allAnswers.filter((answer) => answer.user_id === duel.user_id);
    const opponentAnswers = allAnswers.filter((answer) => answer.user_id === duel.opponent_id);
    if (userAnswers.length < DUEL_QUESTION_COUNT || opponentAnswers.length < DUEL_QUESTION_COUNT) {
      if (!pastDeadline) {
        return send(res, 200, { waiting: true, status: await duelStatusPayload(db, duel, user.id) });
      }
    }
  }
  const newBadgesByUserId = await settleDuel(db, duel);
  duel = unwrap(await db.from("duels").select("*").eq("id", data.duelId).single());
  return sendFinishedDuel(res, db, duel, user.id, newBadgesByUserId[user.id] || []);
}

async function sendFinishedDuel(res, db, duel, viewerId, newBadges = []) {
  const side = participantSide(duel, viewerId);
  const score = scoreForSide(duel, side);
  return send(res, 200, {
    result: {
      result: resultForSide(resultForDuel(duel), side),
      fpAwarded: side === "opponent" ? Number(duel.opponent_fp_awarded || 0) : Number(duel.fp_awarded || 0),
      userScore: score.mine,
      opponentScore: score.theirs,
      avgTimeMs: side === "opponent" ? Number(duel.opponent_avg_time_ms || 0) : Number(duel.user_avg_time_ms || 0),
      newBadges,
    },
    status: await duelStatusPayload(db, duel, viewerId),
  });
}

async function settleDuel(db, duel) {
  if (duel.status === "finished") return {};
  const allAnswers = unwrap(await db.from("duel_answers").select("*").eq("duel_id", duel.id));
  const userAnswers = allAnswers.filter((answer) => answer.user_id === duel.user_id);
  const opponentAnswers = duel.opponent_id
    ? allAnswers.filter((answer) => answer.user_id === duel.opponent_id)
    : [];
  const userCorrect = userAnswers.filter((answer) => answer.is_correct).length;
  const opponentCorrect = duel.opponent_id
    ? opponentAnswers.filter((answer) => answer.is_correct).length
    : Number(duel.opponent_score || 0);
  const userFp = duelPoints(userAnswers);
  const opponentFp = duel.opponent_id ? duelPoints(opponentAnswers) : 0;
  const result = userFp > opponentFp ? "win" : userFp < opponentFp ? "lose" : "draw";
  const userAvgMs = Math.round(userAnswers.reduce((sum, answer) => sum + Number(answer.answer_time_ms || 0), 0) / Math.max(1, userAnswers.length));
  const opponentAvgMs = duel.opponent_id
    ? Math.round(opponentAnswers.reduce((sum, answer) => sum + Number(answer.answer_time_ms || 0), 0) / Math.max(1, opponentAnswers.length))
    : Number(duel.opponent_avg_time_ms || 0);

  const updated = unwrap(await db.from("duels").update({
    status: "finished",
    user_score: userFp,
    opponent_score: opponentFp,
    user_avg_time_ms: userAvgMs,
    opponent_avg_time_ms: opponentAvgMs,
    fp_awarded: userFp,
    opponent_fp_awarded: opponentFp,
    finished_at: new Date().toISOString(),
  }).eq("id", duel.id).eq("status", "active").select("id"));
  if (!updated.length) return {};

  await db.from("duel_queue").update({
    status: "cancelled",
    duel_id: null,
    updated_at: new Date().toISOString(),
  }).in("user_id", [duel.user_id, duel.opponent_id].filter(Boolean)).eq("duel_id", duel.id);

  const newBadgesByUserId = {};
  const user = unwrap(await db.from("users").select("*").eq("id", duel.user_id).single());
  newBadgesByUserId[user.id] = await updateUserAfterDuel(db, user, result, userCorrect, userAnswers, userFp);
  if (duel.opponent_id) {
    const opponent = unwrap(await db.from("users").select("*").eq("id", duel.opponent_id).single());
    newBadgesByUserId[opponent.id] = await updateUserAfterDuel(db, opponent, resultForSide(result, "opponent"), opponentCorrect, opponentAnswers, opponentFp);
  }
  return newBadgesByUserId;
}

async function updateUserAfterDuel(db, user, result, score, answers, fp) {
  const totalTime = answers.reduce((sum, answer) => sum + Number(answer.answer_time_ms || 0), 0);
  const newFire = nextFireStreak(user);
  const categoryIncrements = await categoryCorrectIncrements(db, answers);
  const updatePayload = {
    lifetime_fp: Number(user.lifetime_fp || 0) + fp,
    weekly_fp: Number(user.weekly_fp || 0) + fp,
    wins: Number(user.wins || 0) + (result === "win" ? 1 : 0),
    losses: Number(user.losses || 0) + (result === "lose" ? 1 : 0),
    draws: Number(user.draws || 0) + (result === "draw" ? 1 : 0),
    total_correct: Number(user.total_correct || 0) + score,
    total_answer_time_ms: Number(user.total_answer_time_ms || 0) + totalTime,
    total_answers: Number(user.total_answers || 0) + answers.length,
    current_win_streak: result === "win" ? Number(user.current_win_streak || 0) + 1 : 0,
    fire_streak_days: newFire.fire_streak_days,
    last_fire_date: newFire.last_fire_date,
    last_seen_at: new Date().toISOString(),
  };
  for (const [counter, value] of Object.entries(categoryIncrements)) {
    updatePayload[counter] = Number(user[counter] || 0) + value;
  }
  unwrap(await db.from("users").update(updatePayload).eq("id", user.id));
  return awardBadges(db, user.id);
}

function nextFireStreak(user) {
  const today = todayDate();
  if (user.last_fire_date === today) return { fire_streak_days: user.fire_streak_days || 1, last_fire_date: today };
  if (user.last_fire_date === yesterdayDate()) return { fire_streak_days: Number(user.fire_streak_days || 0) + 1, last_fire_date: today };
  return { fire_streak_days: 1, last_fire_date: today };
}

function normalizeCategory(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function categoryKeyFor(value = "") {
  const normalized = normalizeCategory(value);
  if (!normalized) return "";
  for (const category of QUESTION_CATEGORIES) {
    if (category.aliases.some((alias) => normalized.includes(normalizeCategory(alias)))) return category.key;
  }
  return "";
}

async function categoryCorrectIncrements(db, answers = []) {
  const correctAnswers = answers.filter((answer) => answer.is_correct);
  const questionIds = [...new Set(correctAnswers.map((answer) => answer.question_id).filter(Boolean))];
  if (!questionIds.length) return {};
  const questions = unwrap(await db.from("questions").select("id, category").in("id", questionIds));
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const increments = {};
  for (const answer of correctAnswers) {
    const categoryKey = categoryKeyFor(questionById.get(answer.question_id)?.category || "");
    const counter = CATEGORY_BY_KEY.get(categoryKey)?.counter;
    if (counter) increments[counter] = Number(increments[counter] || 0) + 1;
  }
  return increments;
}

function levelFromPoints(points) {
  return Math.min(100, Math.floor(Number(points || 0) / 1000) + 1);
}

async function awardBadges(db, userId) {
  const user = unwrap(await db.from("users").select("*").eq("id", userId).single());
  const existingRows = unwrap(await db.from("user_badges").select("badge_id").eq("user_id", userId));
  const existingIds = new Set(existingRows.map((row) => row.badge_id));
  const awards = new Set();
  const championCount = await db
    .from("weekly_rank_snapshots")
    .select("week_key", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("rank", 1);
  const secondCount = await db
    .from("weekly_rank_snapshots")
    .select("week_key", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("rank", 2);
  const thirdCount = await db
    .from("weekly_rank_snapshots")
    .select("week_key", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("rank", 3);

  const duelCount = Number(user.wins || 0) + Number(user.losses || 0) + Number(user.draws || 0);
  const duelThresholds = [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  duelThresholds.forEach((value, index) => { if (duelCount >= value) awards.add(`b_${index + 1}`); });
  duelThresholds.forEach((value, index) => { if (Number(user.wins || 0) >= value) awards.add(`b_${index + 11}`); });

  const winStreakThresholds = [3, 5, 7, 10, 15, 20, 30, 50, 75, 100];
  winStreakThresholds.forEach((value, index) => { if (Number(user.current_win_streak || 0) >= value) awards.add(`b_${index + 21}`); });

  const fpThresholds = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
  fpThresholds.forEach((value, index) => { if (Number(user.lifetime_fp || 0) >= value) awards.add(`b_${index + 31}`); });

  for (const category of QUESTION_CATEGORIES) {
    const start = CATEGORY_BADGE_START[category.key];
    if (!start) continue;
    CATEGORY_THRESHOLDS.forEach((value, index) => {
      if (Number(user[category.counter] || 0) >= value) awards.add(`b_${start + index}`);
    });
  }

  if (await hasFlawlessRound(db, userId)) awards.add("b_141");
  if (await todayFastCorrectCount(db, userId) >= 7) awards.add("b_142");
  if (await hasClutchVictory(db, userId)) awards.add("b_143");
  if (await hasPerfectBrainDay(db, userId)) awards.add("b_144");
  if (await currentWeeklyRank(db, userId) <= 10) awards.add("b_145");
  if ((thirdCount.count || 0) >= 1) awards.add("b_146");
  if ((secondCount.count || 0) >= 1) awards.add("b_147");
  if ((championCount.count || 0) >= 1) awards.add("b_148");
  if (await hasFiveConsecutiveC(db, userId)) awards.add("b_149");
  if (levelFromPoints(user.lifetime_fp) >= 100) awards.add("b_150");

  const newBadgeIds = [...awards].filter((badgeId) => !existingIds.has(badgeId));
  if (!newBadgeIds.length) return [];
  unwrap(await db.from("user_badges").upsert(newBadgeIds.map((badgeId) => ({ user_id: userId, badge_id: badgeId })), { onConflict: "user_id,badge_id" }));
  const badgeRows = unwrap(await db.from("badges").select("id, name, description, img_url").in("id", newBadgeIds));
  const byId = new Map(badgeRows.map((badge) => [badge.id, badge]));
  return newBadgeIds.map((badgeId) => byId.get(badgeId)).filter(Boolean);
}

async function todayCorrectCount(db, userId) {
  const result = await db
    .from("duel_answers")
    .select("duel_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_correct", true)
    .gte("answered_at", startOfTodayIso());
  if (result.error) throw result.error;
  return result.count || 0;
}

async function hasPerfectBrainDay(db, userId) {
  const todayStart = startOfTodayIso();
  const duels = unwrap(await db
    .from("duels")
    .select("user_id, opponent_id, user_score, opponent_score, fp_awarded, opponent_fp_awarded, status, started_at")
    .or(`user_id.eq.${userId},opponent_id.eq.${userId}`)
    .eq("status", "finished")
    .gte("started_at", todayStart)
    .order("started_at", { ascending: true })
    .limit(100));

  if (!duels.length) return false;

  const answers = unwrap(await db
    .from("duel_answers")
    .select("duel_id, is_correct, answered_at")
    .eq("user_id", userId)
    .gte("answered_at", todayStart)
    .order("answered_at", { ascending: true })
    .limit(1000));

  if (answers.length < duels.length * DUEL_QUESTION_COUNT) return false;
  if (answers.some((answer) => !answer.is_correct)) return false;

  return duels.every((duel) => {
    const side = participantSide(duel, userId);
    return resultForSide(resultForDuel(duel), side) !== "lose";
  });
}

async function todayFastCorrectCount(db, userId) {
  const result = await db
    .from("duel_answers")
    .select("duel_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_correct", true)
    .lt("answer_time_ms", 5000)
    .gte("answered_at", startOfTodayIso());
  if (result.error) throw result.error;
  return result.count || 0;
}

async function hasFlawlessRound(db, userId) {
  const rows = unwrap(await db
    .from("duel_answers")
    .select("duel_id, is_correct, answered_at")
    .eq("user_id", userId)
    .order("answered_at", { ascending: false })
    .limit(5000));
  const byDuel = new Map();
  for (const row of rows) {
    const stats = byDuel.get(row.duel_id) || { total: 0, correct: 0 };
    stats.total += 1;
    if (row.is_correct) stats.correct += 1;
    byDuel.set(row.duel_id, stats);
  }
  return [...byDuel.values()].some((stats) => stats.total >= DUEL_QUESTION_COUNT && stats.correct >= DUEL_QUESTION_COUNT);
}

async function hasClutchVictory(db, userId) {
  const rows = unwrap(await db
    .from("duels")
    .select("user_id, opponent_id, user_score, opponent_score, fp_awarded, opponent_fp_awarded, status, started_at")
    .or(`user_id.eq.${userId},opponent_id.eq.${userId}`)
    .eq("status", "finished")
    .order("started_at", { ascending: false })
    .limit(5000));
  return rows.some((duel) => {
    const side = participantSide(duel, userId);
    const mine = side === "opponent" ? Number(duel.opponent_fp_awarded || duel.opponent_score || 0) : Number(duel.fp_awarded || duel.user_score || 0);
    const theirs = side === "opponent" ? Number(duel.fp_awarded || duel.user_score || 0) : Number(duel.opponent_fp_awarded || duel.opponent_score || 0);
    return mine > theirs && mine - theirs === 1;
  });
}

async function hasFiveConsecutiveC(db, userId) {
  const rows = unwrap(await db
    .from("duel_answers")
    .select("selected_option, answered_at")
    .eq("user_id", userId)
    .order("answered_at", { ascending: true })
    .limit(5000));
  let streak = 0;
  for (const row of rows) {
    streak = row.selected_option === "C" ? streak + 1 : 0;
    if (streak >= 5) return true;
  }
  return false;
}

async function currentWeeklyRank(db, userId) {
  const rows = unwrap(await db
    .from("users")
    .select("id, weekly_fp, lifetime_fp, created_at")
    .order("weekly_fp", { ascending: false })
    .order("lifetime_fp", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(10));
  const index = rows.findIndex((row) => row.id === userId);
  return index >= 0 ? index + 1 : Number.POSITIVE_INFINITY;
}
