/* ==========================================================================
 * TERM DROP — a Tetris-style TRSS study game
 * --------------------------------------------------------------------------
 * Study-as-mechanic: the answer IS the move. A TERM BLOCK falls from the
 * top; steer it into the DEFINITION BIN that matches the term.
 *
 * Shared modules (provided by the games coordinator, imported relatively):
 *   ../common/cards-loader.js -> chapterList(), loadChapterCards(), pickDistractors(), shuffle()
 *   ../common/tts.js           -> speak(), stopSpeak(), setMuted(), isMuted(), ttsAvailable()
 *
 * Rendering: 100% canvas, DPR-aware, portrait-first (works in landscape).
 * Sound: WebAudio oscillators only — zero external assets.
 * ========================================================================== */

import { chapterList, loadChapterCards, pickDistractors, shuffle } from '../common/cards-loader.js';
import { speak, stopSpeak, setMuted, isMuted, ttsAvailable } from '../common/tts.js';

/* ---------------------------------------------------------------- constants */
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BEST_KEY = 'trss-term-drop-best';

const COLORS = {
  bg:        '#0f172a',  // slate-900
  bgGlow:    '#1e293b',  // slate-800
  block:     '#38bdf8',  // sky-400
  blockEdge: '#0284c7',  // sky-600
  bin:       '#1e293b',
  binEdge:   '#475569',  // slate-600
  binGood:   '#22c55e',  // green-500  (correct flash)
  binBad:    '#ef4444',  // red-500
  text:      '#f1f5f9',  // slate-100
  dim:       '#94a3b8',  // slate-400
  accent:    '#fbbf24',  // amber-400
  heart:     '#f43f5e',  // rose-500
  heartOff:  '#334155',  // slate-700
};

// Tunables — tweak feel here.
const TUNE = {
  baseFall:   95,    // px/s at level 0
  fallStep:   18,    // extra px/s per level (level = every 10 clears)
  maxFall:    380,   // px/s cap
  steer:      340,   // px/s horizontal speed (keys / on-screen buttons)
  spawnDelay: 0.35,  // s pause between blocks (particles get their moment)
  wrongDelay: 0.70,  // s pause after a wrong answer (flash reads)
  flashTime:  2.0,   // s the correct bin stays highlighted after a miss
  startCombo: 1,     // combo multiplier starts here; resets here on a miss
};

/* ------------------------------------------------------------------ helpers */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Word-wrap text to fit maxWidth, capped at maxLines.
 * If the text overflows, the last line is trimmed with an ellipsis.
 * Returns an array of lines.
 */
function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const t = cur ? cur + ' ' + words[i] : words[i];
    if (ctx.measureText(t).width <= maxWidth) { cur = t; continue; }
    if (cur) lines.push(cur);
    cur = words[i];
    if (lines.length === maxLines - 1) {
      // We are on the final allowed line: cram in what fits, then ellipsize.
      let rest = cur;
      for (let j = i + 1; j < words.length; j++) {
        const t2 = rest + ' ' + words[j];
        if (ctx.measureText(t2 + '…').width <= maxWidth) rest = t2;
        else break;
      }
      while (rest && ctx.measureText(rest + '…').width > maxWidth) rest = rest.slice(0, -1);
      lines.push(rest ? rest + '…' : '…');
      return lines;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

/** Shrink font until `text` fits maxWidth (single line). Returns the size used. */
function fitFont(ctx, text, maxWidth, maxSize, minSize, weight = 700) {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  ctx.font = `${weight} ${size}px ${FONT}`;
  return size;
}

/* -------------------------------------------------------------------- audio */
/* WebAudio oscillator SFX — no audio files. AudioContext is created lazily
   on the first user gesture (autoplay policy + iOS requirement). */
let AC = null;
function ac() {
  if (!AC) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    AC = new Ctor();
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, { type = 'sine', vol = 0.12, delay = 0 } = {}) {
  if (isMuted()) return;
  const ctx = ac();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}
const sfx = {
  click:   () => tone(620, 0.06, { type: 'triangle', vol: 0.08 }),
  spawn:   () => tone(440, 0.07, { type: 'sine', vol: 0.05 }),
  correct: () => { tone(523, 0.10, { vol: 0.10 }); tone(659, 0.10, { delay: 0.08, vol: 0.10 }); tone(784, 0.16, { delay: 0.16, vol: 0.12 }); },
  wrong:   () => { tone(170, 0.22, { type: 'sawtooth', vol: 0.10 }); tone(110, 0.28, { type: 'sawtooth', vol: 0.10, delay: 0.06 }); },
  over:    () => { tone(392, 0.14, { vol: 0.10 }); tone(311, 0.14, { delay: 0.13, vol: 0.10 }); tone(233, 0.26, { delay: 0.26, vol: 0.12 }); },
};

/* ------------------------------------------------------------------ buttons */
/* Minimal canvas button with pointer hit-testing. Layout positions are
   recomputed on every resize. */
class Button {
  constructor(label, opts = {}) {
    this.label = label;
    this.x = this.y = this.w = this.h = 0;
    this.fill = opts.fill ?? '#1d4ed8';
    this.fg = opts.fg ?? COLORS.text;
    this.fontSize = opts.fontSize ?? 16;
    this.selected = false;   // toggle state (chapter select)
    this.visible = true;
    this.onTap = opts.onTap ?? (() => {});
  }
  place(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; return this; }
  hit(px, py) { return this.visible && px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h; }
  draw(ctx) {
    if (!this.visible) return;
    roundRect(ctx, this.x, this.y, this.w, this.h, 12);
    ctx.fillStyle = this.selected ? COLORS.accent : this.fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.selected ? '#b45309' : 'rgba(255,255,255,0.25)';
    ctx.stroke();
    ctx.fillStyle = this.selected ? '#0f172a' : this.fg;
    ctx.font = `700 ${this.fontSize}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, this.label, this.w - 24, this.fontSize, 10, 700);
    ctx.fillText(this.label, this.x + this.w / 2, this.y + this.h / 2 + 1);
  }
}

/* -------------------------------------------------------------------- state */
const G = {
  // screen: 'start' | 'loading' | 'playing' | 'over' | 'nocards'
  screen: 'start',
  paused: false,

  // geometry (CSS px, recomputed on resize)
  W: 360, H: 640, dpr: 1,
  hudH: 56, nextH: 44, binH: 130, binTop: 0, binW: 120,
  blockW: 108, blockH: 64,

  // run state
  cards: [],            // full chapter deck data
  deck: [],             // shuffled working deck
  lastId: null,         // last card id played (no immediate repeats)
  current: null,        // card currently falling
  nextCard: null,       // previewed card
  bins: [],             // [{def, correct}] ×3, reshuffled per block
  block: null,          // {x, y}  (x = center px, y = top px)
  spawnTimer: 0,        // delay before next block appears
  pendingOver: 0,       // delay before game-over screen after final heart lost

  score: 0, combo: TUNE.startCombo, clears: 0, hearts: 3,
  best: 0,

  flashT: 0,            // correct-bin flash timer after a miss
  toast: null,          // {text, t} learning toast after a miss
  particles: [],        // [{x,y,vx,vy,life,max,size,color}]
  popups: [],           // [{x,y,text,t}] floating score popups

  steerDir: 0,          // -1/0/+1 from held keys or steer buttons
  dragging: false,

  // start screen
  chapters: [], selChapter: 0, loadProgress: 0,

  // ui element registries (rebuilt by layout())
  buttons: [],
  steerL: null, steerR: null, btnPause: null, btnMute: null,

  fallSpeed() { return Math.min(TUNE.baseFall + Math.floor(this.clears / 10) * TUNE.fallStep, TUNE.maxFall); },
};

try { G.best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch { G.best = 0; }

/* ------------------------------------------------------------------ canvas */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  const wrap = document.getElementById('wrap');
  const r = wrap.getBoundingClientRect();
  G.dpr = Math.min(window.devicePixelRatio || 1, 3);  // cap DPR for perf
  G.W = Math.max(280, r.width);
  G.H = Math.max(420, r.height);
  canvas.width = Math.round(G.W * G.dpr);
  canvas.height = Math.round(G.H * G.dpr);
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  layout();
}

/* Layout: portrait-first column that also works in landscape.
   Bins always span the full width so definitions stay readable at 360px. */
function layout() {
  const { W, H } = G;
  G.hudH = 56;
  G.nextH = 44;
  G.binH = clamp(Math.round(H * 0.21), 118, 150);
  G.binW = W / 3;
  G.binTop = H - G.binH;
  G.blockW = Math.min(W * 0.30, 200);
  G.blockH = 64;
  buildButtons();
  if (G.block) G.block.x = clamp(G.block.x, G.blockW / 2 + 4, W - G.blockW / 2 - 4);
}

/* ------------------------------------------------------------------ buttons */
function mkButton(label, fill, onTap, fontSize = 16) {
  const b = new Button(label, { fill, onTap, fontSize });
  G.buttons.push(b);
  return b;
}

/* All interactive elements are rebuilt on layout(); handlers read live G. */
function buildButtons() {
  G.buttons = [];
  const { W, H, hudH, binH, binTop } = G;

  // HUD: pause + mute (top-right)
  G.btnPause = mkButton('⏸', '#334155', () => { if (G.screen === 'playing') togglePause(); });
  G.btnPause.place(W - 104, 10, 44, 36);
  G.btnMute = mkButton(isMuted() ? '🔇' : '🔊', '#334155', () => toggleMute());
  G.btnMute.place(W - 54, 10, 44, 36);

  // Steer buttons: floating circles flanking the playfield just above bins
  const r = 30, y = binTop - r - 10;
  G.steerL = mkButton('◀', 'rgba(51,65,85,0.75)', () => {}, 22);
  G.steerL.place(10, y - r, r * 2, r * 2);
  G.steerR = mkButton('▶', 'rgba(51,65,85,0.75)', () => {}, 22);
  G.steerR.place(W - 10 - r * 2, y - r, r * 2, r * 2);

  // Start screen
  G.startChapters = G.chapters.map((c, i) =>
    mkButton(c.label, '#1e293b', () => { G.selChapter = i; G.startChapters.forEach((b, j) => (b.selected = j === i)); sfx.click(); }, 15));
  G.btnStart = mkButton('START', '#16a34a', () => startGame(), 20);

  // Game-over screen
  G.btnAgain = mkButton('PLAY AGAIN', '#16a34a', () => restartRun(), 18);
  G.btnChange = mkButton('CHANGE CHAPTER', '#1e293b', () => { G.screen = 'start'; layout(); sfx.click(); }, 15);

  // "Not enough cards" screen
  G.btnBack = mkButton('BACK', '#1e293b', () => { G.screen = 'start'; layout(); sfx.click(); }, 16);

  // Pause overlay resume
  G.btnResume = mkButton('RESUME', '#16a34a', () => togglePause(), 18);

  // Position start-screen elements
  const colW = Math.min(W - 48, 360);
  const cx = (W - colW) / 2;
  let sy = 150;
  G.startChapters.forEach((b, i) => { b.place(cx, sy + i * 52, colW, 42); b.selected = i === G.selChapter; });
  G.btnStart.place(cx, sy + G.startChapters.length * 52 + 24, colW, 54);
  // Position game-over + misc screens (centered column)
  const gy = H / 2 - 40;
  G.btnAgain.place(cx, gy + 96, colW, 54);
  G.btnChange.place(cx, gy + 160, colW, 44);
  G.btnBack.place(cx, H / 2 + 60, colW, 48);
  G.btnResume.place(cx, H / 2 - 10, colW, 54);

  refreshButtonVisibility();
}

function refreshButtonVisibility() {
  const s = G.screen;
  const on = (b, v) => { if (b) b.visible = v; };
  const playing = s === 'playing';
  on(G.btnPause, playing);
  on(G.btnMute, true);
  on(G.steerL, playing && !G.paused);
  on(G.steerR, playing && !G.paused);
  (G.startChapters || []).forEach((b) => (b.visible = s === 'start'));
  on(G.btnStart, s === 'start');
  on(G.btnAgain, s === 'over');
  on(G.btnChange, s === 'over');
  on(G.btnBack, s === 'nocards');
  on(G.btnResume, playing && G.paused);
}

/* ---------------------------------------------------------------- deck mgmt */
function drawCard() {
  // Reshuffle when the working deck is empty; never repeat the last card.
  // lastId is updated here — the single choke point for all draws — so the
  // no-immediate-repeat rule holds for spawns and next-card peeks alike.
  if (!G.deck.length) {
    G.deck = shuffle(G.cards.slice());
    if (G.deck.length > 1 && G.deck[G.deck.length - 1].id === G.lastId) {
      const i = Math.floor(Math.random() * (G.deck.length - 1));
      const last = G.deck.length - 1;
      [G.deck[i], G.deck[last]] = [G.deck[last], G.deck[i]];
    }
  }
  const card = G.deck.pop();
  G.lastId = card.id;
  return card;
}

function defOf(card) { return (card && (card.simple || card.term)) || '—'; }

function spawnBlock() {
  G.current = G.nextCard || drawCard();
  G.nextCard = drawCard();

  // Build the 3 bins: the term's own definition + 2 distractors, shuffled.
  const distractors = pickDistractors(G.cards, G.current.id, 2).map((c) => ({ def: defOf(c), correct: false }));
  G.bins = shuffle([{ def: defOf(G.current), correct: true }, ...distractors]);

  G.block = { x: G.W / 2, y: G.hudH + G.nextH + 6 };
  G.spawnTimer = 0;

  // TTS reads the term aloud on spawn (iOS-safe shared module).
  if (ttsAvailable() && !isMuted()) {
    stopSpeak();           // avoid utterance backlog on fast respawns
    speak(G.current.term);
  }
  sfx.spawn();
}

/* ------------------------------------------------------------------- input */
function togglePause() {
  if (G.screen !== 'playing') return;
  G.paused = !G.paused;
  G.btnPause.label = G.paused ? '▶' : '⏸';
  if (G.paused) stopSpeak();   // don't talk over the pause screen
  sfx.click();
  refreshButtonVisibility();
}

function toggleMute() {
  const m = !isMuted();
  setMuted(m);
  if (G.btnMute) G.btnMute.label = m ? '🔇' : '🔊';
  if (m) stopSpeak();
  else sfx.click();
}

function pointPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function buttonAt(px, py) {
  for (let i = G.buttons.length - 1; i >= 0; i--) {
    if (G.buttons[i].hit(px, py)) return G.buttons[i];
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  ac(); // unlock audio on first gesture
  const { x, y } = pointPos(e);
  const b = buttonAt(x, y);
  if (b) {
    // Steer buttons are hold-to-steer; everything else is tap.
    if (b === G.steerL) { G.steerDir = -1; }
    else if (b === G.steerR) { G.steerDir = 1; }
    else b.onTap();
    canvas.setPointerCapture?.(e.pointerId);
    return;
  }
  if (G.screen === 'playing' && !G.paused && G.block) {
    G.dragging = true;                 // touch-drag steering
    G.block.x = clamp(x, G.blockW / 2 + 4, G.W - G.blockW / 2 - 4);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!G.dragging) return;
  const { x } = pointPos(e);
  if (G.block) G.block.x = clamp(x, G.blockW / 2 + 4, G.W - G.blockW / 2 - 4);
});

function endPointer(e) {
  if (G.dragging) G.dragging = false;
  G.steerDir = 0;   // release hold-to-steer
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const keys = {};
window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  ac();
  keys[e.key] = true;
  if (e.key === 'p' || e.key === 'P') togglePause();
  if (e.key === 'm' || e.key === 'M') toggleMute();
  if ((e.key === 'Enter' || e.key === ' ') && G.screen === 'start') startGame();
  if ((e.key === 'Enter' || e.key === ' ') && G.screen === 'over') restartRun();
});
window.addEventListener('keyup', (e) => { keys[e.key] = false; });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.screen === 'playing' && !G.paused) togglePause();
});

/* ---------------------------------------------------------------- game flow */
async function startGame() {
  const chapter = G.chapters[G.selChapter];
  if (!chapter) return;
  sfx.click();
  G.screen = 'loading';
  G.loadProgress = 0;
  refreshButtonVisibility();
  try {
    G.cards = await loadChapterCards(chapter.id, (p) => { G.loadProgress = p || 0; });
  } catch (err) {
    console.error('card load failed', err);
    G.cards = [];
  }
  if (!G.cards || G.cards.length < 4) {
    // Need the term + 2 distractors + a next-term preview = 4 minimum.
    G.screen = 'nocards';
    refreshButtonVisibility();
    return;
  }
  resetRun();
  G.screen = 'playing';
  refreshButtonVisibility();
}

function resetRun() {
  G.deck = [];
  G.lastId = null;
  G.nextCard = drawCard();
  G.score = 0;
  G.combo = TUNE.startCombo;
  G.clears = 0;
  G.hearts = 3;
  G.paused = false;
  G.flashT = 0;
  G.toast = null;
  G.pendingOver = 0;
  G.particles = [];
  G.popups = [];
  G.steerDir = 0;
  G.dragging = false;
  if (G.btnPause) G.btnPause.label = '⏸';
  spawnBlock();
}

function restartRun() {
  sfx.click();
  resetRun();
  G.screen = 'playing';
  refreshButtonVisibility();
}

function saveBest() {
  if (G.score > G.best) {
    G.best = G.score;
    try { localStorage.setItem(BEST_KEY, String(G.best)); } catch { /* private mode */ }
  }
}

function onCorrect(binX) {
  const gained = 100 * G.combo;
  G.score += gained;
  G.popups.push({ x: binX, y: G.binTop - 30, text: `+${gained}`, t: 0.9, color: COLORS.accent });
  G.clears += 1;
  G.combo += 1;
  burst(G.block.x, G.block.y + G.blockH / 2, COLORS.block, 26, 260);
  sfx.correct();
  G.block = null;
  G.spawnTimer = TUNE.spawnDelay;
}

function onWrong(binIdx) {
  G.hearts -= 1;
  G.combo = TUNE.startCombo;
  G.flashT = TUNE.flashTime;   // highlight the correct bin for 2s
  const correct = G.bins.find((b) => b.correct);
  G.toast = {
    text: `${G.current.term} → ${correct ? correct.def : ''}`,
    t: TUNE.flashTime,
  };
  shatter(G.block.x, G.block.y + G.blockH / 2);
  sfx.wrong();
  stopSpeak();
  G.block = null;
  if (G.hearts <= 0) {
    saveBest();
    G.pendingOver = TUNE.flashTime;  // let the player read the answer, then game over
    sfx.over();
  } else {
    G.spawnTimer = TUNE.wrongDelay;
  }
}

/* ---------------------------------------------------------------- particles */
function burst(x, y, color, n, power) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = power * (0.3 + Math.random() * 0.9);
    G.particles.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - power * 0.35,
      life: 0, max: 0.5 + Math.random() * 0.5,
      size: 2 + Math.random() * 4, color,
    });
  }
}
function shatter(x, y) {
  // block-coloured shards + red sparks = "wrong" reads instantly
  burst(x, y, COLORS.block, 18, 220);
  burst(x, y, COLORS.binBad, 14, 300);
}

function updateParticles(dt) {
  for (const p of G.particles) {
    p.life += dt;
    p.vy += 700 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  G.particles = G.particles.filter((p) => p.life < p.max);
  for (const p of G.popups) p.t -= dt;
  G.popups = G.popups.filter((p) => p.t > 0);
}

/* ------------------------------------------------------------------ update */
let lastT = 0;
function frame(t) {
  const dt = Math.min((t - lastT) / 1000 || 0, 0.05);  // clamp tab-switch jumps
  lastT = t;
  if (G.screen === 'playing' && !G.paused) update(dt);
  updateParticles(G.screen === 'playing' && !G.paused ? dt : 0);
  render();
  requestAnimationFrame(frame);
}

function update(dt) {
  if (G.flashT > 0) G.flashT -= dt;
  if (G.toast) { G.toast.t -= dt; if (G.toast.t <= 0) G.toast = null; }

  // Pending game over after the final miss's flash.
  if (G.pendingOver > 0) {
    G.pendingOver -= dt;
    if (G.pendingOver <= 0) {
      G.screen = 'over';
      refreshButtonVisibility();
      return;
    }
  }

  // Inter-block delay.
  if (G.spawnTimer > 0) {
    G.spawnTimer -= dt;
    if (G.spawnTimer <= 0 && G.hearts > 0) spawnBlock();
    return;
  }
  if (!G.block) return;

  // Horizontal steering: keys, held steer buttons, or drag (drag is absolute).
  let dir = G.steerDir;
  if (keys.ArrowLeft || keys.a || keys.A) dir -= 1;
  if (keys.ArrowRight || keys.d || keys.D) dir += 1;
  dir = clamp(dir, -1, 1);
  if (dir !== 0 && !G.dragging) {
    G.block.x = clamp(G.block.x + dir * TUNE.steer * dt, G.blockW / 2 + 4, G.W - G.blockW / 2 - 4);
  }

  // Fall.
  G.block.y += G.fallSpeed() * dt;

  // Landing: which bin did the block's center drop into?
  if (G.block.y + G.blockH >= G.binTop) {
    const binIdx = clamp(Math.floor(G.block.x / G.binW), 0, 2);
    const binX = (binIdx + 0.5) * G.binW;
    if (G.bins[binIdx] && G.bins[binIdx].correct) onCorrect(binX);
    else onWrong(binIdx);
  }
}

/* ------------------------------------------------------------------ render */
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, G.H);
  g.addColorStop(0, COLORS.bg);
  g.addColorStop(1, COLORS.bgGlow);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, G.W, G.H);
}

function drawHUD() {
  ctx.textBaseline = 'middle';
  // Hearts
  ctx.font = '20px ' + FONT;
  ctx.textAlign = 'left';
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < G.hearts ? COLORS.heart : COLORS.heartOff;
    ctx.fillText('♥', 12 + i * 26, 28);
  }
  // Score + combo
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 18px ${FONT}`;
  ctx.fillText(String(G.score), 96, 24);
  ctx.fillStyle = G.combo > 1 ? COLORS.accent : COLORS.dim;
  ctx.font = `700 14px ${FONT}`;
  ctx.fillText(G.combo > 1 ? `x${G.combo} COMBO` : 'TERM DROP', 96, 44);
  // Best
  ctx.fillStyle = COLORS.dim;
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(`BEST ${Math.max(G.best, G.score)}`, G.W - 116, 24);
}

function drawNextStrip() {
  const y = G.hudH;
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, y, G.W, G.nextH);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('NEXT:', 12, y + G.nextH / 2);
  if (G.nextCard) {
    ctx.fillStyle = COLORS.text;
    fitFont(ctx, G.nextCard.term, G.W - 90, 15, 10, 600);
    ctx.fillText(G.nextCard.term, 62, y + G.nextH / 2);
  }
}

function drawBlock() {
  const b = G.block;
  if (!b) return;
  const w = G.blockW, h = G.blockH;
  const x = b.x - w / 2, y = b.y;

  ctx.save();
  ctx.shadowColor = 'rgba(56,189,248,0.45)';
  ctx.shadowBlur = 14;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#7dd3fc');
  g.addColorStop(1, COLORS.blockEdge);
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  roundRect(ctx, x, y, w, h, 12);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();

  // Term text: wrap to ≤2 lines, auto-shrink to fit.
  const pad = 12;
  const maxW = w - pad * 2;
  let size = 20;
  let lines = [];
  while (size >= 11) {
    ctx.font = `700 ${size}px ${FONT}`;
    lines = wrapLines(ctx, G.current.term, maxW, 2);
    const fits = lines.every((l) => ctx.measureText(l).width <= maxW);
    if (fits) break;
    size -= 1;
  }
  ctx.fillStyle = '#082f49';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = size * 1.15;
  const startY = y + h / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, b.x, startY + i * lh));
}

function drawBins() {
  const { binW, binTop, binH, W } = G;
  for (let i = 0; i < 3; i++) {
    const bin = G.bins[i];
    const x = i * binW;
    const flashing = G.flashT > 0 && bin && bin.correct;

    ctx.save();
    if (flashing) {
      // Pulsing green glow on the correct bin after a miss.
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
      ctx.shadowColor = COLORS.binGood;
      ctx.shadowBlur = 18 + 10 * pulse;
    }
    roundRect(ctx, x + 4, binTop + 6, binW - 8, binH - 12, 12);
    ctx.fillStyle = flashing ? '#14532d' : COLORS.bin;
    ctx.fill();
    ctx.restore();

    roundRect(ctx, x + 4, binTop + 6, binW - 8, binH - 12, 12);
    ctx.lineWidth = flashing ? 3 : 1.5;
    ctx.strokeStyle = flashing ? COLORS.binGood : COLORS.binEdge;
    ctx.stroke();

    if (!bin) continue;
    // Definition: wrap to max 3 lines with ellipsis — readable at 360px.
    ctx.font = `400 12.5px ${FONT}`;
    const lines = wrapLines(ctx, bin.def, binW - 24, 3);
    ctx.fillStyle = flashing ? '#dcfce7' : COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lh = 17;
    const startY = binTop + 6 + (binH - 12) / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, j) => ctx.fillText(l, x + binW / 2, startY + j * lh));
  }
  // Divider line between playfield and bins
  ctx.fillStyle = 'rgba(148,163,184,0.35)';
  ctx.fillRect(0, binTop, W, 2);
}

function drawParticles() {
  for (const p of G.particles) {
    const a = 1 - p.life / p.max;
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawPopups() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of G.popups) {
    ctx.globalAlpha = clamp(p.t / 0.9, 0, 1);
    ctx.font = `700 20px ${FONT}`;
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y - (0.9 - p.t) * 40);
  }
  ctx.globalAlpha = 1;
}

function drawToast() {
  if (!G.toast) return;
  ctx.font = `600 13px ${FONT}`;
  const lines = wrapLines(ctx, '✗ ' + G.toast.text, G.W - 60, 2);
  const lh = 18;
  const boxH = lines.length * lh + 20;
  const y = G.binTop - boxH - 56;
  roundRect(ctx, 20, y, G.W - 40, boxH, 12);
  ctx.fillStyle = 'rgba(69,10,10,0.92)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.binBad;
  ctx.stroke();
  ctx.fillStyle = '#fecaca';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, G.W / 2, y + 10 + lh / 2 + i * lh));
}

function dimScreen() {
  ctx.fillStyle = 'rgba(2,6,23,0.72)';
  ctx.fillRect(0, 0, G.W, G.H);
}

/* ----------------------------------------------------------------- screens */
function drawStart() {
  drawBackground();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.block;
  ctx.font = `800 44px ${FONT}`;
  ctx.fillText('TERM DROP', G.W / 2, 62);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `400 14px ${FONT}`;
  ctx.fillText('Catch the falling term in the matching definition.', G.W / 2, 100);
  ctx.fillText('The answer IS the move.', G.W / 2, 122);

  ctx.fillStyle = COLORS.text;
  ctx.font = `700 15px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('CHAPTER', (G.W - Math.min(G.W - 48, 360)) / 2, 142);

  ctx.fillStyle = COLORS.dim;
  ctx.font = `400 12.5px ${FONT}`;
  ctx.textAlign = 'center';
  const howY = 150 + (G.startChapters?.length || 0) * 52 + 24 + 54 + 26;
  const how = [
    '◀ ▶ / arrows / drag — steer the term block',
    'Land it in the bin with the matching definition',
    '+100 × combo for each catch · 3 misses = game over',
  ];
  how.forEach((l, i) => ctx.fillText(l, G.W / 2, howY + i * 20));

  for (const b of G.buttons) b.draw(ctx);
}

function drawLoading() {
  drawBackground();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText('Loading cards…', G.W / 2, G.H / 2 - 30);
  const bw = Math.min(G.W - 120, 300);
  roundRect(ctx, (G.W - bw) / 2, G.H / 2, bw, 10, 5);
  ctx.fillStyle = '#334155';
  ctx.fill();
  roundRect(ctx, (G.W - bw) / 2, G.H / 2, bw * clamp(G.loadProgress, 0, 1), 10, 5);
  ctx.fillStyle = COLORS.block;
  ctx.fill();
  ctx.fillStyle = COLORS.dim;
  ctx.font = `400 12px ${FONT}`;
  ctx.fillText(`${Math.round(clamp(G.loadProgress, 0, 1) * 100)}%`, G.W / 2, G.H / 2 + 30);
}

function drawNoCards() {
  drawBackground();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText('Not enough cards', G.W / 2, G.H / 2 - 60);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `400 14px ${FONT}`;
  ctx.fillText('Term Drop needs at least 4 cards in a chapter.', G.W / 2, G.H / 2 - 28);
  ctx.fillText('Try a different chapter.', G.W / 2, G.H / 2 - 6);
  for (const b of G.buttons) b.draw(ctx);
}

function drawOver() {
  drawBackground();
  const cx = G.W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.binBad;
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText('GAME OVER', cx, G.H / 2 - 110);
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(`Score: ${G.score}`, cx, G.H / 2 - 60);
  ctx.fillStyle = G.score >= G.best && G.score > 0 ? COLORS.accent : COLORS.dim;
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(G.score >= G.best && G.score > 0 ? `★ New best: ${G.best} ★` : `Best: ${G.best}`, cx, G.H / 2 - 30);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `400 13px ${FONT}`;
  ctx.fillText(`${G.clears} terms caught`, cx, G.H / 2 - 4);
  for (const b of G.buttons) b.draw(ctx);
}

function drawPauseOverlay() {
  dimScreen();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText('PAUSED', G.W / 2, G.H / 2 - 70);
  for (const b of G.buttons) b.draw(ctx);
}

function drawPlaying() {
  drawBackground();
  drawHUD();
  drawNextStrip();
  drawBins();
  drawBlock();
  drawParticles();
  drawPopups();
  drawToast();
  for (const b of G.buttons) b.draw(ctx);
  if (G.paused) drawPauseOverlay();
}

function render() {
  switch (G.screen) {
    case 'start':   drawStart(); break;
    case 'loading': drawLoading(); break;
    case 'nocards': drawNoCards(); break;
    case 'over':    drawOver(); break;
    case 'playing': drawPlaying(); break;
  }
}

/* -------------------------------------------------------------------- boot */
function boot() {
  G.chapters = chapterList();
  if (!G.chapters.length) {
    // Shared module unavailable/misconfigured — fail visibly, not silently.
    G.chapters = [{ id: 'none', label: 'No chapters found' }];
  }
  G.selChapter = 0;
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(document.getElementById('wrap'));
  }
  resize();
  refreshButtonVisibility();
  requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(frame); });
}

boot();
