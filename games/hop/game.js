/* Term Hop — a bouncing climb with study stops.
 *
 * CLIMB: the frog bounces on its own; hold ◀ ▶ (or the left/right side of
 * the pond, or arrow keys) to steer onto lily pads, catch 🪰 flies for coins
 * and don't fall in the water. Some pads drift sideways, some crumble.
 * PERCH: after each climb the frog rests and a meaning appears. Tap the lily
 * pad with the matching term; the frog hops onto it.
 * Relaxed: 10 perches, falling in just costs a couple of coins.
 * Challenge: falls and wrong pads cost hearts, climbs get longer and trickier.
 */
import { createApp, makeDeck, pickDistractors, shuffle, h, wait, defOf, say, sfx, sayBtn, unlockAudio, reducedMotion, steerPad } from "../common/kit.js?v=7";

const ROUND = 10;
let run = null, raf = 0;

const app = createApp({
  id: "hop", title: "Term Hop", emoji: "🐸",
  tagline: "Bounce up the pond, catch flies, and land on the right term.",
  steps: ["The frog bounces by itself. Hold ◀ ▶ to steer it onto lily pads.",
          "Catch 🪰 flies for coins. Don't fall in the water!",
          "When the frog rests, tap the lily pad with the matching term."],
  modes: { relaxed: "10 questions. Splashes only cost coins.", challenge: "Trickier pads. 3 hearts." },
  minCards: 4, demo,
  onStart: begin,
  onPause: () => run && (run.frozen = true),
  onResume: () => { if (run) { run.frozen = false; run.last = performance.now(); } },
  onQuit: stop,
});

function stop() { cancelAnimationFrame(raf); if (run && run.steer) run.steer.destroy(); window.removeEventListener("resize", resize); run = null; }

function begin({ cards, mode, focus }) {
  stop();
  const sk = app.skin("frog");
  run = { mode, cards, sk, deck: makeDeck(focus ? [...new Set([...focus, ...cards])] : cards), n: 0, correct: 0, score: 0,
          hearts: 3, shield: mode === "challenge" && app.has("boost-shield"), height: 0, streak: 0, missed: [], flies: 0,
          frozen: false, last: performance.now(), phase: "climb" };
  run.hud = h("div", { class: "hud" });
  run.prompt = h("div", { class: "hprompt" });
  run.canvas = h("canvas", { class: "pondcv", "aria-label": "Pond. Hold left or right side to steer the frog." });
  run.scene = h("div", { class: "pond", style: `--fa:${sk.a};--fb:${sk.b}` }, run.canvas, h("div", { class: "reeds" }));
  run.steer = steerPad();
  run.ctrl = h("div", { class: "hctrl" }, run.steer.el);
  app.stage.replaceChildren(run.hud, run.prompt, run.scene, run.ctrl);
  run.ctx = run.canvas.getContext("2d");
  // hold either half of the pond to steer too
  run.touch = 0;
  run.canvas.addEventListener("pointerdown", (e) => { unlockAudio(); const b = run.canvas.getBoundingClientRect(); run.touch = e.clientX - b.left < b.width / 2 ? -1 : 1; });
  const up = () => { if (run) run.touch = 0; };
  run.canvas.addEventListener("pointerup", up); run.canvas.addEventListener("pointercancel", up); run.canvas.addEventListener("pointerleave", up);
  window.addEventListener("resize", resize);
  resize();
  startClimb(true);
  raf = requestAnimationFrame(loop);
}

function resize() {
  const r = run; if (!r) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  r.W = r.scene.clientWidth; r.H = r.scene.clientHeight;
  r.canvas.width = r.W * dpr; r.canvas.height = r.H * dpr;
  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  r.k = r.H / 460;                               // physics scale
}

function paintHud() {
  const r = run;
  const kids = r.mode === "relaxed"
    ? [h("span", { class: "chip" }, "❓ ", h("b", {}, Math.min(r.n + 1, ROUND)), " / " + ROUND)]
    : [h("span", { class: "chip" }, "❤️".repeat(Math.max(0, r.hearts)) + "🤍".repeat(3 - Math.max(0, r.hearts)) + (r.shield ? " 🛡" : ""))];
  kids.push(h("span", { class: "chip" }, "🪷 ", h("b", {}, r.height + " m")), app.coinChip(), h("span", { class: "chip" }, "⭐ ", h("b", {}, r.score)));
  r.hud.replaceChildren(...kids);
}

/* ------------------------------------------------------------------- climb */
function startClimb(first) {
  const r = run;
  r.phase = "climb";
  r.climbLeft = first ? 7 : (r.mode === "relaxed" ? 9 : Math.min(14, 9 + r.n * 0.4));
  r.climbTotal = r.climbLeft;
  r.scene.querySelectorAll(".pad,.frog,.splash").forEach((e) => e.remove());
  r.canvas.classList.remove("dim");
  r.ctrl.hidden = false;
  r.prompt.replaceChildren(h("div", { class: "qcard waitcard" }, h("div", { class: "big" }, first ? "Hold ◀ ▶ to steer. Catch the 🪰 flies!" : "Climb! Catch 🪰 flies!")));
  const W = r.W, k = r.k;
  r.cam = 0;
  r.frog = { x: W / 2, y: r.H - 60 * k, vx: 0, vy: -760 * k, face: 1 };
  r.pads = [{ x: W / 2 - 50, y: r.H - 30 * k, w: 100, type: "base" }];
  r.bugs = []; r.parts = []; r.top = r.pads[0].y;
  fillPads();
  paintHud();
}

function fillPads() {
  const r = run, k = r.k, tricky = r.mode === "challenge" ? Math.min(0.45, 0.15 + r.n * 0.03) : 0.12;
  while (r.top > r.cam - r.H) {
    r.top -= (62 + Math.random() * 46) * k;
    const w = Math.max(64, (96 - (r.mode === "challenge" ? r.n * 1.5 : 0))) * (0.9 + Math.random() * 0.25);
    const roll = Math.random();
    const type = roll < tricky / 2 ? "move" : roll < tricky ? "crumble" : "pad";
    r.pads.push({ x: Math.random() * (r.W - w), y: r.top, w, type, vx: type === "move" ? (Math.random() < .5 ? -1 : 1) * 60 : 0 });
    if (Math.random() < 0.45) r.bugs.push({ x: 20 + Math.random() * (r.W - 40), y: r.top - (30 + Math.random() * 30) * k, ph: Math.random() * 6 });
  }
  r.pads = r.pads.filter((p) => p.y < r.cam + r.H + 40);
  r.bugs = r.bugs.filter((b) => b.y < r.cam + r.H + 40 && !b.got);
}

function updateClimb(dt) {
  const r = run, f = r.frog, k = r.k;
  const dir = r.steer.dir() || r.touch;
  f.vx += ((dir * 290 * Math.max(.8, k)) - f.vx) * Math.min(1, dt * 10);
  if (dir) f.face = dir;
  f.x += f.vx * dt;
  if (f.x < -16) f.x = r.W + 16; if (f.x > r.W + 16) f.x = -16;
  const prev = f.y;
  f.vy += 1500 * k * dt; f.y += f.vy * dt;
  for (const p of r.pads) {
    if (p.type === "move") { p.x += p.vx * dt; if (p.x < 0 || p.x + p.w > r.W) p.vx *= -1; }
    if (p.gone) continue;
    if (f.vy > 0 && prev <= p.y && f.y >= p.y && f.x > p.x - 10 && f.x < p.x + p.w + 10) {
      f.y = p.y; f.vy = -760 * k; sfx.jump();
      if (p.type === "crumble") { p.gone = true; dust(f.x, p.y, "#8a6d3b"); }
    }
  }
  // camera follows upward; height = metres climbed
  const target = f.y - r.H * 0.45;
  if (target < r.cam) { const d = r.cam - target; r.cam = target; r.climbed = (r.climbed || 0) + d; if (r.climbed > 45 * k) { r.climbed = 0; r.height++; paintHud(); } }
  fillPads();
  for (const b of r.bugs) {
    if (b.got) continue;
    b.ph += dt * 3; const bx = b.x + Math.sin(b.ph) * 12, by = b.y + Math.cos(b.ph * 1.3) * 6;
    if (app.has("boost-magnet")) { const dx = f.x - b.x, dy = f.y - 20 - b.y, d = Math.hypot(dx, dy); if (d < 130) { b.x += dx / d * 180 * dt; b.y += dy / d * 180 * dt; } }
    if (Math.hypot(bx - f.x, by - (f.y - 20 * k)) < 30 * k) {
      b.got = true; r.flies++; r.score += 10;
      const sb = r.scene.getBoundingClientRect(); app.earn(2, sb.left + bx, sb.top + by - r.cam);
      dust(bx, by, "#ffd166");
    }
  }
  // fell into the water
  if (f.y - r.cam > r.H + 30) splashFall();
  r.climbLeft -= dt;
  if (r.climbLeft <= 0 && f.vy < 0 && f.vy > -300 * k) startPerch();
}

function splashFall() {
  const r = run, k = r.k;
  sfx.hurt();
  const sb = r.scene.getBoundingClientRect();
  if (r.mode === "challenge") {
    if (r.shield) { r.shield = false; app.floater(sb.left + r.W / 2, sb.top + r.H - 60, "🛡 Saved!", "#93c5fd"); }
    else { r.hearts--; app.floater(sb.left + r.W / 2, sb.top + r.H - 60, "💦 Splash!", "#93c5fd"); }
    paintHud();
    if (r.hearts <= 0) return finish();
  } else {
    const lose = Math.min(app.coins, 2); if (lose) app.earn(-lose);
    app.floater(sb.left + r.W / 2, sb.top + r.H - 60, lose ? `💦 −${lose} 🪙` : "💦 Splash!", "#93c5fd");
  }
  // rescue: a lily pad pops up under the frog
  const y = r.cam + r.H - 40 * k;
  r.pads.push({ x: Math.max(0, Math.min(r.W - 110, r.frog.x - 55)), y, w: 110, type: "pad", rescue: true });
  r.frog.y = y; r.frog.vy = -900 * k;
}

function dust(x, y, c) { for (let i = 0; i < 10; i++) run.parts.push({ x, y, vx: (Math.random() - .5) * 200, vy: -Math.random() * 180, life: .5, c }); }

/* ------------------------------------------------------------------- perch */
function startPerch() {
  const r = run;
  if ((r.mode === "relaxed" && r.n >= ROUND) || r.hearts <= 0) return finish();
  r.phase = "perch"; r.busy = false; r.firstTry = true;
  r.canvas.classList.add("dim");
  r.ctrl.hidden = true;
  const card = r.deck.next(); r.card = card;
  const opts = shuffle([card, ...pickDistractors(r.cards, card.id, 2)]);
  r.prompt.replaceChildren(h("div", { class: "qcard meaning" }, h("div", { class: "label" }, h("span", {}, "Find the term for"), sayBtn(defOf(card))), h("div", { class: "big" }, defOf(card))));
  const base = h("div", { class: "pad base" }, h("span", { class: "leaf" }));
  const frog = h("div", { class: "frog", "aria-hidden": "true" }, h("i", { class: "eye l" }), h("i", { class: "eye r" }), h("i", { class: "mouth" }));
  r.qpads = opts.map((c, i) => {
    const b = h("button", { class: `pad choice p${i}`, type: "button", "aria-label": `Lily pad ${String.fromCharCode(65 + i)}: ${c.term}`, onclick: () => hop(b, c) },
      h("span", { class: "leaf" }), h("span", { class: "k" }, String.fromCharCode(65 + i)), h("span", { class: "term" }, c.term));
    b.card = c; return b;
  });
  r.scene.append(...r.qpads, base, frog);
  r.dfrog = frog; r.base = base;
  requestAnimationFrame(() => placeFrog(base, false));
  sfx.whoosh();
  say(defOf(card));
}

function center(el) {
  const s = run.scene.getBoundingClientRect(), b = el.getBoundingClientRect();
  return { x: b.left - s.left + b.width / 2, y: b.top - s.top + b.height / 2, left: b.left - s.left, top: b.top - s.top };
}
function placeFrog(pad, animate) {
  const f = run.dfrog, c = center(pad);
  // sit on the pad's right end so the term stays readable
  const x = pad.classList.contains("base") ? c.x - 28 : c.left + pad.offsetWidth - 60, y = pad.classList.contains("base") ? c.top - 34 : c.top + pad.offsetHeight / 2 - 30;
  if (!animate || reducedMotion()) { f.style.transform = `translate(${x}px, ${y}px)`; f.dataset.x = x; f.dataset.y = y; return Promise.resolve(); }
  const fx = +f.dataset.x, fy = +f.dataset.y, peak = Math.min(fy, y) - 70;
  const a = f.animate([
    { transform: `translate(${fx}px, ${fy}px) scale(1, 1)` },
    { transform: `translate(${fx}px, ${fy + 6}px) scale(1.15, .8)`, offset: .12 },
    { transform: `translate(${(fx + x) / 2}px, ${peak}px) scale(.95, 1.1)`, offset: .55 },
    { transform: `translate(${x}px, ${y}px) scale(1.12, .85)`, offset: .9 },
    { transform: `translate(${x}px, ${y}px) scale(1, 1)` }], { duration: 620, easing: "ease-in-out", fill: "forwards" });
  f.dataset.x = x; f.dataset.y = y;
  sfx.jump();
  return a.finished.then(() => { f.style.transform = `translate(${x}px, ${y}px)`; a.cancel(); });
}

async function hop(pad, c) {
  unlockAudio();
  const r = run; if (!r || r.busy || pad.disabled || r.phase !== "perch") return;
  r.busy = true;
  await placeFrog(pad, true);
  if (!run) return;
  if (c.id === r.card.id) {
    pad.classList.add("good"); sfx.good();
    if (r.firstTry) { r.correct++; r.streak++; r.deck.hit(r.card); } else r.streak = 0;
    const pts = r.firstTry ? 100 + Math.min(r.streak - 1, 5) * 20 : 30;
    r.score += pts; r.height += r.firstTry ? 5 : 1; r.n++;
    const p = pad.getBoundingClientRect(); app.floater(p.left + p.width / 2, p.top, "+" + pts);
    if (r.firstTry) app.earn(4 + Math.min(r.streak, 5));
    paintHud();
    await wait(650);
    if (run) startClimb(false);
  } else {
    pad.classList.add("bad"); r.dfrog.classList.add("sunk"); sfx.bad();
    r.scene.append(h("i", { class: "splash", style: `left:${center(pad).x}px;top:${center(pad).y}px` }));
    r.streak = 0;
    if (r.firstTry) { r.missed.push(r.card); r.deck.miss(r.card); }
    r.firstTry = false;
    if (r.mode === "challenge") { if (r.shield) r.shield = false; else r.hearts--; paintHud(); }
    await wait(700);
    await app.learn(r.card, { chosen: c.term, note: r.mode === "challenge" ? `${r.hearts} ${r.hearts === 1 ? "heart" : "hearts"} left.` : "Now hop onto the right pad!" });
    if (!run) return;
    r.dfrog.classList.remove("sunk"); r.scene.querySelectorAll(".splash").forEach((e) => e.remove());
    if (r.mode === "challenge") { r.n++; if (r.hearts <= 0) return finish(); return startClimb(false); }
    pad.disabled = true; pad.classList.add("gone");
    await placeFrog(r.base, false);
    r.qpads.find((b) => b.card.id === r.card.id).classList.add("hint");
    r.busy = false;
  }
}

/* -------------------------------------------------------------------- loop */
function loop(now) {
  const r = run; if (!r) return;
  const dt = Math.min(0.033, (now - r.last) / 1000); r.last = now;
  if (!r.frozen && r.phase === "climb") updateClimb(dt);
  if (!run) return;
  for (const p of r.parts) { p.life -= dt; p.vy += 600 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  r.parts = r.parts.filter((p) => p.life > 0);
  draw();
  raf = requestAnimationFrame(loop);
}

function draw() {
  const r = run, c = r.ctx, W = r.W, H = r.H, k = r.k;
  c.clearRect(0, 0, W, H);
  // water rings drift with the camera for a sense of climbing
  c.strokeStyle = "rgba(255,255,255,.05)"; c.lineWidth = 2;
  for (let i = 0; i < 7; i++) { const y = ((i * 90 - r.cam * 0.4) % (H + 90) + H + 90) % (H + 90) - 45; c.beginPath(); c.ellipse((i * 137) % W, y, 60, 14, 0, 0, 6.29); c.stroke(); }
  c.save(); c.translate(0, -r.cam);
  for (const p of r.pads) {
    if (p.gone) continue;
    const g = c.createRadialGradient(p.x + p.w * .4, p.y, 4, p.x + p.w / 2, p.y + 6, p.w * .7);
    const col = p.type === "crumble" ? ["#d9b778", "#8a6d3b"] : p.type === "move" ? ["#8fe0ff", "#2f86b0"] : ["#5fd48d", "#2f9e63"];
    g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
    const cx = p.x + p.w / 2, cy = p.y + 7 * k, rx = p.w / 2, ry = 11 * k;
    c.fillStyle = "rgba(0,0,0,.22)"; c.beginPath(); c.ellipse(cx + 3, cy + 5, rx, ry, 0, 0, 6.29); c.fill();
    c.fillStyle = g; c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0.25, 6.03); c.lineTo(cx, cy); c.closePath(); c.fill();   // notched leaf
    c.strokeStyle = "rgba(255,255,255,.18)"; c.lineWidth = 1.5; c.beginPath(); c.ellipse(cx, cy - 1, rx * .8, ry * .6, 0, 3.4, 6); c.stroke();
    c.strokeStyle = "rgba(0,0,0,.15)"; for (const a of [2.2, 3.1, 4.0]) { c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * rx * .8, cy + Math.sin(a) * ry * .8); c.stroke(); }
    if (p.type === "crumble") { c.strokeStyle = "rgba(60,40,10,.6)"; c.beginPath(); c.moveTo(p.x + p.w * .3, p.y + 2); c.lineTo(p.x + p.w * .45, p.y + 12); c.lineTo(p.x + p.w * .6, p.y + 4); c.stroke(); }
  }
  c.font = `${Math.round(22 * Math.max(.8, k))}px sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
  for (const b of r.bugs) if (!b.got) c.fillText("🪰", b.x + Math.sin(b.ph) * 12, b.y + Math.cos(b.ph * 1.3) * 6);
  for (const p of r.parts) { c.globalAlpha = Math.max(0, p.life * 2); c.fillStyle = p.c; c.fillRect(p.x - 3, p.y - 3, 6, 6); }
  c.globalAlpha = 1;
  if (r.phase === "climb") drawFrog(c, r.frog.x, r.frog.y, r.frog.vy, r.frog.face, k);
  c.restore();
  if (r.phase === "climb") {
    const pct = Math.max(0, r.climbLeft / r.climbTotal);
    c.fillStyle = "rgba(0,0,0,.35)"; c.fillRect(12, 12, W - 24, 8);
    c.fillStyle = "#ffb020"; c.fillRect(12, 12, (W - 24) * (1 - pct), 8);
    const label = `🪰 ${r.flies} caught  ·  ❓ question soon`;
    c.font = "600 13px Lexend, sans-serif"; const lw = c.measureText(label).width + 22;
    c.fillStyle = "rgba(8,20,30,.72)"; c.beginPath(); c.roundRect ? c.roundRect(12, 26, lw, 26, 13) : c.rect(12, 26, lw, 26); c.fill();
    c.fillStyle = "#fff"; c.textAlign = "left"; c.textBaseline = "middle";
    c.fillText(label, 23, 39.5);
  }
}
function drawFrog(c, x, y, vy, face, k) {
  const r = run, s = Math.max(.85, k), squash = vy < -500 * k ? 1.12 : vy > 300 * k ? .92 : 1;
  c.save(); c.translate(x, y - 18 * s); c.scale(face * (1 / squash) * s, squash * s);
  const g = c.createRadialGradient(0, -8, 4, 0, 0, 24); g.addColorStop(0, r.sk.a); g.addColorStop(1, r.sk.b);
  c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 24, 19, 0, 0, 6.29); c.fill();
  c.fillStyle = r.sk.b; c.beginPath(); c.ellipse(-14, 16, 9, 5, 0, 0, 6.29); c.ellipse(14, 16, 9, 5, 0, 0, 6.29); c.fill();
  for (const ex of [-10, 10]) { c.fillStyle = "#fff"; c.beginPath(); c.arc(ex, -16, 8, 0, 6.29); c.fill(); c.fillStyle = "#10202a"; c.beginPath(); c.arc(ex + 2, -16, 3.5, 0, 6.29); c.fill(); }
  c.strokeStyle = "#1c3a2c"; c.lineWidth = 2.5; c.beginPath(); c.arc(0, 0, 9, .2 * Math.PI, .8 * Math.PI); c.stroke();
  c.restore();
}

function finish() {
  const r = run; if (!r) return; stop();
  app.results({ score: r.score, correct: r.correct, total: r.n, missed: r.missed, extra: [[r.height + " m", "climbed"], [r.flies, "flies"]] });
}

document.addEventListener("keydown", (e) => {
  if (!run || run.phase !== "perch" || !run.qpads || document.querySelector(".scrim")) return;
  const i = "abc123".indexOf(e.key.toLowerCase()) % 3;
  if (i >= 0 && run.qpads[i]) run.qpads[i].click();
});

function demo(el) {
  el.classList.add("hop-demo");
  el.append(h("i", { class: "hd-pad a" }), h("i", { class: "hd-pad b" }), h("i", { class: "hd-fly" }, "🪰"), h("i", { class: "hd-frog" }));
}
