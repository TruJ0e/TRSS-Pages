/* Term Miner — drill down to the treasure, choosing the right door on the way.
 *
 * Steer the drill (drag, ◀ ▶ or arrow keys) to dig up 💎 gems and avoid
 * boulders. Every so often a rock layer blocks the way with three doors,
 * each labelled with a term; the meaning is shown above. Drill through the
 * door with the matching term (tap its sign to steer there).
 * Relaxed: 10 doors, the drill stops at each layer and waits, boulders only
 * cost gems, then the treasure chest at the bottom. Challenge: endless,
 * faster, lava pockets deeper down, wrong doors cost hearts.
 */
import { createApp, makeDeck, pickDistractors, shuffle, h, wait, defOf, say, sfx, sayBtn, reducedMotion, steerPad, unlockAudio } from "../common/kit.js?v=7";

const ROUND = 10;
let run = null, raf = 0, genTo = 0, hudT = 0;

const app = createApp({
  id: "drop", title: "Term Miner", emoji: "⛏️",
  tagline: "Drill down for treasure. Dig through the door with the right term.",
  steps: ["Drag or hold ◀ ▶ to steer the drill. Dig up 💎 gems, dodge 🪨 boulders.",
          "A rock layer has three doors. Read the meaning at the top.",
          "Tap the door with the matching term. The drill digs through it!"],
  modes: { relaxed: "10 doors, then the treasure. Drill waits.", challenge: "Endless and faster, with lava. 3 hearts." },
  minCards: 4, demo,
  onStart: begin,
  onPause: () => run && (run.frozen = true),
  onResume: () => { if (run) { run.frozen = false; run.last = performance.now(); } },
  onQuit: stop,
});

function stop() { cancelAnimationFrame(raf); if (run && run.steer) run.steer.destroy(); window.removeEventListener("resize", resize); run = null; }

function begin({ cards, mode, focus }) {
  stop(); genTo = 0;
  const canvas = h("canvas", { class: "mine", "aria-label": "Mine. Drag to steer the drill." });
  const sk = app.skin("block");
  run = { mode, cards, sk, deck: makeDeck(focus ? [...new Set([...focus, ...cards])] : cards), canvas, ctx: canvas.getContext("2d"),
          n: 0, correct: 0, score: 0, streak: 0, hearts: 3, missed: [], gems: 0, frozen: false, last: performance.now(),
          shield: mode === "challenge" && app.has("boost-shield"),
          depth: 0, x: 0.5, tx: 0.5, speed: 0, t: 0, objs: [], parts: [], trail: [], gate: null, nextGateAt: 18, bump: 0, shake: 0, treasure: null };
  run.hud = h("div", { class: "hud" });
  run.q = h("div", { class: "mq" });
  run.signs = h("div", { class: "signs" });
  run.wrap = h("div", { class: "minewrap" }, canvas, run.signs);
  run.steer = steerPad();
  run.ctrl = h("div", { class: "mctrl" }, run.steer.el);
  app.stage.replaceChildren(run.hud, run.q, run.wrap, run.ctrl);
  canvas.addEventListener("pointerdown", (e) => { unlockAudio(); run.drag = true; canvas.setPointerCapture(e.pointerId); dragTo(e); });
  canvas.addEventListener("pointermove", (e) => run && run.drag && dragTo(e));
  const end = () => run && (run.drag = false);
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  window.addEventListener("resize", resize);
  resize(); paintHud(); idleCard();
  raf = requestAnimationFrame(loop);
}
function dragTo(e) { if (run.gate && run.gate.picked >= 0) return; const b = run.canvas.getBoundingClientRect(); run.tx = Math.max(0.08, Math.min(0.92, (e.clientX - b.left) / b.width)); }
function resize() {
  const r = run; if (!r) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  r.W = r.wrap.clientWidth; r.H = r.wrap.clientHeight;
  r.canvas.width = r.W * dpr; r.canvas.height = r.H * dpr;
  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  r.ppm = r.H / 11;
  r.drillY = r.H * 0.28;
}
function idleCard() { run.q.replaceChildren(h("div", { class: "qcard waitcard slim" }, h("div", {}, "⛏️ Dig! Grab 💎 gems · dodge 🪨 boulders"))); }

function paintHud() {
  const r = run;
  const kids = r.mode === "relaxed"
    ? [h("span", { class: "chip" }, "🚪 ", h("b", {}, Math.min(r.n + 1, ROUND)), " / " + ROUND)]
    : [h("span", { class: "chip" }, "❤️".repeat(Math.max(0, r.hearts)) + "🤍".repeat(3 - Math.max(0, r.hearts)) + (r.shield ? " 🛡" : ""))];
  kids.push(h("span", { class: "chip" }, "⬇ ", h("b", {}, Math.floor(r.depth) + " m")), app.coinChip(), h("span", { class: "chip" }, "⭐ ", h("b", {}, r.score)));
  r.hud.replaceChildren(...kids);
}

/* -------------------------------------------------------------- world gen */
function generate(to) {
  const r = run;
  while (genTo < to) {
    genTo += 1.6 + Math.random() * 1.8;
    if (r.gate && Math.abs(genTo - r.gate.at) < 3) continue;
    if (Math.abs(genTo - r.nextGateAt - 8) < 4) continue;
    if (r.treasure && genTo > r.treasure.at - 4) continue;
    const roll = Math.random();
    if (roll < 0.5) r.objs.push({ kind: "gem", x: 0.1 + Math.random() * 0.8, y: genTo, c: ["#5cc8ff", "#6ee7b7", "#f472b6", "#fbbf24"][(Math.random() * 4) | 0] });
    else if (roll < 0.78) r.objs.push({ kind: "rock", x: 0.12 + Math.random() * 0.76, y: genTo, rad: 0.55 + Math.random() * 0.35 });
    else if (r.mode === "challenge" && r.depth > 40 && roll < 0.9) r.objs.push({ kind: "lava", x: 0.15 + Math.random() * 0.7, y: genTo, rad: 0.7 });
  }
}

/* ------------------------------------------------------------------ doors */
function openGate() {
  const r = run;
  const card = r.deck.next();
  const opts = shuffle([card, ...pickDistractors(r.cards, card.id, 2)]);
  r.gate = { card, opts, correct: opts.indexOf(card), at: r.depth + 8, picked: -1 };
  r.objs = r.objs.filter((o) => Math.abs(o.y - r.gate.at) > 2.5);
  r.q.replaceChildren(h("div", { class: "qcard meaning" }, h("div", { class: "label" }, h("span", {}, "🚪 Which door means…"), sayBtn(defOf(card))), h("div", { class: "big" }, defOf(card))));
  r.signEls = opts.map((c, i) => h("button", { class: "sign", type: "button", "aria-label": `Door ${"ABC"[i]}: ${c.term}`, onclick: () => pick(i) },
    h("span", { class: "k" }, "ABC"[i]), h("span", { class: "tt" }, c.term)));
  r.signs.replaceChildren(...r.signEls);
  sfx.whoosh();
  say(defOf(card));
}
function pick(i) {
  const r = run, g = r.gate; if (!g || g.picked >= 0 || r.frozen) return;
  unlockAudio();
  g.picked = i;
  r.tx = (i + 0.5) / 3;
  r.signEls.forEach((s, k) => s.classList.add(k === i ? "chosen" : "dim"));
  sfx.tap();
}
async function hitGate() {
  const r = run, g = r.gate;
  const col = Math.max(0, Math.min(2, Math.floor(r.x * 3)));
  const chosen = g.picked >= 0 ? g.picked : col;
  const ok = chosen === g.correct;
  r.n++;
  const sx = (chosen + 0.5) / 3 * r.W;
  if (ok) {
    r.gate = null;
    r.correct++; r.streak++; r.deck.hit(g.card);
    const pts = 100 + Math.min(r.streak - 1, 5) * 25; r.score += pts;
    r.signEls[chosen].classList.remove("chosen"); r.signEls[chosen].classList.add("good");
    burst(sx, r.drillY + 30, "#34d17c", 34); burst(sx, r.drillY + 30, "#a3a3a3", 20); sfx.good(); r.shake = 6;
    const b = r.wrap.getBoundingClientRect(); app.floater(b.left + sx, b.top + r.drillY, "+" + pts);
    app.earn(5 + Math.min(r.streak, 5));
    r.q.replaceChildren(h("div", { class: "qcard term okcard" }, h("div", { class: "big" }, "✓ ", g.card.term)));
    setTimeout(() => { if (run && !run.gate) { run.signs.replaceChildren(); idleCard(); } }, 700);
  } else {
    r.streak = 0; r.shake = 14; sfx.hurt(); sfx.bad();
    r.signEls[chosen].classList.add("bad"); r.signEls[g.correct].classList.remove("dim"); r.signEls[g.correct].classList.add("good");
    r.missed.push(g.card); r.deck.miss(g.card);
    if (r.mode === "challenge") { if (r.shield) r.shield = false; else r.hearts--; }
    burst(sx, r.drillY + 30, "#ff7b72", 22);
    paintHud();
    r.frozen = true;
    await wait(500);
    await app.learn(g.card, { chosen: g.opts[chosen].term, note: r.mode === "challenge" ? `${r.hearts} ${r.hearts === 1 ? "heart" : "hearts"} left.` : "The drill will go through the right door." });
    if (!run) return;
    r.frozen = false; r.last = performance.now();
    r.tx = r.x = (g.correct + 0.5) / 3;
    r.gate = null;
    r.signs.replaceChildren(); idleCard();
  }
  paintHud();
  r.nextGateAt = r.depth + (r.mode === "relaxed" ? 20 + Math.random() * 6 : Math.max(15, 24 - r.n * 0.5));
  if (r.hearts <= 0) return finish();
  if (r.mode === "relaxed" && r.n >= ROUND) r.treasure = { at: r.depth + 9 };
}

/* ------------------------------------------------------------------ loop */
function loop(now) {
  const r = run; if (!r) return;
  const dt = Math.min(0.04, (now - r.last) / 1000); r.last = now;
  if (!r.frozen) update(dt);
  if (run) draw();
  raf = requestAnimationFrame(loop);
}
function update(dt) {
  const r = run; r.t += dt;
  const base = r.mode === "challenge" ? Math.min(5.5, 3 + r.depth / 90) : 2.8;
  let target = base * (r.bump > 0 ? 0.3 : 1);
  const g = r.gate;
  if (g) {
    const gap = g.at - r.depth;
    if (g.picked < 0) target = r.mode === "relaxed" ? (gap > 3.2 ? base : Math.max(0, (gap - 1.6) * 1.5)) : base * 0.75;
    else target = base * 1.6;
    if (gap <= 0.6) { hitGate(); if (!run) return; }
  } else if (!r.treasure && (r.mode === "challenge" || r.n < ROUND) && r.depth >= r.nextGateAt) openGate();
  if (r.treasure) {
    const gap = r.treasure.at - r.depth;
    if (gap < 3) target = Math.max(0, gap - 1.2) * 1.5;
    if (gap < 1.4 && !r.treasure.opened) { r.treasure.opened = true; openTreasure(); }
  }
  r.speed += (target - r.speed) * Math.min(1, dt * 3);
  r.depth += r.speed * dt;
  r.score += Math.round(r.speed * dt * 2);
  generate(r.depth + 14);

  const d = r.steer.dir();
  if (d && !(g && g.picked >= 0)) r.tx = Math.max(0.08, Math.min(0.92, r.tx + d * dt * 0.9));
  r.x += (r.tx - r.x) * Math.min(1, dt * 8);
  r.bump = Math.max(0, r.bump - dt); r.shake = Math.max(0, r.shake - dt * 30);
  r.trail.push({ x: r.x, y: r.depth }); if (r.trail.length > 140) r.trail.shift();

  const tip = r.depth + 0.6;
  for (const o of r.objs) {
    if (o.done) continue;
    const dx = (o.x - r.x) * r.W / r.ppm, dy = o.y - tip, dist = Math.hypot(dx, dy);
    if (o.kind === "gem" && app.has("boost-magnet") && dist < 3.5) { o.x += (r.x - o.x) * dt * 3; o.y += (tip - o.y) * dt * 3; }
    if (o.kind === "gem" && dist < 0.9) { o.done = true; r.gems++; r.score += 10; app.earn(1); burst(o.x * r.W, r.drillY + 24, o.c, 8); }
    else if ((o.kind === "rock" || o.kind === "lava") && dist < (o.rad || .6) + 0.35) { o.done = true; crash(o); if (!run) return; }
  }
  r.objs = r.objs.filter((o) => o.y > r.depth - 6 && !o.done);
  for (const p of r.parts) { p.life -= dt; p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt - r.speed * r.ppm * dt; }
  r.parts = r.parts.filter((p) => p.life > 0);
  const n = performance.now(); if (n - hudT > 400) { hudT = n; paintHud(); }
}

function crash(o) {
  const r = run;
  r.bump = 0.6; r.shake = 12; sfx.hurt();
  const sx = o.x * r.W;
  burst(sx, r.drillY + 30, o.kind === "lava" ? "#fb923c" : "#9ca3af", 18);
  const b = r.wrap.getBoundingClientRect();
  if (r.mode === "challenge" && o.kind === "lava") {
    if (r.shield) { r.shield = false; app.floater(b.left + sx, b.top + r.drillY, "🛡 Saved!", "#93c5fd"); }
    else { r.hearts--; app.floater(b.left + sx, b.top + r.drillY, "🔥 Lava! −1 ❤️", "#fb923c"); }
    paintHud();
    if (r.hearts <= 0) finish();
  } else {
    const lose = Math.min(app.coins, 2); if (lose) app.earn(-lose);
    app.floater(b.left + sx, b.top + r.drillY, lose ? `🪨 Bonk! −${lose}` : "🪨 Bonk!", "#cbd5e1");
  }
}
function burst(x, y, c, n) { for (let i = 0; i < n; i++) run.parts.push({ x, y, vx: (Math.random() - .5) * 260, vy: -60 - Math.random() * 220, life: .6 + Math.random() * .4, c }); }

async function openTreasure() {
  const r = run;
  sfx.win(); r.shake = 8;
  for (let i = 0; i < 4; i++) setTimeout(() => run && burst(r.W / 2, toY(r.treasure.at), ["#ffd166", "#fbbf24", "#fde68a"][i % 3], 26), i * 180);
  const b = r.wrap.getBoundingClientRect(); app.floater(b.left + r.W / 2, b.top + r.drillY, "💰 Treasure! +25", "#ffd166");
  app.earn(25); r.score += 300;
  await wait(1900);
  if (run) finish();
}

/* ------------------------------------------------------------------ draw */
const STRATA = [[0, "#8a5a3b", "#7a4e32"], [30, "#7a6a55", "#6b5c49"], [70, "#5b6170", "#4f5563"], [120, "#453f63", "#3a3555"], [180, "#4a2323", "#3d1c1c"]];
function strata(depth) { let s = STRATA[0]; for (const t of STRATA) if (depth >= t[0]) s = t; return s; }
const toY = (worldY) => run.drillY + (worldY - run.depth) * run.ppm;

function draw() {
  const r = run, c = r.ctx, W = r.W, H = r.H;
  c.save();
  if (r.shake > .4 && !reducedMotion()) c.translate((Math.random() - .5) * r.shake, (Math.random() - .5) * r.shake);
  for (let y = 0; y < H; y += 20) {
    const wd = r.depth + (y - r.drillY) / r.ppm, s = strata(wd);
    c.fillStyle = (Math.floor(wd * 0.8) % 2) ? s[1] : s[2]; c.fillRect(0, y, W, 21);
  }
  c.fillStyle = "rgba(0,0,0,.16)";
  const start = Math.floor((r.depth - r.drillY / r.ppm) * 2) / 2;
  for (let wy = start; wy < start + H / r.ppm + 2; wy += 0.5) for (let k = 0; k < 3; k++) {
    const seed = Math.sin(wy * 91.7 + k * 13.1) * 43758.5, fx = seed - Math.floor(seed);
    c.beginPath(); c.arc(fx * W, toY(wy), 2 + (k % 2) * 2, 0, 6.29); c.fill();
  }
  if (r.depth < r.drillY / r.ppm + 1) { const sy = toY(0); c.fillStyle = "#7dd3fc"; c.fillRect(0, 0, W, sy); c.fillStyle = "#3f9e4d"; c.fillRect(0, sy - 8, W, 10); }
  c.strokeStyle = "rgba(20,12,8,.75)"; c.lineWidth = r.ppm * 0.9; c.lineCap = "round"; c.lineJoin = "round"; c.beginPath();
  r.trail.forEach((p, i) => { const x = p.x * W, y = toY(p.y); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
  for (const o of r.objs) {
    const x = o.x * W, y = toY(o.y); if (y < -40 || y > H + 40) continue;
    if (o.kind === "gem") {
      const s = r.ppm * .32; c.save(); c.translate(x, y); c.rotate(Math.sin(r.t * 2 + o.y) * .2);
      c.fillStyle = o.c; c.beginPath(); c.moveTo(0, -s); c.lineTo(s * .8, -s * .2); c.lineTo(0, s); c.lineTo(-s * .8, -s * .2); c.closePath(); c.fill();
      c.fillStyle = "rgba(255,255,255,.55)"; c.beginPath(); c.moveTo(0, -s); c.lineTo(s * .3, -s * .2); c.lineTo(-s * .3, -s * .2); c.closePath(); c.fill();
      c.fillStyle = `rgba(255,255,255,${.3 + .3 * Math.sin(r.t * 5 + o.x * 10)})`; c.beginPath(); c.arc(s * .5, -s * .6, 2, 0, 6.29); c.fill();
      c.restore();
    } else if (o.kind === "rock") {
      const s = r.ppm * o.rad, g = c.createRadialGradient(x - s * .3, y - s * .3, 2, x, y, s);
      g.addColorStop(0, "#d1d5db"); g.addColorStop(1, "#4b5563"); c.fillStyle = g;
      c.beginPath(); for (let a = 0; a < 7; a++) { const ang = a / 7 * 6.28, rr = s * (0.85 + ((a * 37) % 5) / 25); c.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr); } c.closePath(); c.fill();
    } else {
      const s = r.ppm * o.rad, g = c.createRadialGradient(x, y, 2, x, y, s);
      g.addColorStop(0, "#fde68a"); g.addColorStop(.4, "#fb923c"); g.addColorStop(1, "rgba(220,38,38,.2)"); c.fillStyle = g;
      c.beginPath(); c.arc(x, y, s * (1 + .06 * Math.sin(r.t * 6)), 0, 6.29); c.fill();
    }
  }
  if (r.gate) drawGate(r.gate);
  if (r.treasure) drawChest();
  drawDrill();
  for (const p of r.parts) { c.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6)); c.fillStyle = p.c; c.fillRect(p.x - 3, p.y - 3, 6, 6); }
  c.globalAlpha = 1;
  const v = c.createLinearGradient(0, 0, 0, H); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, `rgba(0,0,0,${Math.min(.55, .15 + r.depth / 400)})`);
  c.fillStyle = v; c.fillRect(0, 0, W, H);
  c.restore();
  placeSigns();
}

function drawGate(g) {
  const r = run, c = r.ctx, W = r.W, y = toY(g.at), th = r.ppm * 1.1;
  if (y > r.H + 60) return;
  c.fillStyle = "#374151"; c.fillRect(0, y - th / 2, W, th);
  c.fillStyle = "#4b5563"; for (let x = 0; x < W; x += 26) c.fillRect(x + ((x / 26) % 2) * 6, y - th / 2 + 4, 20, th / 2 - 6);
  for (let i = 0; i < 3; i++) {
    const cx = (i + .5) / 3 * W, dw = W / 3 * .62, sel = g.picked === i;
    c.fillStyle = sel ? "#ffb020" : "#1f2937"; c.strokeStyle = sel ? "#ffe0a3" : "#94a3b8"; c.lineWidth = 3;
    c.beginPath(); c.roundRect ? c.roundRect(cx - dw / 2, y - th / 2 + 2, dw, th - 4, 8) : c.rect(cx - dw / 2, y - th / 2 + 2, dw, th - 4); c.fill(); c.stroke();
    c.fillStyle = sel ? "#2a1a00" : "#fff"; c.font = `800 ${Math.round(th * .45)}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("ABC"[i], cx, y + 1);
  }
}
function placeSigns() {
  const r = run; if (!r || !r.gate || !r.signEls) return;
  // signs hang just below the rock layer, so they never cover the drill
  const y = toY(r.gate.at) + r.ppm * 0.6 + 4;
  r.signEls.forEach((s, i) => {
    s.style.left = (i / 3) * r.W + 3 + "px"; s.style.width = r.W / 3 - 6 + "px";
    s.style.transform = `translateY(${Math.round(Math.min(y, r.H - s.offsetHeight - 6))}px)`;
  });
}
function drawChest() {
  const r = run, c = r.ctx, x = r.W / 2, y = toY(r.treasure.at) + r.ppm * .2, s = r.ppm * 1.1;
  if (y > r.H + 60) return;
  c.fillStyle = "rgba(255,209,102,.25)"; c.beginPath(); c.arc(x, y, s * 2.2, 0, 6.29); c.fill();
  c.fillStyle = "#8b5a2b"; c.fillRect(x - s, y - s * .4, s * 2, s * 1.1);
  c.fillStyle = "#a16207"; c.beginPath(); c.moveTo(x - s, y - s * .4); c.quadraticCurveTo(x, y - s * 1.3 - (r.treasure.opened ? s * .6 : 0), x + s, y - s * .4); c.fill();
  c.fillStyle = "#fbbf24"; c.fillRect(x - s * .15, y - s * .5, s * .3, s * .4); c.fillRect(x - s, y + s * .1, s * 2, s * .12);
}
function drawDrill() {
  const r = run, c = r.ctx, x = r.x * r.W, y = r.drillY, s = r.ppm * .55;
  c.save(); c.translate(x, y); c.rotate((r.tx - r.x) * 1.4);
  const body = c.createLinearGradient(-s, 0, s, 0); body.addColorStop(0, r.sk.b); body.addColorStop(.5, r.sk.a); body.addColorStop(1, r.sk.b);
  c.fillStyle = body; c.beginPath(); c.roundRect ? c.roundRect(-s * .8, -s * 1.5, s * 1.6, s * 1.3, s * .3) : c.rect(-s * .8, -s * 1.5, s * 1.6, s * 1.3); c.fill();
  c.fillStyle = "#1e293b"; c.beginPath(); c.arc(0, -s * .9, s * .35, 0, 6.29); c.fill();
  c.fillStyle = "#7dd3fc"; c.beginPath(); c.arc(-s * .08, -s * .98, s * .12, 0, 6.29); c.fill();
  const spin = r.t * 20;
  c.fillStyle = "#cbd5e1"; c.beginPath(); c.moveTo(-s * .7, -s * .2); c.lineTo(s * .7, -s * .2); c.lineTo(0, s * 1.2); c.closePath(); c.fill();
  c.strokeStyle = "#64748b"; c.lineWidth = 2;
  for (let i = 0; i < 4; i++) { const k = ((spin / 3 + i / 4) % 1), yy = -s * .2 + k * s * 1.3, w = s * .7 * (1 - k); c.beginPath(); c.moveTo(-w, yy); c.lineTo(w, yy + s * .15); c.stroke(); }
  c.restore();
  if (r.speed > 0.5 && Math.random() < 0.5) r.parts.push({ x: x + (Math.random() - .5) * s, y: y + s, vx: (Math.random() - .5) * 120, vy: -40 - Math.random() * 60, life: .35, c: strata(r.depth)[1] });
}

function finish() {
  const r = run; if (!r) return; stop();
  app.results({ score: r.score, correct: r.correct, total: r.n, missed: r.missed, extra: [[Math.floor(r.depth) + " m", "deep"], [r.gems, "gems"]] });
}

function demo(el) {
  el.classList.add("mine-demo");
  el.append(h("i", { class: "md-gem" }, "💎"), h("i", { class: "md-rock" }, "🪨"), h("div", { class: "md-doors" }, h("b", {}, "A"), h("b", { class: "win" }, "B"), h("b", {}, "C")), h("i", { class: "md-drill" }, "⛏️"));
}
