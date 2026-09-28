/* Memory Match — pair each TERM card with its MEANING card.
 *
 * Card backs say TERM or MEANING so players know what they're flipping.
 * A wrong pair stays face-up until the player taps to continue, so there's
 * always time to read. Relaxed: 4 pairs, no clock. Challenge: 6 pairs + clock.
 */
import { createApp, shuffle, h, wait, defOf, say, sfx, stopSpeak, powerMeter } from "../common/kit.js?v=6";

let run = null, clock = 0;

const app = createApp({
  id: "match", title: "Memory Match", emoji: "🃏",
  tagline: "Munch the monster is hungry! Feed it matching pairs.",
  steps: ["Blue cards are terms. Green cards are meanings.",
          "Flip one of each. A matching pair gets fed to Munch!",
          "Find the ✨ golden pair for bonus coins. Keep a combo going to make Munch dance."],
  modes: { relaxed: "4 pairs. No clock.", challenge: "6 pairs. Beat the clock." },
  minCards: 6, demo,
  onStart: begin,
  onPause: () => run && (run.frozen = true),
  onResume: () => run && (run.frozen = false),
  onQuit: stop,
});

function stop() { clearInterval(clock); run = null; }

function begin({ cards, mode, focus }) {
  stop();
  const pairs = mode === "relaxed" ? 4 : 6;
  const picked = shuffle([...(focus || []), ...shuffle(cards)].filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i)).slice(0, pairs);
  const tiles = shuffle(picked.flatMap((c) => [{ card: c, kind: "term", text: c.term }, { card: c, kind: "meaning", text: defOf(c) }]));
  run = { mode, pairs, tiles, open: [], wrong: null, found: 0, moves: 0, secs: 0, missed: [], frozen: false };

  run.hud = h("div", { class: "hud" });
  run.hint = h("p", { class: "mhint", role: "status" }, "Flip a blue term card and a green meaning card.");
  const grid = h("div", { class: "mgrid" + (pairs === 4 ? " four" : "") });
  tiles.forEach((t, i) => {
    t.el = h("button", { class: "mtile " + t.kind, type: "button", "aria-label": `${t.kind === "term" ? "Term" : "Meaning"} card ${i + 1}, face down`, onclick: () => flip(t) },
      h("span", { class: "inner" },
        h("span", { class: "face back" }, h("span", { class: "mk" }, t.kind === "term" ? "T" : "M"), h("span", { class: "kind" }, t.kind === "term" ? "TERM" : "MEANING")),
        h("span", { class: "face front" }, h("span", { class: "kind" }, t.kind === "term" ? "TERM" : "MEANING"), h("span", { class: "txt" }, t.text))));
    grid.append(t.el);
  });
  run.power = powerMeter({ max: 2, icon: "👁", label: "Peek", onUse: peek });
  run.combo = 0;
  run.munch = h("div", { class: "munch", "aria-hidden": "true" },
    h("div", { class: "mbody" }, h("i", { class: "eye l" }), h("i", { class: "eye r" }), h("i", { class: "mouth" }), h("i", { class: "belly" })),
    h("div", { class: "bubble" }, "I'm hungry!"));
  const gold = tiles[(Math.random() * tiles.length) | 0].card.id;
  tiles.forEach((t) => { if (t.card.id === gold) { t.gold = true; t.el.classList.add("gold"); } });
  app.stage.replaceChildren(run.hud, run.munch, run.power.el, run.hint, grid);
  clock = setInterval(() => { if (run && !run.frozen) { run.secs++; paintHud(); } }, 1000);
  paintHud();
}

function paintHud() {
  const r = run;
  const kids = [h("div", { class: "progress" }, h("i", { style: `width:${(r.found / r.pairs) * 100}%` })),
    h("span", { class: "chip" }, "✓ ", h("b", {}, r.found), " / " + r.pairs),
    h("span", { class: "chip" }, "Flips ", h("b", {}, r.moves)), app.coinChip()];
  if (r.mode === "challenge") kids.push(h("span", { class: "chip" }, "⏱ ", h("b", {}, Math.floor(r.secs / 60) + ":" + String(r.secs % 60).padStart(2, "0"))));
  r.hud.replaceChildren(...kids);
}

function turnBack() {
  const r = run;
  for (const t of r.wrong) { t.el.classList.remove("up", "bad"); t.el.setAttribute("aria-label", `${t.kind} card, face down`); }
  r.wrong = null; r.open = [];
  r.hint.textContent = "Try another pair.";
}

async function flip(t) {
  const r = run; if (!r || r.frozen || t.done) return;
  if (r.wrong) { turnBack(); if (t.el.classList.contains("up")) return; }
  if (r.open.includes(t)) return;
  if (r.open.length === 1 && r.open[0].kind === t.kind) {
    r.hint.textContent = t.kind === "term" ? "You have a term open. Now pick a green MEANING card." : "You have a meaning open. Now pick a blue TERM card.";
    t.el.classList.add("nudge"); setTimeout(() => t.el.classList.remove("nudge"), 400);
    sfx.tap(); return;
  }
  sfx.tap();
  t.el.classList.add("up"); t.el.setAttribute("aria-label", t.kind + ": " + t.text);
  r.open.push(t);
  say(t.text);
  if (r.open.length < 2) { r.hint.textContent = t.kind === "term" ? "Now find its meaning (green card)." : "Now find its term (blue card)."; return; }

  r.moves++; paintHud();
  const [a, b] = r.open;
  if (a.card.id === b.card.id) {
    a.done = b.done = true; r.open = []; r.found++; r.combo++;
    r.power.add(1);
    { const bb = b.el.getBoundingClientRect(); app.earn(r.combo >= 2 ? 5 : 3, bb.left + bb.width / 2, bb.top); }
    await wait(250);
    a.el.classList.add("good"); b.el.classList.add("good"); sfx.good();
    feed(a, b);
    r.hint.textContent = `✓ ${a.card.term} — matched!`;
    paintHud();
    if (r.found === r.pairs) { await wait(700); finish(); }
  } else {
    r.wrong = [a, b]; r.combo = 0;
    a.el.classList.add("bad"); b.el.classList.add("bad"); sfx.bad();
    mood("sad", ["Hmm, not a pair…", "Those don't go together!", "Blech, try again!"][(Math.random() * 3) | 0]);
    if (!r.missed.includes(a.card)) r.missed.push(a.card);
    r.hint.textContent = "Not a pair. Read them both, then tap any card to keep going.";
  }
}

function mood(m, text) {
  const r = run; if (!r) return;
  const el = r.munch; el.classList.remove("happy", "sad", "chomp", "dance"); void el.offsetWidth; el.classList.add(m);
  if (text) el.querySelector(".bubble").textContent = text;
}
function feed(a, b) {
  const r = run, mouth = r.munch.querySelector(".mouth").getBoundingClientRect();
  for (const t of [a, b]) {
    const from = t.el.getBoundingClientRect();
    const ghost = h("div", { class: "ghostcard " + t.kind }, t.kind === "term" ? t.text : "✓");
    Object.assign(ghost.style, { left: from.left + "px", top: from.top + "px", width: from.width + "px", height: from.height + "px" });
    document.body.append(ghost);
    ghost.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${mouth.left + mouth.width / 2 - from.left - from.width / 2}px, ${mouth.top - from.top - from.height / 2}px) scale(.1) rotate(200deg)`, opacity: .6 }],
      { duration: 650, easing: "cubic-bezier(.5,0,.7,.4)", fill: "forwards" }).finished.then(() => ghost.remove());
  }
  setTimeout(() => {
    if (!run) return;
    const lines = r.combo >= 3 ? ["🔥 Combo! Yum yum!", "I LOVE this!", "More more more!"] : ["Yum!", "Delicious!", "Tasty term!", "Mmm, " + a.card.term + "!"];
    mood(r.combo >= 3 ? "dance" : "chomp", lines[(Math.random() * lines.length) | 0]);
    r.munch.style.setProperty("--grow", 1 + r.found * 0.06);
    if (a.gold) { const m = r.munch.getBoundingClientRect(); app.earn(8, m.left + m.width / 2, m.top); app.toast("✨ Golden pair! +8 coins"); }
  }, 600);
}

async function peek() {
  const r = run; if (!r) return;
  if (r.wrong) turnBack();
  const hidden = r.tiles.filter((t) => !t.done && !r.open.includes(t));
  r.frozen = true;
  hidden.forEach((t) => t.el.classList.add("up", "peek"));
  r.hint.textContent = "👁 Peek! Remember where they are…";
  await wait(1800);
  hidden.forEach((t) => t.el.classList.remove("up", "peek"));
  if (run) { r.frozen = false; r.hint.textContent = "Now find the pairs!"; }
}

function finish() {
  const r = run;
  mood("dance", "BURP! 😋 Thanks for the feast!"); sfx.win();
  setTimeout(() => finishNow(r), 1300);
}
function finishNow(r) {
  if (run !== r) return; stop(); stopSpeak();
  const extra = Math.max(0, r.moves - r.pairs);
  const score = r.mode === "challenge" ? Math.max(0, 1500 - extra * 40 - r.secs * 3) : Math.max(0, r.pairs * 150 - extra * 20);
  app.results({ score, correct: r.pairs, total: r.moves, missed: r.missed.slice(0, 6),
    extra: [[r.moves, "flips"]], title: "All matched!" });
}

function demo(el) {
  el.classList.add("m-demo");
  el.append(h("i", { class: "d1" }, "drive"), h("i", { class: "d2" }, "an inner push toward a need"), h("i", { class: "d3" }), h("i", { class: "d4" }));
}
