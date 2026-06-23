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
  seenRequestIds: new Set(),
  acceptedRequestIds: new Set(),
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
  tick: "/sounds/clock-tick.mp3",
  correct: "/sounds/correct.mp3",
  wrong: "/sounds/wrong.mp3",
  win: "/sounds/win.mp3",
  lose: "/sounds/lose.mp3",
  background: "/sounds/idle.mp3",
  duelMusic: "/sounds/duel.mp3",
};

async function api(path, options = {}) {
  const token = getStoredSessionToken();
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    credentials: "same-origin",
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
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
  el.textContent = message;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 2800);
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

function playSound(name) {
  if (state.me && state.me.settings?.sfx_enabled === false) return;
  activateAudio();
  if (state.audioContext?.state === "suspended") {
    state.audioContext.resume().catch(() => {});
  }
  const audio = state.sounds[name];
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(() => tone(name));
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
    win: 1040,
    lose: 130,
    duelStart: 560,
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
  state.duelOpponentAnswers = duel.mode === "realtime"
    ? Array(duel.questions.length).fill(null)
    : distributeScore(duel.opponent_score, duel.questions.length);
  state.duelOpponentAnsweredCount = 0;
  state.duelAnswerSaves = [];
  state.answerLocked = false;
  renderDuelProgress();
}

function renderDuelProgress() {
  const total = state.duel?.questions?.length || 5;
  const activeIndex = Math.min(state.duelIndex, total - 1);
  const userDone = state.duelUserAnswers.filter((value) => value !== null).length;
  const opponentDone = state.duel?.mode === "realtime" ? Math.min(state.duelOpponentAnsweredCount, total) : Math.min(userDone, total);
  const userCorrect = state.duelUserAnswers.filter((value) => value === true).length;
  const opponentVisible = state.duelOpponentAnswers.slice(0, opponentDone);
  const opponentCorrect = opponentVisible.filter((value) => value === true).length;
  $("#duelUserScore").textContent = `${userCorrect} benar · Soal ${Math.min(userDone + 1, total)}/${total}`;
  $("#duelOpponentScore").textContent = `${opponentCorrect} benar · Soal ${Math.min(opponentDone + 1, total)}/${total}`;
  renderScoreBars($("#duelUserBars"), state.duelUserAnswers, activeIndex);
  renderScoreBars($("#duelOpponentBars"), state.duelOpponentAnswers.map((value, index) => index < opponentDone ? value : null), activeIndex);
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

function setDuelTopMode(mode) {
  const active = mode === "active";
  $("#duelTopLogo").classList.toggle("is-hidden", active || mode === "result");
  $(".timer-ring").classList.toggle("is-hidden", !active);
  $(".timer-ring").classList.toggle("is-result", mode === "result");
}

function resetDuelToIdle() {
  clearResultCountdown();
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
  $("#pillFp").textContent = state.me.lifetime_fp.toLocaleString("id-ID");
  $("#pillAvatar").src = avatar(state.me);
  applyAvatarColor($("#pillAvatarWrap"), state.me);
  $("#sideFire").textContent = `${state.me.fire_streak_days} hari`;
  $("#homeAvatar").src = avatar(state.me);
  applyAvatarColor($("#homeAvatarWrap"), state.me);
  $("#duelUserAvatar").src = avatar(state.me);
  applyAvatarColor($("#duelUserAvatarWrap"), state.me);
  $("#duelUserName").textContent = state.me.username;
}

function renderDashboard() {
  const user = state.me;
  const dailyLimit = state.dashboard.dailyDuelLimit || DAILY_DUEL_LIMIT;
  $("#duelLimitText").textContent = `Maksimal ${dailyLimit} duel per hari. Setiap duel berisi 5 pertanyaan, masing-masing 10 detik.`;
  $("#homeName").textContent = user.name;
  $("#homeUsername").textContent = user.username;
  $("#homeLevel").textContent = levelName(user.lifetime_fp);
  $("#badgePreviewText").textContent = `${state.dashboard.unlockedBadges}/${state.dashboard.totalBadges} terbuka`;
  $("#topPreviewText").textContent = state.dashboard.top3.map((row) => `${row.rank}. ${row.username}`).join("  ") || "Belum ada ranking";

  const stats = [
    ["Fire Streak", `${user.fire_streak_days} hari`],
    ["Peringkat Saat Ini", `#${state.dashboard.myRank || "-"}`],
    ["FP Mingguan", user.weekly_fp.toLocaleString("id-ID")],
    ["Lifetime FP", user.lifetime_fp.toLocaleString("id-ID")],
    ["Level", levelName(user.lifetime_fp)],
    ["Duel Hari Ini", `${state.dashboard.duelsToday || 0}/${dailyLimit}`],
  ];
  $("#dashboardStats").innerHTML = stats.map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
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
        toast(`${request.requester_username} mengajak kamu duel. Accept dalam 10 detik.`);
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
  if (tab === "online") return members.filter((member) => member.online);
  if (tab === "friends") return members.filter((member) => member.is_friend);
  if (tab === "favourites") return members.filter((member) => member.is_favourite);
  return members;
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
      <div class="member-level-cell"><span>${levelName(member.lifetime_fp)}</span><small>${member.lifetime_fp.toLocaleString("id-ID")} FP</small></div>
      <div><span class="status-dot ${member.online ? "online" : "offline"}"></span>${member.online ? "Online" : "Offline"}</div>
      <div class="mini-actions">
        <button class="${member.is_friend ? "is-on" : ""}" data-relation="friend" data-id="${member.id}">Friend</button>
        <button class="${member.is_favourite ? "is-on" : ""}" data-relation="favourite" data-id="${member.id}">Fav</button>
        <button data-invite="${member.id}">Invite Duel</button>
      </div>
    </article>
  `).join("") || `<p class="muted">Belum ada member lain. Daftarkan minimal 2 akun agar Member Arena terisi.</p>`;
}

function showMemberProfile(row) {
  const member = JSON.parse(row.dataset.member.replace(/&apos;/g, "'"));
  $$(".member-row").forEach((item) => item.classList.toggle("is-selected", item === row));
  const totalDuels = Number(member.wins || 0) + Number(member.losses || 0) + Number(member.draws || 0);
  const stats = [
    ["Kota", member.city || "-"],
    ["Jenis Kelamin", genderLabel(member.gender)],
    ["Level", levelName(member.lifetime_fp)],
    ["Lifetime FP", member.lifetime_fp.toLocaleString("id-ID")],
    ["Weekly FP", member.weekly_fp.toLocaleString("id-ID")],
    ["Duel Count", totalDuels.toLocaleString("id-ID")],
    ["W/L/D", `${member.wins || 0}/${member.losses || 0}/${member.draws || 0}`],
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
        ${stats.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}
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
    const friendBtn = row?.querySelector("[data-relation='friend']");
    const favouriteBtn = row?.querySelector("[data-relation='favourite']");
    friendBtn?.classList.toggle("is-on", Boolean(relation.is_friend));
    favouriteBtn?.classList.toggle("is-on", Boolean(relation.is_favourite));
    state.cache = Object.fromEntries(Object.entries(state.cache).filter(([key]) => !key.startsWith("members:")));
    const tab = getActiveMemberTab();
    if ((tab === "friends" && !relation.is_friend) || (tab === "favourites" && !relation.is_favourite)) {
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
  toast("Undangan duel terkirim. Menunggu accept 10 detik.");
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
  playSound("duelStart");
  renderQuestion();
}

function subscribeDuelChannel(duelId) {
  if (!state.realtimeClient) return;
  if (state.duelChannel) {
    state.realtimeClient.removeChannel(state.duelChannel);
    state.duelChannel = null;
  }
  state.duelChannel = state.realtimeClient.channel(`forge-duel-${duelId}`);
  state.duelChannel
    .on("broadcast", { event: "answer" }, () => refreshDuelStatus().catch(() => {}))
    .on("broadcast", { event: "finish" }, () => finishDuel({ fromSync: true }).catch(() => {}))
    .subscribe();
}

function startDuelStatusWatcher() {
  clearInterval(state.duelStatusTimer);
  state.duelStatusTimer = window.setInterval(() => {
    refreshDuelStatus().catch(() => {});
  }, 1500);
}

async function refreshDuelStatus() {
  if (!state.duel?.id) return;
  const data = await api(`/api/duel/${state.duel.id}/status`);
  const status = data.status;
  if (status?.opponentAnswered !== undefined) {
    const visible = Math.min(status.opponentAnswered, state.duelOpponentAnswers.length);
    state.duelOpponentAnsweredCount = visible;
    state.duelOpponentAnswers = state.duelOpponentAnswers.map((value, index) => index < visible ? "done" : null);
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
    <article class="leader-row top-${row.rank}">
      <strong>#${row.rank}</strong>
      <div class="leader-player"><span class="avatar-ring" style="--avatar-color:${profileColor(row)}"><img src="${avatar(row)}" alt="" /></span><span><strong>${row.name}</strong><small>@${row.username}</small></span></div>
      <span>${levelName(row.lifetime_fp)}</span>
      <strong>${row.weekly_fp.toLocaleString("id-ID")}</strong>
      <span>${row.wins}</span>
      <span>${row.avg_time}</span>
    </article>
  `).join("") || `<p class="muted">Belum ada data peringkat.</p>`;

  $("#hallOfLegends").innerHTML = `
    <div class="legend-block">
      <strong>Weekly Recap</strong>
      <p class="muted">Recap juara: ${data.weekly?.recapAt || "Minggu 23:50 WITA"}<br>Reset weekly FP: ${data.weekly?.resetAt || "Senin 00:00 WITA"}</p>
      ${data.weekly?.lastWinners?.length ? data.weekly.lastWinners.map((winner) => `
        <article class="legend-person">
          <span class="legend-medal">#${winner.rank}</span>
          <span><b>@${winner.username}</b><small>${Number(winner.weekly_fp || 0).toLocaleString("id-ID")} FP · ${winner.week_key}</small></span>
        </article>
      `).join("") : `<p class="muted">Belum ada recap minggu lalu.</p>`}
    </div>
    <div class="legend-block">
      <strong>Fire Streak Tertinggi</strong>
      ${data.legends.fire.length ? data.legends.fire.map((u, index) => `
        <article class="legend-person">
          <span class="legend-medal">#${index + 1}</span>
          <span><b>@${u.username}</b><small>${u.fire_streak_days} hari menyala</small></span>
        </article>
      `).join("") : `<p class="muted">Belum ada streak.</p>`}
    </div>
    <div class="legend-block">
      <strong>Menang Terbanyak</strong>
      <article class="legend-person">
        <span class="legend-medal">W</span>
        <span><b>@${data.legends.mostWins?.username || "-"}</b><small>${data.legends.mostWins?.wins || 0} kemenangan</small></span>
      </article>
    </div>
    <div class="legend-block">
      <strong>Ronde Tercepat</strong>
      <article class="legend-person">
        <span class="legend-medal">F</span>
        <span><b>@${data.legends.fastest?.username || "-"}</b><small>${data.legends.fastest?.avg_time || "0s"} rata-rata</small></span>
      </article>
    </div>
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
  $("#badgeGrid").innerHTML = data.badges.map((badge) => `
    <button class="badge-tile ${badge.earned_at ? "" : "locked"}" data-badge='${JSON.stringify(badge).replace(/'/g, "&apos;")}'>
      <span class="badge-icon">${badge.earned_at ? badge.icon : "?"}</span>
      <strong>${badge.name}</strong>
      <small>${badge.earned_at ? "Terbuka" : "Terkunci"}</small>
    </button>
  `).join("") || `<p class="muted">Badge belum tersedia. Buka halaman ini lagi setelah database schema dan seed berhasil.</p>`;
}

function showBadgeDetail(button) {
  const badge = JSON.parse(button.dataset.badge.replace(/&apos;/g, "'"));
  $("#badgeDetail").innerHTML = `
    <div class="badge-icon">${badge.earned_at ? badge.icon : "?"}</div>
    <h3>${badge.name}</h3>
    <p>${badge.description}</p>
    <p><strong>Syarat:</strong> ${badge.unlock_rule}</p>
    <p><strong>Status:</strong> ${badge.earned_at ? `Terbuka pada ${new Date(badge.earned_at).toLocaleDateString("id-ID")}` : "Terkunci"}</p>
  `;
}

function renderAbout() {
  const dailyLimit = state.dashboard?.dailyDuelLimit || DAILY_DUEL_LIMIT;
  const items = [
    ["Apa itu FORGE", "Foundation Of Resilience, Growth & Excellence: duel arena komunitas untuk menghidupkan interaksi positif."],
    ["Tujuan Komunitas", "Membuat member aktif, saling mengenal, dan bertumbuh lewat pertanyaan berbobot."],
    ["Forge Points", "FP duel maksimal 100. Jawaban benar mendapat nilai berdasarkan sisa waktu, lalu total duel dinormalisasi ke skala 0-100."],
    ["Cara Duel", `Setiap duel berisi 5 soal, masing-masing 10 detik. Maksimal ${dailyLimit} duel per hari.`],
    ["Sistem Level", "Level 1 sampai Level 100. Setiap 1000 lifetime FP naik 1 level."],
    ["Hadiah Mingguan", "Recap juara idealnya Minggu 23:50 WITA, lalu weekly FP reset Senin 00:00 WITA."],
    ["WhatsApp Komunitas", "Gunakan contact person footer untuk masuk grup atau koordinasi duel."],
    ["Tutorial Singkat", "Daftar dengan nomor WhatsApp, login, mulai duel, kumpulkan FP, dan buka badges."],
    ["Masih Bingung?", "Silakan bertanya atau hubungi admin melalui contact person di footer."],
  ];
  $("#aboutGrid").innerHTML = items.map(([title, text]) => `<article class="about-card"><h3>${title}</h3><p>${text}</p></article>`).join("");
}

function renderSettings() {
  const dailyLimit = state.dashboard.dailyDuelLimit || DAILY_DUEL_LIMIT;
  $("#nameInput").value = state.me.name;
  $("#usernameInput").value = state.me.username;
  $("#phoneInput").value = state.me.phone || "";
  $("#cityInput").value = state.me.city || "";
  setGenderInput(state.me.gender || "");
  const form = $("#settingsForm");
  for (const key of ["music_enabled", "sfx_enabled", "show_online_status", "allow_duel_invites"]) {
    form[key].checked = state.me.settings[key] !== false;
  }
  renderDuelHistory();
  $("#profileStats").innerHTML = `
    <h3>Statistik Profil</h3>
    <div class="profile-stat-grid">
      <div class="copy-stat"><span>ID Pemain</span><strong>${state.me.given_id}</strong><button type="button" data-copy-value="${escapeHtml(state.me.given_id)}" data-copy-label="ID Pemain">Copy ID</button></div>
      <div class="copy-stat"><span>Username</span><strong>@${state.me.username}</strong><button type="button" data-copy-value="${escapeHtml(state.me.username)}" data-copy-label="Username">Copy Username</button></div>
      ${[
        ["Kota", state.me.city || "-"],
        ["Jenis Kelamin", genderLabel(state.me.gender)],
        ["Level Pemain", levelName(state.me.lifetime_fp)],
        ["Total Poin", state.me.lifetime_fp.toLocaleString("id-ID")],
        ["Menang / Kalah / Draw", `${state.me.wins}/${state.me.losses}/${state.me.draws}`],
        ["Jawaban Benar", state.me.total_correct],
        ["Rata-rata Waktu", avgTime(state.me)],
        ["Streak Menang", `${state.me.current_win_streak} menang`],
        ["Duel Pertama", state.me.first_duel_at ? new Date(state.me.first_duel_at).toLocaleDateString("id-ID") : "-"],
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
          <strong>${duel.result || "active"}</strong>
          <small>vs ${duel.opponent_name} - ${new Date(duel.started_at).toLocaleString("id-ID")}</small>
        </div>
        <span>+${duel.fp_awarded || 0} FP</span>
      </article>
    `).join("")}</div>`
    : `<p class="muted">Belum ada riwayat duel.</p>`;
}

async function startDuel() {
  clearResultCountdown();
  const dailyLimit = getDailyDuelLimit();
  if ((state.dashboard?.duelsToday || 0) >= dailyLimit) {
    toast(`Maaf, Anda sudah mencapai limit duel harian ${dailyLimit}/${dailyLimit}.`);
    return;
  }
  const data = await api("/api/duel/start", { method: "POST" });
  beginDuel(data.duel);
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
    payload: { duelId: state.duel.id, index: state.duelIndex },
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
  const nextLifetimeFp = Number(state.me.lifetime_fp || 0) + Number(result.fpAwarded || 0);
  const nextWeeklyFp = Number(state.me.weekly_fp || 0) + Number(result.fpAwarded || 0);
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
  $("#duelUserScore").textContent = `${result.userScore} benar`;
  $("#duelOpponentScore").textContent = `${result.opponentScore} benar`;
  $("#duelResult").innerHTML = `
    <div class="point-orb"><span>+${result.fpAwarded}</span><small>FP</small></div>
    <p class="eyebrow">Duel selesai</p>
    <h1>${resultTitle}</h1>
    <p class="result-copy">${resultMessage}</p>
    <div class="duel-result-grid">
      <article class="duel-result-card tilt-left"><span>Skor Kamu</span><strong>${result.userScore}/5</strong></article>
      <article class="duel-result-card tilt-right"><span>Skor Lawan</span><strong>${result.opponentScore}/5</strong></article>
      <article class="duel-result-card tilt-left"><span>Lifetime FP</span><strong>${nextLifetimeFp.toLocaleString("id-ID")}</strong></article>
      <article class="duel-result-card tilt-right"><span>Weekly FP</span><strong>${nextWeeklyFp.toLocaleString("id-ID")}</strong></article>
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
  if (result.result === "win") {
    playSound("win");
    $("#duelPanel").classList.add("win-glow");
    launchConfetti();
  } else if (result.result === "lose") {
    playSound("lose");
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
  $("#mobileMenuBtn").addEventListener("click", () => $(".sidebar").classList.toggle("is-open"));
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
  $("#answersGrid").addEventListener("click", (event) => {
    const button = event.target.closest(".answer-btn");
    if (button) answerQuestion(button.dataset.option).catch((err) => toast(err.message));
  });
  $("#duelResult").addEventListener("click", (event) => {
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
      show_online_status: form.show_online_status.checked,
      allow_duel_invites: form.allow_duel_invites.checked,
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
