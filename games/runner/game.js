/* Term Runner — an endless runner with study gates.
 *
 * Between gates it's a real runner: switch lanes (swipe, tap the road's
 * left/right side, ◀ ▶ buttons or arrow keys) to dodge barriers, collect
 * coin trails and grab ⚡ magnet power-ups. Every so often a gate with lanes
 * A / B / C appears; the meaning is shown above and the three terms as big
 * buttons below. Tap the right term and your runner takes that lane.
 * Relaxed: 10 gates, the runner waits at each gate, barriers only cost coins.
 * Challenge: gates keep coming, speed climbs, barriers and wrong gates cost hearts.
 */
import { createApp, makeDeck, pickDistractors, shuffle, h, wait, defOf, say, sfx, sayBtn, answerList, reducedMotion } from "../common/kit.js?v=3";

const ROUND = 10;
let run = null, raf = 0;

const app = createApp({
  id: "runner", title: "Term Runner", emoji: "🏃",
  tagline: "Dodge, collect coins, and run through the gate with the right term.",
  steps: ["Swipe or tap left/right to change lanes. Dodge the ⛔ barriers and grab 🪙 coins.",
          "When a gate appears, read the meaning at the top.",
          "Tap the matching term. Your runner dashes into that lane."],
  modes: { relaxed: "10 gates. Runner waits at each gate.", challenge: "Faster and faster. 3 hearts." },
  minCards: 4, demo,
  onStart: begin,
  onPause: () => run && (run.frozen = true),
  onResume: () => { if (run) { run.frozen = false; run.last = performance.now(); } },
  onQuit: stop,
});

function stop() { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); window.removeEventListener("keydown", onKey); run = null; }

function begin({ cards, mode, focus }) {
  stop();
  const canvas = h("canvas", { class: "road", "aria-label": "Road. Tap left or right side to change lanes." });
  const sk = app.skin("runner");
  run = { mode, cards, deck: makeDeck(focus ? [...new Set([...focus, ...cards])] : cards), canvas, ctx: canvas.getContext("2d"), sk,
          n: 0, correct: 0, score: 0, streak: 0, hearts: 3, shield: mode === "challenge" && app.has("boost-shield"), missed: [], frozen: false, last: performance.now(),
          dist: 0, lane: 1, px: 0, lean: 0, stumble: 0, shake: 0, particles: [], objs: [], gate: null, nextGateIn: 7, spawnIn: 1, t: 0, magnet: 0, dodged: 0,
          pace: 1, gateS: 7.5 };
  run.hud = h("div", { class: "hud" });
  run.q = h("div", { class: "rq" });
  run.a = h("div", { class: "ra" });
  run.wrap = h("div", { class: "roadwrap" }, canvas);
  app.stage.replaceChildren(run.hud, run.q, run.wrap, run.a);
  bindRoad(canvas);
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKey);
  resize(); paintHud(); showRunning();
  run.px = laneX(1, 0);
  raf = requestAnimationFrame(loop);
}

function showRunning() {
  const r = run; if (!r) return;
  r.q.replaceChildren(h("div", { class: "qcard waitcard" }, h("div", { class: "big" }, "Dodge ⛔ · Grab 🪙 · Gate coming!")));
  const mv = (d) => h("button", { type: "button", "aria-label": d < 0 ? "Move left" : "Move right", onpointerdown: (e) => { e.preventDefault(); move(d); } }, d < 0 ? "◀" : "▶");
  r.a.replaceChildren(h("div", { class: "steer" }, mv(-1), mv(1)));
}

function move(d) {
  const r = run; if (!r || r.frozen || (r.gate && r.gate.picked < 0)) return;
  const n = Math.max(0, Math.min(2, r.lane + d));
  if (n !== r.lane) { r.lane = n; sfx.tap(); }
}
function onKey(e) {
  if (!run || document.querySelector(".scrim")) return;
  if (run.gate) return;               // during a gate, A/B/C keys pick answers (answerList)
  if (e.key === "ArrowLeft" || e.key === "a") move(-1);
  if (e.key === "ArrowRight" || e.key === "d") move(1);
}
function bindRoad(cv) {
  let sx = 0, sy = 0;
  cv.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; });
  cv.addEventListener("pointerup", (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1);
    else { const b = cv.getBoundingClientRect(); move(e.clientX - b.left < b.width / 2 ? -1 : 1); }
  });
}

function resize() {
  const r = run; if (!r) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  r.W = r.wrap.clientWidth; r.H = r.wrap.clientHeight;
  r.canvas.width = r.W * dpr; r.canvas.height = r.H * dpr;
  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  r.horizon = r.H * 0.26; r.playerY = r.H * 0.9; r.spread = Math.min(r.W * 0.3, 170);
  r.stars = Array.from({ length: 60 }, () => ({ x: Math.random() * r.W, y: Math.random() * r.horizon, s: Math.random() * 1.6 + .4, p: Math.random() * 6 }));
}
const scaleAt = (t) => 1 - 0.7 * t;
const depthY = (t) => run.playerY - (run.playerY - run.horizon) * t;
const laneX = (l, t) => run.W / 2 + (l - 1) * run.spread * scaleAt(t);

function paintHud() {
  const r = run;
  const kids = r.mode === "relaxed"
    ? [h("span", { class: "chip" }, "🚪 ", h("b", {}, Math.min(r.n + 1, ROUND)), " / " + ROUND)]
    : [h("span", { class: "chip" }, "❤️".repeat(Math.max(0, r.hearts)) + "🤍".repeat(3 - Math.max(0, r.hearts)) + (r.shield ? " 🛡" : ""))];
  kids.push(app.coinChip(), h("span", { class: "chip" }, "⭐ ", h("b", {}, r.score)));
  if (r.streak >= 2) kids.push(h("span", { class: "chip hot" }, "🔥 ", h("b", {}, r.streak)));
  if (r.magnet > 0) kids.push(h("span", { class: "chip hot" }, "🧲"));
  r.hud.replaceChildren(...kids);
}

/* ------------------------------------------------------------ road objects */
function spawnPattern() {
  const r = run, lanes = [0, 1, 2];
  const roll = Math.random();
  if (roll < 0.45) {                                  // coin trail in one lane
    const l = lanes[(Math.random() * 3) | 0];
    for (let i = 0; i < 5; i++) r.objs.push({ kind: "coin", lane: l, t: 1 + i * 0.07 });
  } else if (roll < 0.85) {                           // barrier(s) + coins in a free lane
    const free = (Math.random() * 3) | 0;
    const blocks = lanes.filter((l) => l !== free);
    const count = r.mode === "challenge" && r.dist > 250 && Math.random() < 0.5 ? 2 : 1;
    shuffle(blocks).slice(0, count).forEach((l) => r.objs.push({ kind: "bar", lane: l, t: 1 }));
    for (let i = 0; i < 3; i++) r.objs.push({ kind: "coin", lane: free, t: 1.02 + i * 0.07 });
  } else {                                            // power-up
    r.objs.push({ kind: "mag", lane: (Math.random() * 3) | 0, t: 1 });
  }
}

function hitObjects(dt, speed) {
  const r = run;
  for (const o of r.objs) {
    o.t -= dt * speed / 3.2;
    if (r.magnet > 0 && o.kind === "coin" && o.t < 0.35) o.lane += (r.lane - o.lane) * Math.min(1, dt * 8);
    if (!o.done && o.t < 0.035 && o.t > -0.04 && Math.abs(o.lane - r.lane) < 0.5) {
      o.done = true;
      const b = r.wrap.getBoundingClientRect();
      if (o.kind === "coin") { app.earn(1); burst(laneX(r.lane, 0), r.playerY - 50, "#ffd166", 6); r.score += 5; }
      else if (o.kind === "mag") { r.magnet = 8; sfx.power(); app.floater(b.left + r.px, b.top + r.playerY - 100, "🧲 Magnet!", "#c4b5fd"); paintHud(); }
      else if (o.kind === "bar") { crash(); if (!run) return; }
    }
    if (o.kind === "bar" && !o.done && !o.passed && o.t < -0.04) { o.passed = true; r.dodged++; }
  }
  r.objs = r.objs.filter((o) => o.t > -0.1 && !(o.done && o.kind !== "bar"));
}

function crash() {
  const r = run;
  r.stumble = 1; r.shake = 12; r.streak = 0; sfx.hurt();
  burst(r.px, r.playerY - 40, "#ff7b72", 18);
  const b = r.wrap.getBoundingClientRect();
  if (r.mode === "challenge") {
    if (r.shield) { r.shield = false; app.floater(b.left + r.px, b.top + r.playerY - 100, "🛡 Saved!", "#93c5fd"); }
    else { r.hearts--; app.floater(b.left + r.px, b.top + r.playerY - 100, "💥 Ouch!", "#ff7b72"); }
    paintHud();
    if (r.hearts <= 0) finish();
  } else {
    const lose = Math.min(app.coins, 3);
    if (lose) app.earn(-lose);
    app.floater(b.left + r.px, b.top + r.playerY - 100, lose ? `💥 −${lose} 🪙` : "💥 Bump!", "#ff7b72");
    r.pace = 0.5;
  }
}

/* ------------------------------------------------------------------ gates */
function openGate() {
  const r = run;
  const card = r.deck.next();
  const opts = shuffle([card, ...pickDistractors(r.cards, card.id, 2)]);
  r.gate = { card, opts, correct: opts.indexOf(card), t: 1, picked: -1 };
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
  if (i !== r.lane) { r.lane = i; sfx.whoosh(); }
}

async function resolveGate() {
  const r = run, g = r.gate;
  const ok = g.picked === g.correct;
  r.n++;
  if (ok) {
    r.correct++; r.streak++; r.deck.hit(g.card);
    const pts = 100 + Math.min(r.streak - 1, 5) * 25; r.score += pts;
    g.btn.classList.remove("chosen"); g.btn.classList.add("good");
    burst(laneX(g.correct, 0.05), depthY(0.05) - 60, "#34d17c", 30); sfx.good();
    const b = r.wrap.getBoundingClientRect(); app.floater(b.left + r.px, b.top + r.playerY - 90, "+" + pts);
    app.earn(5 + Math.min(r.streak, 5));
    r.gate = null; paintHud();
    r.q.replaceChildren(h("div", { class: "qcard term okcard" }, h("div", { class: "big" }, "✓ ", g.card.term)));
    if (r.mode === "challenge") r.gateS = Math.max(4.5, r.gateS - 0.2);
  } else {
    r.streak = 0; r.stumble = 1; r.shake = 12; sfx.bad();
    if (r.mode === "challenge") { if (r.shield) r.shield = false; else r.hearts--; }
    r.missed.push(g.card); r.deck.miss(g.card);
    if (g.btns) g.btns.forEach((b, k) => { if (k === g.correct) { b.classList.remove("dim"); b.classList.add("good"); } if (k === g.picked) { b.classList.remove("chosen"); b.classList.add("bad"); } });
    burst(laneX(r.lane, 0.05), depthY(0.05) - 60, "#ff7b72", 20);
    r.gate = null; paintHud();
    r.frozen = true;
    await wait(600);
    await app.learn(g.card, { chosen: g.picked >= 0 ? g.opts[g.picked].term : null, title: g.picked < 0 ? "Time's up — here it is" : undefined,
      note: r.mode === "challenge" ? `${r.hearts} ${r.hearts === 1 ? "heart" : "hearts"} left.` : null });
    if (!run) return;
    r.frozen = false; r.last = performance.now();
  }
  r.nextGateIn = r.mode === "relaxed" ? 9 + Math.random() * 3 : Math.max(6, 11 - r.n * 0.3);
  if ((r.mode === "relaxed" && r.n >= ROUND) || r.hearts <= 0) { await wait(ok ? 800 : 0); return finish(); }
  setTimeout(() => { if (run && !run.gate) showRunning(); }, ok ? 900 : 0);
}

function burst(x, y, c, n) {
  for (let i = 0; i < n; i++) run.particles.push({ x, y, vx: (Math.random() - .5) * 340, vy: -80 - Math.random() * 240, life: .6 + Math.random() * .5, c });
}

/* ------------------------------------------------------------------- loop */
function loop(now) {
  const r = run; if (!r) return;
  const dt = Math.min(0.05, (now - r.last) / 1000); r.last = now;
  if (!r.frozen) update(dt);
  if (run) draw();
  raf = requestAnimationFrame(loop);
}

function update(dt) {
  const r = run; r.t += dt;
  r.pace = Math.min(1, r.pace + dt * 0.6);
  const base = r.mode === "challenge" ? Math.min(1.9, 1 + r.dist / 900) : Math.min(1.35, 1 + r.dist / 1500);
  let speed = base * r.pace;
  const g = r.gate;
  if (g) {
    if (g.picked >= 0) g.t -= dt / 0.9;
    else if (r.mode === "relaxed") { if (g.t > 0.32) g.t -= dt / 3; else speed = 0.06; }
    else { g.t -= dt / r.gateS; speed *= 0.5; }
    if (g.t <= 0) { g.t = 0; resolveGate(); }
  } else if (r.mode === "challenge" || r.n < ROUND) {
    r.nextGateIn -= dt;
    // clear the road before a gate so questions never overlap dodging
    if (r.nextGateIn <= 0 && !r.objs.some((o) => o.kind === "bar" && o.t > 0)) openGate();
    r.spawnIn -= dt * speed;
    if (r.spawnIn <= 0 && r.nextGateIn > 2.5) { spawnPattern(); r.spawnIn = r.mode === "challenge" ? Math.max(0.9, 1.8 - r.dist / 800) : 2.1; }
  }
  if (r.magnet > 0) { r.magnet -= dt; if (r.magnet <= 0) paintHud(); }
  hitObjects(dt, speed);
  if (!run) return;
  r.dist += dt * 7 * speed; r.speed = speed;
  const tx = laneX(r.lane, 0);
  r.px += (tx - r.px) * Math.min(1, dt * 12);
  r.lean += (Math.max(-.3, Math.min(.3, (tx - r.px) * 0.005)) - r.lean) * Math.min(1, dt * 8);
  r.stumble = Math.max(0, r.stumble - dt * 1.4); r.shake = Math.max(0, r.shake - dt * 26);
  for (const p of r.particles) { p.life -= dt; p.vy += 800 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  r.particles = r.particles.filter((p) => p.life > 0);
}

/* ------------------------------------------------------------------- draw */
function draw() {
  const r = run, c = r.ctx, W = r.W, H = r.H;
  c.save();
  if (r.shake > .3 && !reducedMotion()) c.translate((Math.random() - .5) * r.shake, (Math.random() - .5) * r.shake);
  const sky = c.createLinearGradient(0, 0, 0, r.horizon * 1.1);
  sky.addColorStop(0, "#070b21"); sky.addColorStop(.6, "#1b2a57"); sky.addColorStop(.9, "#4a3070"); sky.addColorStop(1, "#b0584a");
  c.fillStyle = sky; c.fillRect(0, 0, W, r.horizon + 4);
  for (const s of r.stars) { c.globalAlpha = .35 + .3 * Math.sin(r.t * 2 + s.p); c.fillStyle = "#e3ecff"; c.fillRect(s.x, s.y, s.s, s.s); }
  c.globalAlpha = 1;
  c.fillStyle = "#ffcf7a"; c.beginPath(); c.arc(W * .78, r.horizon - 6, 18, Math.PI, 0); c.fill();
  ridge(r.horizon + 3, H * .07, .012, r.dist * .03, "#2a2160");
  ridge(r.horizon + 2, H * .1, .007, r.dist * .06, "#1a1644");
  const gr = c.createLinearGradient(0, r.horizon, 0, H); gr.addColorStop(0, "#1c2548"); gr.addColorStop(1, "#0a0f24");
  c.fillStyle = gr; c.fillRect(0, r.horizon, W, H - r.horizon);
  // roadside posts flowing past
  for (let i = 0; i < 6; i++) {
    const t = ((i / 6) - (r.dist * 0.02) % (1 / 6) + 1) % 1, s = scaleAt(t);
    c.fillStyle = "rgba(255,176,32,.5)";
    for (const d of [-.85, 2.85]) c.fillRect(laneX(d, t) - 2 * s, depthY(t) - 26 * s, 4 * s, 26 * s);
  }
  c.fillStyle = "#151d3b"; c.beginPath();
  c.moveTo(laneX(-.6, 0), depthY(0)); c.lineTo(laneX(-.6, 1), depthY(1)); c.lineTo(laneX(2.6, 1), depthY(1)); c.lineTo(laneX(2.6, 0), depthY(0)); c.fill();
  c.lineWidth = 3; c.setLineDash([16, 16]); c.lineDashOffset = -((r.dist * 40) % 32); c.strokeStyle = "rgba(160,180,240,.35)";
  for (const d of [.5, 1.5]) { c.beginPath(); c.moveTo(laneX(d, 0), depthY(0)); c.lineTo(laneX(d, 1), depthY(1)); c.stroke(); }
  c.setLineDash([]); c.lineWidth = 4; c.strokeStyle = "rgba(255,176,32,.45)";
  for (const d of [-.6, 2.6]) { c.beginPath(); c.moveTo(laneX(d, 0), depthY(0)); c.lineTo(laneX(d, 1), depthY(1)); c.stroke(); }
  c.textAlign = "center"; c.textBaseline = "middle";
  if (r.gate) {
    c.font = "700 20px Fredoka, sans-serif";
    for (let l = 0; l < 3; l++) { c.fillStyle = l === r.lane ? "rgba(255,176,32,.9)" : "rgba(160,180,240,.35)"; c.fillText("ABC"[l], laneX(l, .12), depthY(.12)); }
  }
  // objects far-to-near
  for (const o of [...r.objs].sort((a, b) => b.t - a.t)) { if (o.t > 1 || o.t < -0.05 || (o.done && o.kind !== "bar")) continue; drawObj(o); }
  if (r.gate) drawGate(r.gate);
  for (const p of r.particles) { c.globalAlpha = Math.max(0, Math.min(1, p.life)); c.fillStyle = p.c; c.fillRect(p.x - 4, p.y - 3, 8, 6); }
  c.globalAlpha = 1;
  drawRunner();
  c.restore();
}
function drawObj(o) {
  const r = run, c = r.ctx, t = Math.max(o.t, 0), s = scaleAt(t), x = laneX(o.lane, t), y = depthY(t);
  if (o.kind === "coin") {
    const w = 11 * s * Math.abs(Math.cos(r.t * 5 + o.t * 20)) + 2 * s;
    c.fillStyle = "#ffd166"; c.strokeStyle = "#b77400"; c.lineWidth = 2 * s;
    c.beginPath(); c.ellipse(x, y - 22 * s, w, 12 * s, 0, 0, 6.29); c.fill(); c.stroke();
  } else if (o.kind === "bar") {
    const bw = r.spread * s * 0.8, bh = 34 * s;
    c.fillStyle = o.done ? "#6b2a2a" : "#e5484d"; c.fillRect(x - bw / 2, y - bh, bw, bh);
    c.fillStyle = "#fff"; for (let i = 0; i < 4; i++) c.fillRect(x - bw / 2 + (i * 2 + .5) * bw / 8, y - bh + 4 * s, bw / 8, bh - 8 * s);
    c.fillStyle = "#2b3656"; c.fillRect(x - bw / 2 + 4 * s, y - 3 * s, 6 * s, 6 * s); c.fillRect(x + bw / 2 - 10 * s, y - 3 * s, 6 * s, 6 * s);
  } else {
    c.fillStyle = "#a78bfa"; c.beginPath(); c.arc(x, y - 24 * s, 15 * s, 0, 6.29); c.fill();
    c.font = `${Math.round(18 * s)}px sans-serif`; c.fillText("🧲", x, y - 23 * s);
  }
}
function ridge(y0, amp, f, ph, col) {
  const r = run, c = r.ctx; c.fillStyle = col; c.beginPath(); c.moveTo(-4, r.H);
  for (let x = -4; x <= r.W + 8; x += 10) c.lineTo(x, y0 - (Math.sin(x * f + ph) * .55 + Math.sin(x * f * 2.7 + ph * 1.7) * .3 + .85) * amp);
  c.lineTo(r.W + 4, r.H); c.fill();
}
function drawGate(g) {
  const r = run, c = r.ctx, t = Math.max(g.t, .001), y = depthY(t), s = scaleAt(t);
  const x0 = laneX(-.6, t), x1 = laneX(2.6, t), hgt = 110 * s;
  c.fillStyle = `rgba(34,211,238,${.14 + .06 * Math.sin(r.t * 6)})`; c.fillRect(x0, y - hgt, x1 - x0, hgt);
  c.fillStyle = "#22d3ee"; c.fillRect(x0 - 4 * s, y - hgt, 8 * s, hgt); c.fillRect(x1 - 4 * s, y - hgt, 8 * s, hgt); c.fillRect(x0, y - hgt, x1 - x0, 8 * s);
  for (let l = 0; l < 3; l++) {
    const cx = laneX(l, t), bw = 46 * s, by = y - hgt * .62, sel = g.picked === l;
    c.fillStyle = sel ? "#ffb020" : "#1f2e4b"; c.strokeStyle = sel ? "#ffd98a" : "#5cc8ff"; c.lineWidth = 3 * s;
    c.beginPath(); c.roundRect ? c.roundRect(cx - bw / 2, by - bw / 2, bw, bw, 10 * s) : c.rect(cx - bw / 2, by - bw / 2, bw, bw); c.fill(); c.stroke();
    c.fillStyle = sel ? "#2a1a00" : "#fff"; c.font = `700 ${Math.round(28 * s)}px Fredoka, sans-serif`; c.fillText("ABC"[l], cx, by + 1);
  }
}
function drawRunner() {
  const r = run, c = r.ctx, s = Math.min(1.1, r.H / 380), ph = r.dist * 1.6;
  const sw = Math.sin(ph), sw2 = Math.sin(ph + Math.PI);
  c.save(); c.translate(r.px, r.playerY);
  c.rotate(r.stumble > 0 ? Math.sin(r.t * 34) * .22 * r.stumble : r.lean * .7);
  c.lineCap = "round";
  if (r.magnet > 0) { c.strokeStyle = `rgba(167,139,250,${.35 + .2 * Math.sin(r.t * 8)})`; c.lineWidth = 3; c.beginPath(); c.arc(0, -40 * s, 42 * s, 0, 6.29); c.stroke(); }
  if (r.shield) { c.strokeStyle = "rgba(147,197,253,.5)"; c.lineWidth = 2; c.beginPath(); c.arc(0, -40 * s, 36 * s, 0, 6.29); c.stroke(); }
  c.fillStyle = "rgba(0,0,0,.35)"; c.beginPath(); c.ellipse(0, 4 * s, 24 * s, 7 * s, 0, 0, 6.29); c.fill();
  const limb = (a, b, x, y, w, col) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(a, b); c.lineTo(x, y); c.stroke(); };
  const hip = -32 * s, sh = -56 * s, lx = r.lean * 34 * s;
  limb(0, hip, sw * 16 * s, -2 * s, 10 * s, "#2b3656"); limb(0, hip, sw2 * 16 * s, -2 * s, 10 * s, "#222b47");
  limb(r.lean * 20 * s, hip, lx, sh, 14 * s, r.sk.a);
  limb(lx, sh + 4 * s, lx + sw2 * 14 * s, sh + 20 * s, 8 * s, "#f6c89f"); limb(lx, sh + 4 * s, lx + sw * 14 * s, sh + 20 * s, 8 * s, "#eab183");
  c.fillStyle = "#f6c89f"; c.beginPath(); c.arc(r.lean * 40 * s, sh - 12 * s, 11 * s, 0, 6.29); c.fill();
  c.strokeStyle = r.sk.b; c.lineWidth = 4 * s; c.beginPath(); c.arc(r.lean * 40 * s, sh - 12 * s, 11 * s, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
  c.restore();
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
