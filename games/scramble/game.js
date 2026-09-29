/* Word Wheel — a Wheel-of-Fortune-style spelling game.
 *
 * The meaning is the clue. The term hides on a puzzle board (first letter
 * already showing). Spin the wheel, then pick a consonant: every copy of it
 * on the board pays the wedge value. Vowels are free in Relaxed and cost 250
 * in Challenge. Tap "Solve" to type the answer (close spelling counts).
 * Relaxed: 6 puzzles, no Bankrupt, and after a few misses the right key
 * glows. Challenge: 8 puzzles, Bankrupt is on the wheel, vowels cost.
 */
import { createApp, makeDeck, shuffle, h, wait, defOf, say, sfx, sayBtn, unlockAudio, editDistance, reducedMotion } from "../common/kit.js?v=11";

let run = null;
const VOWELS = "AEIOU";
const ok = (t) => /^[A-Za-z][A-Za-z '\-]*$/.test(t) && t.split(/[\s-]+/).length <= 3 &&
  t.split(/[\s-]+/).every((w) => w.replace(/'/g, "").length <= 12) && t.replace(/[^A-Za-z]/g, "").length <= 22;

const app = createApp({
  id: "scramble", title: "Word Wheel", emoji: "🎡",
  tagline: "Spin the wheel, pick letters, and solve the puzzle!",
  steps: ["Read the clue — it's the meaning of the hidden term.",
          "Tap SPIN, then pick a letter. Every match on the board wins the wheel's points.",
          "Vowels are free in Relaxed. Know it? Tap SOLVE and type the term!"],
  modes: { relaxed: "5 puzzles. No Bankrupt. Free vowels.", challenge: "7 puzzles. Bankrupt! Vowels cost 250." },
  minCards: 4, demo,
  filter: (cards) => cards.filter((c) => ok(c.term)),
  onStart: begin, onQuit: () => (run = null),
});

function wedges(mode) {
  const w = [300, 500, 250, 800, 400, "FREE", 600, 200, 1000, 350, 450, mode === "challenge" ? "BANKRUPT" : 700];
  const cols = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#eab308", "#6366f1", "#10b981", mode === "challenge" ? "#111827" : "#0ea5e9"];
  return w.map((v, i) => ({ v, col: cols[i] }));
}

function begin({ cards, mode, focus }) {
  const rounds = mode === "relaxed" ? 5 : 7;
  const pool = focus ? [...focus.filter((c) => ok(c.term)), ...cards] : cards;
  run = { mode, rounds, deck: makeDeck([...new Set(pool)]), n: 0, score: 0, correct: 0, missed: [], wedges: wedges(mode), angle: 0, spinning: false };
  run.hud = h("div", { class: "hud" });
  run.body = h("div", { class: "wheelgame" });
  app.stage.replaceChildren(run.hud, run.body);
  next();
}

function paintHud() {
  const r = run; if (!r) return;
  r.hud.replaceChildren(h("div", { class: "progress" }, h("i", { style: `width:${(r.n / r.rounds) * 100}%` })),
    h("span", { class: "chip" }, "🧩 ", h("b", {}, Math.min(r.n + 1, r.rounds)), " / " + r.rounds),
    h("span", { class: "chip bankchip" }, "🏦 ", h("b", {}, r.score)), app.coinChip());
}

function next() {
  const r = run; if (!r) return;
  if (r.n >= r.rounds) return finish();
  const card = r.deck.next();
  const letters = [];
  const words = card.term.toUpperCase().split(/(\s+)/).filter((w) => !/^\s+$/.test(w));
  r.q = { card, words, guessed: new Set(), bank: 0, misses: 0, value: null, done: false };
  // the first letter is shown for free
  r.q.first = card.term.replace(/[^A-Za-z]/g, "")[0].toUpperCase();
  const board = h("div", { class: "pboard", "aria-label": "Puzzle board" });
  r.q.tiles = [];
  words.forEach((w) => {
    const row = h("div", { class: "pword" });
    [...w].forEach((ch, i) => {
      if (!/[A-Z]/.test(ch)) { row.append(h("span", { class: "ptile sym" }, ch)); return; }
      const el = h("span", { class: "ptile" }, h("b", {}, ch));
      r.q.tiles.push({ ch, el, shown: false });
      row.append(el);
    });
    board.append(row);
  });
  r.q.tiles[0].shown = true; r.q.tiles[0].el.classList.add("on");
  r.wheelCv = h("canvas", { class: "wheel", "aria-hidden": "true" });
  r.pointerEl = h("div", { class: "wpointer", "aria-hidden": "true" });
  r.valueEl = h("div", { class: "wvalue", role: "status" }, "Tap SPIN!");
  r.spinBtn = h("button", { class: "btn primary spinbtn", type: "button", onclick: spin }, "🎡 SPIN");
  r.solveBtn = h("button", { class: "btn ghost", type: "button", onclick: solve }, "💡 SOLVE");
  r.showBtn = h("button", { class: "btn ghost", type: "button", onclick: reveal, "aria-label": "Show me the answer" }, "🙈");
  r.keys = h("div", { class: "keyboard" }, [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((L) =>
    h("button", { class: "key" + (VOWELS.includes(L) ? " vowel" : ""), type: "button", "data-l": L, onclick: () => guess(L) }, L)));
  r.msg = h("div", { class: "wmsg", role: "status" });
  r.body.replaceChildren(
    h("div", { class: "qcard meaning clue" }, h("div", { class: "label" }, h("span", {}, "Clue"), sayBtn(defOf(card))), h("div", { class: "big" }, defOf(card)),
      h("div", { class: "cue" }, `${r.q.tiles.length} letters · the first one is on the board`)),
    board,
    h("div", { class: "wheelrow" }, h("div", { class: "wheelbox" }, r.wheelCv, r.pointerEl), h("div", { class: "wside" }, r.valueEl, r.spinBtn, h("div", { class: "row2" }, r.solveBtn, r.showBtn))),
    r.msg, r.keys);
  r.q.board = board;
  markKey(r.q.first);
  paintHud(); updateKeys();
  requestAnimationFrame(() => drawWheel());
  say(defOf(card));
}

function markKey(L) { const k = run.keys.querySelector(`[data-l="${L}"]`); if (k) k.classList.add("used"); }
function updateKeys() {
  const r = run; if (!r) return; const q = r.q;
  r.keys.querySelectorAll(".key").forEach((k) => {
    const L = k.dataset.l, used = q.guessed.has(L) || L === q.first && !q.tiles.some((t) => t.ch === L && !t.shown);
    const vowel = VOWELS.includes(L);
    k.disabled = q.done || used || r.spinning || (!vowel && q.value == null);
    k.classList.toggle("used", used);
  });
  r.spinBtn.disabled = q.done || r.spinning || q.value != null;
  r.solveBtn.disabled = q.done || r.spinning;
}

/* ---------------------------------------------------------------- wheel */
function drawWheel() {
  const r = run; if (!r || !r.wheelCv.isConnected) return;
  const cv = r.wheelCv, dpr = Math.min(2, devicePixelRatio || 1), S = cv.clientWidth;
  if (cv.width !== S * dpr) { cv.width = S * dpr; cv.height = S * dpr; }
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const R = S / 2, n = r.wedges.length, a0 = r.angle;
  c.clearRect(0, 0, S, S);
  c.save(); c.translate(R, R);
  c.fillStyle = "#1f2937"; c.beginPath(); c.arc(0, 0, R - 1, 0, 6.29); c.fill();
  r.wedges.forEach((w, i) => {
    const s = a0 + (i / n) * Math.PI * 2, e = s + Math.PI * 2 / n;
    c.fillStyle = w.col; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R - 6, s, e); c.closePath(); c.fill();
    c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = 1.5; c.stroke();
    c.save(); c.rotate(s + Math.PI / n); c.fillStyle = "#fff"; c.textAlign = "right"; c.textBaseline = "middle";
    const label = typeof w.v === "number" ? String(w.v) : w.v === "FREE" ? "FREE" : "BANK-\nRUPT";
    c.font = `800 ${Math.round(R * (typeof w.v === "number" ? .15 : w.v === "FREE" ? .12 : .085))}px Fredoka, sans-serif`;
    c.fillText(label.replace("\n", ""), R - 12, 0);
    c.restore();
  });
  // pegs + hub
  for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; c.fillStyle = "#fde68a"; c.beginPath(); c.arc(Math.cos(a) * (R - 6), Math.sin(a) * (R - 6), 3, 0, 6.29); c.fill(); }
  const hub = c.createRadialGradient(-4, -4, 2, 0, 0, R * .2); hub.addColorStop(0, "#fff7c2"); hub.addColorStop(1, "#b45309");
  c.fillStyle = hub; c.beginPath(); c.arc(0, 0, R * .17, 0, 6.29); c.fill();
  c.restore();
}

async function spin() {
  unlockAudio();
  const r = run, q = r.q; if (!r || r.spinning || q.value != null || q.done) return;
  r.spinning = true; updateKeys(); r.valueEl.textContent = "Spinning…";
  const n = r.wedges.length, target = (Math.random() * n) | 0;
  // pointer sits at the top (-90°): land the target wedge's middle there
  const want = -Math.PI / 2 - (target + .5) * (Math.PI * 2 / n);
  const turns = 4 + Math.random() * 2;
  const start = r.angle, end = want - Math.PI * 2 * Math.ceil(turns) + (start - (start % (Math.PI * 2)));
  const dur = reducedMotion() ? 300 : 2300, t0 = performance.now();
  let lastPeg = -1;
  await new Promise((res) => {
    const step = (now) => {
      if (!run) return res();
      const k = Math.min(1, (now - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
      r.angle = start + (end - start) * ease;
      const peg = Math.floor((r.angle / (Math.PI * 2 / n)));
      if (peg !== lastPeg) { lastPeg = peg; sfx.tap(); r.pointerEl.classList.remove("tick"); void r.pointerEl.offsetWidth; r.pointerEl.classList.add("tick"); }
      drawWheel();
      if (k < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  if (!run) return;
  r.spinning = false;
  const w = r.wedges[target];
  if (w.v === "BANKRUPT") {
    q.bank = 0; sfx.hurt(); r.valueEl.textContent = "💥 BANKRUPT!"; r.valueEl.className = "wvalue bad";
    r.msg.textContent = "Bankrupt — this puzzle's winnings are gone. Spin again!";
  } else if (w.v === "FREE") {
    sfx.power(); r.valueEl.textContent = "🎁 FREE LETTER"; r.valueEl.className = "wvalue good";
    const hidden = q.tiles.filter((t) => !t.shown);
    const L = hidden[(Math.random() * hidden.length) | 0].ch;
    r.msg.textContent = `Free letter: ${L}!`;
    await revealLetter(L, 100);
    if (!run) return;
  } else {
    q.value = w.v; sfx.lock(); r.valueEl.textContent = `${w.v} per letter`; r.valueEl.className = "wvalue";
    r.msg.textContent = "Pick a letter!";
    hintIfStuck();
  }
  updateKeys();
}

async function guess(L) {
  unlockAudio();
  const r = run, q = r.q; if (!r || q.done || q.guessed.has(L)) return;
  const vowel = VOWELS.includes(L);
  if (!vowel && q.value == null) { r.msg.textContent = "Spin the wheel first!"; return; }
  if (vowel && r.mode === "challenge") { if (r.score + q.bank < 250) { r.msg.textContent = "You need 250 points to buy a vowel."; return; } q.bank -= 250; }
  q.guessed.add(L);
  const count = q.tiles.filter((t) => t.ch === L && !t.shown).length;
  const value = vowel ? 0 : q.value;
  q.value = null;
  r.keys.querySelectorAll(".key.glow").forEach((k) => k.classList.remove("glow"));
  if (count) { q.misses = 0; r.msg.textContent = count === 1 ? `There is 1 ${L}!` : `There are ${count} ${L}'s!`; await revealLetter(L, value); }
  else {
    q.misses++; sfx.bad(); r.msg.textContent = `No ${L}. ${vowel ? "Try another letter." : "Spin again!"}`;
    const k = r.keys.querySelector(`[data-l="${L}"]`); k.classList.add("miss");
    r.valueEl.textContent = "Tap SPIN!"; r.valueEl.className = "wvalue";
  }
  updateKeys();
  paintHud();
}

async function revealLetter(L, value) {
  const r = run, q = r.q;
  q.guessed.add(L);
  const ts = q.tiles.filter((t) => t.ch === L && !t.shown);
  for (const t of ts) {
    t.shown = true; t.el.classList.add("flip"); sfx.lock();
    await wait(reducedMotion() ? 0 : 260);
    t.el.classList.add("on");
  }
  if (value) { q.bank += value * ts.length; const b = r.valueEl.getBoundingClientRect(); app.floater(b.left + b.width / 2, b.top, "+" + value * ts.length, "#fde68a"); }
  if (!run) return;
  r.valueEl.textContent = "Tap SPIN!"; r.valueEl.className = "wvalue";
  paintHud();
  if (q.tiles.every((t) => t.shown)) await solved(false);
}

function hintIfStuck() {
  const r = run, q = r.q;
  if (r.mode !== "relaxed" || q.misses < 2) return;
  const t = q.tiles.find((x) => !x.shown && !VOWELS.includes(x.ch));
  if (t) r.keys.querySelector(`[data-l="${t.ch}"]`).classList.add("glow");
}

function solve() {
  const r = run, q = r.q; if (!r || q.done) return;
  const input = h("input", { class: "solvebox", id: "solvebox", type: "text", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", placeholder: "Type the term…", "aria-label": "Type the term" });
  const err = h("p", { class: "wmsg" });
  const tryIt = () => {
    const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
    const a = norm(input.value), b = norm(q.card.term);
    if (!a) return;
    if (editDistance(a, b) <= Math.max(1, Math.floor(b.length / 6))) { close(); solved(true); }
    else { sfx.bad(); input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake"); err.textContent = "Not quite — check the board and try again."; }
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryIt(); });
  const close = app.sheet([h("h2", {}, "Solve the puzzle"), h("p", { style: "margin:0;color:var(--muted)" }, defOf(q.card)), input, err,
    h("div", { class: "row sheet-actions" }, h("button", { class: "btn ghost", onclick: () => close() }, "Back"), h("button", { class: "btn primary", onclick: tryIt }, "Solve!"))], () => close());
  setTimeout(() => input.focus(), 80);
}

async function solved(bySolve) {
  const r = run, q = r.q; if (q.done) return;
  q.done = true;
  const hiddenLeft = q.tiles.filter((t) => !t.shown).length;
  q.tiles.forEach((t) => { t.shown = true; t.el.classList.add("on"); });
  const bonus = bySolve ? 100 * hiddenLeft : 0;
  const win = Math.max(0, q.bank) + bonus + 100;
  r.score += win; r.n++;
  const clean = q.misses <= 2;
  if (clean) { r.correct++; r.deck.hit(q.card); app.earn(bySolve && hiddenLeft >= 2 ? 6 : 4); } else { r.missed.push(q.card); r.deck.miss(q.card); app.earn(2); }
  q.board.classList.add("win"); sfx.win();
  r.msg.replaceChildren(h("b", { class: "okword" }, "✓ " + q.card.term), ` +${win}` + (bonus ? ` (solve bonus ${bonus})` : ""));
  say(q.card.term);
  paintHud(); updateKeys();
  await wait(1700);
  if (run === r) next();
}

async function reveal() {
  const r = run, q = r.q; if (!q || q.done) return;
  q.done = true; r.n++; r.missed.push(q.card); r.deck.miss(q.card);
  q.tiles.forEach((t) => { t.shown = true; t.el.classList.add("on"); });
  updateKeys();
  await app.learn(q.card, { title: "Here's the answer", note: "It'll come back later so you can try again." });
  if (run === r) next();
}

function finish() {
  const r = run; run = null;
  app.results({ score: r.score, correct: r.correct, total: r.n, missed: r.missed, extra: [["🏦 " + r.score, "banked"]] });
}

document.addEventListener("keydown", (e) => {
  if (!run || !run.q || run.q.done || document.querySelector(".scrim") || e.ctrlKey || e.metaKey) return;
  const k = e.key.toUpperCase();
  if (k === " " || k === "ENTER") { e.preventDefault(); spin(); return; }
  if (/^[A-Z]$/.test(k)) guess(k);
});

function demo(el) {
  el.classList.add("s-demo");
  el.append(h("div", { class: "sd-slots" }, ..."DRIVE".split("").map((c, i) => h("i", { style: `--d:${i * .45}s` }, c))),
    h("div", { class: "sd-tray" }, h("b", { class: "sd-wheel" }, "🎡")));
}
