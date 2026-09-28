/* Term Drop — a term falls from the sky; tap the meaning it belongs to.
 *
 * Relaxed: 10 terms per round, the term floats down slowly and waits at the
 * bottom until you answer. Challenge: it keeps falling, gets faster, and a
 * term that lands unanswered costs one of 3 hearts.
 * Every meaning is shown in full (no truncation) as a big tap target.
 */
import { createApp, makeDeck, pickDistractors, shuffle, h, wait, defOf, say, sfx,
         answerList, reducedMotion } from "../common/kit.js?v=3";

const ROUND = 10;
let run = null, raf = 0;

const app = createApp({
  id: "drop", title: "Term Drop", emoji: "🧱",
  tagline: "Catch each falling term in the meaning it belongs to.",
  steps: ["A term block falls from the sky. Drag it left and right to catch ⭐ stars.",
          "Read the three meanings underneath.",
          "Tap the meaning that matches. The block drops into it."],
  modes: { relaxed: "10 terms. The block waits for you.", challenge: "Faster, with ✴ spikes to dodge. 3 hearts for wrong answers." },
  minCards: 4,
  demo,
  onStart: begin,
  onPause: () => { if (run) run.frozen = true; },
  onResume: () => { if (run) { run.frozen = false; run.last = performance.now(); } },
  onQuit: stop,
});

function stop() { cancelAnimationFrame(raf); run = null; }

function begin({ cards, mode, focus }) {
  stop();
  const deck = makeDeck(focus ? shuffle([...focus, ...cards]).slice(0, Math.max(ROUND, focus.length)) : cards);
  const pool = cards;
  run = { mode, deck, pool, n: 0, score: 0, streak: 0, correct: 0, hearts: 3, missed: [], frozen: false, last: 0, x: 0, stars: 0,
          shield: mode === "challenge" && app.has("boost-shield"), keys: { l: 0, r: 0 } };

  const hud = h("div", { class: "hud" });
  const sky = h("div", { class: "sky" }, h("div", { class: "stars-bg" }));
  const sk = app.skin("block");
  const tile = h("div", { class: "tile", "aria-live": "polite", style: `--ba:${sk.a};--bb:${sk.b}` });
  const ground = h("div", { class: "ground" });
  sky.append(tile, ground);
  const ask = h("div", { class: "ask" });
  app.stage.replaceChildren(hud, sky, ask);
  run.els = { hud, sky, tile, ask };
  // drag anywhere in the sky to steer the block
  const steerTo = (e) => { const b = sky.getBoundingClientRect(); run && (run.x = Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width - 0.5) * 2 / 0.75))); };
  sky.addEventListener("pointerdown", (e) => { run.drag = true; sky.setPointerCapture(e.pointerId); steerTo(e); });
  sky.addEventListener("pointermove", (e) => run && run.drag && steerTo(e));
  const end = () => run && (run.drag = false);
  sky.addEventListener("pointerup", end); sky.addEventListener("pointercancel", end);
  paintHud();
  next();
}

function paintHud() {
  const r = run;
  const left = r.mode === "relaxed"
    ? [h("div", { class: "progress", "aria-label": `Term ${Math.min(r.n + 1, ROUND)} of ${ROUND}` }, h("i", { style: `width:${(r.n / ROUND) * 100}%` })),
       h("span", { class: "chip" }, h("b", {}, Math.min(r.n + 1, ROUND)), " / " + ROUND)]
    : [h("span", { class: "chip", "aria-label": r.hearts + " hearts" }, "❤️".repeat(r.hearts) + "🤍".repeat(3 - r.hearts))];
  r.els.hud.replaceChildren(...[...left,
    h("span", { class: "chip" }, "⭐ ", h("b", {}, r.score)),
    app.coinChip(), r.shield ? h("span", { class: "chip" }, "🛡") : null,
    r.streak >= 2 ? h("span", { class: "chip hot" }, "🔥 ", h("b", {}, r.streak)) : null].filter(Boolean));
}

function next() {
  const r = run; if (!r) return;
  if (r.mode === "relaxed" && r.n >= ROUND) return finish();
  if (r.mode === "challenge" && r.hearts <= 0) return finish();
  const card = r.deck.next();
  const options = shuffle([card, ...pickDistractors(r.pool, card.id, 2)]);
  r.card = card; r.answered = false; r.y = 0; r.x = 0; r.px = 0;
  // scatter pickups through the sky: stars everywhere, spikes in Challenge
  r.els.sky.querySelectorAll(".pick").forEach((e) => e.remove());
  r.picks = [];
  const nStars = 3 + (Math.random() * 2 | 0), nSpikes = r.mode === "challenge" ? Math.min(3, 1 + (r.n / 4 | 0)) : 0;
  for (let i = 0; i < nStars + nSpikes; i++) {
    const spike = i >= nStars;
    const p = { x: Math.random() * 1.8 - 0.9, y: 0.3 + Math.random() * 0.55, spike, vx: spike ? (Math.random() < .5 ? -.25 : .25) : 0 };
    p.el = h("i", { class: "pick" + (spike ? " spike" : "") }, spike ? "✴" : "⭐");
    r.els.sky.insertBefore(p.el, r.els.tile); r.picks.push(p);
  }
  // Challenge speed: seconds to fall the whole sky, shrinking with progress.
  r.fallS = r.mode === "relaxed" ? 12 : Math.max(5, 11 - r.n * 0.35);

  const { tile, ask } = r.els;
  tile.className = "tile";
  tile.replaceChildren(h("span", { class: "tl" }, "TERM"), h("span", { class: "tt" }, card.term));
  tile.style.transform = "translate(-50%, 0)";
  ask.replaceChildren(
    h("div", { class: "label ask-label" }, "Which meaning matches?"),
    answerList(options.map((c) => ({ label: defOf(c), card: c })), { kind: "meaning", onPick: (o, btn, btns) => pick(o, btn, btns) }));
  say(card.term);
  sfx.whoosh();
  r.last = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

function loop(now) {
  const r = run; if (!r || r.answered) return;
  const dt = Math.min(0.05, (now - r.last) / 1000); r.last = now;
  if (!r.frozen) {
    const sky = r.els.sky, tile = r.els.tile;
    const skyH = sky.clientHeight - tile.offsetHeight - 18, skyW = sky.clientWidth, span = (skyW - tile.offsetWidth) / 2 - 8;
    r.y = Math.min(skyH, r.y + (skyH / r.fallS) * dt);
    const kd = (r.keys.r ? 1 : 0) - (r.keys.l ? 1 : 0);
    if (kd) r.x = Math.max(-1, Math.min(1, r.x + kd * dt * 1.8));
    r.px = r.px == null ? 0 : r.px + (r.x * span - r.px) * Math.min(1, dt * 12);
    tile.style.transform = `translate(calc(-50% + ${r.px}px), ${r.y}px)`;
    // pickups
    const tx = skyW / 2 + r.px, ty = r.y + 12 + tile.offsetHeight / 2, hw = tile.offsetWidth / 2 + 10, hh = tile.offsetHeight / 2 + 10;
    for (const p of r.picks) {
      if (p.got) continue;
      if (p.vx) { p.x += p.vx * dt; if (Math.abs(p.x) > .92) p.vx *= -1; }
      const px = skyW / 2 + p.x * (skyW / 2 - 20), py = p.y * sky.clientHeight;
      p.el.style.transform = `translate(${px - 14}px, ${py - 14}px)`;
      if (Math.abs(px - tx) < hw && Math.abs(py - ty) < hh) {
        p.got = true; p.el.classList.add("got");
        const b = sky.getBoundingClientRect();
        if (p.spike) spiked(b.left + px, b.top + py);
        else { r.stars++; r.score += 10; app.earn(1, b.left + px, b.top + py); }
      }
    }
    if (r.y >= skyH) {
      if (r.mode === "challenge") { timeout(); return; }
      r.els.tile.classList.add("waiting");
    }
  }
  raf = requestAnimationFrame(loop);
}

function spiked(x, y) {
  const r = run;
  sfx.hurt(); r.els.tile.classList.remove("crash"); void r.els.tile.offsetWidth; r.els.tile.classList.add("crash");
  if (r.shield) { r.shield = false; app.floater(x, y, "🛡 Saved!", "#93c5fd"); }
  else { const lose = Math.min(app.coins, 3); if (lose) app.earn(-lose); r.score = Math.max(0, r.score - 25); r.streak = 0; app.floater(x, y, lose ? `💥 −${lose} 🪙` : "💥 −25", "#ff7b72"); }
  paintHud();
}

window.addEventListener("keydown", (e) => { if (!run) return; if (e.key === "ArrowLeft") run.keys.l = 1; if (e.key === "ArrowRight") run.keys.r = 1; });
window.addEventListener("keyup", (e) => { if (!run) return; if (e.key === "ArrowLeft") run.keys.l = 0; if (e.key === "ArrowRight") run.keys.r = 0; });

async function pick(opt, btn, btns) {
  const r = run; if (!r || r.answered || r.frozen) return;
  r.answered = true;
  btns.forEach((b) => (b.disabled = true));
  const ok = opt.card.id === r.card.id;
  // Fly the block into the chosen meaning.
  const tr = r.els.tile.getBoundingClientRect(), br = btn.getBoundingClientRect();
  const dy = br.top + br.height / 2 - (tr.top + tr.height / 2);
  const dx = br.left + br.width / 2 - (tr.left + tr.width / 2);
  r.els.tile.style.transition = reducedMotion() ? "none" : "transform .38s cubic-bezier(.5,0,.8,.4), opacity .38s";
  r.els.tile.style.transform = `translate(calc(-50% + ${(r.px || 0) + dx}px), ${r.y + dy}px) scale(.55)`;
  r.els.tile.style.opacity = "0";
  await wait(reducedMotion() ? 0 : 380);
  r.els.tile.style.transition = ""; r.els.tile.style.opacity = "";
  if (!run) return;
  const right = btns.find((b, i) => b.querySelector(".txt").textContent === defOf(r.card));
  if (ok) {
    btn.classList.add("good");
    r.streak++; r.correct++;
    const pts = 100 + Math.min(r.streak - 1, 5) * 20;
    r.score += pts; r.deck.hit(r.card); app.earn(3 + Math.min(r.streak, 5));
    app.floater(br.left + br.width / 2, br.top, "+" + pts);
    sfx.good();
    r.n++; paintHud();
    await wait(650);
  } else {
    btn.classList.add("bad"); if (right) right.classList.add("good");
    btns.forEach((b) => { if (b !== btn && b !== right) b.classList.add("dim"); });
    sfx.bad(); r.streak = 0; r.deck.miss(r.card); r.missed.push(r.card);
    if (r.mode === "challenge") r.hearts--;
    r.n++; paintHud();
    await wait(500);
    await app.learn(r.card, { chosen: opt.label, note: r.mode === "challenge" ? `${r.hearts} ${r.hearts === 1 ? "heart" : "hearts"} left.` : null });
  }
  if (run) next();
}

async function timeout() {
  const r = run; r.answered = true;
  r.els.tile.classList.add("crash");
  const btns = [...r.els.ask.querySelectorAll(".answer")];
  btns.forEach((b) => { b.disabled = true; if (b.querySelector(".txt").textContent === defOf(r.card)) b.classList.add("good"); else b.classList.add("dim"); });
  sfx.bad(); r.streak = 0; r.hearts--; r.deck.miss(r.card); r.missed.push(r.card); r.n++; paintHud();
  await wait(600);
  await app.learn(r.card, { title: "Too slow — here it is", note: `${r.hearts} ${r.hearts === 1 ? "heart" : "hearts"} left.` });
  if (run) next();
}

function finish() {
  const r = run; stop();
  app.results({ score: r.score, correct: r.correct, total: r.n, missed: r.missed, extra: [[r.stars, "stars caught"]] });
}

function demo(el) {
  el.classList.add("drop-demo");
  el.append(h("div", { class: "dd-tile" }, "drive"),
    h("div", { class: "dd-bins" }, h("i", {}), h("i", { class: "win" }), h("i", {})));
}
