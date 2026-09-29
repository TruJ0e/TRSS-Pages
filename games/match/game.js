/* Memory Match — a 5×5 board hiding a picture.
 *
 * 12 term/meaning pairs plus a ⭐ bonus square in the middle. Flip two
 * cards: their full text appears in the big reading panel above the board
 * (tiles are small, the panel is not). A matching pair vanishes and uncovers
 * part of the hidden picture. Clear the board to reveal the whole scene.
 * Wrong pairs stay face-up until the player taps on, so there's time to read.
 * Relaxed: no clock. Challenge: the clock runs and fewer flips score more.
 */
import { createApp, shuffle, h, wait, defOf, say, sfx, stopSpeak, powerMeter, sayBtn } from "../common/kit.js?v=11";

const PAIRS = 12;
let run = null, clock = 0;

const app = createApp({
  id: "match", title: "Memory Match", emoji: "🃏",
  tagline: "Match every pair to uncover the hidden picture!",
  steps: ["Blue cards are terms. Green cards are meanings.",
          "Flip one of each — the reading panel shows their full text.",
          "A matching pair disappears and uncovers part of the hidden picture. Clear the board to see it all!"],
  modes: { relaxed: "12 pairs. No clock.", challenge: "12 pairs. Beat the clock." },
  minCards: 6, demo,
  onStart: begin,
  onPause: () => run && (run.frozen = true),
  onResume: () => run && (run.frozen = false),
  onQuit: stop,
});

function stop() { clearInterval(clock); run = null; }

const SCENES = ["mountains", "reef", "space", "castle"];
const SCENE_NAMES = { mountains: "Sunset Mountains", reef: "Coral Reef", space: "Deep Space", castle: "Dragon Castle" };

function begin({ cards, mode, focus }) {
  stop();
  const uniq = [...(focus || []), ...shuffle(cards)].filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
  const picked = shuffle(uniq).slice(0, Math.min(PAIRS, uniq.length));
  const pairs = picked.length;
  const deck = shuffle(picked.flatMap((c) => [{ card: c, kind: "term", text: c.term }, { card: c, kind: "meaning", text: defOf(c) }]));
  // 5×5 board: 24 cards around a ⭐ bonus square in the centre
  const cells = deck.slice(0, 24);
  while (cells.length < 24) cells.push({ blank: true });
  cells.splice(12, 0, { bonus: true });
  const scene = SCENES[(Math.random() * SCENES.length) | 0];
  run = { mode, pairs, cells, open: [], wrong: null, found: 0, moves: 0, secs: 0, missed: [], frozen: false, combo: 0, scene };

  run.hud = h("div", { class: "hud" });
  run.panel = h("div", { class: "rpanel", "aria-live": "polite" });
  const canvas = h("canvas", { class: "pic", "aria-hidden": "true" });
  const grid = h("div", { class: "board5" });
  run.board = h("div", { class: "boardwrap" }, canvas, grid);
  cells.forEach((t) => {
    if (t.blank) { t.done = true; t.el = h("span", { class: "cell gone" }); grid.append(t.el); return; }
    if (t.bonus) { t.el = h("button", { class: "cell bonus", type: "button", "aria-label": "Bonus star", onclick: () => bonus(t) }, "⭐"); grid.append(t.el); return; }
    t.el = h("button", { class: "cell " + t.kind, type: "button", "aria-label": `${t.kind === "term" ? "Term" : "Meaning"} card, face down`, onclick: () => flip(t) },
      h("span", { class: "mk" }, t.kind === "term" ? "T" : "M"), h("span", { class: "peek" }, t.kind === "term" ? t.text : t.text.split(" ").slice(0, 3).join(" ") + "…"));
    grid.append(t.el);
  });
  run.power = powerMeter({ max: 3, icon: "👁", label: "Peek", onUse: peek });
  app.stage.replaceChildren(run.hud, run.panel, run.board, run.power.el);
  paintPanel();
  requestAnimationFrame(() => paintScene(canvas, scene));
  clock = setInterval(() => { if (run && !run.frozen) { run.secs++; if (run.mode === "challenge") paintHud(); } }, 1000);
  paintHud();
}

function paintHud() {
  const r = run;
  const kids = [h("div", { class: "progress" }, h("i", { style: `width:${(r.found / r.pairs) * 100}%` })),
    h("span", { class: "chip" }, "✓ ", h("b", {}, r.found), " / " + r.pairs),
    h("span", { class: "chip" }, "Flips ", h("b", {}, r.moves)), app.coinChip()];
  if (r.mode === "challenge") kids.push(h("span", { class: "chip" }, "⏱ ", h("b", {}, Math.floor(r.secs / 60) + ":" + String(r.secs % 60).padStart(2, "0"))));
  if (r.combo >= 2) kids.push(h("span", { class: "chip hot" }, "🔥 ", h("b", {}, r.combo)));
  r.hud.replaceChildren(...kids);
}

/* The reading panel: the full text of up to two open cards. */
function paintPanel(msg) {
  const r = run;
  const cards = r.wrong || r.open;
  const hint = (i) => i === 0 ? "Tap any card to flip it" : cards[0] ? (cards[0].kind === "term" ? "Now find its meaning (green)" : "Now find its term (blue)") : "…then flip its partner";
  const slot = (t, i) => t
    ? h("div", { class: "rslot " + t.kind + (r.wrong ? " bad" : "") }, h("div", { class: "label" }, h("span", {}, t.kind === "term" ? "Term" : "Meaning"), sayBtn(t.text, "")), h("div", { class: "rtxt" }, t.text))
    : h("div", { class: "rslot empty" }, h("span", {}, hint(i)));
  r.panel.replaceChildren(slot(cards[0], 0), slot(cards[1], 1), h("div", { class: "rmsg" }, msg || ""));
}

function turnBack() {
  const r = run;
  for (const t of r.wrong) { t.el.classList.remove("up", "bad"); t.el.setAttribute("aria-label", `${t.kind} card, face down`); }
  r.wrong = null; r.open = [];
  paintPanel();
}

async function flip(t) {
  const r = run; if (!r || r.frozen || t.done) return;
  if (r.wrong) { turnBack(); if (t.el.classList.contains("up")) return; }
  if (r.open.includes(t)) return;
  if (r.open.length === 1 && r.open[0].kind === t.kind) {
    t.el.classList.remove("nudge"); void t.el.offsetWidth; t.el.classList.add("nudge");
    paintPanel(t.kind === "term" ? "You already have a term open — pick a green MEANING card." : "You already have a meaning open — pick a blue TERM card.");
    sfx.tap(); return;
  }
  sfx.tap();
  t.el.classList.add("up"); t.el.setAttribute("aria-label", t.kind + ": " + t.text);
  r.open.push(t);
  paintPanel();
  say(t.text);
  if (r.open.length < 2) return;

  r.moves++; paintHud();
  const [a, b] = r.open;
  if (a.card.id === b.card.id) {
    a.done = b.done = true; r.found++; r.combo++;
    r.open = [];
    await wait(450);
    if (!run) return;
    a.el.classList.add("good"); b.el.classList.add("good");
    setTimeout(() => { a.el.classList.add("gone"); b.el.classList.add("gone"); }, 350);
    sfx.good(); r.power.add(1);
    const bb = b.el.getBoundingClientRect(); app.earn(r.combo >= 3 ? 5 : 3, bb.left + bb.width / 2, bb.top);
    paintPanel(r.combo >= 3 ? `🔥 ${r.combo} in a row! ${a.card.term} ✓` : `✓ ${a.card.term} — matched!`);
    paintHud();
    if (r.found === r.pairs) finishBoard();
  } else {
    r.wrong = [a, b]; r.combo = 0; r.open = [];
    a.el.classList.add("bad"); b.el.classList.add("bad"); sfx.bad();
    if (!r.missed.includes(a.card)) r.missed.push(a.card);
    paintPanel("Not a pair. Read them both, then tap any card to keep going.");
    paintHud();
  }
}

function bonus(t) {
  const r = run; if (!r || t.done) return;
  t.done = true; t.el.classList.add("good");
  setTimeout(() => t.el.classList.add("gone"), 300);
  const b = t.el.getBoundingClientRect(); app.earn(5, b.left + b.width / 2, b.top);
  sfx.power(); r.power.add(1);
}

async function peek() {
  const r = run; if (!r) return;
  if (r.wrong) turnBack();
  const hidden = r.cells.filter((t) => !t.done && !t.bonus && !r.open.includes(t));
  r.frozen = true;
  hidden.forEach((t) => t.el.classList.add("up", "peeking"));
  paintPanel("👁 Peek! Remember where they are…");
  await wait(2200);
  hidden.forEach((t) => t.el.classList.remove("up", "peeking"));
  if (run) { r.frozen = false; paintPanel(); }
}

async function finishBoard() {
  const r = run;
  r.cells.forEach((t) => t.el.classList.add("gone"));
  await wait(500);
  r.board.classList.add("revealed");
  r.panel.replaceChildren(h("div", { class: "rslot reveal" }, h("div", { class: "label" }, "Picture revealed!"), h("div", { class: "rtxt" }, "🖼 " + SCENE_NAMES[r.scene])));
  sfx.win(); app.confetti();
  await wait(2400);
  if (run !== r) return;
  stop(); stopSpeak();
  const extra = Math.max(0, r.moves - r.pairs);
  const score = r.mode === "challenge" ? Math.max(0, 3000 - extra * 40 - r.secs * 3) : Math.max(0, r.pairs * 150 - extra * 15);
  app.results({ score, correct: r.pairs, total: r.moves, missed: r.missed.slice(0, 6), extra: [[r.moves, "flips"]], title: "Picture complete!" });
}

/* ------------------------------------------------------ hidden pictures */
function paintScene(cv, scene) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const g = (y0, y1, stops) => { const gr = c.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, col]) => gr.addColorStop(o, col)); return gr; };
  c.textAlign = "center"; c.textBaseline = "middle";
  if (scene === "mountains") {
    c.fillStyle = g(0, H, [[0, "#2b1055"], [.45, "#d6456a"], [.7, "#ffb36b"]]); c.fillRect(0, 0, W, H);
    c.fillStyle = "#fff1c4"; c.beginPath(); c.arc(W * .7, H * .42, W * .11, 0, 6.29); c.fill();
    [["#6b2f5b", .6, .22], ["#45204a", .7, .18], ["#2a1636", .82, .14]].forEach(([col, base, amp], k) => {
      c.fillStyle = col; c.beginPath(); c.moveTo(0, H);
      for (let x = 0; x <= W; x += W / 8) c.lineTo(x, H * base - Math.abs(Math.sin(x / W * 5 + k * 2)) * H * amp);
      c.lineTo(W, H); c.fill();
    });
    c.fillStyle = "#1a1025"; for (let i = 0; i < 9; i++) { const x = rnd(0, W), y = H * .95; c.beginPath(); c.moveTo(x, y - 40); c.lineTo(x - 12, y); c.lineTo(x + 12, y); c.fill(); }
    c.font = `${W * .09}px sans-serif`; c.fillText("🦅", W * .25, H * .25);
  } else if (scene === "reef") {
    c.fillStyle = g(0, H, [[0, "#0ea5e9"], [.6, "#0369a1"], [1, "#0c4a6e"]]); c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(255,255,255,.12)"; for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(rnd(0, W), 0); c.lineTo(rnd(0, W), H * .7); c.lineTo(rnd(0, W), H * .7); c.fill(); }
    c.fillStyle = "#fcd34d"; c.fillRect(0, H * .86, W, H * .14);
    const coral = ["#f472b6", "#fb923c", "#a78bfa", "#f87171"];
    for (let i = 0; i < 8; i++) { c.fillStyle = coral[i % 4]; const x = rnd(0, W); for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(x + rnd(-14, 14), H * .86 - k * 12 - rnd(0, 10), rnd(5, 10), 0, 6.29); c.fill(); } }
    c.font = `${W * .1}px sans-serif`; ["🐠", "🐟", "🐡", "🐢", "🦈", "🐙"].forEach((f, i) => c.fillText(f, W * (.15 + (i % 3) * .33), H * (.2 + Math.floor(i / 3) * .3) + rnd(-10, 10)));
  } else if (scene === "space") {
    c.fillStyle = g(0, H, [[0, "#020617"], [1, "#1e1b4b"]]); c.fillRect(0, 0, W, H);
    for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(255,255,255,${rnd(.3, 1)})`; c.fillRect(rnd(0, W), rnd(0, H), rnd(.5, 2), rnd(.5, 2)); }
    const neb = c.createRadialGradient(W * .3, H * .35, 5, W * .3, H * .35, W * .5); neb.addColorStop(0, "rgba(236,72,153,.45)"); neb.addColorStop(1, "rgba(236,72,153,0)"); c.fillStyle = neb; c.fillRect(0, 0, W, H);
    const pl = c.createRadialGradient(W * .65, H * .55, 5, W * .7, H * .6, W * .22); pl.addColorStop(0, "#fde68a"); pl.addColorStop(1, "#b45309"); c.fillStyle = pl; c.beginPath(); c.arc(W * .7, H * .6, W * .2, 0, 6.29); c.fill();
    c.strokeStyle = "rgba(253,230,138,.7)"; c.lineWidth = 4; c.beginPath(); c.ellipse(W * .7, H * .6, W * .32, W * .07, -.3, 0, 6.29); c.stroke();
    c.font = `${W * .12}px sans-serif`; c.fillText("🚀", W * .2, H * .78); c.fillText("🛸", W * .78, H * .18); c.fillText("👩‍🚀", W * .3, H * .3);
  } else {
    c.fillStyle = g(0, H, [[0, "#1e1b4b"], [.6, "#7c3aed"], [1, "#f97316"]]); c.fillRect(0, 0, W, H);
    c.fillStyle = "#1c1333"; c.fillRect(W * .25, H * .45, W * .5, H * .55);
    for (const x of [.2, .45, .7]) { c.fillRect(W * x, H * .3, W * .1, H * .7); c.beginPath(); c.moveTo(W * x - 6, H * .3); c.lineTo(W * (x + .05), H * .16); c.lineTo(W * (x + .1) + 6, H * .3); c.fill(); }
    c.fillStyle = "#fbbf24"; for (let i = 0; i < 10; i++) c.fillRect(W * rnd(.28, .7), H * rnd(.5, .9), 5, 8);
    c.font = `${W * .24}px sans-serif`; c.fillText("🐉", W * .2, H * .22);
    c.fillStyle = "#2a1f45"; c.beginPath(); c.moveTo(0, H); c.quadraticCurveTo(W * .5, H * .78, W, H); c.fill();
  }
}

function demo(el) {
  el.classList.add("m-demo");
  el.append(h("i", { class: "d1" }, "drive"), h("i", { class: "d2" }, "an inner push toward a need"), h("i", { class: "d3" }), h("i", { class: "d4" }));
}
