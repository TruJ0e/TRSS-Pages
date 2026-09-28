/* Type Rush — a meaning drifts down; type the term before it lands.
 *
 * Forgiving by design: close spellings count (about one slip per five
 * letters, with the right spelling shown afterwards), and word suggestions
 * appear after two letters so players who struggle with spelling can tap.
 * Relaxed: one meaning at a time, 10 words, and a meaning that lands just
 * waits. Challenge: up to 3 at once, faster and faster, 3 hearts.
 */
import { createApp, makeDeck, h, wait, defOf, say, sfx, editDistance, unlockAudio, powerMeter, shuffle, pickDistractors } from "../common/kit.js?v=9";

const ROUND = 10;
let run = null, raf = 0;
const norm = (s) => String(s).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]/g, "");

const app = createApp({
  id: "rush", title: "Type Rush", emoji: "⌨️",
  tagline: "Meteors are falling on the city! Type the right term to blast them.",
  steps: ["A meaning falls like a meteor and is read aloud.",
          "Type the matching term to fire your laser. Close spelling still counts.",
          "Stuck? Tap 💡 for a word bank. Typing without it earns a bonus!"],
  modes: { relaxed: "One at a time. It waits for you.", challenge: "Up to 3 at once. 3 hearts." },
  minCards: 4, demo,
  onStart: begin,
  onPause: () => run && (run.frozen = true),
  onResume: () => { if (run) { run.frozen = false; run.last = performance.now(); } },
  onQuit: stop,
});

function stop() { cancelAnimationFrame(raf); run = null; window.visualViewport && visualViewport.removeEventListener("resize", fit); }

function begin({ cards, mode, focus }) {
  stop();
  run = { mode, cards, deck: makeDeck(focus ? [...new Set([...focus, ...cards])] : cards), items: [], n: 0, correct: 0, score: 0,
          hearts: 3, missed: [], speed: mode === "relaxed" ? 1 / 22 : 1 / 13, spawnT: 0, frozen: false, last: performance.now(), wrongTries: 0 };
  run.hud = h("div", { class: "hud" });
  run.field = h("div", { class: "field" }, h("div", { class: "skyline", "aria-hidden": "true" }), h("div", { class: "cannon", "aria-hidden": "true" }), h("div", { class: "deadline" }));
  run.input = h("input", { class: "guess", id: "guess", type: "text", autocomplete: "off", autocapitalize: "off", autocorrect: "off",
    spellcheck: "false", enterkeyhint: "done", placeholder: "Type the term…", "aria-label": "Type the term" });
  run.sugg = h("div", { class: "sugg bank", role: "group", "aria-label": "Word bank" });
  run.msg = h("div", { class: "rmsg", role: "status" });
  const go = h("button", { class: "btn primary gobtn", type: "button", onclick: () => submit(true) }, "Enter");
  const helpBtn = h("button", { class: "btn ghost gobtn", type: "button", onclick: showMe, title: "Show me the answer", "aria-label": "Show me the answer" }, "🙈");
  run.bankBtn = h("button", { class: "btn ghost bankbtn", type: "button", onclick: () => showBank(true) }, "💡 Word bank" + (mode === "challenge" ? " (−20)" : ""));
  run.slow = 0;
  run.power = powerMeter({ max: 3, icon: "🐢", label: "Slow-mo", onUse: () => { run.slow = 8; app.toast("🐢 Everything slows down for 8 seconds!"); run.field.classList.add("slowmo"); } });
  app.stage.replaceChildren(run.hud, run.power.el, run.field, h("div", { class: "typebar" }, h("div", { class: "inrow" }, run.input, go, helpBtn), run.bankBtn, run.sugg, run.msg));
  run.input.addEventListener("input", () => { unlockAudio(); submit(false); });
  run.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(true); } });
  if (window.visualViewport) visualViewport.addEventListener("resize", fit);
  paintHud(); spawn(); fit(); setTimeout(fit, 60);
  setTimeout(() => run && run.input.focus({ preventScroll: true }), 200);
  raf = requestAnimationFrame(loop);
}

/* Keep the playfield sized to what's visible above the phone keyboard. */
function fit() {
  if (!run) return;
  const vh = window.visualViewport ? visualViewport.height : innerHeight;
  const top = run.field.getBoundingClientRect().top + (window.visualViewport ? visualViewport.pageTop - scrollY : 0);
  const bar = run.field.nextElementSibling;
  const below = (bar ? bar.offsetHeight : 260) + 28;
  run.field.style.height = Math.max(150, Math.min(460, vh - Math.max(60, top) - below)) + "px";
}

function paintHud() {
  const r = run;
  const kids = r.mode === "relaxed"
    ? [h("div", { class: "progress" }, h("i", { style: `width:${(r.n / ROUND) * 100}%` })), h("span", { class: "chip" }, h("b", {}, Math.min(r.n + 1, ROUND)), " / " + ROUND)]
    : [h("span", { class: "chip" }, "❤️".repeat(Math.max(0, r.hearts)) + "🤍".repeat(3 - Math.max(0, r.hearts))), h("span", { class: "chip" }, "✓ ", h("b", {}, r.correct))];
  kids.push(h("span", { class: "chip" }, "⭐ ", h("b", {}, r.score)), app.coinChip());
  r.hud.replaceChildren(...kids);
}

function spawn() {
  const r = run;
  const card = r.deck.next();
  if (r.items.some((i) => i.card.id === card.id)) return;
  const el = h("div", { class: "fall" }, h("span", { class: "label" }, "Meaning"), h("span", {}, defOf(card)));
  r.field.append(el);
  const it = { card, el, y: 0 };
  r.items.push(it);
  paintBank();
  if (r.items.length === 1) say(defOf(card));
  r.wrongTries = 0;
  // the word bank stays hidden at first; in Relaxed it offers itself after a while
  if (r.items.length === 1) { hideBank(); clearTimeout(r.bankTimer); if (r.mode === "relaxed") r.bankTimer = setTimeout(() => run === r && showBank(false), 7000); }
}

function loop(now) {
  const r = run; if (!r) return;
  const dt = Math.min(0.05, (now - r.last) / 1000); r.last = now;
  if (!r.frozen && !document.querySelector(".scrim")) {
    const H = r.field.clientHeight;
    const slowF = r.slow > 0 ? 0.35 : 1;
    if (r.slow > 0) { r.slow -= dt; if (r.slow <= 0) r.field.classList.remove("slowmo"); }
    for (const it of [...r.items]) {
      const max = H - it.el.offsetHeight - 14;
      it.y = Math.min(max, it.y + H * r.speed * slowF * dt);
      it.el.style.transform = `translateY(${it.y}px)`;
      if (it.y >= max) {
        if (r.mode === "relaxed") it.el.classList.add("waiting");
        else { landed(it); break; }
      }
    }
    if (r.mode === "challenge") {
      r.spawnT += dt;
      const maxActive = innerWidth >= 720 ? 3 : 2;
      const gap = Math.max(2.2, 5 - r.correct * 0.12);
      if (r.items.length < maxActive && r.spawnT > gap && r.items.every((i) => i.y > i.el.offsetHeight + 20)) { r.spawnT = 0; spawn(); }
      if (!r.items.length) spawn();
    }
  }
  raf = requestAnimationFrame(loop);
}

function matchItem(text, strict) {
  const v = norm(text); if (v.length < 2) return null;
  let best = null;
  for (const it of run.items) {
    const t = norm(it.card.term);
    if (v === t) return { it, exact: true };
    if (!strict) continue;
    const allow = run.mode === "relaxed" ? Math.max(1, Math.floor(t.length / 5)) : (t.length >= 6 ? 1 : 0);
    const d = editDistance(v, t);
    if (d <= allow && (!best || d < best.d)) best = { it, exact: false, d };
  }
  return best;
}

function submit(strict) {
  const r = run; if (!r || r.frozen) return;
  const m = matchItem(r.input.value, strict);
  if (m) return clear(m.it, m.exact);
  if (strict && r.input.value.trim()) {
    r.wrongTries++; sfx.bad();
    r.input.classList.remove("shake"); void r.input.offsetWidth; r.input.classList.add("shake");
    r.msg.textContent = r.wrongTries >= 2 ? "Not quite. Try a suggestion, or tap 🙈 to see the answer." : "Not quite — check the spelling and try again.";
  }
}

async function clear(it, exact) {
  const r = run;
  r.items = r.items.filter((x) => x !== it);
  r.correct++; r.n++;
  const height = 1 - it.y / Math.max(1, r.field.clientHeight);
  const noHelp = !r.bankOpen;
  const pts = 100 + Math.round(60 * Math.max(0, height)) - (exact ? 0 : 20) + (noHelp ? 50 : 0);
  r.score += pts; r.deck.hit(it.card); r.power.add(1);
  app.earn(exact ? 3 : 2);
  const b = it.el.getBoundingClientRect();
  app.floater(b.left + b.width / 2, b.top + 10, "+" + pts);
  laser(it.el);
  it.el.classList.add("cleared"); setTimeout(() => it.el.remove(), 400);
  if (noHelp) app.toast("🎯 No-help bonus +50", 1200);
  sfx.good();
  r.input.value = ""; paintBank();
  r.msg.replaceChildren(exact ? h("span", { class: "okw" }, "✓ " + it.card.term) : h("span", {}, "Close enough! It's spelled ", h("b", { class: "okw" }, it.card.term)));
  if (r.mode === "challenge" && r.correct % 5 === 0) r.speed *= 1.12;
  paintHud();
  if (r.mode === "relaxed") {
    if (r.n >= ROUND) { await wait(900); return finish(); }
    await wait(exact ? 500 : 1400);
    if (run) spawn();
  } else if (!r.items.length) spawn();
}

async function landed(it) {
  const r = run;
  r.items = r.items.filter((x) => x !== it);
  it.el.classList.add("crash"); setTimeout(() => it.el.remove(), 400); paintBank();
  r.hearts--; r.n++; r.missed.push(it.card); r.deck.miss(it.card); sfx.bad(); paintHud();
  r.frozen = true;
  await app.learn(it.card, { title: "That one landed", note: `${r.hearts} ${r.hearts === 1 ? "heart" : "hearts"} left.` });
  if (!run) return;
  r.frozen = false; r.last = performance.now();
  if (r.hearts <= 0) return finish();
  r.input.focus({ preventScroll: true });
}

async function showMe() {
  const r = run; if (!r || !r.items.length) return;
  const it = r.items.reduce((a, b) => (a.y > b.y ? a : b));
  r.frozen = true;
  r.items = r.items.filter((x) => x !== it); it.el.remove(); paintBank();
  r.n++; r.missed.push(it.card); r.deck.miss(it.card);
  if (r.mode === "challenge") r.hearts--;
  paintHud();
  await app.learn(it.card, { title: "Here's the answer", note: "It will come back later for another try." });
  if (!run) return;
  r.frozen = false; r.last = performance.now(); r.input.value = ""; r.msg.textContent = "";
  if ((r.mode === "relaxed" && r.n >= ROUND) || r.hearts <= 0) return finish();
  if (!r.items.length) spawn();
  r.input.focus({ preventScroll: true });
}

function hideBank() { const r = run; r.bankOpen = false; r.sugg.hidden = true; r.bankBtn.hidden = false; fit(); }
function showBank(asked) {
  const r = run; if (!r || r.bankOpen) return;
  if (asked && r.mode === "challenge") r.score = Math.max(0, r.score - 20);
  r.bankOpen = true; r.sugg.hidden = false; r.bankBtn.hidden = true; paintBank(); paintHud(); fit();
  if (!asked) app.toast("💡 Here's a word bank to help", 1400);
}
/* Laser from the city cannon to the meteor, then an explosion. */
function laser(target) {
  const r = run, f = r.field.getBoundingClientRect(), t = target.getBoundingClientRect();
  const x0 = f.width / 2, y0 = f.height - 16, x1 = t.left - f.left + t.width / 2, y1 = t.top - f.top + t.height / 2;
  const len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
  const beam = h("i", { class: "beam", style: `left:${x0}px;top:${y0}px;width:${len}px;transform:rotate(${ang}deg)` });
  const boom = h("i", { class: "boom", style: `left:${x1}px;top:${y1}px` });
  r.field.append(beam, boom);
  setTimeout(() => { beam.remove(); boom.remove(); }, 600);
}

/* Word bank: always 5 terms, including the answer for every falling meaning. */
function paintBank() {
  const r = run; if (!r || !r.bankOpen) return;
  const need = r.items.map((i) => i.card);
  const keep = (r.bankCards || []).filter((c) => need.includes(c) || Math.random() < 0.5);
  let pool = [...new Set([...need, ...keep])];
  if (pool.length < 5) pool = pool.concat(pickDistractors(r.cards, need[0] ? need[0].id : "", 12).filter((c) => !pool.some((p) => p.term === c.term)).slice(0, 5 - pool.length));
  r.bankCards = shuffle(pool.slice(0, Math.max(5, need.length)));
  r.sugg.replaceChildren(...r.bankCards.map((c) => h("button", { class: "sg", type: "button",
    onmousedown: (e) => e.preventDefault(),
    onclick: (e) => {
      unlockAudio();
      const hit = r.items.find((i) => i.card.term === c.term);
      if (hit) return clear(hit, true);
      const b = e.currentTarget; r.wrongTries++; sfx.bad(); b.classList.add("nope"); setTimeout(() => b.classList.remove("nope"), 400);
      r.msg.textContent = "That word doesn't match a falling meaning. Try another.";
    } }, c.term)));
}

function paintSugg() {
  const r = run, v = norm(r.input.value);
  if (v.length < 2) { r.sugg.replaceChildren(); return; }
  const terms = [...new Set(r.cards.map((c) => c.term))];
  const scored = terms.map((t) => { const n = norm(t); return { t, s: n.startsWith(v) ? 0 : n.includes(v) ? 1 : editDistance(v, n.slice(0, v.length)) + 1 }; })
    .filter((x) => x.s <= (v.length >= 4 ? 2 : 1)).sort((a, b) => a.s - b.s || a.t.length - b.t.length).slice(0, r.mode === "relaxed" ? 3 : 2);
  r.sugg.replaceChildren(...scored.map(({ t }) => h("button", { class: "sg", type: "button",
    onmousedown: (e) => e.preventDefault(), onclick: () => { r.input.value = t; submit(true); r.input.focus({ preventScroll: true }); } }, t)));
}

function finish() {
  const r = run; stop();
  document.activeElement && document.activeElement.blur();
  app.results({ score: r.score, correct: r.correct, total: r.n, missed: r.missed });
}

function demo(el) {
  el.classList.add("r-demo");
  el.append(h("div", { class: "rd-card" }, "what starts and guides goal behavior"),
    h("div", { class: "rd-input" }, h("span", { class: "rd-type" }, "motivation")));
}
