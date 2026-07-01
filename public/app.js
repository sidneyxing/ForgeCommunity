const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const DAILY_DUEL_LIMIT = 7;
const SESSION_STORAGE_KEY = "forge_session_token";

const state = {
  me: null,
  dashboard: null,
  duel: null,
  serverTimeOffsetMs: 0,
  duelIndex: 0,
  duelUserAnswers: [],
  duelOpponentAnswers: [],
  duelOpponentAnsweredCount: 0,
  duelAnswerSaves: [],
  duelAnswerPayloads: [],
  finishingDuelId: null,
  currentQuestionKey: "",
  questionTimerToken: 0,
  matchmakingPollBusy: false,
  answerLocked: false,
  duelTimer: null,
  resultCountdownTimer: null,
  resultCountdown: 120,
  questionStartedAt: 0,
  remaining: 10,
  audioReady: false,
  lastButtonSoundAt: 0,
  audioContext: null,
  backgroundMusic: null,
  duelMusic: null,
  musicMode: "idle",
  pianoLoopTimer: null,
  sounds: {},
  audioPrimed: false,
  audioPrimeTimer: null,
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
  richToastSeq: 0,
  richToastTimers: new Map(),
  visibleInviteToastIds: new Set(),
  visibleBadgeToastIds: new Set(),
  memberProfileModalOpen: false,
  memberProfileHistoryPushed: false,
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
  badgeNotif: "/sounds/badgenotif.mp3",
  duelNotif: "/sounds/duelnotif.mp3",
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

function syncServerClock(serverNowIso) {
  if (!serverNowIso) return;

  const serverMs = new Date(serverNowIso).getTime();
  if (!Number.isFinite(serverMs)) return;

  state.serverTimeOffsetMs = serverMs - Date.now();
}

function serverNowMs() {
  return Date.now() + Number(state.serverTimeOffsetMs || 0);
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

function ensureRichToastStack() {
  let stack = $("#richToastStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "richToastStack";
    stack.className = "rich-toast-stack";
    stack.setAttribute("aria-live", "polite");
    document.body.append(stack);
  }
  return stack;
}

function dismissRichToast(toastId) {
  const toastEl = document.querySelector(`[data-rich-toast-id="${toastId}"]`);
  const timer = state.richToastTimers.get(toastId);
  if (timer) window.clearTimeout(timer);
  state.richToastTimers.delete(toastId);
  if (!toastEl) return;
  toastEl.classList.add("is-leaving");
  window.setTimeout(() => toastEl.remove(), 160);
}

function showRichToast({ type = "info", title = "FORGE", message = "", messageHtml = "", actions = [], autoCloseMs = 5200, sound = "notif" } = {}) {
  const stack = ensureRichToastStack();
  const toastId = `rt_${++state.richToastSeq}`;
  const toastEl = document.createElement("article");
  toastEl.className = `rich-toast rich-toast-${type}`;
  toastEl.dataset.richToastId = toastId;
  toastEl.innerHTML = `
    <button class="rich-toast-close" type="button" aria-label="Tutup notifikasi">×</button>
    <div class="rich-toast-body">
      <strong>${escapeHtml(title)}</strong>
      <p>${messageHtml || escapeHtml(message)}</p>
    </div>
    ${actions.length ? `<div class="rich-toast-actions"></div>` : ""}
  `;

  toastEl.querySelector(".rich-toast-close")?.addEventListener("click", () => dismissRichToast(toastId));
  const actionsWrap = toastEl.querySelector(".rich-toast-actions");
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `rich-toast-action ${action.variant === "secondary" ? "secondary" : "primary"}`;
    button.dataset.toastAction = action.action || action.label || "action";
    button.innerHTML = `<span>${escapeHtml(action.label || "Lihat")}</span>`;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.classList.add("is-loading");
      try {
        await action.onClick?.();
        dismissRichToast(toastId);
      } catch (err) {
        button.disabled = false;
        button.classList.remove("is-loading");
        toast(err.message || "Aksi notifikasi gagal.");
      }
    });
    actionsWrap?.append(button);
  }

  stack.prepend(toastEl);
  if (sound) playSound(sound, { overlap: true });

  if (autoCloseMs > 0) {
    const timer = window.setTimeout(() => dismissRichToast(toastId), autoCloseMs);
    state.richToastTimers.set(toastId, timer);
  }
  return toastId;
}

function badgeTileById(badgeId) {
  for (const tile of $$("#badgeGrid .badge-tile")) {
    try {
      const badge = JSON.parse(tile.dataset.badge.replace(/&apos;/g, "'"));
      if (badge.id === badgeId) return tile;
    } catch {
      // Ignore broken dataset and continue.
    }
  }
  return null;
}

async function openBadgeById(badgeId) {
  showPage("badges");
  await loadBadges().catch((err) => toast(err.message));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const tile = badgeTileById(badgeId);
  if (!tile) return;
  tile.scrollIntoView({ behavior: "smooth", block: "center" });
  tile.focus({ preventScroll: true });
  showBadgeDetail(tile);
}

function showBadgeUnlockNotification(badge = {}) {
  if (!badge?.id || state.visibleBadgeToastIds.has(badge.id)) return;
  state.visibleBadgeToastIds.add(badge.id);
  showRichToast({
    type: "badge",
    title: "Badge baru terbuka",
    message: badge.name ? `Kamu membuka badge ${badge.name}.` : "Kamu membuka badge baru.",
    actions: [{ label: "Lihat Badge", onClick: () => openBadgeById(badge.id) }],
    autoCloseMs: 9000,
    sound: "badgeNotif",
  });
}

function showDuelInviteNotification(request = {}) {
  if (!request?.id || state.visibleInviteToastIds.has(request.id)) return;
  state.visibleInviteToastIds.add(request.id);
  const left = secondsLeft(request);
  const toastId = showRichToast({
    type: "duel",
    title: "Undangan Duel",
    messageHtml: `@${escapeHtml(request.requester_username || "member")} mengajak kamu duel. <span class="rich-toast-countdown" data-invite-countdown="${escapeHtml(request.id)}">${left > 0 ? `Sisa ${left} detik.` : "Segera respon."}</span>`,
    actions: [
      { label: "Accept", action: "accept", variant: "primary", onClick: () => respondDuelRequestById(request.id, "accept") },
      { label: "Decline", action: "decline", variant: "secondary", onClick: () => respondDuelRequestById(request.id, "decline") },
    ],
    autoCloseMs: Math.max(4200, (left || 8) * 1000),
    sound: "duelNotif",
  });
  const toastEl = document.querySelector(`[data-rich-toast-id="${toastId}"]`);
  if (toastEl) {
    toastEl.dataset.requestId = request.id;
    toastEl.dataset.expiresAt = request.expires_at || "";
    toastEl.dataset.expiresInMs = String(Number(request.expires_in_ms || 0));
    toastEl.dataset.receivedAtMs = String(Number(request.received_at_ms || Date.now()));
  }
  updateInviteToastCountdowns();
}

function secondsLeftFromToast(toastEl) {
  if (!toastEl) return 0;
  const expiresInMs = Number(toastEl.dataset.expiresInMs || 0);
  const receivedAtMs = Number(toastEl.dataset.receivedAtMs || Date.now());
  if (Number.isFinite(expiresInMs) && expiresInMs > 0) {
    return Math.max(0, Math.ceil((expiresInMs - (Date.now() - receivedAtMs)) / 1000));
  }
  if (toastEl.dataset.expiresAt) {
    return Math.max(0, Math.ceil((new Date(toastEl.dataset.expiresAt).getTime() - serverNowMs()) / 1000));
  }
  return 0;
}

function updateInviteToastCountdowns() {
  for (const toastEl of $$(".rich-toast-duel[data-request-id]")) {
    const left = secondsLeftFromToast(toastEl);
    const countdown = toastEl.querySelector("[data-invite-countdown]");
    if (countdown) countdown.textContent = left > 0 ? `Sisa ${left} detik.` : "Waktu accept habis.";
    const acceptButton = toastEl.querySelector('[data-toast-action="accept"]');
    if (acceptButton && left <= 0) acceptButton.disabled = true;
  }
}

async function respondDuelRequestById(requestId, action = "accept") {
  const data = await api(`/api/duel-requests/${requestId}/respond`, {
    method: "POST",
    body: { action },
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
  return data;
}

function activateAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (AudioContext) {
    state.audioContext ||= new AudioContext();
    if (state.audioContext.state === "suspended") {
      state.audioContext.resume().catch(() => {});
    }
  }

  if (state.audioReady) return;
  state.audioReady = true;
  for (const [key, src] of Object.entries(soundFiles)) {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    if (key === "background") {
      audio.loop = true;
      audio.volume = 0.16;
      state.backgroundMusic = audio;
    } else if (key === "duelMusic") {
      audio.loop = true;
      audio.volume = 0.24;
      state.duelMusic = audio;
    } else if (key === "badgeNotif" || key === "duelNotif") {
      audio.volume = 0.78;
    }
    state.sounds[key] = audio;
  }
  setMusicMode(state.musicMode);
}


function primeSfxAudioForMobile() {
  activateAudio();
  if (state.audioPrimed) return;
  state.audioPrimed = true;

  for (const name of ["button", "notif", "badgeNotif", "duelNotif"]) {
    const audio = state.sounds[name];
    if (!audio) continue;
    audio.load?.();
  }

  if (state.audioContext?.state === "suspended") {
    state.audioContext.resume().catch(() => {});
  }
}

function notificationToneFallback(name) {
  if (name === "duelNotif") {
    tone("duelNotif");
    return;
  }
  if (name === "badgeNotif") {
    tone("badgeNotif");
    return;
  }
  tone(name);
}

function playSound(name, options = {}) {
  if (state.me && state.me.settings?.sfx_enabled === false) return;
  activateAudio();

  const resumeAudioContext = () => {
    if (state.audioContext?.state === "suspended") {
      return state.audioContext.resume().catch(() => {});
    }
    return Promise.resolve();
  };

  const audio = state.sounds[name];
  if (!audio) {
    resumeAudioContext().finally(() => notificationToneFallback(name));
    return;
  }

  const player = options.overlap ? audio.cloneNode(true) : audio;
  player.currentTime = 0;
  player.volume = options.volume ?? audio.volume;

  resumeAudioContext()
    .then(() => player.play())
    .catch(() => {
      // Mobile browsers sometimes block MP3 playback for async notifications.
      // Keep a generated fallback so duel/badge notification still has sound.
      resumeAudioContext().finally(() => notificationToneFallback(name));
    });
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

function playGeneratedTone(frequency, { type = "sine", duration = 0.17, volume = 0.05 } = {}) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  state.audioContext ||= new AudioContext();
  const ctx = state.audioContext;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequency;
  osc.type = type;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.01);
}

function tone(name) {
  if (name === "duelNotif") {
    playGeneratedTone(620, { duration: 0.16, volume: 0.062 });
    window.setTimeout(() => playGeneratedTone(880, { duration: 0.18, volume: 0.058 }), 125);
    return;
  }
  if (name === "badgeNotif") {
    playGeneratedTone(1180, { duration: 0.15, volume: 0.056 });
    window.setTimeout(() => playGeneratedTone(1460, { duration: 0.18, volume: 0.044 }), 105);
    return;
  }
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
  playGeneratedTone(frequency, {
    type: name === "lose" || name === "wrong" ? "sawtooth" : "sine",
    duration: 0.17,
    volume: 0.05,
  });
}

function isTapSoundTarget(target) {
  return Boolean(target?.closest?.("button, a, [role='button'], [data-page], .action-card, .member-row, .badge-tile"));
}

function playButtonPressSound() {
  const now = performance.now();
  // Wider debounce prevents double sound on mobile when the browser fires
  // pointer/touch/click around the same tap.
  if (now - Number(state.lastButtonSoundAt || 0) < 420) return;
  state.lastButtonSoundAt = now;
  playSound("button", { overlap: true, volume: 0.72 });
}

if ("PointerEvent" in window) {
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (isTapSoundTarget(event.target)) playButtonPressSound();
  }, { capture: true, passive: true });
} else {
  document.addEventListener("touchstart", (event) => {
    if (isTapSoundTarget(event.target)) playButtonPressSound();
  }, { capture: true, passive: true });

  document.addEventListener("click", (event) => {
    if (isTapSoundTarget(event.target)) playButtonPressSound();
  }, { capture: true });
}

function unlockAudioOnFirstGesture() {
  primeSfxAudioForMobile();
  startBackgroundMusic();
}

document.addEventListener("pointerdown", unlockAudioOnFirstGesture, { once: true, passive: true });
if (!("PointerEvent" in window)) {
  document.addEventListener("touchstart", unlockAudioOnFirstGesture, { once: true, passive: true });
}


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
      <span class="fp-diamond" aria-hidden="true"></span>
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
  state.duelAnswerPayloads = [];
  state.finishingDuelId = null;
  state.currentQuestionKey = "";
  state.questionTimerToken += 1;
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
  state.duelAnswerPayloads = [];
  state.finishingDuelId = null;
  state.currentQuestionKey = "";
  state.questionTimerToken += 1;
  state.matchmakingPollBusy = false;
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
  state.resultCountdown = 120;
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
        showDuelInviteNotification(request);
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
  if (state.currentPage === "members") {
    renderRequests(requests, outgoing);
    refreshMemberInviteButtons();
  }
  startRequestCountdownTimer();
  return { ...data, requests, outgoing };
}

function startRequestCountdownTimer() {
  clearInterval(state.requestCountdownTimer);
  const hasPending = [...state.currentIncomingRequests, ...state.currentOutgoingRequests]
    .some((request) => request.status === "pending" && secondsLeft(request) > 0);
  updateInviteToastCountdowns();
  if (!hasPending) return;
  state.requestCountdownTimer = window.setInterval(() => {
    updateInviteToastCountdowns();
    if (state.currentPage === "members") {
      renderRequests(state.currentIncomingRequests, state.currentOutgoingRequests);
      refreshMemberInviteButtons();
    }
    const stillPending = [...state.currentIncomingRequests, ...state.currentOutgoingRequests]
      .some((request) => request.status === "pending" && secondsLeft(request) > 0);
    if (!stillPending) {
      clearInterval(state.requestCountdownTimer);
      state.requestCountdownTimer = null;
      if (state.currentPage === "members") {
        loadDuelRequests({ notify: false }).catch(() => {});
        refreshMemberInviteButtons();
      }
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

function refreshMemberInviteButtons() {
  if (state.currentPage !== "members") return;
  if (!renderCachedMembersForActiveTab()) return;
}

function activeOutgoingPendingRequest() {
  return (state.currentOutgoingRequests || []).find((request) => request.status === "pending" && secondsLeft(request) > 0) || null;
}

function outgoingPendingForMember(memberId) {
  return (state.currentOutgoingRequests || []).find((request) => request.status === "pending" && request.target_id === memberId && secondsLeft(request) > 0) || null;
}

function inviteButtonHtml(member) {
  if (!member.online) {
    return `<button class="duel-action" data-invite="${member.id}" disabled>Offline</button>`;
  }

  const ownPending = outgoingPendingForMember(member.id);
  if (ownPending) {
    return `<button class="duel-action is-pending" data-invite="${member.id}" disabled>Pending ${secondsLeft(ownPending)}s</button>`;
  }

  const anyPending = activeOutgoingPendingRequest();
  if (anyPending) {
    return `<button class="duel-action is-pending" data-invite="${member.id}" disabled>Pending ${secondsLeft(anyPending)}s</button>`;
  }

  return `<button class="duel-action" data-invite="${member.id}">Invite Duel</button>`;
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
        ${inviteButtonHtml(member)}
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
  const changePasswordCard = $("#changePasswordForm")?.closest(".settings-card");
  const historyCard = $("#duelHistoryList")?.closest(".settings-card");
  const accountCard = $("#settingsForm")?.closest(".settings-card");
  const adminResetCard = $("#adminResetPasswordForm")?.closest(".settings-card");
  const statsCard = $("#profileStats");

  // Desktop layout:
  // kiri: Pengaturan Profil, kanan atas: Change Password, kanan bawah: Pengaturan Akun.
  // Row berikutnya tetap Riwayat Duel sejajar dengan Statistik Profil.
  if (profileCard) profileCard.style.order = "1";
  if (changePasswordCard) changePasswordCard.style.order = "2";
  if (accountCard) accountCard.style.order = "3";
  if (historyCard) historyCard.style.order = "4";
  if (statsCard) statsCard.style.order = "5";
  if (adminResetCard) adminResetCard.style.order = "6";
}

function isCurrentUserAdmin() {
  return Boolean(state.me?.is_admin);
}

function syncAdminResetVisibility() {
  const form = $("#adminResetPasswordForm");
  const card = form?.closest(".settings-card");
  const visible = isCurrentUserAdmin();
  card?.classList.toggle("is-hidden", !visible);
  if (form) {
    Array.from(form.elements).forEach((field) => {
      field.disabled = !visible;
    });
  }
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
  openMemberProfileModal(member);
}

function memberProfileStatsHtml(member) {
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
    ["Fire Streak", `${member.fire_streak_days || 0} hari`],
    ["Status", member.online ? "Online" : "Offline"],
  ];

  return stats.map(([label, value]) => {
    const fpClass = /fp/i.test(label) ? ' class="fp-stat"' : "";
    return `<div${fpClass}><span>${label}</span><strong>${value}</strong></div>`;
  }).join("");
}

function openMemberProfileModal(member = {}) {
  const wasOpen = state.memberProfileModalOpen;
  document.querySelector(".member-profile-modal")?.remove();
  document.body.classList.add("modal-open");
  state.memberProfileModalOpen = true;

  document.body.insertAdjacentHTML("beforeend", `
    <div class="member-profile-modal" role="dialog" aria-modal="true" aria-label="Profile member ${escapeHtml(member.username || "")}">
      <button class="member-profile-backdrop" type="button" data-member-modal-close aria-label="Tutup profile member"></button>
      <article class="member-profile-dialog">
        <button class="member-profile-close" type="button" data-member-modal-close aria-label="Tutup">×</button>
        <div class="member-profile-card member-profile-card-modal">
          <div class="member-profile-modal-head">
            <span class="avatar-ring avatar-ring-large" style="--avatar-color:${profileColor(member)}"><img src="${avatar(member)}" alt="" /></span>
            <div class="member-profile-main">
              <p class="eyebrow">Profile Member</p>
              <h3>${escapeHtml(member.name || "Member")}</h3>
              <small>@${escapeHtml(member.username || "member")} / ID ${escapeHtml(member.given_id || "-")} · ${escapeHtml(member.city || "-")}</small>
            </div>
          </div>
          <div class="member-profile-stats">
            ${memberProfileStatsHtml(member)}
          </div>
        </div>
      </article>
    </div>
  `);

  if (!wasOpen) {
    try {
      history.pushState({ ...(history.state || {}), forgeMemberProfileModal: true }, "", window.location.href);
      state.memberProfileHistoryPushed = true;
    } catch {
      state.memberProfileHistoryPushed = false;
    }
  }
}

function closeMemberProfileModal({ fromHistory = false } = {}) {
  const modal = document.querySelector(".member-profile-modal");
  if (!modal && !state.memberProfileModalOpen) return;

  if (!fromHistory && state.memberProfileHistoryPushed) {
    try {
      history.back();
      return;
    } catch {
      // Continue close normally if history.back is blocked.
    }
  }

  state.memberProfileModalOpen = false;
  state.memberProfileHistoryPushed = false;
  document.body.classList.remove("modal-open");
  $$(".member-row").forEach((item) => item.classList.remove("is-selected"));

  if (!modal) return;
  modal.classList.add("is-closing");
  window.setTimeout(() => modal.remove(), 150);
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

async function inviteDuel(memberId, button = null) {
  if (button?.disabled) return;
  const pending = activeOutgoingPendingRequest();
  if (pending) {
    refreshMemberInviteButtons();
    return;
  }
  const originalText = button?.textContent || "Invite Duel";
  if (button) {
    button.disabled = true;
    button.classList.add("is-pending");
    button.textContent = "Pending 20s";
  }

  try {
    const data = await api(`/api/members/${memberId}/invite`, { method: "POST" });
    if (!data.alreadyPending) {
      state.realtimeClient?.channel(`forge-user-${memberId}`).send({
        type: "broadcast",
        event: "duel-invite",
        payload: { from: state.me.id },
      }).catch(() => {});
    }
    await loadDuelRequests({ notify: false }).catch(() => {});
    renderCachedMembersForActiveTab();
    toast(data.alreadyPending ? "Undangan duel masih pending." : "Undangan duel terkirim. Menunggu accept 20 detik.");
  } catch (err) {
    if (button) {
      button.disabled = false;
      button.classList.remove("is-pending");
      button.textContent = originalText;
    }
    throw err;
  }
}

async function respondDuelRequest(button) {
  return respondDuelRequestById(button.dataset.requestId, button.dataset.requestAction);
}

function beginDuel(duel) {
  syncServerClock(duel?.server_now);

  if (!duel?.id) {
    toast("Duel tidak valid dari server. Coba mulai ulang.");
    return;
  }

  // A single duel can arrive through more than one channel: matchmaking poll,
  // realtime broadcast, and invite polling. Do not restart the same duel,
  // because restarting calls renderQuestion() again and resets the timer to 10.
  if (state.duel?.id === duel.id && state.renderedResultDuelId !== duel.id) {
    if (Array.isArray(duel.questions) && duel.questions.length >= 5 && (!Array.isArray(state.duel.questions) || state.duel.questions.length < 5)) {
      state.duel.questions = duel.questions;
    }
    if (duel.status) state.duel.status = duel.status;
    return;
  }

  if (!Array.isArray(duel.questions) || duel.questions.length < 5) {
    recoverDuelStart(duel).catch((err) => {
      resetDuelToIdle();
      toast(err.message || "Soal duel gagal dimuat. Coba mulai duel baru.");
    });
    return;
  }

  clearResultCountdown();
  clearMatchmakingWatcher();
  clearDuelStartTimer();
  clearInterval(state.duelTimer);
  clearInterval(state.duelStatusTimer);
  state.duelStatusTimer = null;
  state.isMatchmaking = false;
  state.matchmakingPollBusy = false;
  state.currentQuestionKey = "";
  state.questionTimerToken += 1;
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

async function recoverDuelStart(duel) {
  if (!duel?.id) throw new Error("Duel tidak valid dari server.");
  showPage("duel");
  $("#duelIdle").classList.add("is-hidden");
  $("#duelActive").classList.add("is-hidden");
  $("#duelResult").classList.remove("is-hidden");
  setDuelTopMode("result");
  $("#duelResult").innerHTML = `
    <div class="duel-loading-orb" aria-hidden="true"></div>
    <p class="eyebrow">Memuat duel</p>
    <h1>Loading...</h1>
    <p class="result-copy">Soal sedang disinkronkan ulang dari server.</p>
  `;
  const data = await api(`/api/duel/${duel.id}`);
  if (!Array.isArray(data.duel?.questions) || data.duel.questions.length < 5) {
    throw new Error("Soal duel belum lengkap dari server. Duel dibatalkan agar tidak stuck di loading.");
  }
  beginDuel(data.duel);
}

function startSyncedDuelCountdown() {
  clearDuelStartTimer();
  const duelId = state.duel?.id;
  const startsAtMs = new Date(state.duel?.starts_at || Date.now()).getTime();
  const delayMs = startsAtMs - serverNowMs();

  state.duelStartCountdownLastSecond = null;

  const startActiveQuestion = () => {
    if (!state.duel?.id || state.duel.id !== duelId || state.renderedResultDuelId === duelId) return;
    $("#duelResult").classList.add("is-hidden");
    $("#duelActive").classList.remove("is-hidden");
    setDuelTopMode("active");
    playSound("matchStart", { overlap: true });
    renderQuestion();
  };

  if (delayMs <= 250) {
    startActiveQuestion();
    return;
  }

  $("#duelActive").classList.add("is-hidden");
  $("#duelResult").classList.remove("is-hidden");
  setDuelTopMode("result");

  const renderCountdown = () => {
    if (!state.duel?.id || state.duel.id !== duelId || state.renderedResultDuelId === duelId) {
      clearDuelStartTimer();
      return;
    }

    const nowMs = serverNowMs();
    const left = Math.max(1, Math.ceil((startsAtMs - nowMs) / 1000));

    if (left !== state.duelStartCountdownLastSecond && nowMs < startsAtMs) {
      state.duelStartCountdownLastSecond = left;
      playSound("matchBeep", { overlap: true });
    }

    $("#duelResult").innerHTML = `
      <p class="eyebrow">Lawan ditemukan</p>
      <h1>Mulai dalam ${left}</h1>
      <p class="result-copy">Kamu dan lawan sudah masuk ruang duel. Soal akan muncul bersamaan.</p>
    `;

    if (serverNowMs() >= startsAtMs) {
      clearDuelStartTimer();
      state.duelStartCountdownLastSecond = null;
      startActiveQuestion();
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
    .on("broadcast", { event: "finish" }, () => refreshDuelStatus().catch(() => {}))
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
  syncServerClock(status?.server_now);
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
    await finishDuel({ fromSync: true, forceResult: true });
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
    ${topList("Lifetime FP Terbanyak", data.legends?.lifetime || [], (row) => fpDisplay(row.lifetime_fp))}
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
  const idNumber = Number(String(badge.id || "").match(/_(\d+)$/)?.[1] || 0);
  const normalizedName = String(badge.real_name || badge.name || "").trim().toLowerCase();
  return (idNumber >= 141 && idNumber <= 150) || SECRET_BADGE_NAMES.has(normalizedName);
}

function badgeDisplayName(badge = {}) {
  if (!badge.earned_at && isSecretBadge(badge)) return "???";
  return badge.name || badge.real_name || "Badge";
}

function badgeDisplayDescription(badge = {}) {
  if (badge.earned_at) return badge.description || "Badge berhasil terbuka.";
  if (isSecretBadge(badge)) return "Nama dan syarat badge ini masih tersembunyi sampai kamu berhasil membukanya.";
  return "Syarat badge ini masih tersembunyi sampai kamu berhasil membukanya.";
}

function renderBadges(data) {
  $("#badgeProgress").textContent = `${data.unlocked}/${data.total} terbuka`;
  const badgeDetail = $("#badgeDetail");
  badgeDetail?.classList.add("is-hidden");
  if (badgeDetail) badgeDetail.innerHTML = "";
  $("#badgeGrid").innerHTML = data.badges.map((badge) => {
    const name = badgeDisplayName(badge);
    const secretClass = !badge.earned_at && isSecretBadge(badge) ? " secret-locked" : "";
    return `
      <button class="badge-tile ${badge.earned_at ? "" : `locked${secretClass}`}" data-badge='${JSON.stringify(badge).replace(/'/g, "&apos;")}'>
        <span class="badge-icon">${badge.earned_at ? badgeVisual(badge) : "?"}</span>
        <strong>${escapeHtml(name)}</strong>
        <small>${badge.earned_at ? "Terbuka" : "Terkunci"}</small>
      </button>
    `;
  }).join("") || `<p class="muted">Badge belum tersedia. Buka halaman ini lagi setelah database schema dan seed berhasil.</p>`;
}

function badgeVisual(badge) {
  const fallback = escapeHtml((badgeDisplayName(badge) || "?").trim().charAt(0).toUpperCase() || "?");
  if (!badge.img_url) return fallback;
  return `<img class="badge-img" src="${escapeHtml(badge.img_url)}" alt="" loading="lazy" onerror="this.remove();this.parentElement.textContent='${fallback}'" />`;
}

function showBadgeDetail(button) {
  const badge = JSON.parse(button.dataset.badge.replace(/&apos;/g, "'"));
  document.querySelector(".badge-modal")?.remove();
  const earnedAt = badge.earned_at ? formatDateTimeId(badge.earned_at) : null;
  const displayName = badgeDisplayName(badge);
  const displayDescription = badgeDisplayDescription(badge);
  const modalClass = badge.earned_at ? "is-unlocked" : "is-locked";
  document.body.insertAdjacentHTML("beforeend", `
    <div class="badge-modal ${modalClass}" role="dialog" aria-modal="true">
      <button class="badge-modal-backdrop" type="button" data-badge-close aria-label="Tutup detail badge"></button>
      <article class="badge-modal-card">
        <button class="badge-modal-close" type="button" data-badge-close aria-label="Tutup">x</button>
        <div class="badge-icon">${badge.earned_at ? badgeVisual(badge) : "?"}</div>
        <h3>${escapeHtml(displayName)}</h3>
        <p>${escapeHtml(displayDescription)}</p>
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
    ["Forge Points", `<span class="about-fp-line"><span class="fp-diamond" aria-hidden="true"></span><span>Forge Points adalah poin progres utama. FP duel maksimal 100; jawaban benar mendapat nilai berdasarkan sisa waktu, lalu total duel dinormalisasi ke skala 0-100.</span></span>`],
    ["Cara Duel", `Setiap duel berisi 5 soal, masing-masing 10 detik. Maksimal ${dailyLimit} duel per hari.`],
    ["Sistem Level", `Level 1 sampai Level 100. Setiap ${fpDisplay(1000)} lifetime naik 1 level.`],
    ["Hadiah Mingguan", `Recap juara idealnya Minggu 23:50 WIB, lalu weekly <span class="about-fp-name"><span class="fp-diamond" aria-hidden="true"></span>Forge Points</span> reset Senin 00:00 WIB.`],
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
  syncAdminResetVisibility();
  setSettingsCardOrder();
  renderDuelHistory();
  $("#profileStats").innerHTML = `
    <h3>Statistik Profil</h3>
    <div class="profile-stat-grid">
      <div class="copy-stat"><span>ID Pemain</span><strong>${state.me.given_id}</strong><button type="button" data-copy-value="${escapeHtml(state.me.given_id)}" data-copy-label="ID Pemain">Copy ID</button></div>
      <div class="copy-stat"><span>Username</span><strong>@${state.me.username}</strong><button type="button" data-copy-value="${escapeHtml(state.me.username)}" data-copy-label="Username">Copy Username</button></div>
      ${[
        ["Level Pemain", levelName(state.me.lifetime_fp)],
        ["Total Poin", fpDisplay(state.me.lifetime_fp), "profile-total-points"],
        ["Badge Unlocked", `${Number(state.dashboard.unlockedBadges || 0).toLocaleString("id-ID")}/${Number(state.dashboard.totalBadges || 0).toLocaleString("id-ID")}`],
        ["Rekor Duel", duelRecordBoxes(state.me.wins, state.me.losses, state.me.draws)],
        ["Jawaban Benar", state.me.total_correct],
        ["Rata-rata Waktu", avgTime(state.me)],
        ["Streak Menang", `${state.me.current_win_streak} menang`],
        ["Akun Dibuat", state.me.created_at ? new Date(state.me.created_at).toLocaleDateString("id-ID") : "-"],
        ["Fire Streak", `${state.me.fire_streak_days} hari`],
        ["Duel Hari Ini", `${state.dashboard.duelsToday || 0}/${dailyLimit}`],
      ].map(([label, value, extraClass]) => `<div class="${extraClass || ""}"><span>${label}</span><strong>${value}</strong></div>`).join("")}
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
  state.matchmakingPollBusy = false;
  state.matchmakingTimer = window.setInterval(async () => {
    if (state.matchmakingPollBusy || state.duel?.id) return;
    state.matchmakingPollBusy = true;
    try {
      const data = await api("/api/duel/matchmaking/status").catch((err) => {
        toast(err.message);
        return null;
      });
      if (!data) return;
      if (data.duel) {
        state.isMatchmaking = false;
        clearMatchmakingWatcher();
        beginDuel(data.duel);
        return;
      }
      if (data.cancelled) {
        state.isMatchmaking = false;
        clearMatchmakingWatcher();
        resetDuelToIdle();
        toast("Pencarian lawan dibatalkan atau sudah timeout.");
      }
    } finally {
      state.matchmakingPollBusy = false;
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

function isValidQuestionImageUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return false;

  const lowered = url.toLowerCase();
  return !["null", "undefined", "none", "false", "-"].includes(lowered);
}

function renderQuestion() {
  if (!state.duel?.id || state.renderedResultDuelId === state.duel.id) return;

  const question = state.duel.questions?.[state.duelIndex];
  if (!question?.id) {
    showDuelCalculatingResult("Soal belum siap. Sedang mencoba sinkronisasi ulang.");
    recoverDuelStart(state.duel).catch((err) => {
      resetDuelToIdle();
      toast(err.message || "Soal duel gagal dimuat. Coba mulai duel baru.");
    });
    return;
  }

  const questionKey = `${state.duel.id}:${state.duelIndex}:${question.id}`;
  if (state.currentQuestionKey === questionKey) {
    return;
  }

  clearInterval(state.duelTimer);
  state.currentQuestionKey = questionKey;
  const timerToken = ++state.questionTimerToken;

  const imageUrl = String(question.image_url ?? "").trim();
  const hasImage = isValidQuestionImageUrl(imageUrl);

  state.answerLocked = false;
  renderDuelProgress();
  state.remaining = 10;
  state.questionStartedAt = performance.now();

  $("#timerValue").textContent = "10";
  $(".timer-ring").style.setProperty("--progress", "100%");
  $("#questionCounter").textContent = `Soal ${state.duelIndex + 1}/${state.duel.questions.length}`;
  $("#questionCategory").textContent = question.category;

  $("#questionText").classList.toggle("has-question-image", hasImage);
  $("#questionText").innerHTML = `
    ${
      hasImage
        ? `
          <div class="question-image-wrap">
            <img class="question-image" src="${escapeHtml(imageUrl)}" alt="Gambar soal" loading="lazy" />
          </div>
        `
        : ""
    }
    <span class="question-copy">${escapeHtml(question.question)}</span>
  `;

  const image = $("#questionText .question-image");
  if (image) {
    image.addEventListener("error", () => {
      image.closest(".question-image-wrap")?.remove();
      $("#questionText")?.classList.remove("has-question-image");
    }, { once: true });
  }

  $("#answersGrid").innerHTML = ["A", "B", "C", "D"].map((key) => `
    <button class="answer-btn" data-option="${key}">
      <strong>${key}</strong><span>${escapeHtml(question[`option_${key.toLowerCase()}`])}</span>
    </button>
  `).join("");

  state.duelTimer = setInterval(() => tickQuestion(timerToken), 1000);
}

function tickQuestion(timerToken) {
  if (timerToken !== state.questionTimerToken || !state.duel?.id || state.renderedResultDuelId === state.duel.id) return;
  state.remaining -= 1;
  $("#timerValue").textContent = String(Math.max(0, state.remaining));
  $(".timer-ring").style.setProperty("--progress", `${Math.max(0, state.remaining * 10)}%`);
  playSound("tick");
  if (state.remaining <= 0) {
    clearInterval(state.duelTimer);
    answerQuestion(null, { timerToken });
  }
}

async function answerQuestion(option, { timerToken = state.questionTimerToken } = {}) {
  if (timerToken !== state.questionTimerToken || state.answerLocked || !state.duel?.id) return;
  state.answerLocked = true;
  clearInterval(state.duelTimer);
  state.duelTimer = null;
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
  const answerPayload = { duelId: state.duel.id, questionId: question.id, selectedOption: option, answerTimeMs: timeMs };
  state.duelAnswerPayloads.push(answerPayload);
  state.duelAnswerSaves.push(api("/api/duel/answer", {
    method: "POST",
    body: answerPayload,
  }).then(() => ({ ok: true })).catch((error) => ({ ok: false, error })));
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
  const answeredDuelId = state.duel.id;
  window.setTimeout(async () => {
    if (!state.duel?.id || state.duel.id !== answeredDuelId || state.renderedResultDuelId === answeredDuelId) return;
    state.currentQuestionKey = "";
    state.duelIndex += 1;
    if (state.duelIndex >= state.duel.questions.length) {
      await finishDuel();
    } else {
      renderQuestion();
    }
  }, 120);
}

function showDuelCalculatingResult(message = "Menghitung hasil duel...") {
  if (!state.duel?.id || state.renderedResultDuelId === state.duel.id) return;
  $("#duelActive")?.classList.add("is-hidden");
  $("#duelResult")?.classList.remove("is-hidden");
  setDuelTopMode("result");
  const resultEl = $("#duelResult");
  if (!resultEl) return;
  resultEl.innerHTML = `
    <div class="duel-loading-orb" aria-hidden="true"></div>
    <p class="eyebrow">Duel selesai</p>
    <h1>Loading...</h1>
    <p class="result-copy">${escapeHtml(message)}</p>
  `;
}

function localAnsweredCount() {
  return state.duelUserAnswers.filter((value) => value !== null).length;
}

async function flushDuelAnswerSaves() {
  const saves = [...state.duelAnswerSaves];
  if (saves.length) {
    const settled = await Promise.all(saves);
    if (settled.every((item) => item?.ok !== false)) return;
  }

  const payloads = [...state.duelAnswerPayloads];
  if (!payloads.length) return;

  state.duelAnswerSaves = payloads.map((payload) => api("/api/duel/answer", {
    method: "POST",
    body: payload,
  }));
  const retrySettled = await Promise.allSettled(state.duelAnswerSaves);
  const failed = retrySettled.find((item) => item.status === "rejected");
  if (failed) {
    throw failed.reason || new Error("Jawaban belum berhasil tersimpan.");
  }
}

function restoreActiveQuestionAfterFinishError() {
  if (!state.duel?.id || state.duelIndex >= state.duel.questions.length) return;
  $("#duelResult")?.classList.add("is-hidden");
  $("#duelActive")?.classList.remove("is-hidden");
  setDuelTopMode("active");
}

async function finishDuel({ fromSync = false, forceResult = false } = {}) {
  if (!state.duel?.id || state.renderedResultDuelId === state.duel.id) return;

  const duelId = state.duel.id;
  if (state.finishingDuelId === duelId) return;

  if (fromSync && !forceResult && localAnsweredCount() < state.duel.questions.length) {
    refreshDuelStatus().catch(() => {});
    return;
  }

  state.finishingDuelId = duelId;
  showDuelCalculatingResult(fromSync ? "Sinkronisasi hasil dari lawan..." : "Jawaban kamu sedang disimpan. Mohon tunggu sebentar.");

  let data;
  try {
    await flushDuelAnswerSaves();
    data = await api("/api/duel/finish", { method: "POST", body: { duelId } });
  } catch (err) {
    state.finishingDuelId = null;
    if (/jawab semua pertanyaan/i.test(err.message || "")) {
      restoreActiveQuestionAfterFinishError();
      toast("Lanjutkan duel sampai semua soal terjawab.");
      return;
    }
    $("#duelResult").classList.remove("is-hidden");
    $("#duelActive").classList.add("is-hidden");
    setDuelTopMode("result");
    $("#duelResult").innerHTML = `
      <p class="eyebrow">Duel belum selesai</p>
      <h1>Gagal Sync</h1>
      <p class="result-copy">${escapeHtml(err.message || "Hasil duel belum bisa disimpan.")}</p>
      <div class="duel-result-actions">
        <button class="btn primary" id="retryFinishDuelBtn">Coba Lagi</button>
        <button class="btn secondary" id="backHomeBtn">Kembali ke Beranda</button>
      </div>
    `;
    return;
  } finally {
    if (!data || data.waiting) state.finishingDuelId = null;
  }

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
  if (state.renderedResultDuelId === duelId) return;
  state.renderedResultDuelId = duelId;
  state.finishingDuelId = null;

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
      <button class="btn primary" id="rematchCountdownBtn">Cari Lawan Baru (120)</button>
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
      payload: { duelId },
    }).catch(() => {});
  }
  if (didLevelUp) toast(`Selamat, kamu naik ke ${nextLevel}.`);
  for (const badge of result.newBadges || []) {
    showBadgeUnlockNotification(badge);
  }
  if (state.resultSoundPlayedDuelIds.has(duelId)) return;
  state.resultSoundPlayedDuelIds.add(duelId);
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

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-member-modal-close]")) closeMemberProfileModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.memberProfileModalOpen) closeMemberProfileModal();
  });

  window.addEventListener("popstate", () => {
    if (state.memberProfileModalOpen) closeMemberProfileModal({ fromHistory: true });
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
    if (inviteBtn) return inviteDuel(inviteBtn.dataset.invite, inviteBtn).catch((err) => toast(err.message));
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
    if (event.target.closest("#retryFinishDuelBtn")) finishDuel({ forceResult: true }).catch((err) => toast(err.message));
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

  $("#resetForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    toast("Reset email belum aktif. Silakan hubungi WA admin 081392187414.");
  });

  $("#changePasswordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (String(body.newPassword || "").length < 8) return toast("Password baru minimal 8 karakter.");
    if (body.newPassword !== body.confirmPassword) return toast("Konfirmasi password baru tidak sama.");
    if (body.currentPassword === body.newPassword) return toast("Password baru tidak boleh sama dengan password lama.");
    setBusy(form, true, "Mengganti password...");
    try {
      const data = await api("/api/me/password", {
        method: "POST",
        body: {
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
          confirmPassword: body.confirmPassword,
        },
      });
      form.reset();
      toast(data.message || "Password berhasil diganti.");
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(form, false);
    }
  });

  $("#adminResetPasswordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isCurrentUserAdmin()) return toast("Fitur ini khusus admin.");
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (String(body.newPassword || "").length < 8) return toast("Password baru minimal 8 karakter.");
    if (body.newPassword !== body.confirmPassword) return toast("Konfirmasi password baru tidak sama.");
    setBusy(form, true, "Mereset password...");
    try {
      const data = await api("/api/admin/reset-password", {
        method: "POST",
        body: {
          adminKey: body.adminKey,
          identifier: body.identifier,
          newPassword: body.newPassword,
        },
      });
      form.reset();
      toast(data.message || "Password user berhasil direset.");
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
