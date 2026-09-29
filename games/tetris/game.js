/* Term Skydive — free-fall through the sky, fly through the right ring.
 *
 * Steer the skydiver (drag, ◀ ▶ or arrow keys) to grab ⭐ stars and dodge
 * birds, drones and balloons. Every so often three rings float up with
 * lanes A / B / C and term signs; the meaning is shown above. Fly through the
 * ring with the matching term (or tap its sign to steer there).
 * Relaxed: 10 rings, the diver slows right down at each ring and waits, then
 * the parachute opens and you land on the target. Challenge: faster and
 * endless, rings don't wait, bumps and wrong rings cost hearts.
 */
import { createApp, makeDeck, pickDistractors, shuffle, h, wait, defOf, say, sfx, sayBtn, reducedMotion, unlockAudio, fx, skin } from "../common/kit.js?v=11";

const ROUND = 10;
let run = null, raf = 0;

const app = createApp({
  id: "drop", title: "Term Skydive", emoji: "🪂",
  tagline: "Jump from the plane, fly through the right rings, and land on the target!",
  steps: ["Drag or tap ◀ ▶ to steer. Grab ⭐ stars, dodge birds and drones.",
          "Rings float up with A, B and C. Read the meaning at the top.",
          "Fly through the ring with the matching term. Tapping its sign steers you there!"],
  modes: { relaxed: "10 rings, then land on the target. Rings wait for you.", challenge: "Faster and endless. 3 hearts." },
  minCards: 4, demo,
  onStart: begin,
  onPause: () => run && (run.frozen = true),
  onResume: () => { if (run) { run.frozen = false; run.last = performance.now(); } },
  onQuit: stop,
});

function stop() { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); run = null; }

function makeRun(extra) {
  return Object.assign({ mode: "relaxed", n: 0, correct: 0, score: 0, streak: 0, hearts: 3, missed: [], stars: 0, frozen: false, last: performance.now(), t: 0,
    x: .5, tx: .5, vx: 0, depth: 0, speed: 0, objs: [], clouds: [], parts: [], ring: null, nextRingAt: 30, bump: 0, spin: 0, keys: { l: 0, r: 0 },
    shield: false, landing: null, sk: skin("runner") }, extra);
}

function begin({ cards, mode, focus }) {
  stop(); fx.quiet = false;
  const canvas = h("canvas", { class: "sky", "aria-label": "Sky. Drag left or right to steer." });
  run = makeRun({ mode, cards, deck: makeDeck(focus ? [...new Set([...focus, ...cards])] : cards), canvas, ctx: canvas.getContext("2d"),
    shield: mode === "challenge" && app.has("boost-shield"), sk: app.skin("runner") });
  run.hud = h("div", { class: "hud" });
  run.q = h("div", { class: "mq" });
  run.signs = h("div", { class: "signs" });
  run.wrap = h("div", { class: "skywrap" }, canvas, run.signs);
  const b = (d, l, a) => h("button", { type: "button", "aria-label": a,
    onpointerdown: (e) => { e.preventDefault(); unlockAudio(); run && (run.keys[d] = 1); }, onpointerup: () => run && (run.keys[d] = 0), onpointerleave: () => run && (run.keys[d] = 0), onpointercancel: () => run && (run.keys[d] = 0) }, l);
  run.ctrl = h("div", { class: "mctrl steer" }, b("l", "◀", "Steer left"), b("r", "▶", "Steer right"));
  app.stage.replaceChildren(run.hud, run.q, run.wrap, run.ctrl);
  canvas.addEventListener("pointerdown", (e) => { unlockAudio(); run.drag = true; canvas.setPointerCapture(e.pointerId); dragTo(e); });
  canvas.addEventListener("pointermove", (e) => run && run.drag && dragTo(e));
  const end = () => run && (run.drag = false);
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKey); window.addEventListener("keyup", onKeyUp);
  resize(); seedClouds(); paintHud(); idleCard();
  raf = requestAnimationFrame(loop);
}
function onKey(e) { if (!run || document.querySelector(".scrim")) return; if (e.key === "ArrowLeft" || e.key === "a") run.keys.l = 1; if (e.key === "ArrowRight" || e.key === "d") run.keys.r = 1; }
function onKeyUp(e) { if (!run) return; if (e.key === "ArrowLeft" || e.key === "a") run.keys.l = 0; if (e.key === "ArrowRight" || e.key === "d") run.keys.r = 0; }
function dragTo(e) { const r = run; if (r.ring && r.ring.picked >= 0) return; const b = r.canvas.getBoundingClientRect(); r.tx = Math.max(.08, Math.min(.92, (e.clientX - b.left) / b.width)); }
function resize() {
  const r = run; if (!r) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  r.W = r.wrap.clientWidth; r.H = r.wrap.clientHeight;
  r.canvas.width = r.W * dpr; r.canvas.height = r.H * dpr;
  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  r.ppm = r.H / 12;
  r.diverY = r.H * .32;
}
function idleCard() { run.q.replaceChildren(h("div", { class: "qcard waitcard slim" }, h("div", {}, "🪂 Steer to grab ⭐ stars · dodge 🐦 birds and 🚁 drones"))); }
function paintHud() {
  const r = run; if (!r || !r.hud) return;
  const alt = Math.max(0, Math.round(4000 - r.depth * 8));
  const kids = r.mode === "relaxed"
    ? [h("span", { class: "chip" }, "⭕ ", h("b", {}, Math.min(r.n + 1, ROUND)), " / " + ROUND)]
    : [h("span", { class: "chip" }, "❤️".repeat(Math.max(0, r.hearts)) + "🤍".repeat(3 - Math.max(0, r.hearts)) + (r.shield ? " 🛡" : ""))];
  kids.push(h("span", { class: "chip" }, "📏 ", h("b", {}, alt + " m")), app.coinChip(), h("span", { class: "chip" }, "⭐ ", h("b", {}, r.score)));
  r.hud.replaceChildren(...kids);
}

/* ================================================================= world */
function seedClouds() { const r = run; for (let i = 0; i < 14; i++) r.clouds.push({ x: Math.random(), y: Math.random() * 14, s: .6 + Math.random() * 1.2, z: Math.random() < .5 ? .5 : 1 }); }
function spawnStuff() {
  const r = run, y = r.depth + 13;
  if (r.ring && Math.abs(r.ring.at - y) < 4) return;
  const roll = Math.random();
  if (roll < .45) { const x = .15 + Math.random() * .7; for (let i = 0; i < 4; i++) r.objs.push({ kind: "star", x: x + Math.sin(i) * .05, y: y + i * .9 }); }
  else if (roll < .8) r.objs.push({ kind: ["bird", "drone", "balloon"][(Math.random() * 3) | 0], x: .1 + Math.random() * .8, y, vx: (Math.random() < .5 ? -1 : 1) * (.05 + Math.random() * .08) });
}

/* ================================================================= rings */
function openRing() {
  const r = run;
  const card = r.deck.next();
  const opts = shuffle([card, ...pickDistractors(r.cards, card.id, 2)]);
  r.ring = { card, opts, correct: opts.indexOf(card), at: r.depth + 11, picked: -1 };
  r.objs = r.objs.filter((o) => Math.abs(o.y - r.ring.at) > 3);
  r.q.replaceChildren(h("div", { class: "qcard meaning" }, h("div", { class: "label" }, h("span", {}, "⭕ Which ring means…"), sayBtn(defOf(card))), h("div", { class: "big" }, defOf(card))));
  r.signEls = opts.map((c, i) => h("button", { class: "sign", type: "button", "aria-label": `Ring ${"ABC"[i]}: ${c.term}`, onclick: () => pick(i) },
    h("span", { class: "k" }, "ABC"[i]), h("span", { class: "tt" }, c.term)));
  r.signs.replaceChildren(...r.signEls);
  sfx.whoosh(); say(defOf(card));
}
function pick(i) {
  const r = run, g = r.ring; if (!g || g.picked >= 0 || r.frozen) return;
  unlockAudio();
  g.picked = i; r.tx = (i + .5) / 3;
  r.signEls.forEach((s, k) => s.classList.add(k === i ? "chosen" : "dim"));
  sfx.tap();
}
async function passRing() {
  const r = run, g = r.ring;
  const lane = Math.max(0, Math.min(2, Math.floor(r.x * 3)));
  const chosen = g.picked >= 0 ? g.picked : lane;
  const ok = chosen === g.correct;
  r.ring = null; r.n++;
  const sx = (chosen + .5) / 3 * r.W;
  if (ok) {
    r.correct++; r.streak++; r.deck.hit(g.card);
    const pts = 100 + Math.min(r.streak - 1, 5) * 25; r.score += pts;
    r.signEls[chosen].classList.remove("chosen"); r.signEls[chosen].classList.add("good");
    burst(sx, r.diverY, "#34d17c", 36); burst(sx, r.diverY, "#fde68a", 18); sfx.good();
    const b = r.wrap.getBoundingClientRect(); app.floater(b.left + sx, b.top + r.diverY - 30, "+" + pts);
    app.earn(5 + Math.min(r.streak, 5));
    r.q.replaceChildren(h("div", { class: "qcard term okcard" }, h("div", { class: "big" }, "✓ ", g.card.term)));
  } else {
    r.streak = 0; r.spin = 1; sfx.bad();
    r.signEls[chosen].classList.add("bad"); r.signEls[g.correct].classList.remove("dim"); r.signEls[g.correct].classList.add("good");
    r.missed.push(g.card); r.deck.miss(g.card);
    if (r.mode === "challenge") { if (r.shield) r.shield = false; else r.hearts--; }
    burst(sx, r.diverY, "#ff7b72", 24);
    paintHud();
    r.frozen = true;
    await wait(500);
    await app.learn(g.card, { chosen: g.opts[chosen].term, note: r.mode === "challenge" ? `${r.hearts} ${r.hearts === 1 ? "heart" : "hearts"} left.` : null });
    if (!run) return;
    r.frozen = false; r.last = performance.now();
    if (r.hearts <= 0) return finish();
  }
  setTimeout(() => { if (run && !run.ring) { run.signs.replaceChildren(); idleCard(); } }, 800);
  r.nextRingAt = r.depth + (r.mode === "relaxed" ? 22 : Math.max(16, 26 - r.n * .6));
  paintHud();
  if (r.mode === "relaxed" && r.n >= ROUND) startLanding();
}

/* ================================================================= landing */
function startLanding() {
  const r = run;
  r.landing = { at: r.depth + 22, chute: 0, done: false, tx: .2 + Math.random() * .6 };
  r.objs = [];
  r.q.replaceChildren(h("div", { class: "qcard waitcard slim" }, h("div", {}, "🪂 Parachute open! Steer onto the 🎯 target")));
  sfx.power();
}
async function land() {
  const r = run, L = r.landing; L.done = true;
  const off = Math.abs(r.x - L.tx);
  const grade = off < .05 ? ["🎯 BULLSEYE!", 25, 300] : off < .12 ? ["Great landing!", 15, 200] : off < .22 ? ["Nice landing!", 8, 100] : ["Safe landing!", 4, 50];
  const b = r.wrap.getBoundingClientRect(); app.floater(b.left + r.x * r.W, b.top + r.diverY - 40, grade[0], "#fde68a");
  app.earn(grade[1]); r.score += grade[2];
  sfx.win(); app.confetti();
  await wait(2200);
  if (run === r) finish();
}

/* =================================================================== loop */
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
  const base = r.mode === "challenge" ? Math.min(9, 5.5 + r.depth / 120) : 4.2;
  let target = base * (r.bump > 0 ? .5 : 1);
  const g = r.ring, L = r.landing;
  if (g) {
    const gap = g.at - r.depth;
    if (g.picked < 0) target = r.mode === "relaxed" ? (gap > 5 ? base : Math.max(.15, (gap - 2.2) * .9)) : base * .7;
    else target = base * 1.4;
    if (gap <= 0) { passRing(); if (!run) return; }
  } else if (!L && (r.mode === "challenge" || r.n < ROUND) && r.depth >= r.nextRingAt) openRing();
  if (L) {
    L.chute = Math.min(1, L.chute + dt * 1.5);
    target = 1.6;
    if (!L.done && r.depth >= L.at) { land(); }
    if (L.done) target = 0;
  }
  r.speed += (target - r.speed) * Math.min(1, dt * 3);
  r.depth += r.speed * dt;
  r.score += Math.round(r.speed * dt * 2);
  // steering
  const kd = r.keys.r - r.keys.l;
  if (kd && !(g && g.picked >= 0)) r.tx = Math.max(.06, Math.min(.94, r.tx + kd * dt * 1.1));
  const prevX = r.x;
  r.x += (r.tx - r.x) * Math.min(1, dt * (L ? 3 : 7));
  r.vx = (r.x - prevX) / Math.max(dt, .001);
  r.bump = Math.max(0, r.bump - dt); r.spin = Math.max(0, r.spin - dt * 1.2);
  // world objects
  if (!L && !g && (r.spawnT = (r.spawnT || 0) + r.speed * dt) > 3.2) { r.spawnT = 0; spawnStuff(); }
  for (const o of r.objs) {
    if (o.vx) { o.x += o.vx * dt; if (o.x < .05 || o.x > .95) o.vx *= -1; }
    if (o.done) continue;
    const dx = (o.x - r.x) * r.W / r.ppm, dy = o.y - (r.depth + .3), dist = Math.hypot(dx, dy);
    if (o.kind === "star" && app.has("boost-magnet") && dist < 3) { o.x += (r.x - o.x) * dt * 3; }
    if (o.kind === "star" && dist < .9) { o.done = true; r.stars++; r.score += 10; app.earn(1); burst(o.x * r.W, r.diverY, "#fde68a", 8); }
    else if (o.kind !== "star" && dist < .85) { o.done = true; bumpInto(o); if (!run) return; }
  }
  r.objs = r.objs.filter((o) => o.y > r.depth - 4 && !o.done);
  for (const cl of r.clouds) { if (cl.y < r.depth - 3) { cl.y = r.depth + 12 + Math.random() * 4; cl.x = Math.random(); } }
  for (const p of r.parts) { p.life -= dt; p.vy += 200 * dt; p.x += p.vx * dt; p.y += p.vy * dt - r.speed * r.ppm * dt; }
  r.parts = r.parts.filter((p) => p.life > 0);
  if ((r.hudT = (r.hudT || 0) + dt) > .35) { r.hudT = 0; paintHud(); }
}
function bumpInto(o) {
  const r = run;
  r.bump = .8; r.spin = 1; sfx.hurt();
  burst(o.x * r.W, r.diverY, "#e5e7eb", 14);
  const b = r.wrap.getBoundingClientRect(), x = b.left + r.x * r.W, y = b.top + r.diverY - 30;
  const what = o.kind === "bird" ? "🐦 Bird!" : o.kind === "drone" ? "🚁 Drone!" : "🎈 Balloon!";
  if (r.mode === "challenge") {
    if (r.shield) { r.shield = false; app.floater(x, y, "🛡 Saved!", "#93c5fd"); }
    else { r.hearts--; app.floater(x, y, what + " −1 ❤️", "#ff7b72"); }
    paintHud(); if (r.hearts <= 0) finish();
  } else { const lose = Math.min(app.coins, 2); if (lose) app.earn(-lose); app.floater(x, y, what + (lose ? ` −${lose}🪙` : ""), "#ff7b72"); }
}
function burst(x, y, c, n) { for (let i = 0; i < n; i++) run.parts.push({ x, y, vx: (Math.random() - .5) * 280, vy: -40 - Math.random() * 200, life: .5 + Math.random() * .5, c }); }

/* =================================================================== draw */
const toY = (wy) => run.diverY + (wy - run.depth) * run.ppm;
function draw() {
  const r = run, c = r.ctx, W = r.W, H = r.H;
  // sky darkens high up, brightens near the ground
  const k = Math.min(1, r.depth / 260);
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, mix("#1e3a8a", "#38bdf8", k)); sky.addColorStop(1, mix("#60a5fa", "#bae6fd", k));
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  if (k < .4) { c.fillStyle = `rgba(255,255,255,${(.4 - k) * 1.5})`; for (let i = 0; i < 40; i++) c.fillRect((i * 97) % W, (i * 53 + r.depth * 2) % H, 1.5, 1.5); }
  // far clouds, near clouds
  for (const cl of r.clouds) if (cl.z < 1) cloud(cl.x * W, toY(cl.y) * .6 + H * .2, cl.s * r.ppm * .9, .35);
  if (r.landing) drawGround();
  for (const o of r.objs) drawObj(o);
  if (r.ring) drawRing(r.ring);
  drawDiver();
  for (const cl of r.clouds) if (cl.z >= 1) cloud(cl.x * W, toY(cl.y), cl.s * r.ppm * .95, .5);
  for (const p of r.parts) { c.globalAlpha = Math.max(0, Math.min(1, p.life * 2)); c.fillStyle = p.c; c.fillRect(p.x - 3, p.y - 3, 6, 6); }
  c.globalAlpha = 1;
  // wind streaks
  if (!r.landing && !reducedMotion()) { c.strokeStyle = "rgba(255,255,255,.25)"; c.lineWidth = 1.5; for (let i = 0; i < 6; i++) { const x = (i * 71 + r.t * 13) % W, y = (H - ((r.t * 300 * (r.speed / 5) + i * 140) % (H + 60))); c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 30); c.stroke(); } }
  placeSigns();
}
function mix(a, b, t) { const p = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)); const A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`; }
function cloud(x, y, s, a) {
  const c = run.ctx; if (y < -s * 2 || y > run.H + s * 2) return;
  c.fillStyle = `rgba(255,255,255,${a})`;
  // one path, a separate sub-path per puff, so overlaps merge cleanly
  c.beginPath();
  for (const [dx, dy, k] of [[0, 0, 1], [-.9, .25, .7], [.9, .2, .75], [.2, -.45, .7], [-.4, -.3, .55]]) { c.moveTo(x + dx * s + k * s, y + dy * s); c.arc(x + dx * s, y + dy * s, k * s, 0, 6.29); }
  c.fill();
}
function drawObj(o) {
  const r = run, c = r.ctx, x = o.x * r.W, y = toY(o.y); if (y < -40 || y > r.H + 40) return;
  c.textAlign = "center"; c.textBaseline = "middle";
  if (o.kind === "star") {
    const s = r.ppm * .38; c.save(); c.translate(x, y); c.rotate(r.t * 2 + o.y);
    c.fillStyle = "#fde047"; c.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, rr = i % 2 ? s * .45 : s; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); c.fill();
    c.restore();
  } else {
    c.font = `${Math.round(r.ppm * .95)}px sans-serif`;
    c.save(); c.translate(x, y); if (o.vx > 0 && o.kind === "bird") c.scale(-1, 1);
    c.fillText(o.kind === "bird" ? "🐦" : o.kind === "drone" ? "🚁" : "🎈", 0, 0);
    c.restore();
  }
}
function drawRing(g) {
  const r = run, c = r.ctx, y = toY(g.at);
  for (let i = 0; i < 3; i++) {
    const cx = (i + .5) / 3 * r.W, rw = r.W / 3 * .38, rh = rw * .42, sel = g.picked === i;
    c.lineWidth = 8;
    c.strokeStyle = sel ? "#ffb020" : ["#f472b6", "#22d3ee", "#a3e635"][i];
    c.beginPath(); c.ellipse(cx, y, rw, rh, 0, Math.PI, 0); c.stroke();          // back half
    c.fillStyle = sel ? "#2a1a00" : "#fff"; c.font = `800 ${Math.round(r.ppm * .6)}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("ABC"[i], cx, y - rh - r.ppm * .45);
    g.front = g.front || [];
  }
  r.frontRingY = y;
}
function drawRingFront() {
  const r = run, g = r.ring; if (!g) return;
  const c = r.ctx, y = toY(g.at);
  for (let i = 0; i < 3; i++) {
    const cx = (i + .5) / 3 * r.W, rw = r.W / 3 * .38, rh = rw * .42, sel = g.picked === i;
    c.lineWidth = 8; c.strokeStyle = sel ? "#ffb020" : ["#f472b6", "#22d3ee", "#a3e635"][i];
    c.beginPath(); c.ellipse(cx, y, rw, rh, 0, 0, Math.PI); c.stroke();           // front half passes over the diver
  }
}
function drawGround() {
  const r = run, c = r.ctx, L = r.landing, gy = toY(L.at) + r.ppm * .9;
  if (gy > r.H + 10) return;
  c.fillStyle = "#16a34a"; c.fillRect(0, gy, r.W, r.H - gy + 5);
  c.fillStyle = "#15803d"; for (let i = 0; i < 12; i++) c.fillRect((i * 57) % r.W, gy + 10 + (i * 31) % 60, 30, 6);
  const tx = L.tx * r.W;
  for (const [rad, col] of [[r.W * .16, "#fff"], [r.W * .12, "#ef4444"], [r.W * .08, "#fff"], [r.W * .04, "#ef4444"]]) { c.fillStyle = col; c.beginPath(); c.ellipse(tx, gy + r.ppm * .5, rad, rad * .35, 0, 0, 6.29); c.fill(); }
}
function drawDiver() {
  const r = run, c = r.ctx, x = r.x * r.W, y = r.diverY, s = r.ppm * .55;
  const L = r.landing;
  c.save(); c.translate(x, y);
  c.rotate(Math.max(-.5, Math.min(.5, r.vx * .6)) + (r.spin > 0 ? r.spin * 6.28 : 0));
  if (L && L.chute > 0) {
    // parachute canopy above
    const cs = s * 2.6 * L.chute;
    c.strokeStyle = "rgba(255,255,255,.7)"; c.lineWidth = 1;
    for (const k of [-1, -.4, .4, 1]) { c.beginPath(); c.moveTo(0, -s * .4); c.lineTo(k * cs, -s * 3.2); c.stroke(); }
    const cols = [r.sk.a, "#fff", r.sk.b, "#fff", r.sk.a];
    cols.forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.moveTo(-cs + i * cs * .4, -s * 3.2); c.quadraticCurveTo(-cs + (i + .5) * cs * .4, -s * 4.8, -cs + (i + 1) * cs * .4, -s * 3.2); c.fill(); });
  }
  const flap = Math.sin(r.t * 18) * .08;
  // limbs spread in the free-fall "X"
  c.lineCap = "round";
  const limb = (x1, y1, x2, y2, w, col) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
  const suit = r.sk.a, trim = r.sk.b;
  const arms = L ? .2 : 1, legs = L ? .3 : 1;
  limb(-s * .3, -s * .2, -s * (1.1 + flap) * arms - s * .2, -s * .75 * arms, s * .32, suit);
  limb(s * .3, -s * .2, s * (1.1 - flap) * arms + s * .2, -s * .75 * arms, s * .32, suit);
  limb(-s * .2, s * .5, -s * .7 * legs, s * (1.3 + flap), s * .36, suit);
  limb(s * .2, s * .5, s * .7 * legs, s * (1.3 - flap), s * .36, suit);
  c.fillStyle = "#f2c29b"; for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * (s * 1.3 * arms + s * .2), -s * .75 * arms, s * .16, 0, 6.29); c.fill(); }
  c.fillStyle = "#1f2937"; for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(sx * s * .7 * legs, s * 1.35, s * .2, s * .14, 0, 0, 6.29); c.fill(); }
  // body + backpack stripe
  c.fillStyle = suit; c.beginPath(); c.ellipse(0, s * .15, s * .45, s * .75, 0, 0, 6.29); c.fill();
  c.fillStyle = trim; c.fillRect(-s * .45, 0, s * .9, s * .18);
  // helmet + goggles
  c.fillStyle = trim; c.beginPath(); c.arc(0, -s * .75, s * .38, 0, 6.29); c.fill();
  c.fillStyle = "#0f172a"; c.fillRect(-s * .3, -s * .8, s * .6, s * .18);
  c.fillStyle = "rgba(125,211,252,.8)"; c.fillRect(-s * .26, -s * .78, s * .2, s * .12); c.fillRect(s * .06, -s * .78, s * .2, s * .12);
  c.restore();
  drawRingFront();
}

function placeSigns() {
  const r = run; if (!r || !r.ring || !r.signEls) return;
  const y = toY(r.ring.at) + r.ppm * .9;
  r.signEls.forEach((s, i) => {
    const w = r.W / 3 - 6;
    s.style.width = w + "px"; s.style.left = (i * r.W / 3 + 3) + "px";
    s.style.transform = `translateY(${Math.round(Math.min(y, r.H - s.offsetHeight - 6))}px)`;
  });
}

function finish() {
  const r = run; if (!r) return; stop();
  app.results({ score: r.score, correct: r.correct, total: r.n, missed: r.missed, extra: [[r.stars, "stars"], [r.n + " / " + (r.mode === "relaxed" ? ROUND : r.n), "rings"]] });
}

/* ========================================================= attract mode */
function demo(el) { setTimeout(() => startDemo(el)); }
function startDemo(el) {
  if (!el.isConnected) return;
  stop(); fx.quiet = true;
  el.classList.add("live-demo");
  const canvas = h("canvas", { class: "sky" });
  const wrap = h("div", { class: "demowrap" }, canvas);
  el.append(wrap);
  run = makeRun({ demo: true, canvas, ctx: canvas.getContext("2d"), nextRingAt: 1e9, wrap, hud: null, q: h("div"), signs: h("div") });
  window.addEventListener("resize", resize);
  resize(); seedClouds();
  raf = requestAnimationFrame(loop);
}
function autopilot() {
  const r = run;
  const star = r.objs.filter((o) => o.kind === "star" && o.y > r.depth && o.y < r.depth + 6).sort((a, b) => a.y - b.y)[0];
  const threat = r.objs.find((o) => o.kind !== "star" && o.y > r.depth && o.y < r.depth + 3 && Math.abs(o.x - r.x) < .15);
  if (threat) r.tx = threat.x > r.x ? Math.max(.08, r.x - .3) : Math.min(.92, r.x + .3);
  else if (star) r.tx = star.x;
}
