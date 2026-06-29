const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const DAILY_DUEL_LIMIT = 7;
const SESSION_STORAGE_KEY = "forge_session_token";

const state = {
  me: null,
  dashboard: null,
  duel: null,
  duelIndex: 0,
  duelUserAnswers: [],
  duelOpponentAnswers: [],
  duelOpponentAnsweredCount: 0,
  duelAnswerSaves: [],
  answerLocked: false,
  duelTimer: null,
  resultCountdownTimer: null,
  resultCountdown: 20,
  questionStartedAt: 0,
  remaining: 10,
  audioReady: false,
  audioContext: null,
  backgroundMusic: null,
  duelMusic: null,
  musicMode: "idle",
  pianoLoopTimer: null,
  sounds: {},
  cache: {},
  currentPage: "home",
  realtimeClient: null,
  userChannel: null,
  duelChannel: null,
  requestPollTimer: null,
  requestCountdownTimer: null,
  currentIncomingRequests: [],
  currentOutgoingRequests: [],
  duelStatusTimer: null,
  matchmakingTimer: null,
  duelStartTimer: null,
  duelStartCountdownLastSecond: null,
  isMatchmaking: false,
  seenRequestIds: new Set(),
  acceptedRequestIds: new Set(),
  memberRandomRanks: new Map(),
  renderedResultDuelId: null,
  resultSoundPlayedDuelIds: new Set(),
};

const pages = {
  home: ["FORGE Arena", "Home"],
  duel: ["Arena Duel", "Duel"],
  members: ["Member List", "Members of Arena"],
  leaderboard: ["Weekly Leaderboard", "Leaderboard"],
  badges: ["Badge Collections", "Badge"],
  about: ["About FORGE", "About"],
  settings: ["Settings", "Account"],
};

const soundFiles = {
  button: "/sounds/button-click.mp3",
  duelStart: "/sounds/duel-start.mp3",
  matchBeep: "/sounds/beep.mp3",
  matchStart: "/sounds/ting.mp3",
  tick: "/sounds/tik.mp3",
  correct: "/sounds/correct.mp3",
  wrong: "/sounds/wrong.mp3",
  notif: "/sounds/notif.mp3",
  win: "/sounds/win.mp3",
  lose: "/sounds/lose.mp3",
  background: "/sounds/idle.mp3",
  duelMusic: "/sounds/duel.mp3",
};

async function api(path, options = {}) {
  const token = getStoredSessionToken();
  let response;
  try {
    response = await fetch(path, {
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      credentials: "same-origin",
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error("Koneksi ke server gagal. Cek internet atau deploy API.");
  }
  const raw = await response.text().catch(() => "");
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = payload.error || payload.message || raw || `Request failed (${response.status})`;
    throw new Error(message.length > 240 ? `${message.slice(0, 240)}...` : message);
  }
  return payload;
}

function getStoredSessionToken() {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function setStoredSessionToken(token) {
  try {
    if (token) localStorage.setItem(SESSION_STORAGE_KEY, token);
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Browser storage can be blocked; the HttpOnly cookie still handles normal sessions.
  }
}

function setBusy(form, busy, label = "Memproses...") {
  const submit = form.querySelector("[type='submit']");
  if (!submit) return;
  if (!submit.dataset.idleText) submit.dataset.idleText = submit.textContent.trim();
  submit.disabled = busy;
  submit.classList.toggle("is-loading", busy);
  submit.textContent = busy ? label : submit.dataset.idleText;
}

function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  playSound("notif", { overlap: true });
  window.setTimeout(() => el.classList.remove("show"), 3200);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function showInlineError(target, message) {
  target.innerHTML = `<p class="muted">${message}</p>`;
}

function activateAudio() {
  if (state.audioReady) return;
  state.audioReady = true;
  tone("button");
  for (const [key, src] of Object.entries(soundFiles)) {
    const audio = new Audio(src);
    audio.preload = "auto";
    if (key === "background") {
      audio.loop = true;
      audio.volume = 0.16;
      state.backgroundMusic = audio;
    } else if (key === "duelMusic") {
      audio.loop = true;
      audio.volume = 0.24;
      state.duelMusic = audio;
    }
    state.sounds[key] = audio;
  }
  setMusicMode(state.musicMode);
}

function playSound(name, options = {}) {
  if (state.me && state.me.settings?.sfx_enabled === false) return;
  activateAudio();
  if (state.audioContext?.state === "suspended") {
    state.audioContext.resume().catch(() => {});
  }
  const audio = state.sounds[name];
  if (audio) {
    const player = options.overlap ? audio.cloneNode(true) : audio;
    player.currentTime = 0;
    player.volume = audio.volume;
    player.play().catch(() => tone(name));
  } else {
    tone(name);
  }
}

function startBackgroundMusic() {
  setMusicMode("idle");
}

function stopBackgroundMusic() {
  state.backgroundMusic?.pause();
  state.duelMusic?.pause();
  clearInterval(state.pianoLoopTimer);
  state.pianoLoopTimer = null;
}

function setMusicMode(mode = "idle") {
  state.musicMode = mode;
  if (state.me && state.me.settings?.music_enabled === false) return stopBackgroundMusic();
  activateAudio();
  clearInterval(state.pianoLoopTimer);
  state.pianoLoopTimer = null;
  const active = mode === "duel" ? state.duelMusic : state.backgroundMusic;
  const inactive = mode === "duel" ? state.backgroundMusic : state.duelMusic;
  inactive?.pause();
  if (active) {
    active.currentTime ||= 0;
    active.play().catch(() => startGeneratedPianoLoop());
  } else {
    startGeneratedPianoLoop();
  }
}

function startGeneratedPianoLoop() {
  if (state.pianoLoopTimer || (state.me && state.me.settings?.music_enabled === false)) return;
  const notes = [261.63, 329.63, 392, 493.88, 440, 392, 329.63, 293.66];
  let index = 0;
  const playNote = () => {
    pianoTone(notes[index % notes.length]);
    index += 1;
  };
  playNote();
  state.pianoLoopTimer = window.setInterval(playNote, 1650);
}

function pianoTone(frequency) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  state.audioContext ||= new AudioContext();
  const ctx = state.audioContext;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequency;
  osc.type = "triangle";
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.028, ctx.currentTime + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 1.15);
}

function tone(name) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  state.audioContext ||= new AudioContext();
  const ctx = state.audioContext;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const frequency = {
    button: 420,
    tick: 760,
    correct: 920,
    wrong: 160,
    notif: 880,
    win: 1040,
    lose: 130,
    duelStart: 560,
    matchBeep: 680,
    matchStart: 980,
  }[name] || 440;
  osc.frequency.value = frequency;
  osc.type = name === "lose" || name === "wrong" ? "sawtooth" : "sine";
  gain.gain.setValueAtTime(0.05, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.17);
}

document.addEventListener("click", (event) => {
  if (event.target.closest("button, a")) playSound("button");
});

document.addEventListener("pointerdown", () => startBackgroundMusic(), { once: true });

function setAuthTab(tab) {
  $$(".auth-tabs button").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.authTab === tab));
  $$(".auth-panel").forEach((panel) => panel.classList.remove("is-active"));
  const target = tab === "register" ? "#registerForm" : tab === "reset" ? "#resetForm" : "#loginForm";
  $(target).classList.add("is-active");
}

async function loadMe() {
  const data = await api("/api/me");
  state.me = data.user;
  state.dashboard = data.dashboard;
  if (state.audioReady) {
    if (state.me.settings?.music_enabled !== false) setMusicMode(state.musicMode);
    else stopBackgroundMusic();
  }
  $("#authView").classList.add("is-hidden");
  $("#appView").classList.remove("is-hidden");
  applyTheme();
  renderShell();
  renderDashboard();
  showPage("home");
  startRequestWatcher();
  initRealtime().catch(() => {});
}

async function restoreSession() {
  const loader = $("#bootLoader");
  const hasStoredSession = Boolean(getStoredSessionToken());
  if (!hasStoredSession) {
    loader?.classList.add("is-hidden");
    $("#authView").classList.remove("is-hidden");
    $("#appView").classList.add("is-hidden");
    return;
  }

  const safetyTimer = window.setTimeout(() => {
    toast("Session masih dicek. Mohon tunggu sebentar.");
  }, 12000);

  try {
    await loadMe();
  } catch (err) {
    console.error("restoreSession failed:", err);
    setStoredSessionToken("");
    $("#authView").classList.remove("is-hidden");
    $("#appView").classList.add("is-hidden");
  } finally {
    window.clearTimeout(safetyTimer);
    loader?.classList.add("is-hidden");
  }
}

function applyTheme() {
  delete document.body.dataset.theme;
}

function levelName(points) {
  return `Level ${Math.min(100, Math.floor(Number(points || 0) / 1000) + 1)}`;
}

function numericLevel(points) {
  return Math.min(100, Math.floor(Number(points || 0) / 1000) + 1);
}

function fpDisplay(value, { signed = false, label = false } = {}) {
  const number = Number(value || 0);
  const prefix = signed && number >= 0 ? "+" : "";
  return `
    <span class="fp-chip" aria-label="${prefix}${number.toLocaleString("id-ID")} Forge Points">
      <span class="fp-value">${prefix}${number.toLocaleString("id-ID")}</span>
      <img class="fp-icon" src="/image/fp.png" alt="FP" loading="lazy" />
      ${label ? `<span class="fp-label">FP</span>` : ""}
    </span>
  `;
}

function levelProgress(points) {
  const level = numericLevel(points);
  const total = Math.max(0, Number(points || 0));
  const current = level >= 100 ? 1000 : total % 1000;
  const required = 1000;
  const percent = level >= 100 ? 100 : Math.max(0, Math.min(100, (current / required) * 100));
  return { level, current, required, percent, nextLevel: Math.min(100, level + 1) };
}

function levelProgressHtml(points) {
  const progress = levelProgress(points);
  const caption = progress.level >= 100
    ? "Level maksimum tercapai"
    : `${progress.current.toLocaleString("id-ID")}/${progress.required.toLocaleString("id-ID")} menuju Level ${progress.nextLevel}`;
  return `
    <div class="level-progress" id="homeLevelProgress">
      <div class="level-progress-top">
        <span>Progress Level</span>
        <strong>${Math.round(progress.percent)}%</strong>
      </div>
      <div class="level-progress-track" aria-label="Progress level ${Math.round(progress.percent)} persen">
        <span style="width:${progress.percent}%"></span>
      </div>
      <small>${caption}</small>
    </div>
  `;
}

function badgeCountHtml(unlocked = 0, total = 0) {
  return `<p class="profile-badge-count" id="homeBadgeCount"><strong>${Number(unlocked || 0).toLocaleString("id-ID")}/${Number(total || 0).toLocaleString("id-ID")}</strong><span>Badge unlocked</span></p>`;
}

function avgTime(user) {
  if (!user.total_answers) return "0s";
  return `${(user.total_answer_time_ms / user.total_answers / 1000).toFixed(1)}s`;
}

function avatar(user = {}) {
  return user.gender === "female" ? "/image/women.png" : "/image/men.png";
}

function genderLabel(gender) {
  return gender === "male" ? "Laki-laki" : gender === "female" ? "Perempuan" : "-";
}

function setGenderInput(value = "") {
  $("#genderInput").value = value;
  $$("#genderPicker [data-gender]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.gender === value);
  });
}

function setRegisterGender(value = "male") {
  $("#registerGenderInput").value = value;
  $$("#registerGenderPicker [data-gender]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.gender === value);
  });
}

function refreshVisibleAvatars(user = state.me) {
  if (!user) return;
  const src = avatar(user);
  for (const selector of ["#pillAvatar", "#homeAvatar", "#duelUserAvatar"]) {
    const img = $(selector);
    if (img) img.src = src;
  }
}

async function copyText(value, label = "Teks") {
  const text = String(value || "");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("input");
    input.value = text;
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  toast(`${label} berhasil dicopy.`);
}

function profileColor(user) {
  const palette = ["#9b111e", "#c7372e", "#d4af37", "#a9702f", "#2f6f9f", "#6a4fb3", "#2f8e5f", "#c7375f"];
  const key = String(user?.id || user?.username || user?.given_id || "forge");
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function applyAvatarColor(root, user) {
  const color = profileColor(user);
  root.style.setProperty("--avatar-color", color);
}

function distributeScore(score, total = 5) {
  const correct = Math.max(0, Math.min(total, Number(score || 0)));
  const slots = Array.from({ length: total }, (_, index) => index < correct);
  return slots.sort(() => Math.random() - 0.5);
}

function resetDuelProgress(duel) {
  state.duelIndex = 0;
  state.duelUserAnswers = Array(duel.questions.length).fill(null);
  state.duelOpponentAnswers = Array(duel.questions.length).fill(null);
  state.duelOpponentAnsweredCount = 0;
  state.duelAnswerSaves = [];
  state.answerLocked = false;
  state.renderedResultDuelId = null;
  state.isMatchmaking = false;
  renderDuelProgress();
}

function renderDuelProgress() {
  const total = state.duel?.questions?.length || 5;
  const userDone = state.duelUserAnswers.filter((value) => value !== null).length;
  const opponentDone = Math.min(state.duelOpponentAnsweredCount, total);
  const userCorrect = state.duelUserAnswers.filter((value) => value === true).length;
  const opponentVisible = state.duelOpponentAnswers.slice(0, total).filter((value) => value !== null);
  const opponentCorrect = opponentVisible.filter((value) => value === true).length;
  const userActiveIndex = userDone >= total ? -1 : Math.min(userDone, total - 1);
  const opponentActiveIndex = opponentDone >= total ? -1 : Math.min(opponentDone, total - 1);
  $("#duelUserScore").textContent = `${userCorrect} benar · Soal ${userDone >= total ? total : userDone + 1}/${total}`;
  $("#duelOpponentScore").textContent = `${opponentCorrect} benar · Soal ${opponentDone >= total ? total : opponentDone + 1}/${total}`;
  renderScoreBars($("#duelUserBars"), state.duelUserAnswers, userActiveIndex);
  renderScoreBars($("#duelOpponentBars"), state.duelOpponentAnswers, opponentActiveIndex);
}

function renderScoreBars(root, answers, activeIndex) {
  root.innerHTML = answers.map((value, index) => {
    const stateClass = value === true ? "is-correct" : value === false ? "is-wrong" : value === "done" ? "is-done" : index === activeIndex ? "is-current" : "";
    return `<span class="${stateClass}"></span>`;
  }).join("");
}

function clearResultCountdown() {
  clearInterval(state.resultCountdownTimer);
  state.resultCountdownTimer = null;
}

function clearMatchmakingWatcher() {
  clearInterval(state.matchmakingTimer);
  state.matchmakingTimer = null;
}

function clearDuelStartTimer() {
  clearInterval(state.duelStartTimer);
  state.duelStartTimer = null;
  state.duelStartCountdownLastSecond = null;
}

function setDuelTopMode(mode) {
  const active = mode === "active";
  $("#duelTopLogo").classList.toggle("is-hidden", active || mode === "result");
  $(".timer-ring").classList.toggle("is-hidden", !active);
  $(".timer-ring").classList.toggle("is-result", mode === "result");
}

function resetDuelToIdle() {
  clearResultCountdown();
  clearMatchmakingWatcher();
  clearDuelStartTimer();
  clearInterval(state.duelTimer);
  clearInterval(state.duelStatusTimer);
  state.duelStatusTimer = null;
  if (state.realtimeClient && state.duelChannel) {
    state.realtimeClient.removeChannel(state.duelChannel);
    state.duelChannel = null;
  }
  state.duel = null;
  state.duelIndex = 0;
  state.duelUserAnswers = [];
  state.duelOpponentAnswers = [];
  state.duelOpponentAnsweredCount = 0;
  state.duelAnswerSaves = [];
  state.answerLocked = false;
  $("#duelIdle").classList.remove("is-hidden");
  $("#duelActive").classList.add("is-hidden");
  $("#duelResult").classList.add("is-hidden");
  $("#duelPanel").classList.remove("loss-shake", "win-glow");
  $("#duelUserScore").textContent = "0 benar · Soal 0/5";
  $("#duelOpponentScore").textContent = "0 benar · Soal 0/5";
  $("#duelUserBars").innerHTML = "";
  $("#duelOpponentBars").innerHTML = "";
  setDuelTopMode("idle");
  setMusicMode("idle");
}

function startResultCountdown() {
  clearResultCountdown();
  state.resultCountdown = 20;
  const button = $("#rematchCountdownBtn");
  const update = () => {
    if (button) button.textContent = `Cari Lawan Baru (${state.resultCountdown})`;
  };
  update();
  state.resultCountdownTimer = window.setInterval(() => {
    state.resultCountdown -= 1;
    if (state.resultCountdown <= 0) {
      resetDuelToIdle();
      return;
    }
    update();
  }, 1000);
}

function renderShell() {
  $("#pillUsername").textContent = state.me.username;
  const pillFp = $("#pillFp");
  if (pillFp?.parentElement) {
    pillFp.parentElement.innerHTML = `<span id="pillFp">${fpDisplay(state.me.lifetime_fp)}</span>`;
  }
  $("#pillAvatar").src = avatar(state.me);
  applyAvatarColor($("#pillAvatarWrap"), state.me);
  $("#sideFire").textContent = `${state.me.fire_streak_days} hari`;
  $("#homeAvatar").src = avatar(state.me);
  applyAvatarColor($("#homeAvatarWrap"), state.me);
  $("#duelUserAvatar").src = avatar(state.me);
  applyAvatarColor($("#duelUserAvatarWrap"), state.me);
  $("#duelUserName").textContent = state.me.username;
  renderDailyFlameGif();
}

function renderDailyFlameGif() {
  const flameCard = $(".daily-flame");
  if (!flameCard) return;
  let fireIcon = $(".daily-flame-icon", flameCard);
  if (!fireIcon) {
    flameCard.insertAdjacentHTML("afterbegin", `<img class="daily-flame-icon" src="/gif/fire.gif" alt="" loading="lazy" />`);
    fireIcon = $(".daily-flame-icon", flameCard);
  }
  if (fireIcon?.tagName === "IMG") {
    fireIcon.src = "/gif/fire.gif";
    fireIcon.alt = "";
  } else if (fireIcon) {
    fireIcon.style.backgroundImage = "url('/gif/fire.gif')";
  }
}

function renderDashboard() {
  const user = state.me;
  const dailyLimit = state.dashboard.dailyDuelLimit || DAILY_DUEL_LIMIT;
  const unlockedBadges = state.dashboard.unlockedBadges || 0;
  const totalBadges = state.dashboard.totalBadges || 0;
  $("#duelLimitText").textContent = `Maksimal ${dailyLimit} duel per hari. Setiap duel berisi 5 pertanyaan, masing-masing 10 detik.`;
  $("#homeName").textContent = user.name;
  $("#homeUsername").textContent = user.username;
  $("#homeLevel").textContent = levelName(user.lifetime_fp);
  $("#badgePreviewText").textContent = `${unlockedBadges}/${totalBadges} terbuka`;
  $("#topPreviewText").textContent = state.dashboard.top3.map((row) => `${row.rank}. ${row.username}`).join("  ") || "Belum ada ranking";

  const avatarWrap = $("#homeAvatarWrap");
  if (avatarWrap) {
    const existingProgress = $("#homeLevelProgress");
    const existingBadgeCount = $("#homeBadgeCount");
    if (existingProgress) existingProgress.outerHTML = levelProgressHtml(user.lifetime_fp);
    else avatarWrap.insertAdjacentHTML("afterend", levelProgressHtml(user.lifetime_fp));
    if (existingBadgeCount) existingBadgeCount.outerHTML = badgeCountHtml(unlockedBadges, totalBadges);
    else $("#homeLevelProgress")?.insertAdjacentHTML("afterend", badgeCountHtml(unlockedBadges, totalBadges));
  }

  const stats = [
    ["Fire Streak", `${user.fire_streak_days} hari`],
    ["Peringkat Saat Ini", `#${state.dashboard.myRank || "-"}`],
    ["FP Mingguan", fpDisplay(user.weekly_fp)],
    ["Lifetime FP", fpDisplay(user.lifetime_fp)],
    ["Level", levelName(user.lifetime_fp)],
    ["Duel Hari Ini", `${state.dashboard.duelsToday || 0}/${dailyLimit}`],
  ];
  $("#dashboardStats").innerHTML = stats.map(([label, value]) => {
    const fpClass = /fp/i.test(label) ? " fp-stat" : "";
    return `<article class="stat-card${fpClass}"><span>${label}</span><strong>${value}</strong></article>`;
  }).join("");
}

function showPage(page) {
  state.currentPage = page;
  if (page !== "duel" && !$("#duelResult").classList.contains("is-hidden")) resetDuelToIdle();
  else if (page !== "duel") clearResultCountdown();
  if (page !== "duel" || !state.duel) setMusicMode("idle");
  const config = pages[page] || pages.home;
  $("#pageKicker").textContent = config[0];
  $("#pageTitle").textContent = config[1];
  $$(".page").forEach((view) => view.classList.toggle("is-active", view.dataset.view === page));
  $$("[data-page]").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.page === page));
  $(".sidebar").classList.remove("is-open");
  document.body.classList.remove("sidebar-open");
  if (page === "members") loadMembers().catch((err) => toast(err.message));
  if (page === "leaderboard") loadLeaderboard().catch((err) => toast(err.message));
  if (page === "badges") loadBadges().catch((err) => toast(err.message));
  if (page === "about") renderAbout();
  if (page === "settings") renderSettings();
}

function getDailyDuelLimit() {
  return state.dashboard?.dailyDuelLimit || DAILY_DUEL_LIMIT;
}

function getActiveMemberTab() {
  return $("#memberTab [data-member-tab].is-active")?.dataset.memberTab || "all";
}

async function refreshMe() {
  const data = await api("/api/me");
  state.me = data.user;
  state.dashboard = data.dashboard;
  renderShell();
  renderDashboard();
  applyTheme();
}

async function initRealtime() {
  if (state.realtimeClient || !state.me) return;
  const config = await api("/api/realtime-config").catch(() => ({ enabled: false }));
  if (!config.enabled) return;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  state.realtimeClient = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  state.userChannel = state.realtimeClient.channel(`forge-user-${state.me.id}`);
  state.userChannel
    .on("broadcast", { event: "duel-invite" }, () => {
      toast("Ada undangan duel masuk.");
      loadDuelRequests({ notify: true }).catch(() => {});
    })
    .on("broadcast", { event: "duel-accepted" }, async ({ payload }) => {
      if (!payload?.duelId) return;
      const data = await api(`/api/duel/${payload.duelId}`).catch(() => null);
      if (data?.duel) beginDuel(data.duel);
    })
    .subscribe();
}

function startRequestWatcher() {
  clearInterval(state.requestPollTimer);
  loadDuelRequests({ notify: false }).catch(() => {});
  state.requestPollTimer = window.setInterval(() => {
    loadDuelRequests({ notify: true }).catch(() => {});
  }, 2500);
}

async function loadDuelRequests({ notify = false } = {}) {
  if (!state.me) return { requests: [], outgoing: [] };
  const data = await api("/api/duel-requests");
  const receivedAt = Date.now();
  const requests = (data.requests || []).map((request) => ({ ...request, received_at_ms: receivedAt }));
  const outgoing = (data.outgoing || []).map((request) => ({ ...request, received_at_ms: receivedAt }));
  if (notify) {
    for (const request of requests) {
      if (!state.seenRequestIds.has(request.id)) {
        state.seenRequestIds.add(request.id);
        toast(`${request.requester_username} mengajak kamu duel. Accept dalam 20 detik.`);
      }
    }
    for (const request of outgoing) {
      if (request.status === "accepted" && request.duel_id && !state.acceptedRequestIds.has(request.id)) {
        state.acceptedRequestIds.add(request.id);
        const duel = await api(`/api/duel/${request.duel_id}`).catch(() => null);
        if (duel?.duel) {
          toast(`${request.target_username} menerima duel.`);
          beginDuel(duel.duel);
        }
      }
    }
  }
  state.currentIncomingRequests = requests;
  state.currentOutgoingRequests = outgoing;
  if (state.currentPage === "members") renderRequests(requests, outgoing);
  startRequestCountdownTimer();
  return { ...data, requests, outgoing };
}

function startRequestCountdownTimer() {
  clearInterval(state.requestCountdownTimer);
  const hasPending = [...state.currentIncomingRequests, ...state.currentOutgoingRequests]
    .some((request) => request.status === "pending" && secondsLeft(request) > 0);
  if (!hasPending) return;
  state.requestCountdownTimer = window.setInterval(() => {
    if (state.currentPage !== "members") return;
    renderRequests(state.currentIncomingRequests, state.currentOutgoingRequests);
    const stillPending = [...state.currentIncomingRequests, ...state.currentOutgoingRequests]
      .some((request) => request.status === "pending" && secondsLeft(request) > 0);
    if (!stillPending) {
      clearInterval(state.requestCountdownTimer);
      state.requestCountdownTimer = null;
    }
  }, 1000);
}

async function loadMembers() {
  normalizeMemberTabs();
  const q = encodeURIComponent($("#memberSearch").value.trim());
  const tab = getActiveMemberTab();
  const cacheKey = `members:${q}:all`;
  if (state.cache[cacheKey]) {
    renderMemberList(filterMembersForTab(state.cache[cacheKey].members, tab));
  } else {
    $("#requestPanel").innerHTML = `<p class="muted">Memuat request duel...</p>`;
    $("#memberList").innerHTML = `<p class="muted">Memuat member...</p>`;
  }
  try {
    const [data, requests] = await Promise.all([
      api(`/api/members?q=${q}&tab=all`),
      loadDuelRequests({ notify: false }),
    ]);
    state.cache[cacheKey] = data;
    renderRequests(requests.requests || [], requests.outgoing || []);
    renderMemberList(filterMembersForTab(data.members, tab));
  } catch (err) {
    showInlineError($("#requestPanel"), "Request duel belum bisa dimuat.");
    showInlineError($("#memberList"), `Member gagal dimuat: ${err.message}`);
    throw err;
  }
}

function filterMembersForTab(members, tab) {
  let filtered = members;
  if (tab === "online") filtered = members.filter((member) => member.online);
  if (tab === "favourites") filtered = members.filter((member) => member.is_favourite);
  return sortMembersForDisplay(filtered);
}

function normalizeMemberTabs() {
  const tabWrap = $("#memberTab");
  if (!tabWrap) return;
  tabWrap.querySelector("[data-member-tab='friends']")?.remove();
  const active = tabWrap.querySelector(".is-active");
  if (!active || active.dataset.memberTab === "friends") {
    tabWrap.querySelector("[data-member-tab='all']")?.classList.add("is-active");
  }
}

function memberRandomRank(memberId) {
  if (!state.memberRandomRanks.has(memberId)) state.memberRandomRanks.set(memberId, Math.random());
  return state.memberRandomRanks.get(memberId);
}

function sortMembersForDisplay(members) {
  return [...members].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.online && b.online) {
      return new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime();
    }
    return memberRandomRank(a.id) - memberRandomRank(b.id);
  });
}

function renderCachedMembersForActiveTab() {
  const q = encodeURIComponent($("#memberSearch").value.trim());
  const cached = state.cache[`members:${q}:all`];
  if (!cached) return false;
  renderMemberList(filterMembersForTab(cached.members, getActiveMemberTab()));
  return true;
}

function renderMemberList(members) {
  $("#memberList").innerHTML = members.map((member) => `
    <article class="member-row" data-member='${JSON.stringify(member).replace(/'/g, "&apos;")}' tabindex="0" role="button" aria-label="Lihat profile ${member.username}">
      <span class="avatar-ring" style="--avatar-color:${profileColor(member)}"><img src="${avatar(member)}" alt="" /></span>
      <div><strong>${member.name}</strong><small>@${member.username} / ${member.given_id} · ${member.city || "-"}</small></div>
      <div class="member-level-cell"><span>${levelName(member.lifetime_fp)}</span><small>${fpDisplay(member.lifetime_fp)}</small></div>
      <div><span class="status-dot ${member.online ? "online" : "offline"}"></span>${member.online ? "Online" : "Offline"}</div>
      <div class="mini-actions">
        <button class="heart-action ${member.is_favourite ? "is-on" : ""}" data-relation="favourite" data-id="${member.id}" aria-label="${member.is_favourite ? "Hapus dari favorite" : "Tambah ke favorite"}">
          <span aria-hidden="true">${member.is_favourite ? "&#9829;" : "&#9825;"}</span>
        </button>
        <button class="duel-action" data-invite="${member.id}" ${member.online ? "" : "disabled"}>${member.online ? "Invite Duel" : "Offline"}</button>
      </div>
    </article>
  `).join("") || `<p class="muted">Belum ada member lain. Daftarkan minimal 2 akun agar Member Arena terisi.</p>`;
}

function duelRecordBoxes(wins = 0, losses = 0, draws = 0) {
  return `
    <span class="record-boxes" aria-label="Win ${wins}, Lose ${losses}, Draw ${draws}">
      <span><b>${Number(wins || 0)}</b> <small>Win</small></span>
      <span><b>${Number(losses || 0)}</b> <small>Lose</small></span>
      <span><b>${Number(draws || 0)}</b> <small>Draw</small></span>
    </span>
  `;
}

function duelResultLabel(result) {
  const value = String(result || "").toLowerCase();
  if (value === "win") return "WIN";
  if (value === "lose" || value === "loss") return "LOSE";
  return "DRAW";
}

function duelHistoryResult(duel = {}) {
  const explicit = String(duel.result || "").toLowerCase();
  if (["win", "lose", "draw"].includes(explicit)) return explicit;
  const mine = Number(duel.user_score ?? duel.fp_awarded ?? 0);
  const opponent = Number(duel.opponent_score ?? 0);
  if (mine > opponent) return "win";
  if (mine < opponent) return "lose";
  return "draw";
}

function setSettingsCardOrder() {
  const profileCard = $("#profileForm")?.closest(".settings-card");
  const historyCard = $("#duelHistoryList")?.closest(".settings-card");
  const accountCard = $("#settingsForm")?.closest(".settings-card");
  const statsCard = $("#profileStats");
  if (profileCard) profileCard.style.order = "1";
  if (historyCard) historyCard.style.order = "2";
  if (accountCard) accountCard.style.order = "3";
  if (statsCard) statsCard.style.order = "4";
}

function removeUnusedSettingsToggles() {
  const form = $("#settingsForm");
  if (!form) return;
  form.show_online_status?.closest(".switch")?.remove();
  form.allow_duel_invites?.closest(".switch")?.remove();
}

function showMemberProfile(row) {
  const member = JSON.parse(row.dataset.member.replace(/&apos;/g, "'"));
  $$(".member-row").forEach((item) => item.classList.toggle("is-selected", item === row));
  const totalDuels = Number(member.wins || 0) + Number(member.losses || 0) + Number(member.draws || 0);
  const stats = [
    ["Kota", member.city || "-"],
    ["Jenis Kelamin", genderLabel(member.gender)],
    ["Level", levelName(member.lifetime_fp)],
    ["Lifetime FP", fpDisplay(member.lifetime_fp)],
    ["Weekly FP", fpDisplay(member.weekly_fp)],
    ["Duel Count", totalDuels.toLocaleString("id-ID")],
    ["Rekor Duel", duelRecordBoxes(member.wins, member.losses, member.draws)],
    ["Jawaban Benar", (member.total_correct || 0).toLocaleString("id-ID")],
    ["Avg Time", avgTime(member)],
    ["Win Streak", `${member.current_win_streak || 0} menang`],
    ["Fire Streak", `${member.fire_streak_days} hari`],
    ["Status", member.online ? "Online" : "Offline"],
  ];
  $("#memberProfilePanel").innerHTML = `
    <article class="member-profile-card">
      <span class="avatar-ring avatar-ring-large" style="--avatar-color:${profileColor(member)}"><img src="${avatar(member)}" alt="" /></span>
      <div class="member-profile-main">
        <p class="eyebrow">Profile Member</p>
        <h3>${member.name}</h3>
        <small>@${member.username} / ID ${member.given_id} · ${member.city || "-"}</small>
      </div>
      <div class="member-profile-stats">
        ${stats.map(([label, value]) => {
          const fpClass = /fp/i.test(label) ? ' class="fp-stat"' : "";
          return `<div${fpClass}><span>${label}</span><strong>${value}</strong></div>`;
        }).join("")}
      </div>
    </article>
  `;
}

function secondsLeft(request) {
  if (!request) return 0;
  if (typeof request === "string") {
    return Math.max(0, Math.ceil((new Date(request).getTime() - Date.now()) / 1000));
  }
  if (Number.isFinite(Number(request.expires_in_ms))) {
    const elapsed = Date.now() - Number(request.received_at_ms || Date.now());
    return Math.max(0, Math.ceil((Number(request.expires_in_ms) - elapsed) / 1000));
  }
  if (!request.expires_at) return 0;
  return Math.max(0, Math.ceil((new Date(request.expires_at).getTime() - Date.now()) / 1000));
}

function renderRequests(requests, outgoing = []) {
  const incomingHtml = requests.length
    ? requests.map((request) => {
      const left = secondsLeft(request);
      return `
      <article class="request-item">
        <p><strong>${request.requester_username}</strong> mengajak kamu duel.</p>
        <small class="request-countdown">${left > 0 ? `Sisa ${left} detik untuk accept` : "Waktu accept habis"}</small>
        <div class="request-actions">
          <button class="btn secondary" data-request-action="accept" data-request-id="${request.id}" ${left <= 0 ? "disabled" : ""}>Accept</button>
          <button class="btn danger" data-request-action="decline" data-request-id="${request.id}">Decline</button>
        </div>
      </article>
    `;
    }).join("")
    : `<p class="muted">Belum ada request duel masuk.</p>`;
  const outgoingHtml = outgoing.length
    ? `<div class="outgoing-requests">${outgoing.map((request) => `
      <small>Invite ke <strong>@${request.target_username}</strong>: ${request.status === "pending" ? `${secondsLeft(request)} detik` : request.status}</small>
    `).join("")}</div>`
    : "";
  $("#requestPanel").innerHTML = incomingHtml + outgoingHtml;
}

async function toggleRelation(button) {
  const row = button.closest(".member-row");
  button.disabled = true;
  button.classList.add("is-loading");
  try {
    const data = await api(`/api/members/${button.dataset.id}/relation`, {
      method: "POST",
      body: { type: button.dataset.relation },
    });
    const relation = data.relation || {};
    const favouriteBtn = row?.querySelector("[data-relation='favourite']");
    const isFavourite = Boolean(relation.is_favourite);
    favouriteBtn?.classList.toggle("is-on", isFavourite);
    favouriteBtn?.setAttribute("aria-label", isFavourite ? "Hapus dari favorite" : "Tambah ke favorite");
    const icon = favouriteBtn?.querySelector("span");
    if (icon) icon.innerHTML = isFavourite ? "&#9829;" : "&#9825;";
    state.cache = Object.fromEntries(Object.entries(state.cache).filter(([key]) => !key.startsWith("members:")));
    const tab = getActiveMemberTab();
    if (tab === "favourites" && !relation.is_favourite) {
      row?.remove();
      if (!$("#memberList").children.length) {
        $("#memberList").innerHTML = `<p class="muted">Belum ada member di tab ini.</p>`;
      }
    }
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
  }
}

async function inviteDuel(memberId) {
  await api(`/api/members/${memberId}/invite`, { method: "POST" });
  state.realtimeClient?.channel(`forge-user-${memberId}`).send({
    type: "broadcast",
    event: "duel-invite",
    payload: { from: state.me.id },
  }).catch(() => {});
  await loadDuelRequests({ notify: false }).catch(() => {});
  toast("Undangan duel terkirim. Menunggu accept 20 detik.");
}

async function respondDuelRequest(button) {
  const data = await api(`/api/duel-requests/${button.dataset.requestId}/respond`, {
    method: "POST",
    body: { action: button.dataset.requestAction },
  });
  await loadDuelRequests({ notify: false });
  if (data.duel) {
    state.realtimeClient?.channel(`forge-user-${data.duel.opponent_id || ""}`).send({
      type: "broadcast",
      event: "duel-accepted",
      payload: { duelId: data.duel.id },
    }).catch(() => {});
    beginDuel(data.duel);
  }
}

function beginDuel(duel) {
  clearResultCountdown();
  clearMatchmakingWatcher();
  clearDuelStartTimer();
  state.isMatchmaking = false;
  state.duel = duel;
  resetDuelProgress(state.duel);
  showPage("duel");
  $("#duelIdle").classList.add("is-hidden");
  $("#duelResult").classList.add("is-hidden");
  $("#duelActive").classList.remove("is-hidden");
  setDuelTopMode("active");
  setMusicMode("duel");
  $("#duelOpponentName").textContent = state.duel.opponent_name;
  $("#duelOpponentScore").textContent = `${state.duel.opponent_score || 0} benar · Soal 0/${state.duel.questions.length}`;
  $("#duelOpponentAvatar").src = avatar({ gender: state.duel.opponent_gender });
  applyAvatarColor($("#duelOpponentAvatarWrap"), {
    id: state.duel.opponent_id,
    username: state.duel.opponent_name,
  });
  $("#duelPanel").classList.remove("loss-shake", "win-glow");
  subscribeDuelChannel(duel.id);
  startDuelStatusWatcher();
  startSyncedDuelCountdown();
}

function startSyncedDuelCountdown() {
  const startsAtMs = new Date(state.duel?.starts_at || Date.now()).getTime();
  const delayMs = startsAtMs - Date.now();
  state.duelStartCountdownLastSecond = null;
  if (delayMs <= 250) {
    $("#duelResult").classList.add("is-hidden");
    $("#duelActive").classList.remove("is-hidden");
    setDuelTopMode("active");
    playSound("matchStart", { overlap: true });
    renderQuestion();
    return;
  }

  $("#duelActive").classList.add("is-hidden");
  $("#duelResult").classList.remove("is-hidden");
  setDuelTopMode("result");
  const renderCountdown = () => {
    const left = Math.max(1, Math.ceil((startsAtMs - Date.now()) / 1000));
    if (left !== state.duelStartCountdownLastSecond && Date.now() < startsAtMs) {
      state.duelStartCountdownLastSecond = left;
      playSound("matchBeep", { overlap: true });
    }
    $("#duelResult").innerHTML = `
      <p class="eyebrow">Lawan ditemukan</p>
      <h1>Mulai dalam ${left}</h1>
      <p class="result-copy">Kamu dan lawan sudah masuk ruang duel. Soal akan muncul bersamaan.</p>
    `;
    if (Date.now() >= startsAtMs) {
      clearDuelStartTimer();
      state.duelStartCountdownLastSecond = null;
      $("#duelResult").classList.add("is-hidden");
      $("#duelActive").classList.remove("is-hidden");
      setDuelTopMode("active");
      playSound("matchStart", { overlap: true });
      renderQuestion();
    }
  };
  renderCountdown();
  state.duelStartTimer = window.setInterval(renderCountdown, 250);
}

function subscribeDuelChannel(duelId) {
  if (!state.realtimeClient) return;
  if (state.duelChannel) {
    state.realtimeClient.removeChannel(state.duelChannel);
    state.duelChannel = null;
  }
  state.duelChannel = state.realtimeClient.channel(`forge-duel-${duelId}`);
  state.duelChannel
    .on("broadcast", { event: "answer" }, ({ payload }) => {
      applyOpponentAnswerPayload(payload);
      refreshDuelStatus().catch(() => {});
    })
    .on("broadcast", { event: "finish" }, () => finishDuel({ fromSync: true }).catch(() => {}))
    .subscribe();
}

function applyOpponentAnswerPayload(payload = {}) {
  if (!state.duel?.id || payload.duelId !== state.duel.id || payload.from === state.me?.id) return;
  const total = state.duel.questions.length;
  const index = Number.isFinite(Number(payload.index)) ? Number(payload.index) : state.duel.questions.findIndex((question) => question.id === payload.questionId);
  if (index < 0 || index >= total) return;
  state.duelOpponentAnswers[index] = Boolean(payload.isCorrect);
  state.duelOpponentAnsweredCount = Math.max(state.duelOpponentAnsweredCount, state.duelOpponentAnswers.filter((value) => value !== null).length);
  renderDuelProgress();
}

function startDuelStatusWatcher() {
  clearInterval(state.duelStatusTimer);
  state.duelStatusTimer = window.setInterval(() => {
    refreshDuelStatus().catch(() => {});
  }, 800);
}

async function refreshDuelStatus() {
  if (!state.duel?.id) return;
  const data = await api(`/api/duel/${state.duel.id}/status`);
  const status = data.status;
  if (Array.isArray(status?.opponentAnswers)) {
    const byQuestion = new Map(status.opponentAnswers.map((answer) => [answer.questionId, Boolean(answer.isCorrect)]));
    state.duelOpponentAnswers = state.duel.questions.map((question) => byQuestion.has(question.id) ? byQuestion.get(question.id) : null);
    state.duelOpponentAnsweredCount = state.duelOpponentAnswers.filter((value) => value !== null).length;
    renderDuelProgress();
  } else if (status?.opponentAnswered !== undefined) {
    const visible = Math.min(status.opponentAnswered, state.duelOpponentAnswers.length);
    state.duelOpponentAnsweredCount = visible;
    state.duelOpponentAnswers = state.duelOpponentAnswers.map((value, index) => index < visible ? (value ?? "done") : null);
    renderDuelProgress();
  }
  if (status?.status === "finished" && state.duel) {
    await finishDuel({ fromSync: true });
  }
}

async function loadLeaderboard() {
  if (state.cache.leaderboard) {
    renderLeaderboard(state.cache.leaderboard);
  } else {
    $("#leaderboardRows").innerHTML = `<p class="muted">Memuat peringkat...</p>`;
    $("#hallOfLegends").innerHTML = `<p class="muted">Memuat legends...</p>`;
  }
  try {
    const data = await api("/api/leaderboard");
    state.cache.leaderboard = data;
    renderLeaderboard(data);
  } catch (err) {
    showInlineError($("#leaderboardRows"), `Peringkat gagal dimuat: ${err.message}`);
    showInlineError($("#hallOfLegends"), "Hall of Legends gagal dimuat.");
    throw err;
  }
}

function renderLeaderboard(data) {
  $("#leaderboardRows").innerHTML = data.rows.map((row) => `
    <article class="leader-row top-${row.rank} ${row.is_me ? "is-me" : ""}">
      <strong>#${row.rank}</strong>
      <div class="leader-player"><span class="avatar-ring" style="--avatar-color:${profileColor(row)}"><img src="${avatar(row)}" alt="" /></span><span><strong>${row.name}</strong><small>@${row.username}</small></span></div>
      <span>${levelName(row.lifetime_fp)}</span>
      <strong>${fpDisplay(row.weekly_fp)}</strong>
      <span>${row.wins}</span>
      <span>${row.avg_time}</span>
    </article>
  `).join("") || `<p class="muted">Belum ada data peringkat.</p>`;

  const topList = (title, rows = [], valueFn = () => "-") => `
    <div class="legend-block">
      <strong>${title}</strong>
      ${rows.length ? rows.map((row, index) => `
        <article class="legend-person">
          <span class="legend-medal">#${index + 1}</span>
          <span><b>@${row.username}</b><small>${valueFn(row)}</small></span>
        </article>
      `).join("") : `<p class="muted">Belum ada data.</p>`}
    </div>
  `;

  $("#hallOfLegends").innerHTML = `
    ${topList("Top 3 Last Week", data.legends?.lastWeek || data.weekly?.lastWinners || [], (row) => `${fpDisplay(row.weekly_fp)} minggu lalu`)}
    ${topList("Fire Streak Terbanyak", data.legends?.fire || [], (row) => `${row.fire_streak_days || 0} hari menyala`)}
    ${topList("Ronde Tercepat", data.legends?.fastest || [], (row) => `${row.avg_time || "0s"} rata-rata`)}
    ${topList("Lifetime FP Terbanyak", data.legends?.lifetime || [], (row) => fpDisplay(row.lifetime_fp))}
    ${topList("Menang Terbanyak", data.legends?.mostWins || [], (row) => `${row.wins || 0} kemenangan`)}
  `;
}

async function loadBadges() {
  if (state.cache.badges) {
    renderBadges(state.cache.badges);
  } else {
    $("#badgeGrid").innerHTML = `<p class="muted">Memuat badge...</p>`;
  }
  try {
    const data = await api("/api/badges");
    state.cache.badges = data;
    renderBadges(data);
  } catch (err) {
    showInlineError($("#badgeGrid"), `Badge gagal dimuat: ${err.message}`);
    throw err;
  }
}

function renderBadges(data) {
  $("#badgeProgress").textContent = `${data.unlocked}/${data.total} terbuka`;
  const badgeDetail = $("#badgeDetail");
  badgeDetail?.classList.add("is-hidden");
  if (badgeDetail) badgeDetail.innerHTML = "";
  $("#badgeGrid").innerHTML = data.badges.map((badge) => `
    <button class="badge-tile ${badge.earned_at ? "" : "locked"}" data-badge='${JSON.stringify(badge).replace(/'/g, "&apos;")}'>
      <span class="badge-icon">${badge.earned_at ? badgeVisual(badge) : "?"}</span>
      <strong>${badge.name}</strong>
      <small>${badge.earned_at ? "Terbuka" : "Terkunci"}</small>
    </button>
  `).join("") || `<p class="muted">Badge belum tersedia. Buka halaman ini lagi setelah database schema dan seed berhasil.</p>`;
}

function badgeVisual(badge) {
  const fallback = escapeHtml((badge.name || "?").trim().charAt(0).toUpperCase() || "?");
  if (!badge.img_url) return fallback;
  return `<img class="badge-img" src="${escapeHtml(badge.img_url)}" alt="" loading="lazy" onerror="this.remove();this.parentElement.textContent='${fallback}'" />`;
}

function showBadgeDetail(button) {
  const badge = JSON.parse(button.dataset.badge.replace(/&apos;/g, "'"));
  document.querySelector(".badge-modal")?.remove();
  const earnedAt = badge.earned_at ? formatDateTimeId(badge.earned_at) : null;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="badge-modal" role="dialog" aria-modal="true">
      <button class="badge-modal-backdrop" type="button" data-badge-close aria-label="Tutup detail badge"></button>
      <article class="badge-modal-card">
        <button class="badge-modal-close" type="button" data-badge-close aria-label="Tutup">x</button>
        <div class="badge-icon">${badge.earned_at ? badgeVisual(badge) : "?"}</div>
        <h3>${escapeHtml(badge.name)}</h3>
        <p>${escapeHtml(badge.description)}</p>
        <p><strong>Status:</strong> ${badge.earned_at ? "Terbuka" : "Terkunci"}</p>
        ${earnedAt ? `<p><strong>Earned at:</strong> ${earnedAt}</p>` : ""}
      </article>
    </div>
  `);
}

function formatDateTimeId(value) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function renderAbout() {
  const dailyLimit = state.dashboard?.dailyDuelLimit || DAILY_DUEL_LIMIT;
  const items = [
    ["Apa itu FORGE", "Foundation Of Resilience, Growth & Excellence: duel arena komunitas untuk menghidupkan interaksi positif."],
    ["Tujuan Komunitas", "Membuat member aktif, saling mengenal, dan bertumbuh lewat pertanyaan berbobot."],
    ["Forge Points", `<span class="about-fp-line"><img src="/image/fp.png" alt="FP" loading="lazy" />Forge Points adalah poin progres utama. FP duel maksimal 100; jawaban benar mendapat nilai berdasarkan sisa waktu, lalu total duel dinormalisasi ke skala 0-100.</span>`],
    ["Cara Duel", `Setiap duel berisi 5 soal, masing-masing 10 detik. Maksimal ${dailyLimit} duel per hari.`],
    ["Sistem Level", `Level 1 sampai Level 100. Setiap ${fpDisplay(1000)} lifetime naik 1 level.`],
    ["Hadiah Mingguan", `Recap juara idealnya Minggu 23:50 WITA, lalu weekly <span class="about-fp-name"><img src="/image/fp.png" alt="FP" loading="lazy" />Forge Points</span> reset Senin 00:00 WITA.`],
    ["WhatsApp Komunitas", "Gunakan contact person footer untuk masuk grup atau koordinasi duel."],
    ["Fire Streak", `Mainkan minimal satu duel setiap hari untuk menjaga Fire Streak. Jika sehari tidak bermain, streak akan kembali ke 0.`],
    ["Masih Bingung?", "Silakan bertanya atau hubungi admin melalui contact person di footer."],
  ];
  $("#aboutGrid").innerHTML = items.map(([title, text]) => `<article class="about-card"><h3>${title}</h3><p>${text}</p></article>`).join("");
}

function renderSettings() {
  const dailyLimit = state.dashboard.dailyDuelLimit || DAILY_DUEL_LIMIT;
  $("#nameInput").value = state.me.name;
  $("#usernameInput").value = state.me.username;
  $("#phoneInput").value = state.me.phone || "";
  const emailInput = $("#emailInput");
  if (emailInput) emailInput.value = state.me.email || "";
  $("#cityInput").value = state.me.city || "";
  setGenderInput(state.me.gender || "");
  const form = $("#settingsForm");
  removeUnusedSettingsToggles();
  for (const key of ["music_enabled", "sfx_enabled"]) {
    if (form[key]) form[key].checked = state.me.settings[key] !== false;
  }
  setSettingsCardOrder();
  renderDuelHistory();
  $("#profileStats").innerHTML = `
    <h3>Statistik Profil</h3>
    <div class="profile-stat-grid">
      <div class="copy-stat"><span>ID Pemain</span><strong>${state.me.given_id}</strong><button type="button" data-copy-value="${escapeHtml(state.me.given_id)}" data-copy-label="ID Pemain">Copy ID</button></div>
      <div class="copy-stat"><span>Username</span><strong>@${state.me.username}</strong><button type="button" data-copy-value="${escapeHtml(state.me.username)}" data-copy-label="Username">Copy Username</button></div>
      <div class="copy-stat"><span>Email Aktif</span><strong>${state.me.email || "-"}</strong><button type="button" data-copy-value="${escapeHtml(state.me.email || "")}" data-copy-label="Email">Copy Email</button></div>
      ${[
        ["Kota", state.me.city || "-"],
        ["Jenis Kelamin", genderLabel(state.me.gender)],
        ["Level Pemain", levelName(state.me.lifetime_fp)],
        ["Total Poin", fpDisplay(state.me.lifetime_fp)],
        ["Badge Unlocked", `${Number(state.dashboard.unlockedBadges || 0).toLocaleString("id-ID")}/${Number(state.dashboard.totalBadges || 0).toLocaleString("id-ID")}`],
        ["Rekor Duel", duelRecordBoxes(state.me.wins, state.me.losses, state.me.draws)],
        ["Jawaban Benar", state.me.total_correct],
        ["Rata-rata Waktu", avgTime(state.me)],
        ["Streak Menang", `${state.me.current_win_streak} menang`],
        ["Akun Dibuat", state.me.created_at ? new Date(state.me.created_at).toLocaleDateString("id-ID") : "-"],
        ["Fire Streak", `${state.me.fire_streak_days} hari`],
        ["Duel Hari Ini", `${state.dashboard.duelsToday || 0}/${dailyLimit}`],
      ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}
    </div>
  `;
}

function renderDuelHistory() {
  const history = state.dashboard.duelHistory || [];
  $("#duelHistoryList").innerHTML = history.length
    ? `<div class="duel-history-list">${history.map((duel) => `
      <article class="duel-history-item">
        <div>
          <strong>${duelResultLabel(duelHistoryResult(duel))}</strong>
          <small>vs ${duel.opponent_name} - ${new Date(duel.started_at).toLocaleString("id-ID")}</small>
        </div>
        <span>${fpDisplay(duel.fp_awarded || 0, { signed: true })}</span>
      </article>
    `).join("")}</div>`
    : `<p class="muted">Belum ada riwayat duel.</p>`;
}

async function startDuel() {
  if (state.isMatchmaking) return;
  clearResultCountdown();
  clearMatchmakingWatcher();
  const dailyLimit = getDailyDuelLimit();
  if ((state.dashboard?.duelsToday || 0) >= dailyLimit) {
    toast(`Maaf, Anda sudah mencapai limit duel harian ${dailyLimit}/${dailyLimit}.`);
    return;
  }
  state.isMatchmaking = true;
  let data;
  try {
    data = await api("/api/duel/start", { method: "POST" });
  } catch (err) {
    state.isMatchmaking = false;
    throw err;
  }
  if (data.duel) {
    state.isMatchmaking = false;
    beginDuel(data.duel);
    return;
  }
  showMatchmakingRoom(data.message);
  startMatchmakingWatcher();
}

function showMatchmakingRoom(message = "Menunggu lawan online. Jangan tutup halaman ini.") {
  $("#duelIdle").classList.add("is-hidden");
  $("#duelActive").classList.add("is-hidden");
  $("#duelResult").classList.remove("is-hidden");
  setDuelTopMode("result");
  $("#duelResult").innerHTML = `
    <p class="eyebrow">Ruang Tunggu</p>
    <h1>Mencari Lawan...</h1>
    <p class="result-copy">${escapeHtml(message)}</p>
    <div class="duel-result-actions">
      <button class="btn secondary" id="cancelMatchmakingBtn">Batalkan</button>
    </div>
  `;
}

function startMatchmakingWatcher() {
  clearMatchmakingWatcher();
  state.matchmakingTimer = window.setInterval(async () => {
    const data = await api("/api/duel/matchmaking/status").catch((err) => {
      toast(err.message);
      return null;
    });
    if (!data) return;
    if (data.duel) {
      state.isMatchmaking = false;
      beginDuel(data.duel);
      return;
    }
    if (data.cancelled) {
      state.isMatchmaking = false;
      clearMatchmakingWatcher();
      resetDuelToIdle();
      toast("Pencarian lawan dibatalkan atau sudah timeout.");
    }
  }, 1000);
}

async function cancelMatchmaking() {
  state.isMatchmaking = false;
  clearMatchmakingWatcher();
  await api("/api/duel/matchmaking/cancel", { method: "POST" }).catch(() => {});
  resetDuelToIdle();
  toast("Pencarian lawan dibatalkan.");
}

function renderQuestion() {
  clearInterval(state.duelTimer);
  const question = state.duel.questions[state.duelIndex];
  state.answerLocked = false;
  renderDuelProgress();
  state.remaining = 10;
  state.questionStartedAt = performance.now();
  $("#timerValue").textContent = "10";
  $(".timer-ring").style.setProperty("--progress", "100%");
  $("#questionCounter").textContent = `Soal ${state.duelIndex + 1}/5`;
  $("#questionCategory").textContent = question.category;
  $("#questionText").innerHTML = `
    ${question.image_url ? `<img class="question-image" src="${escapeHtml(question.image_url)}" alt="Gambar soal" loading="lazy" />` : ""}
    <span>${escapeHtml(question.question)}</span>
  `;
  $("#answersGrid").innerHTML = ["A", "B", "C", "D"].map((key) => `
    <button class="answer-btn" data-option="${key}">
      <strong>${key}</strong><span>${escapeHtml(question[`option_${key.toLowerCase()}`])}</span>
    </button>
  `).join("");
  state.duelTimer = setInterval(tickQuestion, 1000);
}

function tickQuestion() {
  state.remaining -= 1;
  $("#timerValue").textContent = String(Math.max(0, state.remaining));
  $(".timer-ring").style.setProperty("--progress", `${Math.max(0, state.remaining * 10)}%`);
  playSound("tick");
  if (state.remaining <= 0) {
    answerQuestion(null);
  }
}

async function answerQuestion(option) {
  if (state.answerLocked) return;
  state.answerLocked = true;
  clearInterval(state.duelTimer);
  const question = state.duel.questions[state.duelIndex];
  const timeMs = Math.min(10000, Math.round(performance.now() - state.questionStartedAt));
  const isCorrect = option === question.correct_option;
  state.duelUserAnswers[state.duelIndex] = isCorrect;
  renderDuelProgress();
  $$(".answer-btn").forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.option === question.correct_option) btn.classList.add("correct");
    if (option && btn.dataset.option === option && !isCorrect) btn.classList.add("wrong");
  });
  playSound(isCorrect ? "correct" : "wrong");
  state.duelAnswerSaves.push(api("/api/duel/answer", {
    method: "POST",
    body: { duelId: state.duel.id, questionId: question.id, selectedOption: option, answerTimeMs: timeMs },
  }));
  state.duelChannel?.send({
    type: "broadcast",
    event: "answer",
    payload: {
      duelId: state.duel.id,
      from: state.me?.id,
      index: state.duelIndex,
      questionId: question.id,
      isCorrect,
    },
  }).catch(() => {});
  window.setTimeout(async () => {
    state.duelIndex += 1;
    if (state.duelIndex >= state.duel.questions.length) {
      await finishDuel();
    } else {
      renderQuestion();
    }
  }, 120);
}

async function finishDuel({ fromSync = false } = {}) {
  if (!state.duel?.id || state.renderedResultDuelId === state.duel.id) return;
  await Promise.all(state.duelAnswerSaves);
  const data = await api("/api/duel/finish", { method: "POST", body: { duelId: state.duel.id } });
  if (data.waiting) {
    $("#duelActive").classList.add("is-hidden");
    $("#duelResult").classList.remove("is-hidden");
    setDuelTopMode("result");
    $("#duelResult").innerHTML = `
      <p class="eyebrow">Menunggu lawan</p>
      <h1>Jawaban kamu tersimpan</h1>
      <p class="result-copy">Hasil akan muncul otomatis setelah lawan selesai menjawab.</p>
    `;
    startDuelStatusWatcher();
    return;
  }
  const result = data.result;
  if (state.renderedResultDuelId === state.duel.id) return;
  state.renderedResultDuelId = state.duel.id;
  const nextLifetimeFp = Number(state.me.lifetime_fp || 0) + Number(result.fpAwarded || 0);
  const nextWeeklyFp = Number(state.me.weekly_fp || 0) + Number(result.fpAwarded || 0);
  const previousLevel = levelName(state.me.lifetime_fp);
  const nextLevel = levelName(nextLifetimeFp);
  const didLevelUp = previousLevel !== nextLevel;
  refreshMe().catch(() => {});
  const resultTitle = result.result === "win" ? "Menang" : result.result === "lose" ? "Kalah" : "Draw";
  const resultMessage = result.result === "win"
    ? "Congrats, forging until the best of you."
    : result.result === "lose"
      ? "Keep forging until you win."
      : "Draw today, forge stronger for the next duel.";
  $("#duelActive").classList.add("is-hidden");
  $("#duelResult").classList.remove("is-hidden");
  setDuelTopMode("result");
  $("#duelUserScore").textContent = `${result.userScore} poin`;
  $("#duelOpponentScore").textContent = `${result.opponentScore} poin`;
  $("#duelResult").innerHTML = `
    <div class="point-orb"><span>${fpDisplay(result.fpAwarded, { signed: true })}</span><small>Forge Points</small></div>
    <p class="eyebrow">Duel selesai</p>
    <h1>${resultTitle}</h1>
    <p class="result-copy">${resultMessage}</p>
    <div class="duel-result-grid">
      <article class="duel-result-card"><span>Poin Kamu</span><strong>${result.userScore}</strong></article>
      <article class="duel-result-card"><span>Poin Lawan</span><strong>${result.opponentScore}</strong></article>
      <article class="duel-result-card"><span>Lifetime FP</span><strong>${fpDisplay(nextLifetimeFp)}</strong></article>
      <article class="duel-result-card"><span>Weekly FP</span><strong>${fpDisplay(nextWeeklyFp)}</strong></article>
    </div>
    <div class="duel-result-actions">
      <button class="btn primary" id="rematchCountdownBtn">Cari Lawan Baru (20)</button>
      <button class="btn secondary" id="backHomeBtn">Kembali ke Beranda</button>
    </div>
  `;
  startResultCountdown();
  clearInterval(state.duelStatusTimer);
  state.duelStatusTimer = null;
  if (!fromSync) {
    state.duelChannel?.send({
      type: "broadcast",
      event: "finish",
      payload: { duelId: state.duel.id },
    }).catch(() => {});
  }
  if (didLevelUp) toast(`Selamat, kamu naik ke ${nextLevel}.`);
  for (const badge of result.newBadges || []) {
    toast(`Selamat, kamu membuka badge baru: ${badge.name}`);
  }
  if (state.resultSoundPlayedDuelIds.has(state.duel.id)) return;
  state.resultSoundPlayedDuelIds.add(state.duel.id);
  if (result.result === "win") {
    playSound("win", { overlap: true });
    $("#duelPanel").classList.add("win-glow");
    launchConfetti();
  } else if (result.result === "lose") {
    playSound("lose", { overlap: true });
    $("#duelPanel").classList.add("loss-shake");
  }
}

function launchConfetti() {
  const canvas = $("#confettiCanvas");
  const ctx = canvas.getContext("2d");
  const resize = () => {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
  };
  resize();
  const colors = ["#9B111E", "#D4AF37", "#F4D06F", "#FFFFFF"];
  const pieces = Array.from({ length: 160 }, () => ({
    x: Math.random() * canvas.width,
    y: -Math.random() * canvas.height * 0.4,
    w: 8 + Math.random() * 16,
    h: 4 + Math.random() * 10,
    vx: -4 + Math.random() * 8,
    vy: 4 + Math.random() * 8,
    rot: Math.random() * Math.PI,
    vr: -0.15 + Math.random() * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  let frame = 0;
  function draw() {
    frame += 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (frame < 170) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
}

function bindEvents() {
  $$("[data-auth-tab]").forEach((btn) => btn.addEventListener("click", () => setAuthTab(btn.dataset.authTab)));
  $$("[data-page]").forEach((btn) => btn.addEventListener("click", () => showPage(btn.dataset.page)));
  $$("[data-toggle-password]").forEach((button) => button.addEventListener("click", () => {
    const input = button.closest(".password-field")?.querySelector("input");
    if (!input) return;
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    button.classList.toggle("is-visible", !visible);
    button.setAttribute("aria-label", visible ? "Lihat password" : "Sembunyikan password");
  }));
  document.addEventListener("click", (event) => {
    const copyButton = event.target.closest("[data-copy-value]");
    if (copyButton) copyText(copyButton.dataset.copyValue, copyButton.dataset.copyLabel).catch((err) => toast(err.message));
  });

  $("#duelTopLogo").addEventListener("error", (event) => {
    event.currentTarget.src = "/image/forge-logo.png";
  }, { once: true });
  setDuelTopMode("idle");

  $("#profilePill").addEventListener("click", () => showPage("settings"));
  $("#mobileMenuBtn").addEventListener("click", (event) => {
    event.stopPropagation();
    const sidebar = $(".sidebar");
    const isOpen = sidebar.classList.toggle("is-open");
    document.body.classList.toggle("sidebar-open", isOpen);
  });

  document.addEventListener("click", (event) => {
    const sidebar = $(".sidebar");
    if (!sidebar?.classList.contains("is-open")) return;
    if (event.target.closest(".sidebar") || event.target.closest("#mobileMenuBtn")) return;
    sidebar.classList.remove("is-open");
    document.body.classList.remove("sidebar-open");
  });
  $("#genderPicker").addEventListener("click", (event) => {
    const button = event.target.closest("[data-gender]");
    if (!button) return;
    setGenderInput(button.dataset.gender);
    refreshVisibleAvatars({ ...state.me, gender: button.dataset.gender });
  });
  $("#registerGenderPicker").addEventListener("click", (event) => {
    const button = event.target.closest("[data-gender]");
    if (!button) return;
    setRegisterGender(button.dataset.gender);
  });
  $("#memberSearch").addEventListener("input", () => loadMembers().catch((err) => toast(err.message)));
  $("#memberTab").addEventListener("click", (event) => {
    const button = event.target.closest("[data-member-tab]");
    if (!button) return;
    $$("#memberTab [data-member-tab]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderCachedMembersForActiveTab();
    loadMembers().catch((err) => toast(err.message));
  });
  $("#memberList").addEventListener("click", (event) => {
    const relationBtn = event.target.closest("[data-relation]");
    if (relationBtn) return toggleRelation(relationBtn).catch((err) => toast(err.message));
    const inviteBtn = event.target.closest("[data-invite]");
    if (inviteBtn) return inviteDuel(inviteBtn.dataset.invite).catch((err) => toast(err.message));
    const row = event.target.closest(".member-row");
    if (row) showMemberProfile(row);
  });
  $("#memberList").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".member-row");
    if (!row) return;
    event.preventDefault();
    showMemberProfile(row);
  });
  $("#requestPanel").addEventListener("click", (event) => {
    const requestBtn = event.target.closest("[data-request-action]");
    if (requestBtn) respondDuelRequest(requestBtn).catch((err) => toast(err.message));
  });
  $("#badgeGrid").addEventListener("click", (event) => {
    const button = event.target.closest(".badge-tile");
    if (button) showBadgeDetail(button);
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-badge-close]")) {
      document.querySelector(".badge-modal")?.remove();
    }
  });
  $("#answersGrid").addEventListener("click", (event) => {
    const button = event.target.closest(".answer-btn");
    if (button) answerQuestion(button.dataset.option).catch((err) => toast(err.message));
  });
  $("#duelResult").addEventListener("click", (event) => {
    if (event.target.closest("#cancelMatchmakingBtn")) cancelMatchmaking().catch((err) => toast(err.message));
    if (event.target.closest("#rematchCountdownBtn")) resetDuelToIdle();
    if (event.target.closest("#backHomeBtn")) {
      resetDuelToIdle();
      showPage("home");
    }
  });
  $("#startDuelBtn").addEventListener("click", () => startDuel().catch((err) => toast(err.message)));

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(event.currentTarget);
    setBusy(target, true, "Masuk...");
    try {
      const data = await api("/api/auth/login", { method: "POST", body: Object.fromEntries(form) });
      setStoredSessionToken(data.sessionToken);
      await loadMe();
      toast("Login berhasil.");
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(target, false);
    }
  });

  $("#registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = event.currentTarget;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    if (body.password !== body.confirmPassword) return toast("Password confirmation tidak sama.");
    setBusy(target, true, "Membuat akun...");
    try {
      await api("/api/auth/register", { method: "POST", body });
      setAuthTab("login");
      event.currentTarget.reset();
      setRegisterGender("male");
      toast("Akun berhasil dibuat. Silakan login.");
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(target, false);
    }
  });

  $("#resetForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = event.currentTarget;
    const body = Object.fromEntries(new FormData(target));
    setBusy(target, true, "Mengirim kode...");
    try {
      await api("/api/auth/reset/request", { method: "POST", body: { email: body.email } });
      $("#resetConfirmBlock")?.classList.remove("is-hidden");
      toast("Kode reset sudah dikirim ke email aktif kamu.");
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(target, false);
    }
  });

  $("#confirmResetBtn")?.addEventListener("click", async () => {
    const form = $("#resetForm");
    const body = Object.fromEntries(new FormData(form));
    if (body.password !== body.confirmPassword) return toast("Konfirmasi password baru tidak sama.");
    setBusy(form, true, "Mengganti password...");
    try {
      await api("/api/auth/reset/confirm", { method: "POST", body });
      form.reset();
      $("#resetConfirmBlock")?.classList.add("is-hidden");
      setAuthTab("login");
      toast("Password berhasil diganti. Silakan login.");
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(form, false);
    }
  });

  $("#profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = event.currentTarget;
    setBusy(target, true, "Menyimpan...");
    try {
      await api("/api/me/profile", { method: "PATCH", body: Object.fromEntries(new FormData(event.currentTarget)) });
      await refreshMe();
      refreshVisibleAvatars();
      toast("Profil tersimpan.");
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(target, false);
    }
  });

  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = {
      music_enabled: form.music_enabled.checked,
      sfx_enabled: form.sfx_enabled.checked,
    };
    setBusy(form, true, "Menyimpan...");
    try {
      await api("/api/me/settings", { method: "PATCH", body });
      await refreshMe();
      if (body.music_enabled) startBackgroundMusic();
      else stopBackgroundMusic();
      toast("Pengaturan tersimpan.");
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(form, false);
    }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setStoredSessionToken("");
    clearInterval(state.requestPollTimer);
    clearInterval(state.requestCountdownTimer);
    clearInterval(state.duelStatusTimer);
    clearMatchmakingWatcher();
    clearDuelStartTimer();
    if (state.realtimeClient) {
      if (state.userChannel) state.realtimeClient.removeChannel(state.userChannel);
      if (state.duelChannel) state.realtimeClient.removeChannel(state.duelChannel);
    }
    state.requestPollTimer = null;
    state.requestCountdownTimer = null;
    state.duelStatusTimer = null;
    state.userChannel = null;
    state.duelChannel = null;
    state.realtimeClient = null;
    state.me = null;
    $("#authView").classList.remove("is-hidden");
    $("#appView").classList.add("is-hidden");
    toast("Logout berhasil.");
  });

  $("#deleteAccountBtn").addEventListener("click", () => {
    toast("Delete account disiapkan sebagai admin action agar tidak terpencet tidak sengaja.");
  });
}

bindEvents();
restoreSession();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
