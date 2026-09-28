/* Term Runner — a Subway-Surfers-style runner with study gates.
 *
 * Controls: swipe ← → to change lanes, swipe ↑ to jump, swipe ↓ to slide.
 * Also the four on-screen buttons and the arrow keys / WASD / space.
 * Obstacles: hurdles (jump), overhead bars (slide), trains (change lane).
 * Pickups: coin lines and arcs, 🧲 magnet, ✖2 double coins, 🛡 shield.
 * Every so often a gate spans the track with lanes A / B / C; the meaning is
 * shown above and the terms as buttons below — tap one and the runner takes
 * that lane through the gate.
 * Relaxed: 10 gates, the runner stops before each gate and waits, crashes
 * only cost coins. Challenge: faster, endless, crashes and wrong gates cost hearts.
 *
 * Rendering is a real perspective projection (world x/y/z -> screen) so
 * everything scales, overlaps and fogs correctly.
 */
import { createApp, makeDeck, pickDistractors, shuffle, h, wait, defOf, say, sfx, sayBtn, answerList, reducedMotion } from "../common/kit.js?v=5";

const ROUND = 10;
const LANE = 2.2;                  // lane width in world units
const CAM_H = 3.4, CAM_BACK = 4.6; // camera height / distance behind the runner
const FAR = 90;                    // draw distance
let run = null, raf = 0;

const app = createApp({
  id: "runner", title: "Term Runner", emoji: "🏃",
  tagline: "Jump, slide and dodge down the tracks — then dash through the gate with the right term.",
  steps: ["Swipe ← → to switch lanes, ↑ to jump hurdles, ↓ to slide under bars. Trains? Change lanes!",
          "Grab 🪙 coins and power-ups: 🧲 magnet, ✖2 double coins, 🛡 shield.",
          "At each gate, read the meaning and tap the matching term."],
  modes: { relaxed: "10 gates. Runner waits at each gate.", challenge: "Faster and faster. 3 hearts." },
  minCards: 4, demo,
  onStart: begin,
  onPause: () => run && (run.frozen = true),
  onResume: () => { if (run) { run.frozen = false; run.last = performance.now(); } },
  onQuit: stop,
});

function stop() {
  cancelAnimationFrame(raf);
  window.removeEventListener("resize", resize); window.removeEventListener("keydown", onKey);
  run = null;
}

/* ================================================================== setup */
function begin({ cards, mode, focus }) {
  stop();
  const canvas = h("canvas", { class: "road", "aria-label": "Track. Swipe to move: left, right, up to jump, down to slide." });
  run = {
    mode, cards, deck: makeDeck(focus ? [...new Set([...focus, ...cards])] : cards), canvas, ctx: canvas.getContext("2d"),
    sk: app.skin("runner"), n: 0, correct: 0, score: 0, streak: 0, hearts: 3, missed: [], frozen: false, last: performance.now(),
    shield: mode === "challenge" && app.has("boost-shield"), magnetT: 0, doubleT: 0, invuln: 0,
    dist: 0, speed: 0, t: 0, laneF: 0, lane: 0, y: 0, vy: 0, slideT: 0, stumble: 0, shake: 0,
    objs: [], parts: [], spawnZ: 26, gate: null, nextGateAt: mode === "relaxed" ? 110 : 150, dodged: 0,
  };
  run.hud = h("div", { class: "hud" });
  run.q = h("div", { class: "rq" });
  run.a = h("div", { class: "ra" });
  run.wrap = h("div", { class: "roadwrap" }, canvas);
  app.stage.replaceChildren(run.hud, run.q, run.wrap, run.a);
  bindTouch(canvas);
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKey);
  resize(); paintHud(); showRunning();
  raf = requestAnimationFrame(loop);
}

function resize() {
  const r = run; if (!r) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  r.W = r.wrap.clientWidth; r.H = r.wrap.clientHeight;
  r.canvas.width = r.W * dpr; r.canvas.height = r.H * dpr;
  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  r.horizon = r.H * 0.25;
  r.F = r.W * 1.05;
  r.sky = null;
}

/* ================================================================ controls */
function showRunning() {
  const r = run; if (!r) return;
  r.q.replaceChildren(h("div", { class: "qcard waitcard slim" }, h("div", {}, "⬅ ➡ switch · ⬆ jump · ⬇ slide · a gate is coming!")));
  const b = (dir, label, aria) => h("button", { type: "button", "aria-label": aria, onpointerdown: (e) => { e.preventDefault(); act(dir); } }, label);
  r.a.replaceChildren(h("div", { class: "pad4" }, b("left", "◀", "Move left"), b("up", "▲", "Jump"), b("down", "▼", "Slide"), b("right", "▶", "Move right")));
}
function act(dir) {
  const r = run; if (!r || r.frozen) return;
  if (r.gate && r.gate.picked < 0 && (dir === "left" || dir === "right")) return;   // at a gate, answering picks the lane
  if (dir === "left" && r.lane > -1) { r.lane--; sfx.tap(); }
  else if (dir === "right" && r.lane < 1) { r.lane++; sfx.tap(); }
  else if (dir === "up" && r.y <= 0.001) { r.vy = 9.2; r.slideT = 0; sfx.jump(); }
  else if (dir === "down") { if (r.y > 0.05) r.vy = -14; r.slideT = 0.75; sfx.whoosh(); }
}
function onKey(e) {
  if (!run || document.querySelector(".scrim")) return;
  const k = e.key;
  if (run.gate && run.gate.picked < 0 && /^[abc123]$/i.test(k)) return;
  if (k === "ArrowLeft" || k === "a") act("left");
  else if (k === "ArrowRight" || k === "d") act("right");
  else if (k === "ArrowUp" || k === "w" || k === " ") { e.preventDefault(); act("up"); }
  else if (k === "ArrowDown" || k === "s") { e.preventDefault(); act("down"); }
}
function bindTouch(cv) {
  let sx = 0, sy = 0;
  cv.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; });
  cv.addEventListener("pointerup", (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy, ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 18) { const b = cv.getBoundingClientRect(); const x = (e.clientX - b.left) / b.width; act(x < 0.33 ? "left" : x > 0.67 ? "right" : "up"); return; }
    if (ax > ay) act(dx > 0 ? "right" : "left"); else act(dy < 0 ? "up" : "down");
  });
}

/* ==================================================================== HUD */
function paintHud() {
  const r = run;
  const kids = r.mode === "relaxed"
    ? [h("span", { class: "chip" }, "🚪 ", h("b", {}, Math.min(r.n + 1, ROUND)), " / " + ROUND)]
    : [h("span", { class: "chip" }, "❤️".repeat(Math.max(0, r.hearts)) + "🤍".repeat(3 - Math.max(0, r.hearts)))];
  kids.push(app.coinChip(), h("span", { class: "chip" }, "⭐ ", h("b", {}, r.score)));
  if (r.streak >= 2) kids.push(h("span", { class: "chip hot" }, "🔥 ", h("b", {}, r.streak)));
  const pw = [];
  if (r.magnetT > 0) pw.push("🧲"); if (r.doubleT > 0) pw.push("✖2"); if (r.shield) pw.push("🛡");
  if (pw.length) kids.push(h("span", { class: "chip hot" }, pw.join(" ")));
  r.hud.replaceChildren(...kids);
}

/* ================================================================= spawning */
const PATTERNS_EASY = [
  ["low", null, null], [null, "high", null], [null, null, "train"], ["train", null, null],
  [null, "low", null], ["high", null, null], [null, null, "low"], [null, "train", null],
];
const PATTERNS_HARD = [
  ["low", "low", "low"], ["high", "high", "high"], ["train", "train", null], [null, "train", "train"],
  ["train", "low", "train"], ["high", "train", "low"], ["low", "high", "train"], ["train", null, "train"],
];
function spawnRow(z) {
  const r = run;
  const hard = r.mode === "challenge" && r.dist > 120;
  const pool = hard && Math.random() < 0.6 ? PATTERNS_HARD : PATTERNS_EASY;
  const pat = pool[(Math.random() * pool.length) | 0];
  pat.forEach((kind, i) => {
    const lane = i - 1;
    if (kind === "train") r.objs.push({ kind, lane, z, len: 7 + Math.random() * 7, hue: (Math.random() * 3) | 0 });
    else if (kind) r.objs.push({ kind, lane, z, len: 0.5 });
  });
  const free = pat.map((k, i) => (k ? null : i - 1)).filter((x) => x !== null);
  const low = pat.findIndex((k) => k === "low");
  if (low >= 0 && Math.random() < 0.6) {
    for (let i = 0; i < 5; i++) r.objs.push({ kind: "coin", lane: low - 1, z: z - 2.4 + i * 1.2, y: 0.7 + Math.sin((i / 4) * Math.PI) * 1.6 });
  } else if (free.length) {
    const l = free[(Math.random() * free.length) | 0];
    for (let i = 0; i < 6; i++) r.objs.push({ kind: "coin", lane: l, z: z + i * 1.4, y: 0.7 });
  }
  if (Math.random() < 0.12) {
    const l = free.length ? free[0] : 0;
    r.objs.push({ kind: ["magnet", "double", "shieldp"][(Math.random() * 3) | 0], lane: l, z: z + 10, y: 0.9 });
  }
}

/* ==================================================================== gates */
function openGate() {
  const r = run;
  const card = r.deck.next();
  const opts = shuffle([card, ...pickDistractors(r.cards, card.id, 2)]);
  r.gate = { card, opts, correct: opts.indexOf(card), z: 40, picked: -1 };
  r.q.replaceChildren(h("div", { class: "qcard meaning" }, h("div", { class: "label" }, h("span", {}, "🚪 Which term means…"), sayBtn(defOf(card))), h("div", { class: "big" }, defOf(card))));
  r.a.replaceChildren(answerList(opts.map((c, i) => ({ label: c.term, i })), { kind: "term", onPick: (o, btn, btns) => choose(o.i, btn, btns) }));
  sfx.whoosh();
  say(defOf(card));
}
function choose(i, btn, btns) {
  const r = run, g = r.gate; if (!g || g.picked >= 0 || r.frozen) return;
  g.picked = i; g.btns = btns; g.btn = btn;
  btns.forEach((b, k) => { b.disabled = true; if (k !== i) b.classList.add("dim"); });
  btn.classList.add("chosen");
  r.lane = i - 1; r.slideT = 0;
  sfx.whoosh();
}
async function resolveGate() {
  const r = run, g = r.gate;
  r.gate = null;
  const ok = g.picked === g.correct;
  r.n++;
  if (ok) {
    r.correct++; r.streak++; r.deck.hit(g.card);
    const pts = 100 + Math.min(r.streak - 1, 5) * 25; r.score += pts;
    g.btn.classList.remove("chosen"); g.btn.classList.add("good");
    burst(r.laneF * LANE, 1.5, 1.5, "#34d17c", 40); sfx.good();
    const b = r.wrap.getBoundingClientRect(); app.floater(b.left + b.width / 2, b.top + b.height * 0.55, "+" + pts);
    app.earn(5 + Math.min(r.streak, 5));
    paintHud();
    r.q.replaceChildren(h("div", { class: "qcard term okcard" }, h("div", { class: "big" }, "✓ ", g.card.term)));
  } else {
    r.streak = 0; r.stumble = 1; r.shake = 14; sfx.bad();
    if (r.mode === "challenge") { if (r.shield) r.shield = false; else r.hearts--; }
    r.missed.push(g.card); r.deck.miss(g.card);
    if (g.btns) g.btns.forEach((b, k) => { if (k === g.correct) { b.classList.remove("dim"); b.classList.add("good"); } if (k === g.picked) { b.classList.remove("chosen"); b.classList.add("bad"); } });
    burst(r.laneF * LANE, 1.2, 1, "#ff7b72", 26);
    paintHud();
    r.frozen = true;
    await wait(550);
    await app.learn(g.card, { chosen: g.picked >= 0 ? g.opts[g.picked].term : null, title: g.picked < 0 ? "Time's up — here it is" : undefined,
      note: r.mode === "challenge" ? `${r.hearts} ${r.hearts === 1 ? "heart" : "hearts"} left.` : null });
    if (!run) return;
    r.frozen = false; r.last = performance.now();
  }
  r.nextGateAt = r.dist + (r.mode === "relaxed" ? 100 + Math.random() * 20 : Math.max(100, 160 - r.n * 4));
  r.spawnZ = 22;
  if ((r.mode === "relaxed" && r.n >= ROUND) || r.hearts <= 0) { await wait(ok ? 800 : 0); return finish(); }
  setTimeout(() => { if (run && !run.gate) showRunning(); }, ok ? 900 : 0);
}

/* =================================================================== update */
function loop(now) {
  const r = run; if (!r) return;
  const dt = Math.min(0.04, (now - r.last) / 1000); r.last = now;
  if (!r.frozen) update(dt);
  if (run) draw();
  raf = requestAnimationFrame(loop);
}

function update(dt) {
  const r = run; r.t += dt;
  const base = r.mode === "challenge" ? Math.min(19, 11 + r.dist / 160) : Math.min(12.5, 9 + r.dist / 400);
  let target = base * (r.stumble > 0 ? 0.55 : 1);
  const g = r.gate;
  if (g) {
    if (g.picked < 0) target = r.mode === "relaxed" ? (g.z > 9 ? base : Math.max(0, (g.z - 5) * 2)) : base * 0.6;
    else target = base * 1.4;
  }
  r.speed += (target - r.speed) * Math.min(1, dt * 3);
  const dz = r.speed * dt;
  r.dist += dz; r.score += Math.round(dz * 0.4);

  if (!g && (r.mode === "challenge" || r.n < ROUND) && r.dist >= r.nextGateAt && !r.objs.some((o) => /low|high|train/.test(o.kind) && o.z > 0 && o.z < 45)) openGate();
  if (r.gate) {
    r.gate.z -= dz;
    if (r.gate.z <= 0) { resolveGate(); if (!run) return; }
  } else {
    r.spawnZ -= dz;
    if (r.spawnZ <= 0) {
      if (r.dist + FAR < r.nextGateAt - 12) spawnRow(FAR);
      r.spawnZ = r.mode === "challenge" ? Math.max(11, 20 - r.dist / 150) : 22;
    }
  }

  r.laneF += (r.lane - r.laneF) * Math.min(1, dt * 14);
  r.vy -= 28 * dt; r.y = Math.max(0, r.y + r.vy * dt); if (r.y === 0 && r.vy < 0) r.vy = 0;
  r.slideT = Math.max(0, r.slideT - dt);
  r.stumble = Math.max(0, r.stumble - dt * 1.2); r.shake = Math.max(0, r.shake - dt * 30); r.invuln = Math.max(0, r.invuln - dt);
  const hadPw = r.magnetT > 0 || r.doubleT > 0;
  r.magnetT = Math.max(0, r.magnetT - dt); r.doubleT = Math.max(0, r.doubleT - dt);
  if (hadPw && r.magnetT === 0 && r.doubleT === 0) paintHud();

  const px = r.laneF;
  for (const o of r.objs) {
    o.z -= dz;
    if (o.done) continue;
    if (o.kind === "coin" && r.magnetT > 0 && o.z < 14 && o.z > -1) { o.lane += (px - o.lane) * Math.min(1, dt * 7); o.y += (r.y + 1 - o.y) * Math.min(1, dt * 5); }
    const sameLane = Math.abs(o.lane - px) < 0.45;
    const zHit = o.z < 0.6 && o.z + (o.len || 0.5) > -0.6;
    if (!sameLane || !zHit) { if (o.z + (o.len || 0) < -0.6 && !o.passed && /low|high|train/.test(o.kind)) { o.passed = true; r.dodged++; } continue; }
    if (o.kind === "coin") { if (Math.abs((o.y || 0.7) - (r.y + 0.8)) < 1.3) { o.done = true; app.earn(r.doubleT > 0 ? 2 : 1); burst(o.lane * LANE, o.y, o.z, "#ffd166", 5); } }
    else if (o.kind === "magnet") { o.done = true; r.magnetT = 10; pw("🧲 Magnet!"); }
    else if (o.kind === "double") { o.done = true; r.doubleT = 12; pw("✖2 Double coins!"); }
    else if (o.kind === "shieldp") { o.done = true; r.shield = true; pw("🛡 Shield!"); }
    else if (r.invuln <= 0) {
      const hit = o.kind === "train" || (o.kind === "low" && r.y < 0.9) || (o.kind === "high" && r.slideT <= 0);
      if (hit) { o.done = true; crash(o.kind); if (!run) return; }
    }
  }
  r.objs = r.objs.filter((o) => o.z + (o.len || 0) > -4 && !(o.done && !/low|high|train/.test(o.kind)));
  for (const p of r.parts) { p.life -= dt; p.vy -= 18 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt - dz; }
  r.parts = r.parts.filter((p) => p.life > 0);
}

function pw(text) { const r = run; sfx.power(); const b = r.wrap.getBoundingClientRect(); app.floater(b.left + b.width / 2, b.top + b.height * 0.45, text, "#c4b5fd"); paintHud(); }

function crash(kind) {
  const r = run;
  r.stumble = 1; r.shake = 16; r.streak = 0; r.invuln = 1.3; r.speed *= 0.4; sfx.hurt();
  burst(r.laneF * LANE, 1, 0.5, "#ff7b72", 22);
  const b = r.wrap.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height * 0.5;
  const tip = kind === "low" ? "Jump ⬆" : kind === "high" ? "Slide ⬇" : "Switch lanes";
  if (r.mode === "challenge") {
    if (r.shield) { r.shield = false; app.floater(x, y, "🛡 Saved!", "#93c5fd"); }
    else { r.hearts--; app.floater(x, y, "💥 " + tip + "!", "#ff7b72"); }
    paintHud();
    if (r.hearts <= 0) finish();
  } else {
    const lose = Math.min(app.coins, 3); if (lose) app.earn(-lose);
    app.floater(x, y, "💥 " + tip + (lose ? ` −${lose}🪙` : "!"), "#ff7b72");
    paintHud();
  }
}
function burst(x, y, z, c, n) {
  for (let i = 0; i < n; i++) run.parts.push({ x, y, z, vx: (Math.random() - .5) * 6, vy: 2 + Math.random() * 5, vz: (Math.random() - .5) * 4, life: .5 + Math.random() * .5, c });
}

/* ===================================================================== draw */
function P(x, y, z) {
  const r = run, d = z + CAM_BACK;
  if (d < 0.3) return null;
  const s = r.F / d;
  return { x: r.W / 2 + (x - r.laneF * LANE * 0.35) * s, y: r.horizon + (CAM_H - y) * s * 0.62, s };
}
const fogA = (z) => Math.max(0, Math.min(1, (z - 25) / (FAR - 25)));

function draw() {
  const r = run, c = r.ctx, W = r.W, H = r.H;
  c.save();
  if (r.shake > .4 && !reducedMotion()) c.translate((Math.random() - .5) * r.shake, (Math.random() - .5) * r.shake);
  drawSky();
  drawGround();
  const items = [];
  for (const o of r.objs) if (!(o.done && !/low|high|train/.test(o.kind)) && o.z < FAR && o.z + (o.len || 0) > -3) items.push({ z: o.z, f: () => drawObj(o) });
  if (r.gate) items.push({ z: r.gate.z, f: () => drawGate(r.gate) });
  items.push({ z: 0.01, f: drawRunner });
  items.sort((a, b) => b.z - a.z).forEach((i) => i.f());
  for (const p of r.parts) { const q = P(p.x, p.y, p.z); if (!q) continue; c.globalAlpha = Math.max(0, Math.min(1, p.life * 2)); c.fillStyle = p.c; c.fillRect(q.x - q.s * .06, q.y - q.s * .06, q.s * .12, q.s * .12); }
  c.globalAlpha = 1;
  if (r.speed > 13 && !reducedMotion()) {
    c.strokeStyle = "rgba(255,255,255,.08)"; c.lineWidth = 2;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + r.t, x0 = W / 2 + Math.cos(a) * W * .45, y0 = r.horizon + Math.sin(a) * H * .5; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + Math.cos(a) * 40, y0 + Math.sin(a) * 40); c.stroke(); }
  }
  const v = c.createRadialGradient(W / 2, H * .55, H * .3, W / 2, H * .55, H * .9);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.45)");
  c.fillStyle = v; c.fillRect(0, 0, W, H);
  c.restore();
}

function drawSky() {
  const r = run, c = r.ctx, W = r.W;
  const g = c.createLinearGradient(0, 0, 0, r.horizon + 10);
  g.addColorStop(0, "#0b1030"); g.addColorStop(.55, "#2b2a6b"); g.addColorStop(.85, "#b4577a"); g.addColorStop(1, "#ffb36b");
  c.fillStyle = g; c.fillRect(0, 0, W, r.horizon + 10);
  c.fillStyle = "rgba(255,230,190,.9)"; c.beginPath(); c.arc(W * .74, r.horizon - 24, 26, 0, 6.29); c.fill();
  c.fillStyle = "rgba(255,200,150,.18)"; c.beginPath(); c.arc(W * .74, r.horizon - 24, 44, 0, 6.29); c.fill();
  if (!r.sky) {
    r.sky = Array.from({ length: 3 }, (_, layer) => {
      const bs = []; let x = -20;
      while (x < W * 2 + 40) { const w = 18 + Math.random() * 36; bs.push({ x, w, h: (20 + Math.random() * 60) * (1 - layer * .25) }); x += w + 2; }
      return bs;
    });
  }
  const cols = ["#2a1f55", "#221a47", "#1a1438"];
  r.sky.forEach((bs, layer) => {
    const off = (r.dist * (0.4 + layer * 0.35)) % (W * 2);
    for (const b of bs) {
      let x = b.x - off; if (x + b.w < 0) x += W * 2;
      c.fillStyle = cols[layer];
      c.fillRect(x, r.horizon - b.h - layer * 4, b.w, b.h + 12);
      if (layer === 2) {
        c.fillStyle = "rgba(255,210,120,.35)";
        for (let wy = r.horizon - b.h + 6; wy < r.horizon - 6; wy += 9) for (let wx = x + 4; wx < x + b.w - 4; wx += 8) if (((wx - x) * 7 + wy * 3 | 0) % 5 === 0) c.fillRect(wx, wy, 3, 4);
      }
    }
  });
}

function quad(a, b, cc, d, fill) { const c = run.ctx; if (!a || !b || !cc || !d) return; c.fillStyle = fill; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(cc.x, cc.y); c.lineTo(d.x, d.y); c.closePath(); c.fill(); }

function drawGround() {
  const r = run, c = r.ctx, W = r.W, H = r.H;
  const gg = c.createLinearGradient(0, r.horizon, 0, H); gg.addColorStop(0, "#3a3050"); gg.addColorStop(1, "#1b1628");
  c.fillStyle = gg; c.fillRect(0, r.horizon, W, H - r.horizon);
  const edge = LANE * 1.75;
  quad(P(-edge - 1, 0, -4.2), P(edge + 1, 0, -4.2), P(edge + 1, 0, FAR), P(-edge - 1, 0, FAR), "#4a4056");
  const step = 1.6, off = r.dist % step;
  for (let z = FAR - off; z > -4.4; z -= step) {
    const f = fogA(z);
    for (let l = -1; l <= 1; l++) {
      const x0 = l * LANE - LANE * .42, x1 = l * LANE + LANE * .42;
      quad(P(x0, 0, z), P(x1, 0, z), P(x1, 0, z + .45), P(x0, 0, z + .45), `rgba(${110 - f * 40},${80 - f * 20},60,${1 - f * .6})`);
    }
  }
  c.lineCap = "round";
  for (let l = -1; l <= 1; l++) for (const s of [-.28, .28]) {
    const a = P(l * LANE + s * LANE, .12, -4.2), b = P(l * LANE + s * LANE, .12, FAR);
    if (!a || !b) continue;
    const gr = c.createLinearGradient(a.x, a.y, b.x, b.y); gr.addColorStop(0, "#d9dde8"); gr.addColorStop(1, "rgba(160,160,190,.2)");
    c.strokeStyle = gr; c.lineWidth = Math.min(5, Math.max(1, a.s * .04)); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  }
  for (const side of [-1, 1]) {
    const x = side * (edge + 1.2);
    quad(P(x, 0, -4.2), P(x, 2.6, -4.2), P(x, 2.6, FAR), P(x, 0, FAR), side < 0 ? "#2b2440" : "#302848");
    const ls = 12, lo = r.dist % ls;
    for (let z = FAR - lo; z > -2; z -= ls) {
      const top = P(x - side * .1, 3.4, z), bot = P(x - side * .1, 0, z);
      if (!top || !bot) continue;
      c.strokeStyle = "rgba(20,16,30,.9)"; c.lineWidth = Math.max(1, top.s * .08); c.beginPath(); c.moveTo(bot.x, bot.y); c.lineTo(top.x, top.y); c.stroke();
      c.fillStyle = `rgba(255,214,140,${.9 - fogA(z) * .7})`; c.beginPath(); c.arc(top.x, top.y, Math.max(1.5, top.s * .14), 0, 6.29); c.fill();
      c.fillStyle = `rgba(255,214,140,${Math.max(0, .12 - fogA(z) * .1)})`; c.beginPath(); c.arc(top.x, top.y, Math.max(3, top.s * .6), 0, 6.29); c.fill();
    }
  }
  const fg = c.createLinearGradient(0, r.horizon - 4, 0, r.horizon + H * .18);
  fg.addColorStop(0, "rgba(255,170,130,.55)"); fg.addColorStop(1, "rgba(255,170,130,0)");
  c.fillStyle = fg; c.fillRect(0, r.horizon - 4, W, H * .18 + 4);
}

function box(x, y0, y1, z0, z1, w, front, side, top) {
  const hw = w / 2;
  const f = [P(x - hw, y0, z0), P(x + hw, y0, z0), P(x + hw, y1, z0), P(x - hw, y1, z0)];
  if (f.some((p) => !p)) return f;
  const b = [P(x - hw, y0, z1), P(x + hw, y0, z1), P(x + hw, y1, z1), P(x - hw, y1, z1)];
  if (b.every(Boolean)) {
    quad(f[3], f[2], b[2], b[3], top);
    const camX = run.laneF * LANE * .35;
    if (x - hw > camX) quad(f[0], f[3], b[3], b[0], side); else if (x + hw < camX) quad(f[1], f[2], b[2], b[1], side);
  }
  quad(f[0], f[1], f[2], f[3], front);
  return f;
}

function drawObj(o) {
  const r = run, c = r.ctx, x = o.lane * LANE, fa = fogA(Math.max(0, o.z));
  c.globalAlpha = 1 - fa * .85;
  if (o.kind === "train") {
    const cols = [["#e5484d", "#a3282c", "#f58a8d"], ["#3b82f6", "#1d4ed8", "#93c5fd"], ["#f59e0b", "#b45309", "#fcd34d"]][o.hue];
    const f = box(x, 0.15, 3.1, Math.max(o.z, -2.5), o.z + o.len, LANE * .92, cols[0], cols[1], cols[2]);
    if (f[0] && o.z > -2.5) {
      const s = f[0].s, w = f[2].x - f[3].x;
      c.fillStyle = "#1e2a44"; c.fillRect(f[3].x + w * .15, f[3].y + s * .35, w * .7, s * .8);
      c.fillStyle = "rgba(160,220,255,.35)"; c.fillRect(f[3].x + w * .18, f[3].y + s * .38, w * .25, s * .3);
      c.fillStyle = "#fff6c2"; for (const k of [.2, .8]) { c.beginPath(); c.arc(f[0].x + (f[1].x - f[0].x) * k, f[0].y - s * .5, s * .13, 0, 6.29); c.fill(); }
    }
  } else if (o.kind === "low") {
    const f = box(x, 0, 0.95, o.z, o.z + .25, LANE * .9, "#f3f4f6", "#9ca3af", "#e5e7eb");
    if (f[0]) {
      const s = f[0].s, w = f[2].x - f[3].x, hgt = f[0].y - f[3].y;
      c.fillStyle = "#e5484d"; for (let i = 0; i < 4; i++) c.fillRect(f[3].x + w * (i / 4 + .06), f[3].y, w * .12, hgt * .55);
      c.fillStyle = "#6b7280"; c.fillRect(f[0].x, f[3].y + hgt * .5, s * .08, hgt * .5); c.fillRect(f[1].x - s * .08, f[3].y + hgt * .5, s * .08, hgt * .5);
    }
  } else if (o.kind === "high") {
    for (const sx of [-.45, .45]) box(x + sx * LANE, 0, 2.3, o.z, o.z + .15, .14, "#374151", "#1f2937", "#4b5563");
    const f = box(x, 1.45, 2.3, o.z, o.z + .2, LANE * .95, "#facc15", "#a16207", "#fde68a");
    if (f[0]) { const s = f[0].s; c.fillStyle = "#1f2937"; c.font = `800 ${Math.max(8, s * .42)}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("⬇ SLIDE", (f[0].x + f[1].x) / 2, (f[0].y + f[3].y) / 2); }
  } else {
    const q = P(x, o.y || .7, o.z); if (!q) { c.globalAlpha = 1; return; }
    const rad = q.s * .32;
    if (o.kind === "coin") {
      const w = rad * Math.abs(Math.cos(r.t * 6 + o.z));
      c.fillStyle = "#ffd166"; c.strokeStyle = "#b77400"; c.lineWidth = Math.max(1, rad * .18);
      c.beginPath(); c.ellipse(q.x, q.y, Math.max(1, w), rad, 0, 0, 6.29); c.fill(); c.stroke();
    } else {
      c.fillStyle = "rgba(167,139,250,.35)"; c.beginPath(); c.arc(q.x, q.y, rad * 1.8, 0, 6.29); c.fill();
      c.fillStyle = "#7c3aed"; c.beginPath(); c.arc(q.x, q.y, rad * 1.2, 0, 6.29); c.fill();
      c.font = `${Math.max(8, rad * 1.5)}px sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = "#fff"; c.fillText(o.kind === "magnet" ? "🧲" : o.kind === "double" ? "✖2" : "🛡", q.x, q.y + 1);
    }
  }
  c.globalAlpha = 1;
}

function drawGate(g) {
  const r = run, c = r.ctx, z = Math.max(g.z, -0.5), fa = fogA(z);
  c.globalAlpha = 1 - fa * .7;
  const edge = LANE * 1.6;
  for (const sx of [-edge, edge]) box(sx, 0, 4.2, z, z + .3, .35, "#22d3ee", "#0e7490", "#67e8f9");
  box(0, 3.8, 4.4, z, z + .3, edge * 2 + .35, "#22d3ee", "#0e7490", "#67e8f9");
  for (let l = -1; l <= 1; l++) {
    const a = P(l * LANE - LANE * .45, 0, z), b = P(l * LANE + LANE * .45, 3.7, z), lb = P(l * LANE, 2.7, z);
    if (!a || !b || !lb) continue;
    const sel = g.picked === l + 1, s = lb.s;
    c.fillStyle = sel ? "rgba(255,176,32,.35)" : `rgba(34,211,238,${.12 + .06 * Math.sin(r.t * 5 + l)})`;
    c.fillRect(a.x, b.y, b.x - a.x, a.y - b.y);
    c.fillStyle = sel ? "#ffb020" : "#0f1a33"; c.strokeStyle = sel ? "#ffe0a3" : "#67e8f9"; c.lineWidth = Math.max(1.5, s * .06);
    c.beginPath(); c.roundRect ? c.roundRect(lb.x - s * .55, lb.y - s * .55, s * 1.1, s * 1.1, s * .2) : c.rect(lb.x - s * .55, lb.y - s * .55, s * 1.1, s * 1.1); c.fill(); c.stroke();
    c.fillStyle = sel ? "#2a1a00" : "#fff"; c.font = `800 ${Math.max(9, s * .8)}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("ABC"[l + 1], lb.x, lb.y + 1);
  }
  c.globalAlpha = 1;
}

function drawRunner() {
  const r = run, c = r.ctx;
  const base = P(r.laneF * LANE, r.y, 0), ground = P(r.laneF * LANE, 0, 0);
  if (!base) return;
  const U = base.s * 0.36;                       // body unit (~ head height)
  const ph = r.dist * 1.25;
  const sliding = r.slideT > 0, air = r.y > 0.05;
  // soft shadow shrinks as the runner rises
  const sh = 1 - Math.min(.6, r.y * .15);
  c.fillStyle = `rgba(0,0,0,${.38 * sh})`; c.beginPath(); c.ellipse(ground.x, ground.y, U * 1.3 * sh, U * .32 * sh, 0, 0, 6.29); c.fill();
  if (r.invuln > 0 && Math.floor(r.t * 14) % 2 === 0) return;
  c.save(); c.translate(base.x, base.y);
  const lean = (r.lane - r.laneF) * -0.35;       // bank into lane changes
  c.rotate(r.stumble > 0 ? Math.sin(r.t * 30) * .2 * r.stumble : lean);
  c.lineCap = "round"; c.lineJoin = "round";
  const skin = "#e9b48f", skinD = "#c98f6a", pants = "#27324f", pantsD = "#1b2440", shoe = "#f8fafc", sole = "#ef4444", hair = "#3b2a20";
  const hoodie = r.sk.a, trim = r.sk.b;
  const bob = sliding || air ? 0 : Math.abs(Math.sin(ph)) * U * .12;

  const seg = (x0, y0, x1, y1, w0, w1, col) => {   // tapered limb segment
    const a = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2, cx = Math.cos(a), sy = Math.sin(a);
    c.fillStyle = col; c.beginPath();
    c.moveTo(x0 + cx * w0 / 2, y0 + sy * w0 / 2); c.lineTo(x1 + cx * w1 / 2, y1 + sy * w1 / 2);
    c.lineTo(x1 - cx * w1 / 2, y1 - sy * w1 / 2); c.lineTo(x0 - cx * w0 / 2, y0 - sy * w0 / 2); c.closePath(); c.fill();
    c.beginPath(); c.arc(x1, y1, w1 / 2, 0, 6.29); c.fill();
  };
  const shoeAt = (x, y, tilt) => {
    c.save(); c.translate(x, y); c.rotate(tilt);
    c.fillStyle = shoe; c.beginPath(); c.ellipse(0, 0, U * .32, U * .17, 0, 0, 6.29); c.fill();
    c.fillStyle = sole; c.fillRect(-U * .32, U * .06, U * .64, U * .08);
    c.restore();
  };
  // leg: thigh + shin with a bent knee. k = stride phase (-1..1)
  const leg = (k, col, colD) => {
    let hipX = k * U * .08, hipY = -U * 2.05 + bob;
    let kneeX, kneeY, footX, footY;
    if (air) { kneeX = hipX + k * U * .25; kneeY = hipY + U * .55; footX = hipX + k * U * .05; footY = hipY + U * 1.0; }
    else {
      const lift = Math.max(0, -Math.cos(ph + (k > 0 ? 0 : Math.PI)));
      kneeX = hipX + k * U * .18; kneeY = hipY + U * .95 - lift * U * .35;
      footX = hipX + k * U * .12; footY = -lift * U * .55 + (1 - lift) * 0;
    }
    seg(hipX, hipY, kneeX, kneeY, U * .5, U * .4, col);
    seg(kneeX, kneeY, footX, footY - U * .12, U * .4, U * .3, colD);
    shoeAt(footX, footY - U * .05, k * .15);
  };

  if (sliding) {
    // knee-slide: torso leaning back, legs forward and low
    seg(0, -U * .55, U * 1.1, -U * .3, U * .5, U * .4, pants);
    seg(U * 1.1, -U * .3, U * 1.7, -U * .15, U * .4, U * .3, pantsD); shoeAt(U * 1.85, -U * .12, .1);
    c.save(); c.translate(-U * .1, -U * .7); c.rotate(-1.0);
    drawTorso(0, 0); c.restore();
    c.fillStyle = skin; c.beginPath(); c.arc(-U * 1.25, -U * 1.35, U * .42, 0, 6.29); c.fill();
    c.fillStyle = hair; c.beginPath(); c.arc(-U * 1.25, -U * 1.4, U * .43, Math.PI * .9, Math.PI * 2.1); c.fill();
    c.fillStyle = trim; c.beginPath(); c.ellipse(-U * 1.25, -U * 1.62, U * .45, U * .2, -1, 0, 6.29); c.fill();
    c.restore();
    return;
  }
  const s1 = air ? .9 : Math.sin(ph), s2 = -s1;
  // back leg, back arm, torso, front arm, front leg, head
  leg(s2, pantsD, "#141b33");
  const shY = -U * 3.55 + bob;
  arm(-1, s1);
  c.save(); c.translate(0, bob); drawTorso(0, -U * 2.15); c.restore();
  leg(s1, pants, pantsD);
  arm(1, s2);
  // head seen from behind: hair, ears, backwards cap
  const hy = shY - U * .55;
  c.fillStyle = skinD; c.beginPath(); c.ellipse(-U * .44, hy + U * .05, U * .1, U * .16, 0, 0, 6.29); c.ellipse(U * .44, hy + U * .05, U * .1, U * .16, 0, 0, 6.29); c.fill();
  c.fillStyle = skin; c.beginPath(); c.ellipse(0, hy + U * .28, U * .2, U * .16, 0, 0, 6.29); c.fill();   // neck
  const hg = c.createRadialGradient(-U * .15, hy - U * .15, U * .05, 0, hy, U * .5);
  hg.addColorStop(0, "#5a4033"); hg.addColorStop(1, hair);
  c.fillStyle = hg; c.beginPath(); c.ellipse(0, hy, U * .46, U * .5, 0, 0, 6.29); c.fill();
  c.fillStyle = trim; c.beginPath(); c.ellipse(0, hy - U * .22, U * .48, U * .32, 0, Math.PI, 0); c.fill();   // cap crown
  c.fillRect(-U * .48, hy - U * .24, U * .96, U * .1);
  c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(0, hy - U * .05, U * .3, U * .1, 0, 0, Math.PI); c.fill();  // snap strap
  c.fillStyle = trim; c.beginPath(); c.ellipse(0, hy + U * .02, U * .22, U * .08, 0, 0, 6.29); c.fill();              // backwards brim
  if (r.shield) { c.strokeStyle = `rgba(147,197,253,${.5 + .2 * Math.sin(r.t * 6)})`; c.lineWidth = 3; c.beginPath(); c.ellipse(0, -U * 2.2, U * 1.6, U * 2.6, 0, 0, 6.29); c.stroke(); }
  if (r.magnetT > 0) { c.strokeStyle = `rgba(167,139,250,${.45 + .2 * Math.sin(r.t * 8)})`; c.lineWidth = 2; c.beginPath(); c.arc(0, -U * 2.2, U * 2.6, 0, 6.29); c.stroke(); }
  c.restore();

  function arm(side, k) {
    const sx = side * U * .62, sy = shY + U * .35;
    const ex = sx + side * U * .18 + (air ? side * U * .2 : 0), ey = sy + U * .55 + (air ? -U * .7 : k * U * .1);
    const hx = ex + (air ? side * U * .1 : k * U * .15), hy2 = ey + (air ? -U * .45 : U * .5 - Math.abs(k) * U * .15);
    seg(sx, sy, ex, ey, U * .34, U * .28, side < 0 ? "#b86f00" : hoodie);
    seg(ex, ey, hx, hy2, U * .28, U * .22, side < 0 ? skinD : skin);
  }
  function drawTorso(x, y) {
    // hoodie body with shading, hood lump and backpack
    const tg = c.createLinearGradient(x - U * .8, 0, x + U * .8, 0);
    tg.addColorStop(0, shade(hoodie, -.25)); tg.addColorStop(.5, hoodie); tg.addColorStop(1, shade(hoodie, -.3));
    c.fillStyle = tg; c.beginPath();
    c.moveTo(x - U * .7, y); c.quadraticCurveTo(x - U * .82, y - U * .9, x - U * .6, y - U * 1.45);
    c.quadraticCurveTo(x, y - U * 1.62, x + U * .6, y - U * 1.45); c.quadraticCurveTo(x + U * .82, y - U * .9, x + U * .7, y);
    c.quadraticCurveTo(x, y + U * .12, x - U * .7, y); c.fill();
    c.fillStyle = shade(hoodie, -.15); c.beginPath(); c.ellipse(x, y - U * 1.38, U * .42, U * .2, 0, 0, 6.29); c.fill();   // hood
    c.fillStyle = shade(trim, -.1); c.beginPath();                                                                      // backpack
    c.roundRect ? c.roundRect(x - U * .45, y - U * 1.2, U * .9, U * .95, U * .2) : c.rect(x - U * .45, y - U * 1.2, U * .9, U * .95); c.fill();
    c.fillStyle = shade(trim, .25); c.fillRect(x - U * .3, y - U * .8, U * .6, U * .08);
    c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(x - U * .06, y - U * 1.1, U * .12, U * .25);
    c.fillStyle = shade(hoodie, -.35); c.fillRect(x - U * .7, y - U * .1, U * 1.4, U * .12);                         // waistband
  }
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16), f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function finish() {
  const r = run; if (!r) return; stop();
  app.results({ score: r.score, correct: r.correct, total: r.n, missed: r.missed,
    extra: [[Math.round(r.dist) + " m", "ran"], [r.dodged, "dodged"]] });
}

function demo(el) {
  el.classList.add("run-demo");
  el.append(h("div", { class: "rd-road" }), h("div", { class: "rd-coin" }), h("div", { class: "rd-bar" }),
    h("div", { class: "rd-gate" }, h("b", {}, "A"), h("b", { class: "win" }, "B"), h("b", {}, "C")), h("div", { class: "rd-runner" }));
}
