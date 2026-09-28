/* True or False — does this meaning belong to this term?
 *
 * Relaxed: 10 statements, no clock. Challenge: 60 seconds, streak bonus.
 * A wrong answer opens the Learn-it card (the clock stops while it's open).
 */
import { createApp, makeDeck, pickDistractors, shuffle, h, wait, defOf, say, sfx, sayBtn, powerMeter } from "../common/kit.js?v=9";

const ROUND = 10, SECONDS = 60;
let run = null, timer = 0;

const app = createApp({
  id: "blitz", title: "True or False", emoji: "⚡",
  tagline: "Does this meaning go with this term? Decide true or false.",
  steps: ["Read the term and the meaning under it.",
          "Tap ✓ True if they go together.",
          "Tap ✗ False if the meaning belongs to a different term."],
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
  app.stage.replaceChildren(run.hud, run.power.el, run.body);
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
    const b = btn.getBoundingClientRect(); app.floater(b.left + b.width / 2, b.top, "+" + pts);
    paintHud(); await wait(550);
  } else {
    r.streak = 0; r.deck.miss(r.q.card); r.missed.push(r.q.card);
    btn.classList.add("picked-bad"); sfx.bad(); paintHud();
    r.body.querySelector(".statement").classList.add("buzz");
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

function finish() {
  const r = run; stop();
  app.results({ score: r.score, correct: r.correct, total: r.n, missed: r.missed,
    extra: [[r.best, "best streak"]] });
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
