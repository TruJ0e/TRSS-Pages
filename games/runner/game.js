/* Term Runner — a rooftop free-run with study gates.
 *
 * Run across city rooftops at sunset. Controls: swipe ← → to change lanes,
 * swipe ↑ to jump, swipe ↓ to slide (also the four buttons, arrow keys,
 * WASD, space).
 * Hazards: gaps between buildings and AC units (jump), hanging pipes and
 * signs (slide), water towers and chimney stacks (change lanes).
 * Pickups: coin trails and arcs, 🧲 magnet, ✖2 double coins, 🛡 shield.
 * Every so often a gate stands on a roof with lanes A / B / C; the meaning
 * is shown above and the terms as buttons below — tap one and the runner
 * takes that lane through the gate.
 * Relaxed: 10 gates, the runner waits at each gate, falls/crashes only cost
 * coins. Challenge: faster, endless, falls/crashes and wrong gates cost hearts.
 */
import { createApp, makeDeck, pickDistractors, shuffle, h, wait, defOf, say, sfx, sayBtn, answerList, reducedMotion, fx, skin } from "../common/kit.js?v=11";

const ROUND = 10;
const LANE = 2.2;                  // lane width (world units)
const CAM_H = 5.6, CAM_BACK = 8.5; // higher, further-back camera
const FAR = 110;
const ROOF_W = LANE * 1.9;         // half-width of a roof
let run = null, raf = 0;

const app = createApp({
  id: "runner", title: "Term Runner", emoji: "🏃",
  tagline: "Free-run across the city rooftops — then dash through the gate with the right term.",
  steps: ["Swipe ← → to switch lanes, ↑ to jump gaps and AC units, ↓ to slide under pipes. Water towers? Change lanes!",
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
  stop(); fx.quiet = false;
  const canvas = h("canvas", { class: "road", "aria-label": "Rooftops. Swipe to move: left, right, up to jump, down to slide." });
  run = {
    mode, cards, deck: makeDeck(focus ? [...new Set([...focus, ...cards])] : cards), canvas, ctx: canvas.getContext("2d"),
    sk: app.skin("runner"), n: 0, correct: 0, score: 0, streak: 0, hearts: 3, missed: [], frozen: false, last: performance.now(),
    shield: mode === "challenge" && app.has("boost-shield"), magnetT: 0, doubleT: 0, invuln: 0,
    dist: 0, speed: 0, t: 0, laneF: 0, lane: 0, y: 0, vy: 0, slideT: 0, stumble: 0, shake: 0, fallT: 0,
    objs: [], parts: [], roofs: [], roofEnd: 0, spawnZ: 30, gate: null, nextGateAt: mode === "relaxed" ? 110 : 150, dodged: 0,
  };
  // the first long roof, then buildings follow with gaps
  addRoof(-10, 70); decorate(run.roofs[0]);
  extendRoofs();
  for (let z = 30; z < FAR; z += 22) if (z < run.nextGateAt - 14) spawnRow(z);
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

const ROOF_COLS = [["#6e5a78", "#4a3c58", "#2c2238"], ["#7d6552", "#574536", "#33271e"], ["#5d6a7c", "#3f4858", "#252b36"], ["#7c5c66", "#573f47", "#33242a"]];
function addRoof(z0, len) {
  const r = run;
  r.roofs.push({ z0, z1: z0 + len, h: (Math.random() * 3) | 0, col: ROOF_COLS[(Math.random() * ROOF_COLS.length) | 0], seed: Math.random() * 100 });
  r.roofEnd = z0 + len;
}

function resize() {
  const r = run; if (!r) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  r.W = r.wrap.clientWidth; r.H = r.wrap.clientHeight;
  r.canvas.width = r.W * dpr; r.canvas.height = r.H * dpr;
  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  r.horizon = r.H * 0.2;
  r.F = r.W * 1.15;
  r.sky = null;
}

/* ================================================================ controls */
function showRunning() {
  const r = run; if (!r) return;
  r.q.replaceChildren(h("div", { class: "qcard waitcard slim" }, h("div", {}, "⬅ ➡ switch · ⬆ jump gaps · ⬇ slide · a gate is coming!")));
  const b = (dir, label, aria) => h("button", { type: "button", "aria-label": aria, onpointerdown: (e) => { e.preventDefault(); act(dir); } }, label);
  r.a.replaceChildren(h("div", { class: "pad4" }, b("left", "◀", "Move left"), b("up", "▲", "Jump"), b("down", "▼", "Slide"), b("right", "▶", "Move right")));
}
function act(dir) {
  const r = run; if (!r || r.frozen || r.fallT > 0) return;
  if (r.gate && r.gate.picked < 0 && (dir === "left" || dir === "right")) return;
  if (dir === "left" && r.lane > -1) { r.lane--; sfx.tap(); }
  else if (dir === "right" && r.lane < 1) { r.lane++; sfx.tap(); }
  else if (dir === "up" && r.y <= 0.001) { r.vy = 10; r.slideT = 0; sfx.jump(); }
  else if (dir === "down") { if (r.y > 0.05) r.vy = -16; r.slideT = 0.75; sfx.whoosh(); }
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
// per-lane obstacle kinds: "ac" (jump), "pipe" (slide), "tank" (switch lane)
const EASY = [["ac", null, null], [null, "pipe", null], [null, null, "tank"], ["tank", null, null], [null, "ac", null], ["pipe", null, null], [null, "tank", null], [null, null, "ac"]];
const HARD = [["ac", "ac", "ac"], ["pipe", "pipe", "pipe"], ["tank", "tank", null], [null, "tank", "tank"], ["tank", "ac", "tank"], ["pipe", "tank", "ac"], ["ac", "pipe", "tank"], ["tank", null, "tank"]];
function spawnRow(z) {
  const r = run;
  if (!onRoof(z - 2) || !onRoof(z + 4)) return;
  const gz = r.gate ? r.gate.z : r.nextGateAt - r.dist;
  if (Math.abs(z - gz) < 14) return;          // keep obstacles away from roof edges
  const hard = r.mode === "challenge" && r.dist > 120;
  const pool = hard && Math.random() < 0.6 ? HARD : EASY;
  const pat = pool[(Math.random() * pool.length) | 0];
  pat.forEach((kind, i) => { if (kind) r.objs.push({ kind, lane: i - 1, z, len: kind === "tank" ? 2.2 : 0.6 }); });
  const free = pat.map((k, i) => (k ? null : i - 1)).filter((x) => x !== null);
  const ac = pat.findIndex((k) => k === "ac");
  if (ac >= 0 && Math.random() < 0.6) {
    for (let i = 0; i < 5; i++) r.objs.push({ kind: "coin", lane: ac - 1, z: z - 2.4 + i * 1.2, y: 0.8 + Math.sin((i / 4) * Math.PI) * 1.7 });
  } else if (free.length) {
    const l = free[(Math.random() * free.length) | 0];
    for (let i = 0; i < 6; i++) r.objs.push({ kind: "coin", lane: l, z: z + i * 1.4, y: 0.8 });
  }
  if (Math.random() < 0.12) r.objs.push({ kind: ["magnet", "double", "shieldp"][(Math.random() * 3) | 0], lane: free.length ? free[0] : 0, z: z + 9, y: 1 });
}
/* Scenery that never blocks a lane: antennas, dishes, vents, skylights on the
   roof edges, plus neighbouring buildings of different heights beside the run. */
function decorate(b) {
  b.decor = [];
  for (let z = b.z0 + 3; z < b.z1 - 2; z += 5 + Math.random() * 6) {
    const side = Math.random() < .5 ? -1 : 1;
    b.decor.push({ kind: ["antenna", "dish", "vent", "skylight", "vent"][(Math.random() * 5) | 0], x: side * (ROOF_W - .55), dz: z - b.z0 });
  }
  b.nb = [-1, 1].map((side) => ({ side, h: -3 - Math.random() * 6, gap: 4.5 + Math.random() * 4, col: ROOF_COLS[(Math.random() * ROOF_COLS.length) | 0] }));
}
function onRoof(z) { return run.roofs.some((b) => z >= b.z0 && z <= b.z1); }
function extendRoofs() {
  const r = run;
  while (r.roofEnd < FAR + 40) {
    // no gaps near an upcoming gate so questions never overlap a jump
    const gateZ = r.gate ? r.gate.z : r.nextGateAt - r.dist;
    const nearGate = Math.abs(r.roofEnd - gateZ) < 25;
    const gap = nearGate ? 0 : (r.mode === "challenge" ? 3 + Math.min(2.2, r.dist / 400) : 3);
    addRoof(r.roofEnd + gap, 34 + Math.random() * 30);
    decorate(r.roofs[r.roofs.length - 1]);
  }
}

/* ==================================================================== gates */
function openGate() {
  const r = run;
  const card = r.deck.next();
  const opts = shuffle([card, ...pickDistractors(r.cards, card.id, 2)]);
  r.gate = { card, opts, correct: opts.indexOf(card), z: 44, picked: -1 };
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
  r.spawnZ = 24;
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
  if (r.demo) autopilot();
  // falling into a gap: short drop, then a rescue back onto the roof
  if (r.fallT > 0) {
    r.fallT -= dt; r.y -= dt * 14; r.speed *= 0.9;
    if (r.fallT <= 0) { r.y = 0; r.vy = 0; r.invuln = 1.5; r.objs = r.objs.filter((o) => o.z > 6); nudgeToRoof(); }
    return;
  }
  const base = r.mode === "challenge" ? Math.min(19, 11 + r.dist / 160) : Math.min(12.5, 9 + r.dist / 400);
  let target = base * (r.stumble > 0 ? 0.55 : 1);
  const g = r.gate;
  if (g) {
    if (g.picked < 0) target = r.mode === "relaxed" ? (g.z > 10 ? base : Math.max(0, (g.z - 6) * 2)) : base * 0.6;
    else target = base * 1.4;
  }
  r.speed += (target - r.speed) * Math.min(1, dt * 3);
  const dz = r.speed * dt;
  r.dist += dz; r.score += Math.round(dz * 0.4);
  for (const b of r.roofs) { b.z0 -= dz; b.z1 -= dz; }
  r.roofEnd -= dz;
  r.roofs = r.roofs.filter((b) => b.z1 > -15);
  extendRoofs();

  if (!g && (r.mode === "challenge" || r.n < ROUND) && r.dist >= r.nextGateAt && !r.objs.some((o) => /ac|pipe|tank/.test(o.kind) && o.z > 0 && o.z < 50) && onRoof(44)) openGate();
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
  r.vy -= 30 * dt; r.y = Math.max(0, r.y + r.vy * dt); if (r.y === 0 && r.vy < 0) r.vy = 0;
  r.slideT = Math.max(0, r.slideT - dt);
  r.stumble = Math.max(0, r.stumble - dt * 1.2); r.shake = Math.max(0, r.shake - dt * 30); r.invuln = Math.max(0, r.invuln - dt);
  const hadPw = r.magnetT > 0 || r.doubleT > 0;
  r.magnetT = Math.max(0, r.magnetT - dt); r.doubleT = Math.max(0, r.doubleT - dt);
  if (hadPw && r.magnetT === 0 && r.doubleT === 0) paintHud();

  // gap check: feet over empty air while on the ground = fall
  if (r.y < 0.05 && !onRoof(0) && r.invuln <= 0) { fall(); return; }

  const px = r.laneF;
  for (const o of r.objs) {
    o.z -= dz;
    if (o.done) continue;
    if (o.kind === "coin" && r.magnetT > 0 && o.z < 14 && o.z > -1) { o.lane += (px - o.lane) * Math.min(1, dt * 7); o.y += (r.y + 1 - o.y) * Math.min(1, dt * 5); }
    const sameLane = Math.abs(o.lane - px) < 0.45;
    const zHit = o.z < 0.6 && o.z + (o.len || 0.5) > -0.6;
    if (!sameLane || !zHit) { if (o.z + (o.len || 0) < -0.6 && !o.passed && /ac|pipe|tank/.test(o.kind)) { o.passed = true; r.dodged++; } continue; }
    if (o.kind === "coin") { if (Math.abs((o.y || 0.8) - (r.y + 0.9)) < 1.3) { o.done = true; app.earn(r.doubleT > 0 ? 2 : 1); burst(o.lane * LANE, o.y, o.z, "#ffd166", 5); } }
    else if (o.kind === "magnet") { o.done = true; r.magnetT = 10; pw("🧲 Magnet!"); }
    else if (o.kind === "double") { o.done = true; r.doubleT = 12; pw("✖2 Double coins!"); }
    else if (o.kind === "shieldp") { o.done = true; r.shield = true; pw("🛡 Shield!"); }
    else if (r.invuln <= 0) {
      const hit = o.kind === "tank" || (o.kind === "ac" && r.y < 1.0) || (o.kind === "pipe" && r.slideT <= 0);
      if (hit) { o.done = true; crash(o.kind); if (!run) return; }
    }
  }
  r.objs = r.objs.filter((o) => o.z + (o.len || 0) > -4 && !(o.done && !/ac|pipe|tank/.test(o.kind)));
  for (const p of r.parts) { p.life -= dt; p.vy -= 18 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt - dz; }
  r.parts = r.parts.filter((p) => p.life > 0);
}

function nudgeToRoof() {
  const r = run;
  // put the runner at the start of the next roof
  const next = r.roofs.find((b) => b.z0 > -1);
  if (next && next.z0 > 0) { const d = next.z0 + 1; for (const b of r.roofs) { b.z0 -= d; b.z1 -= d; } r.roofEnd -= d; for (const o of r.objs) o.z -= d; if (r.gate) r.gate.z -= d; }
}

function fall() {
  const r = run;
  r.fallT = 0.7; r.shake = 10; sfx.hurt();
  const b = r.wrap.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height * 0.5;
  if (r.mode === "challenge") {
    if (r.shield) { r.shield = false; app.floater(x, y, "🛡 Saved!", "#93c5fd"); }
    else { r.hearts--; app.floater(x, y, "😱 Jump the gaps ⬆!", "#ff7b72"); }
    paintHud();
    if (r.hearts <= 0) setTimeout(finish, 700);
  } else {
    const lose = Math.min(app.coins, 3); if (lose) app.earn(-lose);
    app.floater(x, y, "😱 Jump the gaps ⬆" + (lose ? ` −${lose}🪙` : "!"), "#ff7b72");
  }
}

function pw(text) { const r = run; sfx.power(); const b = r.wrap.getBoundingClientRect(); app.floater(b.left + b.width / 2, b.top + b.height * 0.45, text, "#c4b5fd"); paintHud(); }

function crash(kind) {
  const r = run;
  r.stumble = 1; r.shake = 16; r.streak = 0; r.invuln = 1.3; r.speed *= 0.4; sfx.hurt();
  burst(r.laneF * LANE, 1, 0.5, "#ff7b72", 22);
  const b = r.wrap.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height * 0.5;
  const tip = kind === "ac" ? "Jump ⬆" : kind === "pipe" ? "Slide ⬇" : "Switch lanes";
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
  return { x: r.W / 2 + (x - r.laneF * LANE * 0.3) * s, y: r.horizon + (CAM_H - y) * s * 0.55, s };
}
const fogA = (z) => Math.max(0, Math.min(1, (z - 30) / (FAR - 30)));
function quad(a, b, cc, d, fill) { const c = run.ctx; if (!a || !b || !cc || !d) return; c.fillStyle = fill; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(cc.x, cc.y); c.lineTo(d.x, d.y); c.closePath(); c.fill(); }

function draw() {
  const r = run, c = r.ctx, W = r.W, H = r.H;
  c.save();
  if (r.shake > .4 && !reducedMotion()) c.translate((Math.random() - .5) * r.shake, (Math.random() - .5) * r.shake);
  drawSky();
  drawCityBelow();
  // roofs far to near, with everything standing on them interleaved by depth
  const items = [];
  for (const b of r.roofs) if (b.z0 < FAR) items.push({ z: b.z1 + 1000, f: () => drawRoof(b) });   // roofs first
  for (const o of r.objs) if (!(o.done && !/ac|pipe|tank/.test(o.kind)) && o.z < FAR && o.z + (o.len || 0) > -4) items.push({ z: o.z, f: () => drawObj(o) });
  if (r.gate) items.push({ z: r.gate.z, f: () => drawGate(r.gate) });
  items.push({ z: 0.01, f: drawRunner });
  items.sort((a, b) => b.z - a.z).forEach((i) => i.f());
  for (const p of r.parts) { const q = P(p.x, p.y, p.z); if (!q) continue; c.globalAlpha = Math.max(0, Math.min(1, p.life * 2)); c.fillStyle = p.c; c.fillRect(q.x - q.s * .05, q.y - q.s * .05, q.s * .1, q.s * .1); }
  c.globalAlpha = 1;
  if (r.speed > 14 && !reducedMotion()) {
    c.strokeStyle = "rgba(255,255,255,.07)"; c.lineWidth = 2;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + r.t, x0 = W / 2 + Math.cos(a) * W * .45, y0 = r.horizon + Math.sin(a) * H * .5; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + Math.cos(a) * 40, y0 + Math.sin(a) * 40); c.stroke(); }
  }
  const v = c.createRadialGradient(W / 2, H * .55, H * .35, W / 2, H * .55, H * .95);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(10,0,20,.45)");
  c.fillStyle = v; c.fillRect(0, 0, W, H);
  c.restore();
}

function drawSky() {
  const r = run, c = r.ctx, W = r.W, H = r.H;
  const g = c.createLinearGradient(0, 0, 0, r.horizon + 20);
  g.addColorStop(0, "#1a1446"); g.addColorStop(.5, "#5b2a6e"); g.addColorStop(.85, "#e0705a"); g.addColorStop(1, "#ffc27a");
  c.fillStyle = g; c.fillRect(0, 0, W, r.horizon + 20);
  c.fillStyle = "rgba(255,236,200,.95)"; c.beginPath(); c.arc(W * .72, r.horizon - 6, 22, Math.PI, 0); c.fill();
  c.fillStyle = "rgba(255,190,130,.2)"; c.beginPath(); c.arc(W * .72, r.horizon - 6, 46, Math.PI, 0); c.fill();
  // distant skyline on the horizon (parallax)
  if (!r.sky) {
    r.sky = Array.from({ length: 2 }, (_, layer) => {
      const bs = []; let x = -20;
      while (x < W * 2 + 40) { const w = 14 + Math.random() * 30; bs.push({ x, w, h: (10 + Math.random() * 34) * (1 - layer * .3), spire: Math.random() < .15 }); x += w + 2; }
      return bs;
    });
  }
  r.sky.forEach((bs, layer) => {
    const off = (r.dist * (0.25 + layer * 0.25)) % (W * 2);
    c.fillStyle = layer ? "#3a1f4d" : "#4b2a5c";
    for (const b of bs) {
      let x = b.x - off; if (x + b.w < 0) x += W * 2;
      c.fillRect(x, r.horizon - b.h, b.w, b.h + 2);
      if (b.spire) c.fillRect(x + b.w / 2 - 1, r.horizon - b.h - 10, 2, 10);
    }
  });
}

/* The street far below, visible through the gaps between buildings. */
function drawCityBelow() {
  const r = run, c = r.ctx, W = r.W, H = r.H;
  const g = c.createLinearGradient(0, r.horizon, 0, H);
  g.addColorStop(0, "#2a1838"); g.addColorStop(1, "#0b0712");
  c.fillStyle = g; c.fillRect(0, r.horizon, W, H - r.horizon);
  // twinkling windows and street lights deep below
  for (let i = 0; i < 60; i++) {
    const sx = ((i * 97.3 + r.dist * 3) % (W + 40)) - 20, sy = r.horizon + 10 + ((i * 53.7) % (H - r.horizon - 10));
    c.fillStyle = i % 5 === 0 ? "rgba(255,210,120,.5)" : "rgba(160,190,255,.18)";
    c.fillRect(sx, sy, 2, 2);
  }
}

function drawRoof(b) {
  const r = run, c = r.ctx;
  const z0 = Math.max(b.z0, -CAM_BACK + 0.6), z1 = Math.min(b.z1, FAR);
  if (z1 <= z0) return;
  const top = 0, w = ROOF_W, depth = 9;
  const [surf, side, dark] = b.col;
  const f = fogA(z0);
  c.globalAlpha = 1 - f * .6;
  // neighbouring buildings beside the run (lower, so the city feels deep)
  for (const nb of b.nb || []) {
    const x0 = nb.side * (w + nb.gap), x1 = nb.side * (w + nb.gap + 6);
    quad(P(x0, nb.h, z0), P(x1, nb.h, z0), P(x1, nb.h, z1), P(x0, nb.h, z1), nb.col[0]);
    quad(P(x0, nb.h, z0), P(x0, nb.h, z1), P(x0, nb.h - 12, z1), P(x0, nb.h - 12, z0), nb.col[1]);
    const fa2 = P(x0, nb.h, z0), fb2 = P(x1, nb.h - 12, z0);
    if (fa2 && fb2) {
      quad(P(x0, nb.h, z0), P(x1, nb.h, z0), P(x1, nb.h - 12, z0), P(x0, nb.h - 12, z0), nb.col[2]);
      const cols = 4, rows = 6, ww = (fb2.x - fa2.x) / cols, wh = (fb2.y - fa2.y) / rows;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (Math.sin(b.seed * 7 + i * 5 + j * 11 + nb.side) > .2) { c.fillStyle = "rgba(255,200,110,.6)"; c.fillRect(fa2.x + i * ww + ww * .3, fa2.y + j * wh + wh * .3, ww * .4, wh * .4); }
    }
  }
  // building walls going down into the street
  quad(P(-w, top, z0), P(w, top, z0), P(w, -depth, z0), P(-w, -depth, z0), dark);          // front face (the gap edge)
  quad(P(-w, top, z0), P(-w, top, z1), P(-w, -depth, z1), P(-w, -depth, z0), side);          // left wall
  quad(P(w, top, z0), P(w, top, z1), P(w, -depth, z1), P(w, -depth, z0), side);              // right wall
  // lit windows on the front face
  const fa = P(-w, top, z0), fb = P(w, -depth, z0);
  if (fa && fb && b.z0 > -CAM_BACK + 0.6) {
    const cols = 6, rows = 5, ww = (fb.x - fa.x) / cols, wh = (fb.y - fa.y) / rows;
    for (let i = 0; i < cols; i++) for (let j = 1; j < rows; j++) {
      const lit = Math.sin(b.seed * 13 + i * 7 + j * 3) > 0.1;
      c.fillStyle = lit ? "rgba(255,206,120,.75)" : "rgba(20,14,30,.6)";
      c.fillRect(fa.x + i * ww + ww * .25, fa.y + j * wh + wh * .25, ww * .5, wh * .45);
    }
  }
  // roof surface with tar seams
  quad(P(-w, top, z0), P(w, top, z0), P(w, top, z1), P(-w, top, z1), surf);
  c.strokeStyle = "rgba(0,0,0,.12)"; c.lineWidth = 1;
  const step = 3, off = (r.dist % step);
  for (let z = z0 + (step - off); z < z1; z += step) { const a = P(-w, 0, z), bb = P(w, 0, z); if (a && bb) { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(bb.x, bb.y); c.stroke(); } }
  // lane guide stripes (subtle painted lines)
  c.strokeStyle = "rgba(255,255,255,.07)"; c.lineWidth = 2;
  for (const d of [-.5, .5]) { const a = P(d * LANE, 0.01, z0), bb = P(d * LANE, 0.01, z1); if (a && bb) { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(bb.x, bb.y); c.stroke(); } }
  // parapet walls along both edges
  for (const sx of [-w, w]) {
    quad(P(sx, 0, z0), P(sx, .45, z0), P(sx, .45, z1), P(sx, 0, z1), side);
    quad(P(sx - Math.sign(sx) * .25, .45, z0), P(sx, .45, z0), P(sx, .45, z1), P(sx - Math.sign(sx) * .25, .45, z1), "#8b7a95");
  }
  for (const d of b.decor || []) drawDecor(d, b.z0 + d.dz);
  // front ledge highlight so the gap edge reads clearly
  const la = P(-w, 0, z0), lb = P(w, 0, z0);
  if (la && lb && b.z0 > -CAM_BACK + 0.6) { c.strokeStyle = "rgba(255,210,150,.7)"; c.lineWidth = Math.max(2, la.s * .05); c.beginPath(); c.moveTo(la.x, la.y); c.lineTo(lb.x, lb.y); c.stroke(); }
  c.globalAlpha = 1;
}

function drawDecor(d, z) {
  if (z < -CAM_BACK + 1 || z > FAR) return;
  const c = run.ctx, x = d.x;
  if (d.kind === "antenna") {
    const a = P(x, 0.45, z), t = P(x, 4.2, z); if (!a || !t) return;
    c.strokeStyle = "#2b2233"; c.lineWidth = Math.max(1, a.s * .05); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(t.x, t.y); c.stroke();
    for (const k of [.45, .7]) { const m = P(x, 0.45 + 3.75 * k, z); c.beginPath(); c.moveTo(m.x - m.s * .35, m.y); c.lineTo(m.x + m.s * .35, m.y); c.stroke(); }
    c.fillStyle = Math.sin(run.t * 4 + z) > 0 ? "#ff4d4d" : "#7a1d1d"; c.beginPath(); c.arc(t.x, t.y, Math.max(1.5, t.s * .08), 0, 6.29); c.fill();
  } else if (d.kind === "dish") {
    const a = P(x, 1.3, z); if (!a) return;
    c.fillStyle = "#cbd5e1"; c.beginPath(); c.ellipse(a.x, a.y, a.s * .45, a.s * .55, x > 0 ? -.5 : .5, 0, 6.29); c.fill();
    c.fillStyle = "#94a3b8"; c.beginPath(); c.ellipse(a.x, a.y, a.s * .3, a.s * .38, x > 0 ? -.5 : .5, 0, 6.29); c.fill();
    const f = P(x, .45, z); c.strokeStyle = "#475569"; c.lineWidth = Math.max(1, a.s * .05); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(f.x, f.y); c.stroke();
  } else if (d.kind === "vent") {
    box(x, 0.45, 1.3, z, z + .6, .7, "#6b7280", "#4b5563", "#9ca3af");
    const tp = P(x, 1.45, z + .3); if (tp) { c.fillStyle = "#374151"; c.beginPath(); c.ellipse(tp.x, tp.y, tp.s * .42, tp.s * .12, 0, 0, 6.29); c.fill(); }
  } else {
    const xs = x * .75;
    box(xs, 0, 0.35, z, z + 1.6, 1.3, "#94a3b8", "#64748b", "rgba(125,211,252,.55)");
  }
}

function box(x, y0, y1, z0, z1, w, front, side, top) {
  const hw = w / 2;
  const f = [P(x - hw, y0, z0), P(x + hw, y0, z0), P(x + hw, y1, z0), P(x - hw, y1, z0)];
  if (f.some((p) => !p)) return f;
  const b = [P(x - hw, y0, z1), P(x + hw, y0, z1), P(x + hw, y1, z1), P(x - hw, y1, z1)];
  if (b.every(Boolean)) {
    quad(f[3], f[2], b[2], b[3], top);
    const camX = run.laneF * LANE * .3;
    if (x - hw > camX) quad(f[0], f[3], b[3], b[0], side); else if (x + hw < camX) quad(f[1], f[2], b[2], b[1], side);
  }
  quad(f[0], f[1], f[2], f[3], front);
  return f;
}

function drawObj(o) {
  const r = run, c = r.ctx, x = o.lane * LANE, fa = fogA(Math.max(0, o.z));
  c.globalAlpha = 1 - fa * .85;
  if (o.kind === "tank") {
    // rooftop water tower: legs + round wooden tank + cone roof
    const z0 = Math.max(o.z, -3), z1 = o.z + o.len;
    for (const dx of [-.7, .7]) box(x + dx, 0, 1.4, z0, z0 + .15, .15, "#3f3a46", "#2b2730", "#4a4552");
    const f = box(x, 1.4, 3.6, z0, z1, LANE * .8, "#9a6b43", "#6f4c30", "#b5835a");
    if (f[0]) {
      const s = f[0].s, w = f[1].x - f[0].x;
      c.strokeStyle = "rgba(40,24,12,.7)"; c.lineWidth = Math.max(1, s * .04);
      for (const k of [.3, .65]) { const y = f[3].y + (f[0].y - f[3].y) * k; c.beginPath(); c.moveTo(f[0].x, y); c.lineTo(f[1].x, y); c.stroke(); }
      const top = P(x, 4.4, (z0 + z1) / 2);
      if (top) { c.fillStyle = "#5b4a3a"; c.beginPath(); c.moveTo(f[3].x - w * .05, f[3].y); c.lineTo(top.x, top.y); c.lineTo(f[2].x + w * .05, f[2].y); c.closePath(); c.fill(); }
    }
  } else if (o.kind === "ac") {
    // AC unit: metal box with a fan grille — jump over it
    const f = box(x, 0, 1.0, o.z, o.z + .6, LANE * .82, "#b8c0cc", "#7c8594", "#d7dde6");
    if (f[0]) {
      const s = f[0].s, cx = (f[0].x + f[1].x) / 2, cy = (f[0].y + f[3].y) / 2, rad = Math.min(f[1].x - f[0].x, f[0].y - f[3].y) * .35;
      c.fillStyle = "#4b5563"; c.beginPath(); c.arc(cx, cy, rad, 0, 6.29); c.fill();
      c.strokeStyle = "#9ca3af"; c.lineWidth = Math.max(1, s * .03);
      for (let i = 0; i < 3; i++) { const a = r.t * 12 + i * 2.09; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * rad * .9, cy + Math.sin(a) * rad * .9); c.stroke(); }
      c.fillStyle = "#facc15"; c.fillRect(f[0].x, f[0].y - (f[0].y - f[3].y) * .12, f[1].x - f[0].x, (f[0].y - f[3].y) * .08);
    }
  } else if (o.kind === "pipe") {
    // steam pipe on posts with a hanging warning sign — slide under it
    for (const sx of [-.46, .46]) box(x + sx * LANE, 0, 2.5, o.z, o.z + .18, .16, "#4b5563", "#374151", "#6b7280");
    box(x, 1.6, 1.95, o.z, o.z + .35, LANE * 1.02, "#9ca3af", "#6b7280", "#d1d5db");
    const f = box(x, 1.25, 1.6, o.z, o.z + .05, LANE * .55, "#f97316", "#c2410c", "#fdba74");
    if (f[0]) { const s = f[0].s; c.fillStyle = "#1f2937"; c.font = `800 ${Math.max(7, s * .28)}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("⬇ DUCK", (f[0].x + f[1].x) / 2, (f[0].y + f[3].y) / 2 + 1); }
    if (!reducedMotion() && Math.random() < .3) { const p = P(x + (Math.random() - .5) * LANE, 2, o.z); if (p) r.parts.push({ x: x + (Math.random() - .5) * LANE, y: 2, z: o.z, vx: 0, vy: 1.5, vz: 0, life: .6, c: "rgba(230,230,240,.35)" }); }
  } else {
    const q = P(x, o.y || .8, o.z); if (!q) { c.globalAlpha = 1; return; }
    const rad = q.s * .3;
    if (o.kind === "coin") {
      const w = rad * Math.abs(Math.cos(r.t * 6 + o.z));
      c.fillStyle = "rgba(255,209,102,.25)"; c.beginPath(); c.arc(q.x, q.y, rad * 1.5, 0, 6.29); c.fill();
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

/* ============================================================ the runner */
function drawRunner() {
  const r = run, c = r.ctx;
  const base = P(r.laneF * LANE, r.y, 0), ground = P(r.laneF * LANE, 0, 0);
  if (!base) return;
  const U = base.s * 0.36;
  const ph = r.dist * 1.15;                      // stride phase tied to distance, so feet never slide
  const sliding = r.slideT > 0, air = r.y > 0.05 || r.fallT > 0;
  if (r.fallT <= 0 && ground) {
    const sh = 1 - Math.min(.6, r.y * .15);
    c.fillStyle = `rgba(0,0,0,${.38 * sh})`; c.beginPath(); c.ellipse(ground.x, ground.y, U * 1.2 * sh, U * .3 * sh, 0, 0, 6.29); c.fill();
  }
  if (r.invuln > 0 && Math.floor(r.t * 14) % 2 === 0) return;
  c.save(); c.translate(base.x, base.y);
  const lean = (r.lane - r.laneF) * -0.3;
  c.rotate(r.stumble > 0 ? Math.sin(r.t * 30) * .2 * r.stumble : lean);
  c.lineCap = "round"; c.lineJoin = "round";
  const skin = "#e9b48f", skinD = "#c98f6a", pants = "#27324f", pantsD = "#1b2440", shoe = "#f8fafc", sole = "#ef4444", hair = "#3b2a20";
  const hoodie = r.sk.a, trim = r.sk.b;
  const bob = sliding || air ? 0 : Math.abs(Math.sin(ph)) * U * .1;

  const seg = (x0, y0, x1, y1, w0, w1, col) => {
    const a = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2, cx = Math.cos(a), sy = Math.sin(a);
    c.fillStyle = col; c.beginPath();
    c.moveTo(x0 + cx * w0 / 2, y0 + sy * w0 / 2); c.lineTo(x1 + cx * w1 / 2, y1 + sy * w1 / 2);
    c.lineTo(x1 - cx * w1 / 2, y1 - sy * w1 / 2); c.lineTo(x0 - cx * w0 / 2, y0 - sy * w0 / 2); c.closePath(); c.fill();
    c.beginPath(); c.arc(x1, y1, w1 / 2, 0, 6.29); c.fill();
    c.beginPath(); c.arc(x0, y0, w0 / 2, 0, 6.29); c.fill();
  };
  const shoeAt = (x, y, lifted) => {
    // seen from behind: the heel and sole face the camera; a lifted foot shows more sole
    c.fillStyle = shoe; c.beginPath(); c.ellipse(x, y, U * .24, U * .16, 0, 0, 6.29); c.fill();
    c.fillStyle = sole; c.beginPath(); c.ellipse(x, y + U * .07, U * .22, lifted ? U * .12 : U * .06, 0, 0, Math.PI); c.fill();
  };
  // Leg cycle viewed from behind: the stance foot stays planted under the hip,
  // the swing foot lifts and tucks up behind with the knee bending outward.
  const leg = (side, phase, col, colD) => {
    const hipX = side * U * .26, hipY = -U * 2.0 + bob;
    let lift = air ? 0.55 : Math.max(0, Math.sin(phase));           // 0 = planted, 1 = highest
    if (sliding) lift = 0;
    const footX = hipX + side * U * (0.04 + lift * .06), footY = -lift * U * .95;
    const kneeX = hipX + side * U * (0.1 + lift * .22), kneeY = hipY + U * (1.0 - lift * .35);
    seg(hipX, hipY, kneeX, kneeY, U * .48, U * .38, col);
    seg(kneeX, kneeY, footX, footY - U * .14, U * .38, U * .28, colD);
    shoeAt(footX, footY, lift > 0.2);
  };
  const shY = -U * 3.5 + bob;
  const arm = (side, phase) => {
    const swing = air ? 1 : Math.sin(phase);                          // arms pump opposite the legs
    const sx = side * U * .62, sy = shY + U * .35;
    const ex = sx + side * U * .22, ey = sy + U * .5 - swing * U * .12;
    const hx = ex - side * U * .05 + (air ? side * U * .25 : 0), hy = ey + (air ? -U * .55 : U * .45 - swing * U * .3);
    seg(sx, sy, ex, ey, U * .32, U * .27, side < 0 ? shade(hoodie, -.2) : hoodie);
    seg(ex, ey, hx, hy, U * .26, U * .2, side < 0 ? skinD : skin);
  };

  if (sliding) {
    seg(-U * .2, -U * .5, U * 1.0, -U * .3, U * .48, U * .38, pants);
    seg(U * 1.0, -U * .3, U * 1.6, -U * .15, U * .38, U * .28, pantsD); shoeAt(U * 1.75, -U * .14, true);
    c.save(); c.translate(-U * .15, -U * .65); c.rotate(-1.0); drawTorso(0, 0); c.restore();
    c.fillStyle = hair; c.beginPath(); c.arc(-U * 1.25, -U * 1.35, U * .43, 0, 6.29); c.fill();
    c.fillStyle = trim; c.beginPath(); c.ellipse(-U * 1.25, -U * 1.55, U * .45, U * .2, -1, 0, 6.29); c.fill();
    c.restore();
    return;
  }
  leg(-1, ph + Math.PI, pantsD, "#141b33");
  arm(-1, ph);
  c.save(); c.translate(0, bob); drawTorso(0, -U * 2.1); c.restore();
  leg(1, ph, pants, pantsD);
  arm(1, ph + Math.PI);
  const hy = shY - U * .55;
  c.fillStyle = skinD; c.beginPath(); c.ellipse(-U * .44, hy + U * .05, U * .1, U * .16, 0, 0, 6.29); c.ellipse(U * .44, hy + U * .05, U * .1, U * .16, 0, 0, 6.29); c.fill();
  c.fillStyle = skin; c.beginPath(); c.ellipse(0, hy + U * .3, U * .2, U * .16, 0, 0, 6.29); c.fill();
  const hg = c.createRadialGradient(-U * .15, hy - U * .15, U * .05, 0, hy, U * .5);
  hg.addColorStop(0, "#5a4033"); hg.addColorStop(1, hair);
  c.fillStyle = hg; c.beginPath(); c.ellipse(0, hy, U * .46, U * .5, 0, 0, 6.29); c.fill();
  c.fillStyle = trim; c.beginPath(); c.ellipse(0, hy - U * .22, U * .48, U * .32, 0, Math.PI, 0); c.fill();
  c.fillRect(-U * .48, hy - U * .24, U * .96, U * .1);
  c.fillStyle = trim; c.beginPath(); c.ellipse(0, hy + U * .02, U * .22, U * .08, 0, 0, 6.29); c.fill();
  if (r.shield) { c.strokeStyle = `rgba(147,197,253,${.5 + .2 * Math.sin(r.t * 6)})`; c.lineWidth = 3; c.beginPath(); c.ellipse(0, -U * 2.1, U * 1.6, U * 2.6, 0, 0, 6.29); c.stroke(); }
  if (r.magnetT > 0) { c.strokeStyle = `rgba(167,139,250,${.45 + .2 * Math.sin(r.t * 8)})`; c.lineWidth = 2; c.beginPath(); c.arc(0, -U * 2.1, U * 2.6, 0, 6.29); c.stroke(); }
  c.restore();

  function drawTorso(x, y) {
    const tg = c.createLinearGradient(x - U * .8, 0, x + U * .8, 0);
    tg.addColorStop(0, shade(hoodie, -.25)); tg.addColorStop(.5, hoodie); tg.addColorStop(1, shade(hoodie, -.3));
    c.fillStyle = tg; c.beginPath();
    c.moveTo(x - U * .7, y); c.quadraticCurveTo(x - U * .82, y - U * .9, x - U * .6, y - U * 1.45);
    c.quadraticCurveTo(x, y - U * 1.62, x + U * .6, y - U * 1.45); c.quadraticCurveTo(x + U * .82, y - U * .9, x + U * .7, y);
    c.quadraticCurveTo(x, y + U * .12, x - U * .7, y); c.fill();
    c.fillStyle = shade(hoodie, -.15); c.beginPath(); c.ellipse(x, y - U * 1.38, U * .42, U * .2, 0, 0, 6.29); c.fill();
    c.fillStyle = shade(trim, -.1); c.beginPath();
    c.roundRect ? c.roundRect(x - U * .45, y - U * 1.2, U * .9, U * .95, U * .2) : c.rect(x - U * .45, y - U * 1.2, U * .9, U * .95); c.fill();
    c.fillStyle = shade(trim, .25); c.fillRect(x - U * .3, y - U * .8, U * .6, U * .08);
    c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(x - U * .06, y - U * 1.1, U * .12, U * .25);
    c.fillStyle = shade(hoodie, -.35); c.fillRect(x - U * .7, y - U * .1, U * 1.4, U * .12);
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

/* ========================================================= attract mode */
/* The start screen shows the real game playing itself, silently. */
function demo(el) { setTimeout(() => startDemo(el)); }   // after the module has finished loading
function startDemo(el) {
  if (!el.isConnected) return;
  stop(); fx.quiet = true;
  el.classList.add("live-demo");
  const canvas = h("canvas", { class: "road" });
  const wrap = h("div", { class: "demowrap" }, canvas);
  el.append(wrap);
  run = {
    demo: true, mode: "relaxed", cards: [], deck: null, canvas, ctx: canvas.getContext("2d"),
    sk: skin("runner"), n: 0, correct: 0, score: 0, streak: 0, hearts: 3, missed: [], frozen: false, last: performance.now(),
    shield: false, magnetT: 0, doubleT: 0, invuln: 0,
    dist: 0, speed: 0, t: 0, laneF: 0, lane: 0, y: 0, vy: 0, slideT: 0, stumble: 0, shake: 0, fallT: 0,
    objs: [], parts: [], roofs: [], roofEnd: 0, spawnZ: 30, gate: null, nextGateAt: 1e9, dodged: 0,
    hud: h("div"), q: h("div"), a: h("div"), wrap,
  };
  addRoof(-10, 70); decorate(run.roofs[0]); extendRoofs();
  for (let z = 26; z < FAR; z += 22) spawnRow(z);
  window.addEventListener("resize", resize);
  requestAnimationFrame(() => { if (run && run.demo) { resize(); raf = requestAnimationFrame(loop); } });
}
function autopilot() {
  const r = run;
  if (r.y < .01 && !onRoof(2.2) && onRoof(0)) act("up");                       // jump the gap
  const ahead = r.objs.filter((o) => !o.done && /ac|pipe|tank/.test(o.kind) && o.z + (o.len || 0) > 0 && o.z < 8 && Math.abs(o.lane - r.lane) < .5).sort((a, b) => a.z - b.z)[0];
  if (!ahead) {
    const c = r.objs.find((o) => o.kind === "coin" && o.z > 3 && o.z < 12);
    if (c && c.lane !== r.lane && Math.random() < .03 && !r.objs.some((o) => o.kind === "tank" && o.lane === c.lane && o.z < 12)) act(c.lane < r.lane ? "left" : "right");
    return;
  }
  if (ahead.kind === "ac" && ahead.z < 3.4 && r.y < .01) act("up");
  else if (ahead.kind === "pipe" && ahead.z < 3.4 && r.slideT <= 0) act("down");
  else if (ahead.kind === "tank") {
    const ok = [-1, 0, 1].filter((l) => l !== r.lane && !r.objs.some((o) => /ac|pipe|tank/.test(o.kind) && Math.abs(o.lane - l) < .5 && o.z < ahead.z + 5 && o.z + (o.len || 0) > -1));
    if (ok.length) { const t = ok.sort((a, b) => Math.abs(a - r.lane) - Math.abs(b - r.lane))[0]; act(t < r.lane ? "left" : "right"); }
  }
}
