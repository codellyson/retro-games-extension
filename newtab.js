/* Retro new-tab shell.
   Hosts the clock, search, theme/difficulty pickers, HUD, audio, and pause.
   Loads one game module at a time from ./games/*.js. */

// ---- Game registry ------------------------------------------------------
const GAMES = {
  breakout:    { name: "Breakout",    module: "./games/breakout.js" },
  snake:       { name: "Snake",       module: "./games/snake.js" },
  brickshootr: { name: "Brickshootr", module: "./games/brickshootr.js" },
  dodger:      { name: "Dodger",      module: "./games/dodger.js" },
};

// ---- Elements -----------------------------------------------------------
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const levelEl = document.getElementById("level");
const livesEl = document.getElementById("lives");
const overlayEl = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlaySub = document.getElementById("overlaySub");
const timeEl = document.getElementById("time");
const dateEl = document.getElementById("date");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const themePicker = document.querySelector(".theme-picker");
const muteBtn = document.getElementById("muteBtn");
const iconOn = document.getElementById("iconSoundOn");
const iconOff = document.getElementById("iconSoundOff");
const pauseBtn = document.getElementById("pauseBtn");
const iconPause = document.getElementById("iconPause");
const iconPlay = document.getElementById("iconPlay");
const diffPicker = document.querySelector(".diff-picker");
const gamePicker = document.querySelector(".game-picker");
const stageEl = document.getElementById("stage");

// ---- Storage ------------------------------------------------------------
const storage = {
  async get(keys) {
    if (window.chrome?.storage?.sync) {
      return new Promise((r) => chrome.storage.sync.get(keys, r));
    }
    const out = {};
    for (const k of keys) {
      try {
        const v = localStorage.getItem("bo_" + k);
        if (v !== null) out[k] = JSON.parse(v);
      } catch (_) {}
    }
    return out;
  },
  async set(obj) {
    if (window.chrome?.storage?.sync) {
      return new Promise((r) => chrome.storage.sync.set(obj, r));
    }
    for (const [k, v] of Object.entries(obj)) {
      localStorage.setItem("bo_" + k, JSON.stringify(v));
    }
  },
};

// ---- Clock --------------------------------------------------------------
function updateClock() {
  const d = new Date();
  timeEl.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  dateEl.textContent = d.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}
updateClock();
setInterval(updateClock, 15000);

// ---- Search -------------------------------------------------------------
searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  window.location.href = /^https?:\/\//i.test(q)
    ? q
    : `https://www.google.com/search?q=${encodeURIComponent(q)}`;
});

// ---- Theme --------------------------------------------------------------
const THEMES = ["glassy", "neon", "paper"];
let currentTheme = "glassy";
function applyTheme(t) {
  currentTheme = THEMES.includes(t) ? t : "glassy";
  document.body.dataset.theme = currentTheme;
  for (const btn of themePicker.querySelectorAll(".theme-btn")) {
    btn.classList.toggle("active", btn.dataset.theme === currentTheme);
  }
}
themePicker.addEventListener("click", (e) => {
  const btn = e.target.closest(".theme-btn");
  if (!btn) return;
  applyTheme(btn.dataset.theme);
  storage.set({ theme: currentTheme });
});

// ---- Difficulty (shell-level — games read via getDifficulty) ------------
const DIFFICULTIES = ["easy", "normal", "hard"];
let currentDifficulty = "normal";
function applyDifficulty(d) {
  currentDifficulty = DIFFICULTIES.includes(d) ? d : "normal";
  for (const btn of diffPicker.querySelectorAll(".diff-btn")) {
    btn.classList.toggle("active", btn.dataset.difficulty === currentDifficulty);
  }
}
diffPicker.addEventListener("click", (e) => {
  const btn = e.target.closest(".diff-btn");
  if (!btn) return;
  applyDifficulty(btn.dataset.difficulty);
  storage.set({ difficulty: currentDifficulty });
  currentGame?.onDifficultyChange?.(currentDifficulty);
});

// ---- Audio --------------------------------------------------------------
let audioCtx = null;
let muted = false;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}
function blip({ freq = 440, dur = 0.08, type = "square", gain = 0.15, slide = 0 } = {}) {
  if (muted || !audioCtx) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}
function setMuted(m) {
  muted = m;
  iconOn.style.display = muted ? "none" : "";
  iconOff.style.display = muted ? "" : "none";
  storage.set({ muted });
}
muteBtn.addEventListener("click", () => setMuted(!muted));

// ---- HUD ----------------------------------------------------------------
const hud = {
  setScore(n) { scoreEl.textContent = String(n).padStart(4, "0"); },
  setLevel(n) { levelEl.textContent = String(n); },
  setLives(full, max) {
    const f = Math.max(0, full | 0);
    const e = Math.max(0, (max | 0) - f);
    livesEl.textContent = "♥".repeat(f) + "♡".repeat(e);
  },
  setBest(n) { bestEl.textContent = String(n).padStart(4, "0"); },
};

// ---- Overlay ------------------------------------------------------------
const overlay = {
  show(title, sub) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub || "";
    overlayEl.classList.remove("hidden");
  },
  hide() {
    overlayEl.classList.add("hidden");
  },
};

// ---- Pause --------------------------------------------------------------
function updatePauseIcon() {
  const playing = currentGame?.getStatus?.() === "playing";
  iconPause.style.display = playing ? "" : "none";
  iconPlay.style.display = playing ? "none" : "";
}
function togglePause() {
  ensureAudio();
  currentGame?.togglePause?.();
  updatePauseIcon();
}
pauseBtn.addEventListener("click", togglePause);

// ---- Input forwarding ---------------------------------------------------
window.addEventListener("keydown", (e) => {
  if (document.activeElement === searchInput) return;
  if (e.key === "p" || e.key === "P") { togglePause(); return; }
  if (e.key === "m" || e.key === "M") { setMuted(!muted); return; }
  currentGame?.onKey?.(e, true);
});
window.addEventListener("keyup", (e) => {
  if (document.activeElement === searchInput) return;
  currentGame?.onKey?.(e, false);
});

canvas.addEventListener("pointerdown", (e) => {
  ensureAudio();
  currentGame?.onPointer?.("down", e);
});
canvas.addEventListener("pointermove", (e) => currentGame?.onPointer?.("move", e));
canvas.addEventListener("pointerup", (e) => currentGame?.onPointer?.("up", e));
canvas.addEventListener("pointercancel", (e) => currentGame?.onPointer?.("cancel", e));
canvas.addEventListener("pointerleave", (e) => currentGame?.onPointer?.("leave", e));

// ---- Alt+B toggle from service worker -----------------------------------
let running = true;
if (window.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "toggle_game") {
      running = !running;
      canvas.style.display = running ? "block" : "none";
      overlayEl.style.display = running ? "" : "none";
    }
  });
}

// ---- Game loader --------------------------------------------------------
let currentGame = null;
let currentGameId = null;

async function loadGame(id) {
  if (!GAMES[id]) id = "breakout";
  if (currentGame?.destroy) currentGame.destroy();
  currentGame = null;
  const mod = await import(GAMES[id].module);
  currentGame = await mod.init({
    canvas,
    ctx,
    storage,
    audio: { blip, ensureAudio, isMuted: () => muted },
    hud,
    overlay,
    getTheme: () => currentTheme,
    getDifficulty: () => currentDifficulty,
    onStatusChange: updatePauseIcon,
  });
  currentGameId = id;
  storage.set({ currentGame: id });
  for (const btn of gamePicker.querySelectorAll(".game-btn")) {
    btn.classList.toggle("active", btn.dataset.game === id);
  }
  updatePauseIcon();
  fitCanvas();
}

gamePicker.addEventListener("click", (e) => {
  const btn = e.target.closest(".game-btn");
  if (!btn) return;
  if (btn.dataset.game === currentGameId) return;
  loadGame(btn.dataset.game);
});

// ---- Canvas sizing ------------------------------------------------------
// Games set canvas.width/height (internal resolution). The browser scales that
// bitmap to the CSS display size we set here — which is the biggest box that
// fits the stage while preserving the game's aspect ratio.
function fitCanvas() {
  const rect = stageEl.getBoundingClientRect();
  const framePad = 28; // .canvas-wrap padding (14px * 2)
  const safety = 8;    // small buffer so we never overflow
  const availW = rect.width  - framePad - safety;
  const availH = rect.height - framePad - safety;
  if (availW <= 0 || availH <= 0) return;
  const iw = canvas.width  || 720;
  const ih = canvas.height || 585;
  const gameRatio = iw / ih;
  const availRatio = availW / availH;
  let w, h;
  if (availRatio > gameRatio) {
    h = availH;
    w = h * gameRatio;
  } else {
    w = availW;
    h = w / gameRatio;
  }
  canvas.style.width = `${Math.floor(w)}px`;
  canvas.style.height = `${Math.floor(h)}px`;
}
window.addEventListener("resize", fitCanvas);

// ---- Main loop ----------------------------------------------------------
let lastTime = 0;
function loop(nowMs) {
  const t = nowMs || performance.now();
  const dt = lastTime ? Math.min(2.5, (t - lastTime) / 16.667) : 1;
  lastTime = t;
  if (running && currentGame) {
    if (currentGame.getStatus?.() !== "paused") currentGame.step(dt);
    currentGame.render();
  }
  requestAnimationFrame(loop);
}

// ---- Boot ---------------------------------------------------------------
(async () => {
  const saved = await storage.get(["theme", "muted", "difficulty", "currentGame"]);
  applyTheme(saved.theme || "glassy");
  setMuted(!!saved.muted);
  applyDifficulty(saved.difficulty || "normal");
  await loadGame(saved.currentGame || "breakout");
  loop();
})();
