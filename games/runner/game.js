/**
 * Term Runner — study-as-mechanic endless runner for TRSS.
 *
 * The answer IS the move: every 10-14 seconds of running, a question gate
 * approaches. The definition appears in a banner and is spoken aloud while
 * the world slows to 25% speed; three lane signs show candidate terms.
 * Steer into the lane with the matching TERM before the gate arrives.
 * Correct: chime, +100 x streak multiplier, gate shatters. Wrong: stumble,
 * streak resets, and the correct term + definition is shown for 2s.
 * There is deliberately NO game over — this is study, not punishment.
 *
 * Pure canvas, zero assets, zero libraries. Card data and TTS come from the
 * shared modules in ../common/ (provided by the TRSS games coordinator):
 *   ../common/cards-loader.js  -> chapterList, loadChapterCards, pickDistractors, shuffle
 *   ../common/tts.js           -> speak, stopSpeak, setMuted, isMuted, ttsAvailable
 *
 * Deploy: tools/trss-games/runner/ in TruJ0e/Study-Generator-  ->  /games/runner/
 */
import { chapterList, loadChapterCards, pickDistractors, shuffle } from "../common/cards-loader.js";
import { speak, stopSpeak, setMuted, isMuted, ttsAvailable } from "../common/tts.js";

/* ================================ config ================================ */
const GATE_MIN_S = 10;          // seconds of running between question gates
const GATE_MAX_S = 14;
const GATE_APPROACH_S = 5.5;    // seconds a gate takes horizon -> player
const SLOW_FACTOR = 0.25;       // world speed multiplier while a gate is open
const RUN_SPEED = 6;            // meters per second at full speed
const POINTS_PER_GATE = 100;    // base points; multiplied by streak
const FEEDBACK_CORRECT_S = 0.9; // "correct" banner linger after shatter
const FEEDBACK_WRONG_S = 2.0;   // wrong-answer overlay dwell
const BEST_KEY = "trss-runner-best";
const MUTE_KEY = "trss-runner-muted";

/* ================================ helpers =============================== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const fmtNum = (n) => Math.floor(n).toLocaleString("en-US");
const pointIn = (x, y, r) => !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
/** Definition text for a card, with graceful fallbacks. */
function defOf(card) { return String((card && (card.simple || card.cue)) || "").trim(); }

/**
 * Greedy word-wrap with ellipsis. Returns at most maxLines lines, each
 * fitting maxWidth per ctx.measureText. Exported for tests.
 */
export function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "", i = 0;
  for (; i < words.length; i++) {
    const t = cur ? cur + " " + words[i] : words[i];
    if (ctx.measureText(t).width <= maxWidth || cur === "") { cur = t; continue; }
    lines.push(cur); cur = words[i];
    if (lines.length === maxLines) { i++; break; }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  // Leftover words mean we truncated: ellipsize the last line to fit.
  const used = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(last + "\u2026").width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = last + "\u2026";
  }
  return lines;
}

function drawRoundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ============================ audio (WebAudio) ========================== */
/* Oscillator-only chimes: no audio files, zero cost, iOS-safe (created on
   first user gesture via ensureAudio). */
let actx = null;
function ensureAudio() {
  try {
    if (!actx) {
      const AC = (typeof window !== "undefined") && (window.AudioContext || window.webkitAudioContext);
      if (AC) actx = new AC();
    }
    if (actx && actx.state === "suspended") actx.resume();
  } catch (e) { /* audio unavailable — the game stays silent */ }
}
function tone(freq, dur, type, vol, delay) {
  if (!actx) return;
  try {
    const t0 = actx.currentTime + (delay || 0);
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) {}
}
const chime = () => { tone(660, 0.14, "sine", 0.16); tone(880, 0.14, "sine", 0.16, 0.09); tone(1320, 0.22, "sine", 0.13, 0.18); };
const thud  = () => { tone(150, 0.22, "triangle", 0.22); tone(85, 0.30, "sine", 0.20, 0.03); };
const blip  = () => tone(520, 0.06, "square", 0.05);
const gateAlert = () => tone(330, 0.14, "sine", 0.09);

/* ============================ persisted prefs =========================== */
function loadBest()  { try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; } }
function saveBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) {} }
function loadMuted() { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { return false; } }
function saveMuted(m){ try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch (e) {} }

let TTS_OK = false;
try { TTS_OK = !!ttsAvailable(); } catch (e) { TTS_OK = false; }

/* ========================================================================
 * createGame(canvas) — builds one self-contained game instance.
 * Returns { frame, begin, bootChapters, startRun, destroy, state, _test }.
 * ======================================================================== */
export function createGame(canvas) {
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0;                 // CSS pixels (drawing space)
  let cx = 0, horizonY = 0, playerY = 0, laneSpread = 0, fs = 1;
  let stars = [];

  /* ------------------------------- state ------------------------------ */
  const G = {
    mode: "menu",        // menu | playing
    phase: "run",        // run | gate | feedback  (only when playing)
    paused: false,
    time: 0, animT: 0,   // wall clock / animation clock (animation slows with world)
    menuDist: 0,         // background scroll distance while in menu

    chapters: [], chaptersError: "", loadingChapters: true,
    chapterId: null, chapterLabel: "",
    cards: [],
    deck: [], lastAskedId: null,

    score: 0, streak: 0, best: loadBest(), newBest: false, dist: 0,
    lane: 1, playerX: 0, lean: 0, stumble: 0,

    runTime: 0, nextGateAt: rand(GATE_MIN_S, GATE_MAX_S),
    gate: null,          // { card, correctLane, terms[3], t, alpha }
    feedback: null,      // { kind: 'correct'|'wrong', ttl, card }
    banner: null,        // { title, lines[], until }
    particles: [], floaters: [],
    shake: 0,

    overlayMsg: "", overlayMsgUntil: 0,
    loadingCards: false,
    muted: loadMuted(),
    ui: { chapters: [], start: null, resume: null, quit: null, mute: null, pause: null },
  };
  const cardCache = new Map();      // chapterId -> filtered cards
  try { setMuted(G.muted); } catch (e) {}
  try { G.muted = !!isMuted(); } catch (e) {}

  /* ------------------------- layout & perspective --------------------- */
  function resize() {
    const dpr = Math.min(2.5, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    W = canvas.clientWidth || (typeof window !== "undefined" && window.innerWidth) || 360;
    H = canvas.clientHeight || (typeof window !== "undefined" && window.innerHeight) || 640;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
  }
  function layout() {
    cx = W / 2;
    horizonY = H * 0.30;
    playerY = H * 0.86;
    laneSpread = Math.min(W * 0.30, 150);
    fs = clamp(W / 380, 0.85, 1.25);          // font scale (readable at 360px)
    stars = [];
    const n = Math.round(clamp(W * H / 9000, 50, 120));
    for (let i = 0; i < n; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * horizonY * 0.96,
                   r: rand(0.4, 1.8), ph: rand(0, 6.28), sp: rand(1, 3) });
    }
    // HUD buttons (top-right, 46px touch targets)
    const pad = 12, bs = 46, top = 14;
    G.ui.mute = { x: W - pad - bs, y: top, w: bs, h: bs };
    G.ui.pause = { x: W - pad - bs * 2 - 8, y: top, w: bs, h: bs };
  }
  /** depth t: 1 = horizon, 0 = player */
  const scaleAt = (t) => 1 - 0.72 * t;
  const depthY = (t) => playerY - (playerY - horizonY) * t;
  const laneX = (lane, t) => cx + (lane - 1) * laneSpread * scaleAt(t);

  /* ------------------------- question scheduling ---------------------- */
  // Shuffle the deck; cycle through it; reshuffle when exhausted. Never ask
  // the same card twice in a row, including across a reshuffle boundary.
  function refillDeck() {
    const d = shuffle(G.cards.filter((c) => c && c.term && defOf(c)).slice());
    if (G.lastAskedId && d.length > 1 && d[0].id === G.lastAskedId) {
      const j = 1 + Math.floor(Math.random() * (d.length - 1));
      const tmp = d[0]; d[0] = d[j]; d[j] = tmp;
    }
    G.deck = d;
  }
  function nextCard() {
    if (!G.deck.length) refillDeck();
    const c = G.deck.pop();
    if (c) G.lastAskedId = c.id;
    return c;
  }

  /* --------------------------- chapter loading ------------------------ */
  async function bootChapters() {
    G.loadingChapters = true;
    try {
      const list = await chapterList();
      G.chapters = (list || []).filter((c) => c && c.id);
      if (G.chapters.length && !G.chapterId) G.chapterId = G.chapters[0].id; // preselect first
    } catch (e) {
      G.chaptersError = "couldn't load chapters \u2014 check your connection";
    }
    G.loadingChapters = false;
  }

  async function startRun(chapterId) {
    if (!chapterId || G.loadingCards) return;
    G.loadingCards = true; G.overlayMsg = "";
    try {
      if (!cardCache.has(chapterId)) {
        const raw = await loadChapterCards(chapterId);
        cardCache.set(chapterId, (raw || []).filter((c) => c && c.term && defOf(c)));
      }
      const cards = cardCache.get(chapterId) || [];
      if (cards.length < 4) {
        // Friendly, specific, and actionable — the spec's exact wording.
        G.overlayMsg = "not enough cards to play \u2014 pick another chapter";
        G.overlayMsgUntil = G.time + 5;
        return;
      }
      G.cards = cards;
      G.chapterId = chapterId;
      const ch = G.chapters.find((c) => c.id === chapterId);
      G.chapterLabel = (ch && ch.label) || chapterId;
      refillDeck();
      // reset run state
      G.score = 0; G.streak = 0; G.newBest = false; G.dist = 0;
      G.lane = 1; G.lean = 0; G.stumble = 0;
      G.runTime = 0; G.nextGateAt = rand(GATE_MIN_S, GATE_MAX_S);
      G.gate = null; G.feedback = null; G.phase = "run"; G.banner = null;
      G.particles.length = 0; G.floaters.length = 0; G.shake = 0;
      G.mode = "playing"; G.paused = false;
      ensureAudio();
    } catch (err) {
      G.overlayMsg = "couldn't load cards \u2014 check your connection and retry";
      G.overlayMsgUntil = G.time + 5;
    } finally {
      G.loadingCards = false;
    }
  }

  function toMenu() {
    try { stopSpeak(); } catch (e) {}
    G.mode = "menu"; G.phase = "run"; G.paused = false;
    G.gate = null; G.feedback = null; G.banner = null;
    G.particles.length = 0; G.floaters.length = 0; G.shake = 0; G.stumble = 0;
  }

  /* -------------------------------- input ----------------------------- */
  function moveLane(dir) {
    if (G.mode !== "playing" || G.paused) return;
    const next = clamp(G.lane + dir, 0, 2);
    if (next !== G.lane) { G.lane = next; blip(); }
  }
  function toggleMute() {
    try { setMuted(!isMuted()); G.muted = !!isMuted(); } catch (e) { G.muted = !G.muted; }
    saveMuted(G.muted);
  }
  function setPaused(p) {
    if (G.mode !== "playing") return;
    if (G.paused === p) return;
    G.paused = p;
    if (p) { try { stopSpeak(); } catch (e) {} }
    else ensureAudio();
  }
  function handleTap(x, y) {
    ensureAudio();
    if (G.mode === "menu") { menuTap(x, y); return; }
    if (G.paused) { pauseTap(x, y); return; }
    if (pointIn(x, y, G.ui.mute)) { toggleMute(); return; }
    if (pointIn(x, y, G.ui.pause)) { setPaused(true); return; }
    // Tapping during a wrong-answer overlay skips the wait.
    if (G.phase === "feedback" && G.feedback && G.feedback.kind === "wrong") { endFeedback(); return; }
    moveLane(x < W * 0.5 ? -1 : 1);
  }
  function menuTap(x, y) {
    for (const b of G.ui.chapters) {
      if (pointIn(x, y, b.rect)) { G.chapterId = b.id; blip(); return; }
    }
    if (pointIn(x, y, G.ui.start)) startRun(G.chapterId);
  }
  function pauseTap(x, y) {
    if (pointIn(x, y, G.ui.resume)) setPaused(false);
    else if (pointIn(x, y, G.ui.quit)) toMenu();
  }
  function onKey(e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === " ") e.preventDefault();
    ensureAudio();
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") moveLane(-1);
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") moveLane(1);
    else if (e.key === "p" || e.key === "P" || e.key === "Escape") { if (G.mode === "playing") setPaused(!G.paused); }
    else if (e.key === "m" || e.key === "M") toggleMute();
    else if ((e.key === "Enter" || e.key === " ") && G.mode === "menu" && !G.loadingCards) startRun(G.chapterId);
  }
  let touchStart = null;
  function bindInput() {
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault(); ensureAudio();
      const t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY };
    }, { passive: false });
    canvas.addEventListener("touchend", (e) => {
      e.preventDefault();
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (Math.max(adx, ady) > 24 && adx > ady * 1.3) moveLane(dx > 0 ? 1 : -1); // swipe
      else handleTap(t.clientX, t.clientY);                                     // tap
      touchStart = null;
    }, { passive: false });
    canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener("mousedown", (e) => { ensureAudio(); handleTap(e.clientX, e.clientY); });
    if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("keydown", onKey);
  }

  /* ------------------------- question gate logic ---------------------- */
  function setBanner(title, text, ttlSec) {
    ctx.font = font(15 * fs, 600);
    const lines = wrapLines(ctx, text, W - 64, 3);
    G.banner = { title, lines, until: ttlSec === Infinity ? Infinity : G.time + ttlSec };
  }

  function openGate() {
    if (G.cards.length < 4) return; // safety net; startRun already enforces this
    const card = nextCard();
    if (!card) return;
    let distract = [];
    try { distract = pickDistractors(G.cards, card.id, 2) || []; } catch (e) { distract = []; }
    distract = distract.filter((d) => d && d.id !== card.id && d.term);
    // Pad deterministically if the shared module ever returns short.
    for (let i = 0; distract.length < 2 && i < G.cards.length; i++) {
      const c = G.cards[i];
      if (c.id !== card.id && distract.indexOf(c) < 0) distract.push(c);
    }
    const correctLane = (Math.random() * 3) | 0;
    const terms = ["", "", ""];
    let di = 0;
    for (let l = 0; l < 3; l++) terms[l] = (l === correctLane) ? card.term : distract[di++].term;

    G.gate = { card, correctLane, terms, t: 1, alpha: 0 };
    G.phase = "gate";
    try { stopSpeak(); } catch (e) {}
    setBanner("\u2753 WHICH TERM MATCHES?", defOf(card), Infinity);
    if (TTS_OK && !G.muted) { try { speak(defOf(card)); } catch (e) {} }
    gateAlert();
  }

  function signPos(lane, t) { return { x: laneX(lane, t), y: depthY(t), s: scaleAt(t) }; }

  function spawnShatter() {
    // The gate "shatters": each lane sign bursts into drifting fragments.
    const g = G.gate;
    for (let l = 0; l < 3; l++) {
      const p = signPos(l, Math.max(g.t, 0.02));
      const n = 12;
      for (let i = 0; i < n; i++) {
        G.particles.push({
          x: p.x + rand(-30, 30) * p.s, y: p.y - rand(20, 110) * p.s,
          vx: rand(-160, 160), vy: rand(-260, -40),
          rot: rand(0, 6.28), vr: rand(-8, 8),
          ttl: rand(0.5, 1.1), size: rand(4, 10) * p.s,
          color: l === g.correctLane ? "#34d399" : "#8fa3c7",
        });
      }
    }
  }

  function resolveGate() {
    const g = G.gate;
    const ok = G.lane === g.correctLane;
    try { stopSpeak(); } catch (e) {}
    if (ok) {
      G.streak += 1;
      const gained = POINTS_PER_GATE * G.streak;   // 100 x streak multiplier
      G.score += gained;
      if (G.score > G.best) { G.best = G.score; G.newBest = true; saveBest(G.best); }
      chime();
      spawnShatter();
      addFloater(G.playerX, playerY - 90 * fs, "+" + fmtNum(gained), "#34d399", 24);
      if (G.streak >= 3) addFloater(G.playerX, playerY - 130 * fs, "STREAK x" + G.streak + "!", "#ffb020", 18);
      G.feedback = { kind: "correct", ttl: FEEDBACK_CORRECT_S, card: g.card };
      setBanner("\u2713 " + g.card.term, defOf(g.card), FEEDBACK_CORRECT_S + 0.4);
    } else {
      G.streak = 0;
      thud();
      G.shake = 14;
      G.stumble = 1;
      G.banner = null;
      G.feedback = { kind: "wrong", ttl: FEEDBACK_WRONG_S, card: g.card };
    }
    G.gate = null;
    G.phase = "feedback";
  }

  function endFeedback() { if (G.feedback) G.feedback.ttl = 0; }

  function addFloater(x, y, txt, color, size) {
    G.floaters.push({ x, y, txt, color, size: size * fs, ttl: 1.2 });
  }

  /* -------------------------------- update ---------------------------- */
  function worldFactor() {
    if (G.phase === "gate") return SLOW_FACTOR;
    if (G.phase === "feedback" && G.feedback && G.feedback.kind === "wrong") return 0.12;
    return 1;
  }

  function update(dt) {
    G.time += dt;
    const factor = worldFactor();
    G.animT += dt * (G.mode === "menu" ? 0.35 : factor);

    // Smooth lane interpolation (the runner visibly slides between lanes).
    const tx = laneX(G.lane, 0);
    G.playerX += (tx - G.playerX) * Math.min(1, dt * 12);
    const leanTarget = clamp((tx - G.playerX) * 0.004, -0.28, 0.28);
    G.lean += (leanTarget - G.lean) * Math.min(1, dt * 8);
    if (G.stumble > 0) G.stumble = Math.max(0, G.stumble - dt * 1.4);
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 26);

    if (G.mode === "menu") { G.menuDist += dt * 2.2; }
    else {
      G.dist += dt * RUN_SPEED * factor;
      if (G.phase === "run") {
        G.runTime += dt;
        if (G.runTime >= G.nextGateAt) openGate();
      } else if (G.phase === "gate" && G.gate) {
        G.gate.t -= dt / GATE_APPROACH_S;
        G.gate.alpha = Math.min(1, G.gate.alpha + dt * 1.8);
        if (G.gate.t <= 0) resolveGate();
      } else if (G.phase === "feedback" && G.feedback) {
        G.feedback.ttl -= dt;
        if (G.feedback.ttl <= 0) {
          G.feedback = null;
          G.phase = "run";
          G.runTime = 0;
          G.nextGateAt = rand(GATE_MIN_S, GATE_MAX_S);
        }
      }
    }

    if (G.banner && G.banner.until !== Infinity && G.time >= G.banner.until) G.banner = null;
    if (G.overlayMsg && G.time >= G.overlayMsgUntil) G.overlayMsg = "";

    // particles & floaters
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) { G.particles.splice(i, 1); continue; }
      p.vy += 900 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
    for (let i = G.floaters.length - 1; i >= 0; i--) {
      const f = G.floaters[i];
      f.ttl -= dt; f.y -= 46 * dt;
      if (f.ttl <= 0) G.floaters.splice(i, 1);
    }
  }

  /* -------------------------------- render ---------------------------- */
  function font(px, weight) {
    return (weight || 600) + " " + Math.round(px) + 'px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  }

  function render() {
    ctx.save();
    if (G.shake > 0.2) ctx.translate(rand(-G.shake, G.shake) * 0.5, rand(-G.shake, G.shake) * 0.5);
    drawBackground();
    if (G.mode === "menu") { ctx.restore(); drawMenu(); return; }
    drawTrack();
    if (G.gate) drawGate(G.gate);
    drawParticles();
    drawRunner();
    drawFloaters();
    drawBannerPanel();
    drawHUD();
    if (G.phase === "feedback" && G.feedback && G.feedback.kind === "wrong") drawWrongOverlay();
    if (G.paused) drawPauseOverlay();
    ctx.restore();
  }

  function drawBackground() {
    // Dusk sky.
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY * 1.15);
    sky.addColorStop(0, "#070b21");
    sky.addColorStop(0.55, "#16224d");
    sky.addColorStop(0.85, "#3c2a63");
    sky.addColorStop(1, "#8a4a3c");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizonY * 1.15 + 2);

    // Stars (twinkle; no sideways drift — the camera runs forward).
    for (const s of stars) {
      const a = 0.30 + 0.35 * Math.sin(G.time * s.sp + s.ph);
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = "#dfe8ff";
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // Parallax hill silhouettes at the horizon.
    const scroll = G.mode === "menu" ? G.menuDist : G.dist;
    ridge(horizonY + 4, H * 0.055, 0.012, scroll * 0.030, "#262055");
    ridge(horizonY + 2, H * 0.085, 0.007, scroll * 0.055, "#191641");
  }

  function ridge(baseY, amp, freq, phase, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-4, H);
    for (let x = -4; x <= W + 8; x += 10) {
      const y = baseY - (Math.sin(x * freq + phase) * 0.55
                       + Math.sin(x * freq * 2.7 + phase * 1.7) * 0.30 + 0.85) * amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 4, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawTrack() {
    // Ground.
    const g = ctx.createLinearGradient(0, horizonY, 0, H);
    g.addColorStop(0, "#1b2342");
    g.addColorStop(0.35, "#141b36");
    g.addColorStop(1, "#0b0f24");
    ctx.fillStyle = g;
    ctx.fillRect(0, horizonY, W, H - horizonY);

    // Horizon glow.
    ctx.fillStyle = "rgba(232,115,74,0.28)";
    ctx.fillRect(0, horizonY - 1, W, 3);

    // Lane dividers with motion dashes (dash offset flows with distance).
    const off = -((G.dist * 34) % 32);
    ctx.lineWidth = Math.max(2, 3 * fs);
    ctx.setLineDash([16, 16]);
    ctx.lineDashOffset = off;
    ctx.strokeStyle = "rgba(140,160,220,0.35)";
    for (const d of [0.5, 1.5]) {
      ctx.beginPath();
      ctx.moveTo(laneX(d, 0), depthY(0));
      ctx.lineTo(laneX(d, 1), depthY(1));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Track edges.
    ctx.lineWidth = Math.max(2, 4 * fs);
    ctx.strokeStyle = "rgba(255,176,32,0.30)";
    for (const d of [-0.55, 2.55]) {
      ctx.beginPath();
      ctx.moveTo(laneX(d, 0), depthY(0));
      ctx.lineTo(laneX(d, 1), depthY(1));
      ctx.stroke();
    }
  }

  function drawGate(gate) {
    const t = Math.max(gate.t, 0.001);
    const y = depthY(t), s = scaleAt(t);
    const x0 = laneX(-0.55, t), x1 = laneX(2.55, t);
    ctx.save();
    ctx.globalAlpha = gate.alpha;

    // Energy field across the track.
    const pulse = 0.16 + 0.07 * Math.sin(G.time * 7);
    ctx.fillStyle = "rgba(34,211,238," + pulse.toFixed(3) + ")";
    ctx.fillRect(x0, y - 96 * s, x1 - x0, 96 * s);
    // Side posts + top beam.
    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(x0 - 4 * s, y - 104 * s, 8 * s, 104 * s);
    ctx.fillRect(x1 - 4 * s, y - 104 * s, 8 * s, 104 * s);
    ctx.fillRect(x0 - 4 * s, y - 104 * s, (x1 - x0) + 8 * s, 8 * s);

    // Arrival progress bar (thin, under the banner area is busy — put it on the beam).
    ctx.fillStyle = "#ffb020";
    const pw = (x1 - x0) * (1 - t);
    ctx.fillRect(x0, y - 104 * s, pw, 5 * s);

    // One sign per lane: correct term + 2 distractors.
    for (let l = 0; l < 3; l++) drawSign(l, gate.terms[l], t, null);
    ctx.restore();
  }

  function drawSign(lane, term, t, mood) {
    const p = signPos(lane, t);
    const s = p.s;
    const laneW = Math.abs(laneX(1, t) - laneX(0, t)) * 0.94;
    let fsize = 15 * s * fs;
    ctx.font = font(fsize, 700);
    let lines = wrapLines(ctx, term, laneW - 18 * s, 2);
    while (lines.length > 2 && fsize > 9 * s) { fsize -= 1; ctx.font = font(fsize, 700); lines = wrapLines(ctx, term, laneW - 18 * s, 2); }
    const lineH = fsize * 1.28;
    const bw = laneW, bh = lines.length * lineH + 16 * s;
    const bx = p.x - bw / 2, by = p.y - 66 * s - bh;

    // Post.
    ctx.fillStyle = "#0e1430";
    ctx.fillRect(p.x - 3.5 * s, by + bh - 4 * s, 7 * s, 66 * s + 8 * s);
    // Board.
    let border = "#ffb020", glow = "rgba(255,176,32,0.25)";
    if (mood === "good") { border = "#34d399"; glow = "rgba(52,211,153,0.45)"; }
    if (mood === "bad") { border = "#f87171"; glow = "rgba(248,113,113,0.45)"; }
    ctx.shadowColor = glow; ctx.shadowBlur = 14 * s;
    ctx.fillStyle = "#1c2547";
    drawRoundRect(ctx, bx, by, bw, bh, 8 * s); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.5, 2.5 * s);
    ctx.strokeStyle = border;
    drawRoundRect(ctx, bx, by, bw, bh, 8 * s); ctx.stroke();
    // Term text.
    ctx.fillStyle = "#fff7e6";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = font(fsize, 700);
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], p.x, by + 8 * s + lineH * (i + 0.5));
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  function drawParticles() {
    for (const p of G.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.ttl, 0, 1);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawRunner() {
    const s = (H / 640) * 0.95;
    const x = G.playerX, y = playerY;
    const ph = G.animT * 11;
    const sw = Math.sin(ph), sw2 = Math.sin(ph + Math.PI);
    ctx.save();
    ctx.translate(x, y);
    if (G.stumble > 0) ctx.rotate(Math.sin(G.time * 34) * 0.22 * G.stumble);
    else ctx.rotate(G.lean * 0.7);
    ctx.lineCap = "round";

    // Shadow.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(0, 5 * s, 26 * s, 8 * s, 0, 0, 6.29); ctx.fill();

    const hipY = -34 * s, shY = -58 * s;
    const limb = (x1, y1, x2, y2, w, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    // Legs (dark pants) with a running stride.
    limb(0, hipY, sw * 17 * s, -2 * s, 11 * s, "#26314f");
    limb(0, hipY, sw2 * 17 * s, -2 * s, 11 * s, "#1d2540");
    // Torso (amber jersey), leaning slightly forward.
    limb(G.lean * 22 * s, hipY, G.lean * 34 * s, shY, 14 * s, "#ffb020");
    // Arms pumping opposite the legs.
    const ax = G.lean * 34 * s;
    limb(ax, shY + 4 * s, ax + sw2 * 15 * s, shY + 20 * s, 9 * s, "#f6c89f");
    limb(ax, shY + 4 * s, ax + sw * 15 * s, shY + 20 * s, 9 * s, "#eab183");
    // Head with a cyan headband.
    const hx = G.lean * 40 * s, hy = shY - 13 * s;
    ctx.fillStyle = "#f6c89f";
    ctx.beginPath(); ctx.arc(hx, hy, 11 * s, 0, 6.29); ctx.fill();
    ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 4 * s;
    ctx.beginPath(); ctx.arc(hx, hy, 11 * s, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    ctx.restore();
  }

  function drawFloaters() {
    ctx.textAlign = "center";
    for (const f of G.floaters) {
      ctx.globalAlpha = clamp(f.ttl, 0, 1);
      ctx.font = font(f.size, 800);
      ctx.fillStyle = f.color;
      ctx.fillText(f.txt, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  function drawBannerPanel() {
    const b = G.banner;
    if (!b) return;
    const padX = 14, top = 72;
    const maxW = W - padX * 2;
    ctx.font = font(13 * fs, 800);
    const titleH = 18 * fs;
    ctx.font = font(15 * fs, 600);
    const lineH = 21 * fs;
    const h = 14 + titleH + b.lines.length * lineH + 12;
    ctx.fillStyle = "rgba(8,12,30,0.82)";
    drawRoundRect(ctx, padX, top, maxW, h, 12); ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = G.phase === "feedback" ? "#34d399" : "#22d3ee";
    drawRoundRect(ctx, padX, top, maxW, h, 12); ctx.stroke();
    let y = top + 14;
    ctx.fillStyle = G.phase === "feedback" ? "#34d399" : "#7dd3fc";
    ctx.font = font(13 * fs, 800);
    ctx.fillText(b.title, padX + 16, y + 12 * fs); y += titleH;
    ctx.fillStyle = "#f4f7ff";
    ctx.font = font(15 * fs, 600);
    for (const line of b.lines) { y += lineH; ctx.fillText(line, padX + 16, y); }
  }

  function drawHUD() {
    const pad = 12;
    // Score (top-left).
    ctx.fillStyle = "#8fa3c7";
    ctx.font = font(11 * fs, 800);
    ctx.fillText("SCORE", pad, 26);
    ctx.fillStyle = "#ffffff";
    ctx.font = font(24 * fs, 800);
    ctx.fillText(fmtNum(G.score), pad, 50);
    // Streak or best (below score).
    ctx.font = font(14 * fs, 700);
    if (G.streak >= 2) {
      ctx.fillStyle = "#ffb020";
      ctx.fillText("\uD83D\uDD25 STREAK x" + G.streak, pad, 72);
    } else {
      ctx.fillStyle = "#5b6b94";
      ctx.fillText("BEST " + fmtNum(G.best), pad, 72);
    }
    if (G.newBest) {
      ctx.fillStyle = "#34d399";
      ctx.font = font(12 * fs, 800);
      ctx.fillText("NEW BEST!", pad, 92);
    }
    // Distance (top-right, left of the buttons).
    ctx.textAlign = "right";
    ctx.fillStyle = "#8fa3c7";
    ctx.font = font(14 * fs, 700);
    ctx.fillText(Math.floor(G.dist) + " m", G.ui.pause.x - 10, 40);
    ctx.fillStyle = "#5b6b94";
    ctx.font = font(11 * fs, 700);
    ctx.fillText(G.chapterLabel.toUpperCase().slice(0, 18), G.ui.pause.x - 10, 58);
    ctx.textAlign = "left";

    // Mute + pause buttons (46px targets).
    drawIconButton(G.ui.mute, G.muted ? "\uD83D\uDD07" : "\uD83D\uDD0A");
    drawIconButton(G.ui.pause, "\u275A\u275A");
  }

  function drawIconButton(r, glyph) {
    ctx.fillStyle = "rgba(8,12,30,0.62)";
    drawRoundRect(ctx, r.x, r.y, r.w, r.h, 12); ctx.fill();
    ctx.strokeStyle = "rgba(140,160,220,0.35)";
    ctx.lineWidth = 1.5;
    drawRoundRect(ctx, r.x, r.y, r.w, r.h, 12); ctx.stroke();
    ctx.fillStyle = "#dfe8ff";
    ctx.font = font(20, 700);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(glyph, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  function drawWrongOverlay() {
    const f = G.feedback;
    if (!f) return;
    ctx.fillStyle = "rgba(5,8,20,0.66)";
    ctx.fillRect(0, 0, W, H);
    const w = Math.min(W - 48, 430);
    ctx.font = font(15 * fs, 800);
    const termLines = wrapLines(ctx, f.card.term, w - 48, 2);
    ctx.font = font(14 * fs, 600);
    const defLines = wrapLines(ctx, defOf(f.card), w - 48, 3);
    const h = 30 + 30 + termLines.length * 24 * fs + 14 + defLines.length * 20 * fs + 44;
    const x = (W - w) / 2, y = (H - h) / 2;
    ctx.fillStyle = "#141b36";
    drawRoundRect(ctx, x, y, w, h, 16); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = "#f87171";
    drawRoundRect(ctx, x, y, w, h, 16); ctx.stroke();

    let cy = y + 34;
    ctx.fillStyle = "#f87171";
    ctx.font = font(16 * fs, 800); ctx.textAlign = "center";
    ctx.fillText("STUMBLE! The term was:", cx, cy); cy += 26;
    ctx.fillStyle = "#ffb020";
    ctx.font = font(17 * fs, 800);
    for (const line of termLines) { ctx.fillText(line, cx, cy); cy += 24 * fs; }
    cy += 8;
    ctx.fillStyle = "#dfe8ff";
    ctx.font = font(14 * fs, 600);
    for (const line of defLines) { ctx.fillText(line, cx, cy); cy += 20 * fs; }
    ctx.textAlign = "left";

    // Auto-continue progress bar + hint.
    const pct = clamp(f.ttl / FEEDBACK_WRONG_S, 0, 1);
    ctx.fillStyle = "rgba(140,160,220,0.25)";
    drawRoundRect(ctx, x + 24, y + h - 26, w - 48, 8, 4); ctx.fill();
    ctx.fillStyle = "#22d3ee";
    drawRoundRect(ctx, x + 24, y + h - 26, (w - 48) * pct, 8, 4); ctx.fill();
    ctx.fillStyle = "#5b6b94";
    ctx.font = font(11 * fs, 700); ctx.textAlign = "center";
    ctx.fillText("tap to continue", cx, y + h - 34);
    ctx.textAlign = "left";
  }

  function drawPauseOverlay() {
    ctx.fillStyle = "rgba(5,8,20,0.72)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    ctx.font = font(34 * fs, 800); ctx.textAlign = "center";
    ctx.fillText("PAUSED", cx, H * 0.36);
    ctx.textAlign = "left";
    const bw = Math.min(W - 96, 300), bh = 58;
    G.ui.resume = { x: cx - bw / 2, y: H * 0.36 + 30, w: bw, h: bh };
    G.ui.quit = { x: cx - bw / 2, y: H * 0.36 + 30 + bh + 14, w: bw, h: bh };
    drawBigButton(G.ui.resume, "RESUME", "#22d3ee");
    drawBigButton(G.ui.quit, "QUIT TO MENU", "#3a466e");
  }

  function drawBigButton(r, label, color) {
    ctx.fillStyle = color;
    drawRoundRect(ctx, r.x, r.y, r.w, r.h, 14); ctx.fill();
    ctx.fillStyle = "#0a0e20";
    if (color === "#3a466e") ctx.fillStyle = "#dfe8ff";
    ctx.font = font(18 * fs, 800); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  /* ------------------------------- menu ------------------------------- */
  function drawMenu() {
    // Animated world behind the menu (slow scroll).
    drawTrack();
    drawRunnerMenuGhost();
    ctx.fillStyle = "rgba(5,8,20,0.55)";
    ctx.fillRect(0, 0, W, H);

    let y = H * 0.10;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffb020";
    ctx.font = font(46 * fs, 800);
    ctx.shadowColor = "rgba(255,176,32,0.5)"; ctx.shadowBlur = 24;
    ctx.fillText("TERM RUNNER", cx, y);
    ctx.shadowBlur = 0;
    y += 30 * fs;
    ctx.fillStyle = "#7dd3fc";
    ctx.font = font(15 * fs, 700);
    ctx.fillText("the answer IS the move", cx, y);
    y += 34 * fs;

    // How-to (3 lines).
    ctx.fillStyle = "#dfe8ff";
    ctx.font = font(14 * fs, 600);
    const howto = [
      "1. Swipe \u25C0 \u25B6  or tap screen sides to switch lanes",
      "2. When a \u2753 gate nears, read the spoken definition",
      "3. Run into the lane with the MATCHING term",
    ];
    for (const line of howto) { ctx.fillText(line, cx, y); y += 22 * fs; }
    y += 10 * fs;

    // Chapter select.
    ctx.fillStyle = "#8fa3c7";
    ctx.font = font(12 * fs, 800);
    ctx.fillText("CHOOSE A CHAPTER", cx, y); y += 12 * fs;
    G.ui.chapters = [];
    const bw = Math.min(W - 64, 380), bh = 56;
    if (G.loadingChapters) {
      ctx.fillStyle = "#5b6b94"; ctx.font = font(14 * fs, 600);
      ctx.fillText("loading chapters\u2026", cx, y + 30);
      y += 60;
    } else if (G.chaptersError) {
      ctx.fillStyle = "#f87171"; ctx.font = font(14 * fs, 600);
      ctx.fillText(G.chaptersError, cx, y + 30);
      y += 60;
    } else {
      for (const ch of G.chapters) {
        const r = { x: cx - bw / 2, y, w: bw, h: bh, id: ch.id };
        const sel = ch.id === G.chapterId;
        ctx.fillStyle = sel ? "#ffb020" : "rgba(20,27,54,0.9)";
        drawRoundRect(ctx, r.x, r.y, r.w, r.h, 12); ctx.fill();
        if (!sel) { ctx.strokeStyle = "rgba(140,160,220,0.35)"; ctx.lineWidth = 1.5; drawRoundRect(ctx, r.x, r.y, r.w, r.h, 12); ctx.stroke(); }
        ctx.fillStyle = sel ? "#0a0e20" : "#dfe8ff";
        ctx.font = font(16 * fs, 800); ctx.textBaseline = "middle";
        ctx.fillText((sel ? "\u2713 " : "") + ch.label, cx, y + bh / 2 + 1);
        ctx.textBaseline = "alphabetic";
        G.ui.chapters.push({ rect: r, id: ch.id });
        y += bh + 10;
      }
    }

    // Start button.
    const sw2 = Math.min(W - 64, 380), sh = 62;
    G.ui.start = { x: cx - sw2 / 2, y: y + 6, w: sw2, h: sh };
    const canStart = !!G.chapterId && !G.loadingCards && !G.loadingChapters;
    if (G.loadingCards) {
      ctx.fillStyle = "#5b6b94"; ctx.font = font(15 * fs, 700);
      ctx.fillText("loading cards\u2026", cx, G.ui.start.y + sh / 2);
    } else {
      drawBigButton(G.ui.start, canStart ? "START RUN" : "PICK A CHAPTER", canStart ? "#34d399" : "#3a466e");
    }

    // Transient message (e.g. not enough cards) + best score + footer.
    y = G.ui.start.y + sh + 26;
    ctx.font = font(13 * fs, 700);
    if (G.overlayMsg) { ctx.fillStyle = "#f87171"; ctx.fillText(G.overlayMsg, cx, y); y += 22; }
    ctx.fillStyle = "#5b6b94";
    ctx.fillText(G.best > 0 ? "BEST " + fmtNum(G.best) : "no runs yet \u2014 set a best!", cx, y);
    y += 20;
    ctx.font = font(11 * fs, 600);
    ctx.fillText(TTS_OK ? "\uD83D\uDD0A definitions are read aloud" : "\uD83D\uDD07 voice unavailable in this browser", cx, y);
    ctx.textAlign = "left";
  }

  // A parked runner silhouette on the menu (reuses the run pose, no input).
  function drawRunnerMenuGhost() {
    const keepLane = G.lane, keepX = G.playerX, keepTime = G.animT, keepMode = G.mode;
    G.lane = 1; G.mode = "playing";
    const tx = laneX(1, 0);
    G.playerX = tx;
    G.animT = keepTime;
    drawRunner();
    G.lane = keepLane; G.playerX = keepX; G.mode = keepMode;
  }

  /* ---------------------------- main loop ----------------------------- */
  let raf = 0, last = 0;
  function frame(now) {
    const dt = clamp(((now - last) / 1000) || 0, 0, 0.05);
    last = now;
    if (!G.paused) update(dt);
    render();
  }
  function begin() {
    last = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    const loop = (t) => { frame(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  }
  function destroy() {
    if (raf) cancelAnimationFrame(raf);
    try {
      if (typeof window !== "undefined" && window.removeEventListener) {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", resize);
      }
      if (typeof document !== "undefined" && document.removeEventListener) {
        document.removeEventListener("visibilitychange", onVis);
      }
    } catch (e) {}
  }
  function onVis() {
    if (typeof document !== "undefined" && document.hidden && G.mode === "playing" && !G.paused) setPaused(true);
  }

  resize();
  bindInput();
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", () => setTimeout(resize, 120));
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", onVis);
  }
  // Snap the runner to the middle lane on boot (avoids a slide-in from x=0).
  G.playerX = laneX(1, 0);

  return {
    frame, begin, bootChapters, startRun, destroy,
    state: G,
    _test: {
      openGate, resolveGate, endFeedback, nextCard, refillDeck,
      moveLane, setPaused, toggleMute, toMenu,
      tap: handleTap, key: onKey,
      wrapLines, defOf,
    },
  };
}

/* ------------------------------- auto-boot ---------------------------- */
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("game");
    if (!canvas) return; // not the game page (or running under test)
    const game = createGame(canvas);
    game.bootChapters();
    game.begin();
  });
}
