/* True or False — does this meaning belong to this term?
 *
 * Relaxed: 10 statements, no clock. Challenge: 60 seconds, streak bonus.
 * A wrong answer opens the Learn-it card (the clock stops while it's open).
 */
import { createApp, makeDeck, pickDistractors, shuffle, h, wait, defOf, say, sfx, sayBtn, powerMeter } from "../common/kit.js?v=10";

const ROUND = 10, SECONDS = 60;
let run = null, timer = 0;

const app = createApp({
  id: "blitz", title: "True or False", emoji: "⚡",
  tagline: "Answer right to crack the egg. What will hatch? A dragon? A unicorn?",
  steps: ["Read the term and the meaning under it.",
          "Tap ✓ True if they go together, ✗ False if they don't.",
          "Every right answer cracks the egg. Three cracks and a creature hatches for your collection!"],
  modes: { relaxed: "10 questions. No clock.", challenge: "60 seconds. Build a streak." },
  minCards: 4, demo,
  onStart: begin,
  onPause: () => run && (run.frozen = true),
  onResume: () => run && (run.frozen = false),
  onQuit: stop,
});

function stop() { clearInterval(timer); run = null; }

function begin({ cards, mode, focus }) {
  stop();
  run = { mode, cards, deck: makeDeck(focus ? shuffle([...focus, ...cards]).slice(0, Math.max(ROUND, focus.length)) : cards),
          n: 0, correct: 0, score: 0, streak: 0, best: 0, missed: [], left: SECONDS, frozen: false, busy: false };
  run.hud = h("div", { class: "hud" });
  run.body = h("div", { class: "tf show" });
  run.double = 0; run.freeze = 0;
  run.power = powerMeter(mode === "challenge"
    ? { max: 4, icon: "❄️", label: "Freeze 10s", onUse: () => { run.freeze = 10; app.toast("❄️ Clock frozen for 10 seconds!"); paintHud(); } }
    : { max: 4, icon: "✨", label: "Double ×3", onUse: () => { run.double = 3; app.toast("✨ Next 3 right answers score double!"); paintHud(); } });
  run.hatched = [];
  run.eggBox = h("div", { class: "eggbox" });
  app.stage.replaceChildren(run.hud, run.eggBox, run.power.el, run.body);
  newEgg();
  if (mode === "challenge") timer = setInterval(tick, 1000);
  paintHud(); next();
}

function tick() {
  const r = run; if (!r || r.frozen || document.querySelector(".scrim")) return;
  if (r.freeze > 0) { r.freeze--; paintHud(); return; }
  r.left--; paintHud();
  if (r.left <= 0) finish();
}

function paintHud() {
  const r = run;
  const kids = r.mode === "relaxed"
    ? [h("div", { class: "progress" }, h("i", { style: `width:${(r.n / ROUND) * 100}%` })), h("span", { class: "chip" }, h("b", {}, Math.min(r.n + 1, ROUND)), " / " + ROUND)]
    : [h("div", { class: "progress timebar" + (r.left <= 10 ? " low" : "") }, h("i", { style: `width:${(r.left / SECONDS) * 100}%` })), h("span", { class: "chip" }, "⏱ ", h("b", {}, r.left + "s"))];
  kids.push(h("span", { class: "chip" }, "⭐ ", h("b", {}, r.score)), app.coinChip());
  if (r.freeze > 0) kids.push(h("span", { class: "chip hot" }, "❄️ " + r.freeze));
  if (r.double > 0) kids.push(h("span", { class: "chip hot" }, "✨×2 · " + r.double));
  if (r.streak >= 2) kids.push(h("span", { class: "chip hot" }, "🔥 ", h("b", {}, r.streak)));
  r.hud.replaceChildren(...kids);
}

function next() {
  const r = run; if (!r) return;
  if (r.mode === "relaxed" && r.n >= ROUND) return finish();
  const card = r.deck.next();
  let shown = card, isTrue = Math.random() < 0.5;
  if (!isTrue) {
    const d = pickDistractors(r.cards, card.id, 4).find((c) => defOf(c) !== defOf(card));
    if (d) shown = d; else isTrue = true;
  }
  r.q = { card, shown, isTrue };
  const tBtn = h("button", { class: "tfbtn yes", type: "button", onclick: () => answer(true) }, h("span", { class: "ic" }, "✓"), "True");
  const fBtn = h("button", { class: "tfbtn no", type: "button", onclick: () => answer(false) }, h("span", { class: "ic" }, "✗"), "False");
  r.btns = { tBtn, fBtn };
  r.body.replaceChildren(
    h("div", { class: "statement marquee" }, h("i", { class: "spot l", "aria-hidden": "true" }), h("i", { class: "spot r", "aria-hidden": "true" }), h("i", { class: "bulbs t", "aria-hidden": "true" }), h("i", { class: "bulbs b", "aria-hidden": "true" }),
      h("div", { class: "qcard term" }, h("div", { class: "label" }, h("span", {}, "Term"), sayBtn(card.term)), h("div", { class: "big termword" }, card.term)),
      h("div", { class: "means", "aria-hidden": "true" }, "means…"),
      h("div", { class: "qcard meaning" }, h("div", { class: "label" }, h("span", {}, "Meaning"), sayBtn(defOf(shown))), h("div", { class: "big" }, defOf(shown)))),
    h("div", { class: "tfrow" }, fBtn, tBtn));
  say([card.term, "means", defOf(shown)]);
}

async function answer(saysTrue) {
  const r = run; if (!r || r.busy || r.frozen) return;
  r.busy = true;
  const ok = saysTrue === r.q.isTrue;
  const btn = saysTrue ? r.btns.tBtn : r.btns.fBtn;
  r.btns.tBtn.disabled = r.btns.fBtn.disabled = true;
  r.n++;
  if (ok) {
    r.correct++; r.streak++; r.best = Math.max(r.best, r.streak);
    let pts = 100 + Math.min(r.streak - 1, 8) * 25;
    if (r.double > 0) { pts *= 2; r.double--; }
    r.score += pts; r.deck.hit(r.q.card); r.power.add(1);
    app.earn(r.streak % 5 === 0 ? 6 : 2);
    btn.classList.add("picked-good"); sfx.good();
    cheer(r.streak);
    crack();
    const b = btn.getBoundingClientRect(); app.floater(b.left + b.width / 2, b.top, "+" + pts);
    paintHud(); await wait(550);
  } else {
    r.streak = 0; r.deck.miss(r.q.card); r.missed.push(r.q.card);
    btn.classList.add("picked-bad"); sfx.bad(); paintHud();
    r.body.querySelector(".statement").classList.add("buzz");
    wobble();
    await wait(450);
    const note = r.q.isTrue
      ? "That meaning really did belong to this term, so the answer was TRUE."
      : `The meaning shown belongs to "${r.q.shown.term}", so the answer was FALSE.`;
    await app.learn(r.q.card, { note, title: r.q.isTrue ? "It was true" : "It was false" });
  }
  if (!run) return;
  r.busy = false;
  if (r.mode === "challenge" && r.left <= 0) return finish();
  if (!run) return;
  paintHud(); next();
}

async function finish() {
  const r = run; if (!r) return; stop();
  if (r.hatching) await r.hatching;
  app.results({ score: r.score, correct: r.correct, total: r.n, missed: r.missed,
    extra: [[r.best, "best streak"], [r.hatched.length, "hatched"]] });
  showCollection(r.hatched);
}

/* ================================================= eggs & creatures */
/* Every right answer cracks the egg; three cracks hatch a creature. Wrong
   answers only make the egg wobble — progress is never taken away. */
const COMMON = [["🐣", "Chick"], ["🐰", "Bunny"], ["🐼", "Panda"], ["🐨", "Koala"], ["🦊", "Fox cub"], ["🐧", "Penguin"], ["🦦", "Otter"],
  ["🐢", "Turtle"], ["🐙", "Octopus"], ["🦉", "Owlet"], ["🐱", "Kitten"], ["🐶", "Puppy"], ["🦥", "Sloth"], ["🦔", "Hedgehog"], ["🐹", "Hamster"], ["🦭", "Seal pup"]];
const RARE = [["🐉", "Dragon"], ["🐲", "Baby dragon"], ["🦄", "Unicorn"], ["🐦‍🔥", "Phoenix"], ["🦖", "T-rex"], ["🦕", "Long-neck dino"],
  ["🦑", "Kraken"], ["🐍", "Sea serpent"], ["🦅", "Griffin"], ["🧚", "Fairy"], ["🧜", "Merfolk"]];
const EGG_COLS = [["#fde68a", "#f59e0b"], ["#bfdbfe", "#3b82f6"], ["#fbcfe8", "#db2777"], ["#bbf7d0", "#16a34a"], ["#ddd6fe", "#7c3aed"], ["#fed7aa", "#ea580c"]];
const CRACKS = 3;
const loadDex = () => { try { return JSON.parse(localStorage.getItem("trss-creatures") || "{}"); } catch { return {}; } };
const saveDex = (d) => { try { localStorage.setItem("trss-creatures", JSON.stringify(d)); } catch {} };

function newEgg() {
  const r = run; if (!r) return;
  r.cracks = 0;
  const [a, b] = EGG_COLS[(Math.random() * EGG_COLS.length) | 0];
  r.egg = h("div", { class: "egg", style: `--ea:${a};--eb:${b}`, role: "img", "aria-label": "Egg: 0 of 3 cracks" },
    h("span", { class: "shine" }),
    h("span", { class: "cracks", html:
      '<svg viewBox="0 0 100 120"><path class="c1" d="M18 58 L30 50 L38 60 L50 52"/><path class="c2" d="M50 52 L60 62 L68 50 L82 58"/><path class="c3" d="M50 52 L47 70 L55 82 L50 98"/></svg>' }));
  const dots = h("div", { class: "eggdots" }, Array.from({ length: CRACKS }, () => h("i")));
  r.eggBox.replaceChildren(h("div", { class: "nest" }, r.egg), h("div", { class: "eggside" }, h("b", {}, "Crack the egg!"), h("span", {}, "Each right answer cracks it"), dots));
  r.dots = dots;
}
function crack() {
  const r = run; if (!r || !r.egg || r.cracks >= CRACKS) return;
  r.cracks++;
  r.egg.classList.remove("hit"); void r.egg.offsetWidth; r.egg.classList.add("hit", "c" + r.cracks);
  r.egg.setAttribute("aria-label", `Egg: ${r.cracks} of ${CRACKS} cracks`);
  [...r.dots.children].forEach((d, i) => d.classList.toggle("on", i < r.cracks));
  sfx.lock();
  if (r.cracks >= CRACKS) r.hatching = hatch();
}
function wobble() { const r = run; if (r && r.egg) { r.egg.classList.remove("wob"); void r.egg.offsetWidth; r.egg.classList.add("wob"); } }
async function hatch() {
  const r = run;
  const rare = Math.random() < Math.min(0.6, 0.22 + r.streak * 0.04);   // streaks make rare creatures likelier
  const pool = rare ? RARE : COMMON;
  const [emo, name] = pool[(Math.random() * pool.length) | 0];
  r.hatched.push({ emo, name, rare });
  const dex = loadDex(); dex[emo] = { name, n: ((dex[emo] && dex[emo].n) || 0) + 1, rare }; saveDex(dex);
  await wait(250);
  if (run !== r) return;
  r.egg.classList.add("burst");
  r.egg.parentElement.append(h("div", { class: "creature" + (rare ? " rare" : "") }, h("span", { class: "rays" }), h("span", { class: "emo" }, emo)));
  r.eggBox.querySelector(".eggside").replaceChildren(h("b", {}, rare ? "✨ RARE! A " + name + "!" : "It's a " + name + "!"), h("span", {}, rare ? "A mythical creature joins your collection" : "Added to your collection"));
  rare ? sfx.win() : sfx.power();
  app.earn(rare ? 10 : 4);
  await wait(1800);
  if (run === r) newEgg();
}
function showCollection(list) {
  const res = document.querySelector(".results"); if (!res) return;
  const dex = loadDex(), all = Object.keys(dex).length;
  const box = h("div", { class: "dexbox" },
    h("div", { class: "label" }, `Your creature collection · ${all} of ${COMMON.length + RARE.length} found`),
    h("div", { class: "dex" }, [...COMMON, ...RARE].map(([e, n]) => h("span", { class: "dexitem" + (dex[e] ? " got" : "") + (RARE.some((x) => x[0] === e) ? " rare" : ""), title: dex[e] ? n : "Not found yet" }, dex[e] ? e : "?"))),
    list.length ? h("p", { class: "dexnew" }, "Hatched this round: ", list.map((c) => c.emo).join(" ")) : null);
  res.querySelector(".statgrid").after(box);
}


document.addEventListener("keydown", (e) => {
  if (!run || document.querySelector(".scrim")) return;
  const k = e.key.toLowerCase();
  if (k === "t" || k === "arrowright") answer(true);
  if (k === "f" || k === "arrowleft") answer(false);
});

function demo(el) {
  el.classList.add("tf-demo");
  el.append(h("div", { class: "td-card" }, h("b", {}, "emotion"), h("span", {}, "a body reaction plus a feeling")),
    h("div", { class: "td-btns" }, h("i", { class: "n" }, "✗"), h("i", { class: "y" }, "✓")));
}

/* game-show feedback: spotlights flash, streak banners */
function cheer(streak) {
  const st = run && run.body.querySelector(".statement"); if (!st) return;
  st.classList.add("win");
  if (streak === 3 || streak === 5 || streak % 10 === 0) {
    const label = streak >= 10 ? "🏆 UNSTOPPABLE!" : streak >= 5 ? "🔥 ON FIRE!" : "⚡ HEATING UP!";
    const b = h("div", { class: "banner" }, label); run.body.append(b); setTimeout(() => b.remove(), 1300);
    sfx.win();
  }
}
