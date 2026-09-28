/* TRSS Games — shared game kit.
 *
 * Every game gets the same shell: top bar (Games · title · Pause · Settings),
 * a start screen (how-to, animated demo, chapter + mode choice), a pause
 * sheet, the "Learn it" card shown after every mistake, a results screen
 * that lists the terms to practise, read-aloud, sound effects, and one
 * settings panel whose choices apply to all seven games.
 *
 * Accessibility defaults: Relaxed mode (no clock, no game over), large
 * type, speech on, mistakes explained until the player moves on.
 */
import { CHAPTERS, loadChapterCards, pickDistractors, shuffle } from "./cards-loader.js";

export { CHAPTERS, pickDistractors, shuffle };

/* ----------------------------------------------------------------- storage */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/* ---------------------------------------------------------------- settings */
const DEFAULTS = { size: "m", font: "lexend", spacing: "normal", contrast: "normal", motion: "auto",
                   voice: true, rate: 0.9, sound: true, mode: "relaxed", chapter: "ch7" };
export const settings = Object.assign({}, DEFAULTS, store.get("trss-games-settings", {}));
function applySettings() {
  const h = document.documentElement;
  h.dataset.size = settings.size;
  h.dataset.font = settings.font;
  h.dataset.spacing = settings.spacing;
  h.dataset.contrast = settings.contrast;
  if (settings.motion === "auto") delete h.dataset.motion; else h.dataset.motion = settings.motion;
}
export function saveSettings() { store.set("trss-games-settings", settings); applySettings(); }
export const reducedMotion = () => settings.motion === "reduce" ||
  (settings.motion === "auto" && window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
applySettings();

/* ------------------------------------------------------------------ speech */
let voice = null;
function pickVoice() {
  if (!("speechSynthesis" in window)) return;
  const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  const pref = [/natural/i, /google us english/i, /samantha/i, /aria/i, /jenny/i, /zira/i, /en-us/i];
  for (const re of pref) { const v = vs.find((x) => re.test(x.name) || re.test(x.lang)); if (v) { voice = v; return; } }
  voice = vs[0] || null;
}
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
export const canSpeak = () => "speechSynthesis" in window;
export function stopSpeak() { if (canSpeak()) speechSynthesis.cancel(); }
/** Speak text. force=true speaks even when auto-voice is off (the 🔊 buttons). */
export function say(text, force = false) {
  if (!canSpeak() || !text || (!settings.voice && !force)) return;
  speechSynthesis.cancel();
  const parts = String(text).match(/[^.!?;]+[.!?;]*/g) || [String(text)];
  for (const p of parts) {
    const u = new SpeechSynthesisUtterance(p.trim());
    u.rate = settings.rate; if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }
}

/* -------------------------------------------------------------------- sound */
let actx = null;
export function unlockAudio() {
  try {
    if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
    if (actx && actx.state === "suspended") actx.resume();
  } catch { /* silent */ }
}
function tone(f, dur, { type = "sine", vol = 0.12, delay = 0, slide = 0 } = {}) {
  if (!settings.sound || !actx) return;
  try {
    const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.05);
  } catch { /* ignore */ }
}
export const sfx = {
  tap:   () => tone(560, 0.05, { type: "triangle", vol: 0.06 }),
  good:  () => { tone(660, 0.12); tone(880, 0.12, { delay: 0.08 }); tone(1320, 0.2, { delay: 0.16, vol: 0.1 }); },
  bad:   () => { tone(220, 0.18, { type: "triangle", vol: 0.12, slide: 0.7 }); },
  jump:  () => tone(380, 0.16, { type: "sine", vol: 0.08, slide: 2.2 }),
  whoosh:() => tone(900, 0.2, { type: "sine", vol: 0.04, slide: 0.3 }),
  win:   () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { delay: i * 0.11, vol: 0.11 })),
  lock:  () => tone(740, 0.07, { type: "triangle", vol: 0.07 }),
  coin:  () => { tone(988, 0.06, { type: "square", vol: 0.035 }); tone(1319, 0.1, { type: "square", vol: 0.035, delay: 0.05 }); },
  power: () => [440, 660, 880, 1175].forEach((f, i) => tone(f, 0.12, { type: "triangle", vol: 0.08, delay: i * 0.05 })),
  hurt:  () => tone(160, 0.25, { type: "sawtooth", vol: 0.07, slide: 0.5 }),
};

/* ------------------------------------------------------------------- icons */
export const icon = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/></svg>',
};

/* ----------------------------------------------------------------- helpers */
export function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const defOf = (c) => (c && (c.simple || c.cue)) || "";
export function sayBtn(text, label = "Listen") {
  return h("button", { class: "say", type: "button", "aria-label": label + ": " + text,
    onclick: (e) => { e.stopPropagation(); unlockAudio(); say(text, true); } },
    h("span", { html: icon.speaker }), label);
}
/** Letters-only edit distance, for forgiving spelling. */
export function editDistance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

/* ------------------------------------------------------ review / smart deck */
/* Remembers, per card, how often it was missed. Missed cards come back
   sooner (3 turns later in the same round) and lead the next session. */
const REVIEW_KEY = "trss-games-review";
const review = store.get(REVIEW_KEY, {});
export function makeDeck(cards) {
  const weight = (c) => (review[c.id] ? review[c.id].miss - review[c.id].hit * 0.5 : 0);
  const shuffled = shuffle(cards);
  const weak = shuffled.filter((c) => weight(c) > 0).sort((a, b) => weight(b) - weight(a)).slice(0, 4);
  let queue = [...weak, ...shuffled.filter((c) => !weak.includes(c))];
  let last = null;
  return {
    next() {
      if (!queue.length) queue = shuffle(cards);
      if (queue.length > 1 && queue[0] === last) queue.push(queue.shift());
      last = queue.shift();
      return last;
    },
    hit(c) { const r = review[c.id] || (review[c.id] = { miss: 0, hit: 0 }); r.hit++; store.set(REVIEW_KEY, review); },
    miss(c) {
      const r = review[c.id] || (review[c.id] = { miss: 0, hit: 0 }); r.miss++; store.set(REVIEW_KEY, review);
      queue.splice(Math.min(3, queue.length), 0, c);
    },
  };
}


/* ------------------------------------------------ rewards: coins, XP, shop */
/* One wallet shared by all seven games. Coins come from play (pickups,
   combos, clean answers); XP comes from score. Coins buy looks and boosts. */
export const SHOP = [
  { id: "run-sunset", cat: "runner", name: "Sunset", price: 0, a: "#ffb020", b: "#22d3ee" },
  { id: "run-ocean", cat: "runner", name: "Ocean", price: 150, a: "#3b82f6", b: "#fde047" },
  { id: "run-mint", cat: "runner", name: "Mint", price: 300, a: "#34d17c", b: "#f472b6" },
  { id: "run-royal", cat: "runner", name: "Royal", price: 600, a: "#8b5cf6", b: "#facc15" },
  { id: "run-flame", cat: "runner", name: "Flame", price: 1000, a: "#ef4444", b: "#fb923c" },
  { id: "frog-green", cat: "frog", name: "Pond Green", price: 0, a: "#9cf08e", b: "#45b85a" },
  { id: "frog-gold", cat: "frog", name: "Golden", price: 200, a: "#fde68a", b: "#d4a017" },
  { id: "frog-blue", cat: "frog", name: "Dart Blue", price: 400, a: "#93c5fd", b: "#2563eb" },
  { id: "frog-pink", cat: "frog", name: "Bubblegum", price: 700, a: "#fbcfe8", b: "#db2777" },
  { id: "frog-cosmic", cat: "frog", name: "Cosmic", price: 1200, a: "#c4b5fd", b: "#4338ca" },
  { id: "block-sky", cat: "block", name: "Sky", price: 0, a: "#8fdcff", b: "#36a9e6" },
  { id: "block-lava", cat: "block", name: "Lava", price: 200, a: "#fdba74", b: "#dc2626" },
  { id: "block-candy", cat: "block", name: "Candy", price: 400, a: "#f9a8d4", b: "#a855f7" },
  { id: "block-gold", cat: "block", name: "Gold", price: 800, a: "#fef08a", b: "#ca8a04" },
  { id: "boost-shield", cat: "boost", name: "🛡 Shield", price: 500, desc: "Challenge runs start with one free miss." },
  { id: "boost-magnet", cat: "boost", name: "🧲 Magnet", price: 350, desc: "Coins and flies drift toward you." },
  { id: "boost-lucky", cat: "boost", name: "🍀 Lucky", price: 800, desc: "+25% coins from every game." },
];
const wallet = Object.assign({ coins: 0, xp: 0, owned: {}, equip: {} }, store.get("trss-games-wallet", {}));
const saveWallet = () => store.set("trss-games-wallet", wallet);
export const owns = (id) => !!wallet.owned[id] || (SHOP.find((i) => i.id === id) || {}).price === 0;
export function skin(cat) { return SHOP.find((i) => i.id === wallet.equip[cat] && i.cat === cat) || SHOP.find((i) => i.cat === cat && i.price === 0); }
export const levelOf = (xp) => Math.floor(Math.sqrt(xp / 60)) + 1;
const xpFor = (lv) => (lv - 1) * (lv - 1) * 60;
export const walletInfo = () => ({ ...wallet, level: levelOf(wallet.xp) });

/** Hold-to-steer pad (◀ ▶). Returns {el, dir()} where dir is -1, 0 or 1. Also arrow keys / A-D. */
export function steerPad() {
  const held = { l: false, r: false }, keys = { l: false, r: false };
  const mk = (side, label) => {
    const b = h("button", { type: "button", "aria-label": side === "l" ? "Move left" : "Move right" }, label);
    const on = (e) => { e.preventDefault(); held[side] = true; b.classList.add("held"); unlockAudio(); };
    const off = () => { held[side] = false; b.classList.remove("held"); };
    b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off); b.addEventListener("pointercancel", off); b.addEventListener("pointerleave", off);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  };
  const el = h("div", { class: "steer" }, mk("l", "◀"), mk("r", "▶"));
  const kd = (e) => { if (e.key === "ArrowLeft" || e.key === "a") keys.l = true; if (e.key === "ArrowRight" || e.key === "d") keys.r = true; };
  const ku = (e) => { if (e.key === "ArrowLeft" || e.key === "a") keys.l = false; if (e.key === "ArrowRight" || e.key === "d") keys.r = false; };
  window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
  return { el, dir: () => ((held.r || keys.r) ? 1 : 0) - ((held.l || keys.l) ? 1 : 0),
           destroy() { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); } };
}

/* ------------------------------------------------------------------ the app */
/**
 * createApp(cfg) -> app
 * cfg: { id, title, emoji, tagline, steps[], demo(el) , minCards, filter(cards),
 *        modes: {relaxed, challenge}, onStart({cards, mode, chapter}),
 *        onPause(), onResume(), onQuit(), fullStage }
 */
export function createApp(cfg) {
  const root = document.getElementById("app") || document.body.appendChild(h("div", { id: "app" }));
  root.className = "app";
  const pauseBtn = h("button", { class: "iconbtn", type: "button", "aria-label": "Pause", hidden: true, html: icon.pause, onclick: () => pause() });
  const setBtn = h("button", { class: "iconbtn", type: "button", "aria-label": "Settings", html: icon.gear, onclick: () => openSettings() });
  const bar = h("header", { class: "topbar" },
    h("a", { class: "iconbtn", href: "../", "aria-label": "Back to all games", html: icon.back + '<span>Games</span>' }),
    h("div", { class: "title" }, cfg.title), pauseBtn, setBtn);
  const stage = h("main", { class: "stage", id: "stage" });
  root.replaceChildren(bar, stage);
  document.title = cfg.title + " — TRSS Study Games";

  let playing = false, paused = false, lastRun = null, loaded = {};
  const app = {
    stage, settings, cfg,
    get mode() { return settings.mode; },
    get paused() { return paused; },
    setPlaying(p) { playing = p; pauseBtn.hidden = !p; stage.classList.toggle("full", !!(p && cfg.fullStage)); },
    menu, learn, results, toast, floater, confetti, pause, start,
    coins: 0,
    earn(n, x, y) {
      if (wallet.owned["boost-lucky"]) n = Math.round(n * 1.25);
      app.coins += n; sfx.coin();
      if (x != null) floater(x, y, "🪙+" + n, "#ffd166");
      document.querySelectorAll(".coinchip b").forEach((b) => (b.textContent = app.coins));
    },
    coinChip() { return h("span", { class: "chip coinchip" }, "🪙 ", h("b", {}, app.coins)); },
    has: (id) => !!wallet.owned[id],
    skin,
  };

  /* ---------------- start menu */
  function menu() {
    app.setPlaying(false); stopSpeak(); paused = false;
    stage.replaceChildren();
    const chapterIds = Object.keys(CHAPTERS);
    if (!CHAPTERS[settings.chapter]) settings.chapter = chapterIds[0];

    const demo = h("div", { class: "demo", "aria-hidden": "true" });
    const chapters = h("div", { class: "choices", role: "radiogroup", "aria-label": "Chapter" });
    const paintCh = () => chapters.replaceChildren(...chapterIds.map((id) => {
      const [name, ...rest] = CHAPTERS[id].label.split(" — ");
      return h("button", { class: "choice", type: "button", role: "radio", "aria-checked": String(id === settings.chapter),
        onclick: () => { settings.chapter = id; saveSettings(); sfx.tap(); paintCh(); } },
        h("span", { class: "tick" }, id === settings.chapter ? "✓" : ""),
        h("span", {}, name, rest.length ? h("small", {}, rest.join(" — ")) : null));
    }));
    paintCh();
    const modes = h("div", { class: "seg", role: "radiogroup", "aria-label": "Mode" });
    const m = cfg.modes || {};
    const paintMode = () => modes.replaceChildren(...[["relaxed", "😌 Relaxed", m.relaxed || "No clock. Take your time."],
      ["challenge", "🔥 Challenge", m.challenge || "Faster, with lives."]].map(([id, name, sub]) =>
      h("button", { class: "choice", type: "button", role: "radio", "aria-checked": String(settings.mode === id),
        onclick: () => { settings.mode = id; saveSettings(); sfx.tap(); paintMode(); } },
        h("span", {}, name, h("small", {}, sub)))));
    paintMode();

    const best = store.get(`trss-${cfg.id}-best-${settings.mode}`, 0);
    const startBtn = h("button", { class: "btn primary block", type: "button", onclick: () => { unlockAudio(); start(); } }, "▶  Start");
    const lv = levelOf(wallet.xp), into = (wallet.xp - xpFor(lv)) / (xpFor(lv + 1) - xpFor(lv));
    const strip = h("div", { class: "walletbar" },
      h("span", { class: "lvl" }, "Lv ", h("b", {}, lv)),
      h("div", { class: "progress xp", "aria-label": "Level progress" }, h("i", { style: `width:${Math.round(into * 100)}%` })),
      h("span", { class: "chip coinchip" }, "🪙 ", h("span", {}, wallet.coins)),
      h("button", { class: "btn ghost shopbtn", type: "button", onclick: () => openShop(menu) }, "🛍 Shop"));
    stage.append(h("section", { class: "menu" }, strip,
      h("div", { class: "hero" }, h("div", { class: "emoji" }, cfg.emoji), h("h1", {}, cfg.title), h("p", {}, cfg.tagline)),
      demo,
      h("ol", { class: "steps" }, cfg.steps.map((s, i) => h("li", {}, h("span", { class: "n" }, i + 1), h("span", {}, s)))),
      h("div", { class: "label" }, "Chapter"), chapters,
      h("div", { class: "label" }, "Mode"), modes,
      h("div", { class: "startbar" }, startBtn),
      best ? h("p", { style: "text-align:center;color:var(--muted);margin:0" }, "Your best: ", h("b", {}, best)) : null));
    if (cfg.demo) try { cfg.demo(demo); } catch (e) { console.warn(e); }
  }

  /* ---------------- start a run */
  async function start(opts = {}) {
    stopSpeak();
    const chapter = settings.chapter;
    stage.replaceChildren(h("div", { class: "loading" }, h("div", { class: "spinner" }), "Loading your cards…"));
    let cards;
    try {
      cards = loaded[chapter] || (loaded[chapter] = await loadChapterCards(chapter));
    } catch (e) {
      stage.replaceChildren(h("div", { class: "error" }, "The study cards didn't load. Check your internet, then try again."),
        h("button", { class: "btn primary block", onclick: () => start(opts) }, "↻ Try again"),
        h("button", { class: "btn ghost block", onclick: menu }, "Back"));
      return;
    }
    let pool = cfg.filter ? cfg.filter(cards) : cards;
    if (pool.length < (cfg.minCards || 4)) pool = cards;
    app.coins = 0;
    lastRun = { cards: pool, all: cards, chapter, mode: settings.mode, focus: opts.focus || null };
    stage.replaceChildren();
    app.setPlaying(true);
    cfg.onStart({ ...lastRun });
  }

  /* ---------------- pause */
  function pause() {
    if (!playing || paused) return;
    paused = true; stopSpeak(); cfg.onPause && cfg.onPause();
    const resume = () => { close(); paused = false; cfg.onResume && cfg.onResume(); };
    const close = sheet([
      h("h2", {}, "Paused"),
      h("button", { class: "btn primary block", onclick: resume }, "▶  Keep playing"),
      h("button", { class: "btn ghost block", onclick: () => { close(); openSettings(() => { paused = false; cfg.onResume && cfg.onResume(); }); } }, "Settings"),
      h("button", { class: "btn ghost block", onclick: () => { close(); paused = false; cfg.onQuit && cfg.onQuit(); menu(); } }, "Quit to menu"),
    ], resume);
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  window.addEventListener("keydown", (e) => { if ((e.key === "Escape" || e.key === "p") && playing && !paused && !document.querySelector(".scrim")) pause(); });

  /* ---------------- generic bottom sheet */
  function sheet(children, onDismiss) {
    const box = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, h("div", { class: "grip" }), ...children);
    const scrim = h("div", { class: "scrim" }, box);
    scrim.addEventListener("click", (e) => { if (e.target === scrim && onDismiss) onDismiss(); });
    const key = (e) => { if (e.key === "Escape" && onDismiss) { e.stopPropagation(); onDismiss(); } };
    document.addEventListener("keydown", key, true);
    document.body.append(scrim);
    const f = box.querySelector(".btn.primary") || box.querySelector("button"); if (f) setTimeout(() => f.focus({ preventScroll: true }), 50);
    return () => { document.removeEventListener("keydown", key, true); scrim.remove(); };
  }
  app.sheet = sheet;

  /* ---------------- settings */
  function openSettings(after) {
    const wasPlaying = playing && !paused;
    if (wasPlaying) { paused = true; cfg.onPause && cfg.onPause(); }
    const group = (label, key, opts) => {
      const row = h("div", { class: "opts" });
      const paint = () => row.replaceChildren(...opts.map(([v, t]) => h("button", { class: "opt", type: "button", "aria-pressed": String(settings[key] === v),
        onclick: () => { settings[key] = v; saveSettings(); sfx.tap(); paint(); if (key === "rate") say("This is how fast I will read.", true); } }, t)));
      paint();
      return h("div", { class: "set-group" }, h("div", { class: "label" }, label), row);
    };
    const done = () => { close(); if (wasPlaying) { paused = false; cfg.onResume && cfg.onResume(); } if (after) after(); };
    const close = sheet([
      h("h2", {}, "Settings"),
      h("p", { style: "margin:0;color:var(--muted)" }, "These apply to every game on this device."),
      group("Text size", "size", [["s", "A"], ["m", "A+"], ["l", "A++"], ["xl", "A+++"]]),
      group("Font", "font", [["lexend", "Lexend"], ["atkinson", "Hyperlegible"], ["system", "Standard"]]),
      group("Letter spacing", "spacing", [["normal", "Normal"], ["wide", "Wide"]]),
      group("Read aloud automatically", "voice", [[true, "🔊 On"], [false, "Off"]]),
      group("Reading speed", "rate", [[0.7, "Slow"], [0.9, "Normal"], [1.1, "Fast"]]),
      group("Sound effects", "sound", [[true, "On"], [false, "Off"]]),
      group("Contrast", "contrast", [["normal", "Normal"], ["high", "High"]]),
      group("Motion", "motion", [["auto", "Auto"], ["reduce", "Less motion"], ["full", "Full"]]),
      h("div", { class: "sheet-actions" }, h("button", { class: "btn primary block", onclick: done }, "Done")),
    ], done);
  }
  app.openSettings = openSettings;


  /* ---------------- shop */
  function openShop(after) {
    const body = h("div", { class: "shopgrid" });
    const coinsEl = h("b", {}, wallet.coins);
    const cats = [["runner", "🏃 Runner outfits"], ["frog", "🐸 Frog colours"], ["block", "🧱 Block styles"], ["boost", "⚡ Boosts"]];
    const paint = () => {
      coinsEl.textContent = wallet.coins;
      body.replaceChildren(...cats.flatMap(([cat, label]) => [h("div", { class: "label" }, label),
        h("div", { class: "shoprow" }, SHOP.filter((i) => i.cat === cat).map((it) => {
          const have = owns(it.id), on = cat !== "boost" && skin(cat).id === it.id;
          const sw = it.a ? h("span", { class: "swatch", style: `background:linear-gradient(135deg,${it.a},${it.b})` }) : null;
          return h("button", { class: "shopitem" + (on ? " on" : "") + (have ? " have" : ""), type: "button",
            onclick: () => {
              if (!have) {
                if (wallet.coins < it.price) { toast(`You need ${it.price - wallet.coins} more coins`); sfx.bad(); return; }
                wallet.coins -= it.price; wallet.owned[it.id] = true; sfx.power(); toast("Unlocked " + it.name + "!");
              }
              if (cat !== "boost") wallet.equip[cat] = it.id;
              saveWallet(); paint();
            } }, sw, h("span", { class: "nm" }, it.name),
            h("span", { class: "pr" }, on ? "✓ Using" : have ? (cat === "boost" ? "✓ Owned" : "Use") : "🪙 " + it.price),
            it.desc ? h("small", {}, it.desc) : null);
        }))]));
    };
    paint();
    const done = () => { close(); if (after) after(); };
    const close = sheet([h("h2", {}, "Shop"), h("p", { style: "margin:0;color:var(--muted)" }, "You have 🪙 ", coinsEl, " coins. Earn more in any game."), body,
      h("div", { class: "sheet-actions" }, h("button", { class: "btn primary block", onclick: done }, "Done"))], done);
  }
  app.openShop = openShop;

  /* ---------------- learn-it card: shown after a miss (and optionally a hit) */
  function learn(card, { correct = false, chosen = null, title, note, button } = {}) {
    return new Promise((resolve) => {
      stopSpeak();
      const def = defOf(card);
      const kids = [
        h("div", { class: "learn-head" },
          h("div", { class: "badge " + (correct ? "good" : "bad"), "aria-hidden": "true" }, correct ? "✓" : "✗"),
          h("h2", {}, title || (correct ? "Nice work!" : "Let's learn this one"))),
        chosen ? h("div", { class: "fact muted" }, h("div", { class: "label" }, "You picked"), h("div", { class: "v" }, chosen)) : null,
        h("div", { class: "fact term" }, h("div", { class: "label" }, "Term"), h("div", { class: "v" }, card.term)),
        h("div", { class: "fact meaning" }, h("div", { class: "label" }, "Meaning"), h("div", { class: "v" }, def)),
        card.cue && card.cue !== def ? h("div", { class: "fact" }, h("div", { class: "label" }, "Memory hook"), h("div", { class: "v" }, card.cue)) : null,
        card.examples && card.examples[0] ? h("div", { class: "fact muted" }, h("div", { class: "label" }, "Example"), h("div", { class: "v" }, card.examples[0])) : null,
        note ? h("p", { style: "margin:0;color:var(--muted)" }, note) : null,
        h("div", { class: "row sheet-actions" }, sayBtn(card.term + ". " + def, "Read it to me"),
          h("button", { class: "btn primary", style: "flex:1 1 160px", onclick: () => { close(); stopSpeak(); resolve(); } }, button || "Got it  →")),
      ];
      const close = sheet(kids, null);
      if (!correct) say(card.term + ". " + def);
    });
  }

  /* ---------------- results */
  function results({ score = 0, correct = 0, total = 0, missed = [], extra = [], title } = {}) {
    app.setPlaying(false); stopSpeak();
    const acc = total ? correct / total : 0;
    const starsN = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : acc >= 0.4 ? 1 : 0;
    const key = `trss-${cfg.id}-best-${lastRun ? lastRun.mode : settings.mode}`;
    const prev = store.get(key, 0), isBest = score > prev;
    if (isBest) store.set(key, score);
    const uniqueMissed = [...new Map(missed.map((c) => [c.id, c])).values()];
    const bonus = starsN * 10, earned = app.coins + bonus, xpGain = Math.round(score / 4) + correct * 5;
    const lvBefore = levelOf(wallet.xp);
    wallet.coins += earned; wallet.xp += xpGain; saveWallet(); app.coins = 0;
    const lvNow = levelOf(wallet.xp), into = (wallet.xp - xpFor(lvNow)) / (xpFor(lvNow + 1) - xpFor(lvNow));
    const reward = h("div", { class: "reward" },
      h("div", { class: "rw" }, h("b", {}, "🪙 +" + earned), h("span", {}, bonus ? `incl. ${bonus} star bonus` : "coins")),
      h("div", { class: "rw" }, h("b", {}, "✨ +" + xpGain + " XP"), h("span", {}, lvNow > lvBefore ? "🎉 Level " + lvNow + "!" : "Level " + lvNow)),
      h("div", { class: "progress xp" }, h("i", { style: `width:${Math.round(into * 100)}%` })));
    const stars = h("div", { class: "stars", "aria-label": starsN + " of 3 stars" }, [0, 1, 2].map(() => h("span", {}, "⭐")));
    stage.replaceChildren(h("section", { class: "results" },
      h("div", { class: "hero" }, h("h1", {}, title || (starsN === 3 ? "Brilliant!" : starsN === 2 ? "Great job!" : starsN === 1 ? "Good effort!" : "Keep practising!"))),
      stars,
      h("div", { class: "bigscore" }, h("b", {}, score), h("span", { style: "color:var(--muted)" }, isBest && score > 0 ? "🏆 New best score!" : "Best: " + Math.max(prev, score))),
      reward,
      h("div", { class: "statgrid" },
        h("div", { class: "stat" }, h("b", {}, correct), h("span", {}, "correct")),
        h("div", { class: "stat" }, h("b", {}, total ? Math.round(acc * 100) + "%" : "—"), h("span", {}, "accuracy")),
        ...(extra.length ? extra.map(([v, l]) => h("div", { class: "stat" }, h("b", {}, v), h("span", {}, l)))
          : [h("div", { class: "stat" }, h("b", {}, uniqueMissed.length), h("span", {}, "to practise"))])),
      uniqueMissed.length ? h("div", { class: "label" }, "Practise these") : null,
      uniqueMissed.length ? h("div", { class: "review-list" }, uniqueMissed.map((c) =>
        h("div", { class: "review-item" }, h("span", { class: "t" }, c.term), sayBtn(c.term + ". " + defOf(c), "Listen"), h("span", { class: "m" }, defOf(c))))) : null,
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => start() }, "↻  Play again"),
        h("button", { class: "btn ghost", onclick: () => openShop() }, "🛍  Shop"),
        uniqueMissed.length >= 1 ? h("button", { class: "btn ghost", onclick: () => start({ focus: uniqueMissed }) }, "🎯  Practise missed") : null),
      h("button", { class: "btn ghost block", onclick: menu }, "Change chapter or mode")));
    requestAnimationFrame(() => [...stars.children].forEach((s, i) => i < starsN && setTimeout(() => { s.classList.add("on"); sfx.lock(); }, 300 + i * 280)));
    if (starsN >= 2 || lvNow > lvBefore) { sfx.win(); confetti(); }
    if (lvNow > lvBefore) setTimeout(() => toast("🎉 Level up! You're now level " + lvNow, 2600), 900);
    window.scrollTo({ top: 0 });
  }

  /* ---------------- little feedback helpers */
  function toast(text, ms = 1800) {
    const t = h("div", { class: "toast", role: "status" }, text);
    document.body.append(t); setTimeout(() => t.remove(), ms);
  }
  function floater(x, y, text, color) {
    const f = h("div", { class: "floater", style: `left:${x}px;top:${y}px;${color ? "color:" + color : ""}` }, text);
    document.body.append(f); setTimeout(() => f.remove(), 1000);
  }
  function confetti() {
    if (reducedMotion()) return;
    const c = h("canvas", { class: "confetti" }); document.body.append(c);
    const x = c.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr; x.scale(dpr, dpr);
    const cols = ["#ffb020", "#5cc8ff", "#6ee7b7", "#ff7b72", "#ffd166"];
    const ps = Array.from({ length: 120 }, () => ({ x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .35,
      vx: (Math.random() - .5) * 700, vy: -300 - Math.random() * 500, r: Math.random() * 6.28, vr: (Math.random() - .5) * 12,
      s: 5 + Math.random() * 6, c: cols[(Math.random() * cols.length) | 0] }));
    let t0 = performance.now(), last = t0;
    (function f(now) {
      const dt = Math.min(.04, (now - last) / 1000); last = now;
      x.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of ps) { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
        x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .6); x.restore(); }
      if (now - t0 < 2600) requestAnimationFrame(f); else c.remove();
    })(t0);
  }

  menu();
  return app;
}

/* --------------------------------------------------- shared question widgets */
/** Meaning/term prompt card with a Listen button. kind: 'meaning' | 'term'. */
export function promptCard(kind, text, extra) {
  return h("div", { class: "qcard " + kind },
    h("div", { class: "label" }, h("span", {}, kind === "term" ? "Term" : "Meaning"), sayBtn(text)),
    h("div", { class: "big" }, text), extra || null);
}
/** Answer buttons. Resolves with the chosen option when tapped (or 1-4 keys). */
export function answerList(options, { kind = "term", onPick }) {
  const list = h("div", { class: "answers", role: "group", "aria-label": "Choose an answer" });
  const btns = options.map((o, i) => h("button", { class: "answer " + kind, type: "button",
    onclick: () => { unlockAudio(); onPick(o, btns[i], btns); } },
    h("span", { class: "key", "aria-hidden": "true" }, String.fromCharCode(65 + i)), h("span", { class: "txt" }, o.label)));
  list.append(...btns);
  const key = (e) => {
    if (!document.body.contains(list)) { document.removeEventListener("keydown", key); return; }
    if (document.querySelector(".scrim")) return;
    const i = "1234abcd".indexOf(e.key.toLowerCase()) % 4;
    if (i >= 0 && btns[i] && !btns[i].disabled) btns[i].click();
  };
  document.addEventListener("keydown", key);
  return list;
}
export const store_ = store;

/** Power meter: fills as the player does well; when full, a button fires the power.
 *  powerMeter({ max, label, icon, onUse }) -> { el, add(n), reset() } */
export function powerMeter({ max = 4, label, icon: ic = "⚡", onUse }) {
  let v = 0;
  const bar = h("i"), prog = h("div", { class: "progress", "aria-hidden": "true" }, bar);
  const btn = h("button", { class: "powbtn", type: "button", disabled: true, onclick: () => { if (v < max) return; v = 0; paint(); sfx.power(); onUse(); } }, ic + " " + label);
  const el = h("div", { class: "powerbar", title: "Answer correctly to charge your power" }, prog, btn);
  const paint = () => { bar.style.width = (v / max) * 100 + "%"; btn.disabled = v < max; btn.classList.toggle("ready", v >= max); };
  paint();
  return { el, add(n = 1) { const was = v >= max; v = Math.min(max, v + n); paint(); if (!was && v >= max) sfx.lock(); }, reset() { v = 0; paint(); } };
}
