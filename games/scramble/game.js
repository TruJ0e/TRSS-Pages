/* Word Scramble — spell the term from its letters, one word at a time.
 *
 * Built for dyslexic players: each word of the term is scrambled on its own
 * row (spaces and hyphens stay put), letters are UPPERCASE to avoid b/d/p/q
 * mix-ups, a right letter locks in green, a wrong letter just bounces back
 * (nothing you've built is wiped), and hints are free in Relaxed mode.
 */
import { createApp, makeDeck, shuffle, h, wait, defOf, say, sfx, sayBtn, unlockAudio, powerMeter } from "../common/kit.js?v=9";

let run = null;
const ok = (t) => /^[A-Za-z][A-Za-z '\-]*$/.test(t) && t.split(/[\s-]+/).length <= 3 &&
  t.split(/[\s-]+/).every((w) => w.replace(/'/g, "").length <= 12) && t.replace(/[^A-Za-z]/g, "").length <= 22;

const app = createApp({
  id: "scramble", title: "Word Scramble", emoji: "🔤",
  tagline: "Read the meaning, then build the term letter by letter.",
  steps: ["Read (or listen to) the meaning.",
          "Tap the letters in order to spell the term.",
          "Right letters lock in. Stuck? Tap 💡 Hint — it's free."],
  modes: { relaxed: "8 words. Free hints. Helpful glow.", challenge: "10 words. Hints cost points." },
  minCards: 4, demo,
  filter: (cards) => cards.filter((c) => ok(c.term)),
  onStart: begin, onQuit: () => (run = null),
});

function begin({ cards, mode, focus }) {
  const rounds = mode === "relaxed" ? 8 : 10;
  const pool = focus ? [...focus.filter((c) => ok(c.term)), ...cards] : cards;
  run = { mode, rounds, deck: makeDeck([...new Set(pool)]), n: 0, score: 0, correct: 0, mistakes: 0, hints: 0, missed: [] };
  run.hud = h("div", { class: "hud" });
  run.body = h("div", { class: "scr" });
  run.power = powerMeter({ max: 3, icon: "🪄", label: "Magic word", onUse: magic });
  // the treasure vault: every solved word opens one lock
  run.vault = h("div", { class: "vault", "aria-label": "Vault locks" },
    h("div", { class: "vdoor" }, h("span", { class: "vwheel" }, "☸"), h("span", { class: "vtxt" }, "Treasure vault")),
    h("div", { class: "locks" }, Array.from({ length: run.rounds }, () => h("i", { class: "lock" }, "🔒"))));
  app.stage.replaceChildren(run.hud, run.vault, run.power.el, run.body);
  next();
}

function paintHud() {
  const r = run;
  r.hud.replaceChildren(h("div", { class: "progress" }, h("i", { style: `width:${(r.n / r.rounds) * 100}%` })),
    h("span", { class: "chip" }, h("b", {}, Math.min(r.n + 1, r.rounds)), " / " + r.rounds),
    h("span", { class: "chip" }, "⭐ ", h("b", {}, r.score)), app.coinChip());
}

function next() {
  const r = run; if (!r) return;
  if (r.n >= r.rounds) return finish();
  const card = r.deck.next();
  // Split the term into words; keep separators as fixed marks.
  const parts = card.term.split(/(\s+|-)/).filter((p) => p && !/^\s+$/.test(p));
  const words = [];
  for (const p of parts) if (p === "-") words.push({ sep: "-" }); else words.push({ letters: p.replace(/'/g, "").toUpperCase().split("") });
  const seq = []; // every letter slot in order
  words.forEach((w, wi) => w.letters && w.letters.forEach((ch, li) => seq.push({ ch, wi, li })));
  r.q = { card, words, seq, pos: 0, wrongHere: 0, hintsHere: 0, mistakesHere: 0 };

  const slotsWrap = h("div", { class: "slots", "aria-live": "polite" });
  words.forEach((w) => {
    if (w.sep) { slotsWrap.append(h("span", { class: "sep" }, "–")); return; }
    const g = h("span", { class: "word" });
    w.slotEls = w.letters.map(() => g.appendChild(h("span", { class: "slot" })));
    slotsWrap.append(g);
  });
  const tray = h("div", { class: "tray" });
  words.forEach((w, wi) => {
    if (!w.letters) return;
    let order = shuffle(w.letters.map((ch, i) => ({ ch, i })));
    for (let g = 0; g < 10 && w.letters.length > 1 && order.every((o, k) => o.ch === w.letters[k]); g++) order = shuffle(order);
    const row = h("div", { class: "trow" });
    w.tiles = order.map((o) => {
      const t = { ch: o.ch, wi, used: false };
      t.el = h("button", { class: "ltile", type: "button", "aria-label": "Letter " + o.ch, onclick: () => tap(t) }, o.ch);
      row.append(t.el); return t;
    });
    tray.append(row);
  });
  // one golden tile per word: place it for bonus coins
  const all = words.flatMap((w) => w.tiles || []);
  const gold = all[(Math.random() * all.length) | 0];
  if (gold) { gold.gold = true; gold.el.classList.add("gold"); }
  const hintBtn = h("button", { class: "btn ghost", type: "button", onclick: hint }, "💡 Hint" + (r.mode === "challenge" ? " (−30)" : ""));
  const showBtn = h("button", { class: "btn ghost", type: "button", onclick: reveal }, "🙈 Show me");
  r.q.msg = h("div", { class: "smsg", role: "status" });
  r.body.replaceChildren(
    h("div", { class: "qcard meaning" }, h("div", { class: "label" }, h("span", {}, "Meaning"), sayBtn(defOf(card))), h("div", { class: "big" }, defOf(card)),
      h("div", { class: "cue" }, `${seq.length} letters · the first one is done for you`)),
    slotsWrap, r.q.msg, tray,
    h("div", { class: "row" }, hintBtn, showBtn));
  r.q.slotsWrap = slotsWrap;
  // the first letter starts in place so every word has a foothold
  { const f = words[seq[0].wi].tiles.find((x) => x.ch === seq[0].ch); if (f) { q0(f); } }
  paintSlots(); paintHud();
  say(defOf(card));
}

function q0(t) {
  const q = run.q;
  t.used = true; t.el.classList.add("used"); t.el.disabled = true; if (t.gold) { t.gold = false; t.el.classList.remove("gold"); }
  q.pos = 1;
}

function paintSlots() {
  const q = run.q;
  q.seq.forEach((s, i) => {
    const el = q.words[s.wi].slotEls[s.li];
    el.textContent = i < q.pos ? s.ch : "";
    el.className = "slot" + (i < q.pos ? " filled" : "") + (i === q.pos ? " now" : "");
  });
}

function glowNeeded() {
  const q = run.q, need = q.seq[q.pos];
  const t = q.words[need.wi].tiles.find((x) => !x.used && x.ch === need.ch);
  if (t) t.el.classList.add("glow");
}

async function tap(t) {
  unlockAudio();
  const r = run, q = r.q; if (!q || t.used || q.done) return;
  const need = q.seq[q.pos];
  if (t.ch === need.ch && t.wi === need.wi) {
    place(t);
  } else {
    q.mistakesHere++; r.mistakes++; q.wrongHere++;
    t.el.classList.remove("wrong"); void t.el.offsetWidth; t.el.classList.add("wrong");
    sfx.bad();
    q.msg.textContent = t.wi !== need.wi ? "That letter is in a different word." : "Not that one — try another letter.";
    if (r.mode === "relaxed" && q.wrongHere >= 2) glowNeeded();
  }
}

function place(t) {
  const r = run, q = r.q;
  t.used = true; t.el.classList.remove("glow", "wrong"); t.el.classList.add("used"); t.el.disabled = true;
  if (t.gold && !q.hinting) { const b = t.el.getBoundingClientRect(); app.earn(3, b.left + b.width / 2, b.top); }
  q.pos++; q.wrongHere = 0; q.msg.textContent = "";
  sfx.lock();
  paintSlots();
  if (q.pos >= q.seq.length) solved();
}

function hint() {
  const r = run, q = r.q; if (!q || q.done) return;
  const need = q.seq[q.pos];
  const t = q.words[need.wi].tiles.find((x) => !x.used && x.ch === need.ch);
  if (!t) return;
  r.hints++; q.hintsHere++;
  q.hinting = true; place(t); q.hinting = false;
}

async function solved() {
  const r = run, q = r.q; q.done = true;
  const pts = Math.max(20, 100 - q.mistakesHere * 15 - (r.mode === "challenge" ? q.hintsHere * 30 : q.hintsHere * 5));
  r.score += pts; r.n++;
  const clean = q.mistakesHere + q.hintsHere <= 2;
  if (!clean) { r.missed.push(q.card); r.deck.miss(q.card); }
  else { r.correct++; r.deck.hit(q.card); if (!q.magic) r.power.add(1); app.earn(q.mistakesHere + q.hintsHere === 0 ? 5 : 3); }
  q.slotsWrap.classList.add("win"); sfx.good();
  openLock(r.n - 1, clean);
  q.msg.innerHTML = ""; q.msg.append(h("b", { class: "okword" }, "✓ " + q.card.term), " +" + pts);
  say(q.card.term);
  paintHud();
  await wait(1300);
  if (run) next();
}

function magic() {
  const r = run, q = r.q; if (!q || q.done) return;
  q.magic = true;
  // spell the rest of the current word automatically
  const wi = q.seq[q.pos].wi;
  const step = () => { if (!run || q.done || q.pos >= q.seq.length || q.seq[q.pos].wi !== wi) return; hint(); r.hints--; q.hintsHere--; setTimeout(step, 160); };
  step();
}

async function reveal() {
  const r = run, q = r.q; if (!q || q.done) return;
  q.done = true; r.n++; r.missed.push(q.card); r.deck.miss(q.card);
  q.pos = q.seq.length; paintSlots();
  openLock(r.n - 1, false);
  await app.learn(q.card, { title: "Here's the word", note: "It'll come back later so you can try again." });
  if (run) next();
}

function openLock(i, clean) {
  const l = run && run.vault.querySelectorAll(".lock")[i]; if (!l) return;
  l.textContent = clean ? "🔓" : "🔑"; l.classList.add(clean ? "open" : "helped");
  run.vault.querySelector(".vwheel").classList.remove("spin"); void run.vault.offsetWidth; run.vault.querySelector(".vwheel").classList.add("spin");
}

async function finish() {
  const r = run; if (!r) return;
  r.vault.classList.add("opened"); r.vault.querySelector(".vtxt").textContent = "Vault open! 💰";
  sfx.win(); app.earn(10); app.confetti();
  await wait(1500);
  run = null;
  app.results({ score: r.score, correct: r.correct, total: r.n, missed: r.missed, extra: [[r.hints, "hints"]] });
}

document.addEventListener("keydown", (e) => {
  if (!run || !run.q || run.q.done || document.querySelector(".scrim") || e.ctrlKey || e.metaKey) return;
  const k = e.key.toUpperCase();
  if (/^[A-Z]$/.test(k)) {
    const q = run.q, need = q.seq[q.pos];
    const t = q.words[need.wi].tiles.find((x) => !x.used && x.ch === k) || q.words.flatMap((w) => w.tiles || []).find((x) => !x.used && x.ch === k);
    if (t) tap(t);
  }
});

function demo(el) {
  el.classList.add("s-demo");
  el.append(h("div", { class: "sd-slots" }, ..."DRIVE".split("").map((c, i) => h("i", { style: `--d:${i * .45}s` }, c))),
    h("div", { class: "sd-tray" }, ..."VRDEI".split("").map((c) => h("b", {}, c))));
}
