/* Term Miner — dig down through the earth to the treasure vault.
 *
 * The ground is a grid of blocks. Dirt digs fast, stone digs slowly, 💎 gems
 * and gold give coins, and dark bedrock can't be dug — steer around it.
 * Every few layers a bedrock wall has three doors labelled A / B / C with
 * terms; the meaning is shown above. Tap the door with the matching term.
 * Relaxed: 10 doors then the treasure vault; the drill waits at each wall.
 * Challenge: a fuel tank drains as you dig — gems and gold refill it; running
 * dry or picking a wrong door costs a heart.
 *
 * Controls: ◀ ▶ buttons, swipe or tap left/right of the drill, arrow keys.
 */
import { createApp, makeDeck, pickDistractors, shuffle, h, wait, defOf, say, sfx, sayBtn, reducedMotion, unlockAudio, fx, skin } from "../common/kit.js?v=10";

const ROUND = 10, COLS = 7, DOORS = [1, 3, 5];
const HARD = { dirt: 0.22, clay: 0.34, stone: 0.7, gem: 0.3, gold: 0.3, empty: 0.06, door: 0.3 };
let run = null, raf = 0;

const app = createApp({
  id: "drop", title: "Term Miner", emoji: "⛏️",
  tagline: "Dig down through the earth. Choose the right door. Reach the treasure vault!",
  steps: ["Tap ◀ ▶ to steer the drill. It digs down by itself.",
          "Dig 💎 gems and gold for coins. Dark bedrock can't be dug — go around it!",
          "At each bedrock wall, read the meaning and tap the door with the matching term."],
  modes: { relaxed: "10 doors, then the vault. Take your time.", challenge: "Watch your fuel! Gems refill it. 3 hearts." },
  minCards: 4, demo,
  onStart: begin,
  onPause: () => run && (run.frozen = true),
  onResume: () => { if (run) { run.frozen = false; run.last = performance.now(); } },
  onQuit: stop,
});

function stop() { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); window.removeEventListener("keydown", onKey); run = null; }

/* ================================================================== setup */
function begin({ cards, mode, focus }) {
  stop(); fx.quiet = false;
  const canvas = h("canvas", { class: "mine", "aria-label": "Mine. Tap left or right of the drill to steer." });
  run = { mode, cards, sk: app.skin("block"), deck: makeDeck(focus ? [...new Set([...focus, ...cards])] : cards),
          canvas, ctx: canvas.getContext("2d"), rows: [], n: 0, correct: 0, score: 0, streak: 0, hearts: 3, missed: [],
          gems: 0, frozen: false, last: performance.now(), t: 0,
          col: 3, colF: 3, row: 0, rowF: 0, cam: -2.6, dig: null, shake: 0, parts: [], fuel: 1, hudT: 0,
          shield: mode === "challenge" && app.has("boost-shield"), gate: null, target: null, nextGateRow: 5, vaultRow: null, opened: false };
  for (let i = 0; i < 40; i++) genRow();
  run.hud = h("div", { class: "hud" });
  run.q = h("div", { class: "mq" });
  run.signs = h("div", { class: "signs" });
  run.wrap = h("div", { class: "minewrap" }, canvas, run.signs);
  const b = (d, l, a) => h("button", { type: "button", "aria-label": a, onpointerdown: (e) => { e.preventDefault(); unlockAudio(); steer(d); } }, l);
  run.ctrl = h("div", { class: "mctrl steer" }, b(-1, "◀", "Steer left"), b(1, "▶", "Steer right"));
  app.stage.replaceChildren(run.hud, run.q, run.wrap, run.ctrl);
  let sx = 0;
  canvas.addEventListener("pointerdown", (e) => { unlockAudio(); sx = e.clientX; });
  canvas.addEventListener("pointerup", (e) => {
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 24) return steer(dx > 0 ? 1 : -1);
    const bb = canvas.getBoundingClientRect(), tapCol = (e.clientX - bb.left) / (bb.width / COLS);
    steer(tapCol < run.colF + 0.5 ? -1 : 1);
  });
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKey);
  resize(); paintHud(); idleCard();
  raf = requestAnimationFrame(loop);
}
function onKey(e) {
  if (!run || document.querySelector(".scrim")) return;
  if (e.key === "ArrowLeft" || e.key === "a") steer(-1);
  if (e.key === "ArrowRight" || e.key === "d") steer(1);
}
function resize() {
  const r = run; if (!r) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  r.W = r.wrap.clientWidth; r.H = r.wrap.clientHeight;
  r.canvas.width = r.W * dpr; r.canvas.height = r.H * dpr;
  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  r.T = r.W / COLS;
}
function idleCard() {
  const r = run;
  r.q.replaceChildren(h("div", { class: "qcard waitcard slim" }, h("div", {}, r.mode === "challenge" ? "⛏️ Dig! 💎 gems refill your fuel · go around dark bedrock" : "⛏️ Dig! Grab 💎 gems · go around dark bedrock")));
}

/* ================================================================ world */
function layerAt(row) { return row < 12 ? 0 : row < 30 ? 1 : row < 55 ? 2 : 3; }
function genRow() {
  const r = run, y = r.rows.length;
  if (y < 1) { r.rows.push(Array(COLS).fill("sky")); return; }
  const L = layerAt(y), row = [];
  for (let c = 0; c < COLS; c++) {
    const roll = Math.random();
    let t = L === 0 ? "dirt" : L === 1 ? (roll < .5 ? "dirt" : "clay") : (roll < .55 ? "stone" : "clay");
    if (y > 2) {
      if (roll < 0.07) t = "gem"; else if (roll < 0.12) t = "gold";
      else if (roll > (L >= 2 ? 0.86 : 0.92)) t = "bedrock";
    }
    row.push(t);
  }
  if (row.every((t) => t === "bedrock")) row[(Math.random() * COLS) | 0] = "dirt";
  r.rows.push(row);
}
function ensureRows(to) { while (run.rows.length <= to) genRow(); }
function tile(row, col) { ensureRows(row + 1); return run.rows[row][col]; }
function setTile(row, col, t) { ensureRows(row + 1); run.rows[row][col] = t; }

/* Build a bedrock wall with three doors a few rows below the drill. */
function placeGate() {
  const r = run, gr = r.row + 4;
  ensureRows(gr + 2);
  for (let c = 0; c < COLS; c++) r.rows[gr][c] = DOORS.includes(c) ? "door" : "bedrock";
  for (let c = 0; c < COLS; c++) if (r.rows[gr - 1][c] === "bedrock") r.rows[gr - 1][c] = "dirt";   // every door reachable
  const card = r.deck.next();
  const opts = shuffle([card, ...pickDistractors(r.cards, card.id, 2)]);
  r.gate = { row: gr, card, opts, correct: opts.indexOf(card), picked: -1, retry: false };
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
  g.picked = i; r.target = DOORS[i];
  r.signEls.forEach((s, k) => s.classList.add(k === i ? "chosen" : "dim"));
  sfx.tap();
}

/* ============================================================= movement */
function steer(d) {
  const r = run; if (!r || r.frozen || r.dig) return;
  if (r.gate && r.gate.picked >= 0) return;
  const nc = r.col + d; if (nc < 0 || nc >= COLS) return;
  const t = tile(r.row, nc);
  if (t === "bedrock" || t === "door") { r.shake = 6; sfx.tap(); return; }
  startDig(r.row, nc, "side");
}
function startDig(row, col, dir) {
  const t = tile(row, col), hard = HARD[t] ?? 0.25;
  run.dig = { row, col, dir, t: 0, dur: dir === "side" ? Math.max(0.12, hard * 0.8) : hard, type: t };
}
function finishDig() {
  const r = run, d = r.dig; r.dig = null;
  const t = d.type, p = screenOf(d.row, d.col);
  r.row = d.row; r.col = d.col;
  if (t === "gem" || t === "gold") {
    r.gems++; r.score += t === "gem" ? 20 : 15; r.fuel = Math.min(1, r.fuel + 0.22);
    const b = r.wrap.getBoundingClientRect();
    app.earn(t === "gem" ? 2 : 1, b.left + p.x + r.T / 2, b.top + p.y);
    burst(p.x + r.T / 2, p.y + r.T / 2, t === "gem" ? "#5cc8ff" : "#fbbf24", 14);
  } else if (t !== "empty" && t !== "door") burst(p.x + r.T / 2, p.y + r.T / 2, tileCol(t)[1], 6);
  setTile(d.row, d.col, "empty");
  r.score += 2;
}

function tryDown() {
  const r = run, g = r.gate;
  if (g && r.row + 1 === g.row) {
    if (g.picked < 0) {
      if (r.mode === "relaxed") return;                       // wait at the wall for an answer
      if (!DOORS.includes(r.col)) return;                     // challenge: steer to a door (fuel keeps draining)
      g.picked = DOORS.indexOf(r.col); r.signEls.forEach((s, k) => s.classList.add(k === g.picked ? "chosen" : "dim"));
    }
    if (r.col !== DOORS[g.picked]) return;
    return throughDoor();
  }
  // once a door is chosen the path to it is always clear (bedrock becomes stone)
  if (g && g.picked >= 0 && tile(r.row + 1, r.col) === "bedrock") setTile(r.row + 1, r.col, "stone");
  if (tile(r.row + 1, r.col) === "bedrock") { r.blocked = (r.blocked || 0) + 1; return; }
  r.blocked = 0;
  startDig(r.row + 1, r.col, "down");
}

async function throughDoor() {
  const r = run, g = r.gate;
  const ok = g.picked === g.correct;
  const p = screenOf(g.row, DOORS[g.picked]);
  if (ok) {
    if (!g.retry) { r.n++; r.correct++; r.streak++; r.deck.hit(g.card); }
    const pts = g.retry ? 0 : 100 + Math.min(r.streak - 1, 5) * 25; r.score += pts;
    r.signEls[g.picked].classList.remove("chosen"); r.signEls[g.picked].classList.add("good");
    for (let c = 0; c < COLS; c++) if (c !== DOORS[g.picked]) setTile(g.row, c, "bedrock");
    burst(p.x + r.T / 2, p.y + r.T / 2, "#34d17c", 34); sfx.good(); r.shake = 8;
    if (pts) { const b = r.wrap.getBoundingClientRect(); app.floater(b.left + p.x + r.T / 2, b.top + p.y, "+" + pts); app.earn(5 + Math.min(r.streak, 5)); }
    r.q.replaceChildren(h("div", { class: "qcard term okcard" }, h("div", { class: "big" }, "✓ ", g.card.term)));
    r.gate = null; r.target = null;
    setTimeout(() => { if (run && !run.gate) { run.signs.replaceChildren(); idleCard(); } }, 900);
    startDig(g.row, DOORS[g.picked], "down");
    r.nextGateRow = g.row + (r.mode === "relaxed" ? 5 : Math.max(4, 7 - (r.n / 3 | 0)));
    paintHud();
    return;
  }
  // wrong door: it's locked — learn the answer, then go through the right one
  r.n++; r.streak = 0; r.shake = 14; sfx.hurt(); sfx.bad();
  r.signEls[g.picked].classList.add("bad"); r.signEls[g.correct].classList.remove("dim"); r.signEls[g.correct].classList.add("good");
  r.missed.push(g.card); r.deck.miss(g.card);
  if (r.mode === "challenge") { if (r.shield) r.shield = false; else r.hearts--; }
  burst(p.x + r.T / 2, p.y, "#ff7b72", 22);
  paintHud();
  r.frozen = true;
  await wait(500);
  await app.learn(g.card, { chosen: g.opts[g.picked].term, note: r.mode === "challenge" ? `${r.hearts} ${r.hearts === 1 ? "heart" : "hearts"} left.` : "The drill will go through the right door." });
  if (!run) return;
  r.frozen = false; r.last = performance.now();
  if (r.hearts <= 0) return finish();
  g.retry = true; g.picked = g.correct; r.target = DOORS[g.correct];
  r.signEls.forEach((s, k) => { s.classList.remove("bad", "chosen", "dim", "good"); s.classList.add(k === g.correct ? "chosen" : "dim"); });
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
  if (r.dig) {
    r.dig.t += dt;
    if (r.dig.type === "stone" && Math.random() < .5) { const p = screenOf(r.dig.row, r.dig.col); r.parts.push({ x: p.x + r.T / 2 + (Math.random() - .5) * r.T * .6, y: p.y + r.T * .2, vx: (Math.random() - .5) * 200, vy: -80 - Math.random() * 120, life: .3, c: "#fde68a" }); }
    if (r.dig.t >= r.dig.dur) finishDig();
  } else if (r.target != null && r.col !== r.target) {
    const d = Math.sign(r.target - r.col);
    if (tile(r.row, r.col + d) === "bedrock") setTile(r.row, r.col + d, "dirt");   // the path to a chosen door is always open
    startDig(r.row, r.col + d, "side");
  } else if (!r.opened) {
    tryDown();
  }
  if (!r.gate && !r.vaultRow && r.row >= r.nextGateRow) { if (r.mode === "relaxed" && r.n >= ROUND) makeVault(); else placeGate(); }
  if (r.vaultRow && r.row >= r.vaultRow - 1 && !r.opened) openVault();
  // smooth motion
  const k = r.dig ? Math.min(1, r.dig.t / r.dig.dur) : 1;
  const tx = r.dig ? r.col + (r.dig.col - r.col) * k : r.col;
  r.colF += (tx - r.colF) * Math.min(1, dt * 20);
  r.rowF = r.dig ? r.row + (r.dig.row - r.row) * k : r.row;
  r.cam += ((r.rowF - 2.6) - r.cam) * Math.min(1, dt * 6);
  if (r.mode === "challenge" && !r.opened) {
    r.fuel -= dt * (0.035 + r.n * 0.002);
    if (r.fuel <= 0) {
      r.fuel = 0.6; r.shake = 10; sfx.hurt();
      const b = r.wrap.getBoundingClientRect();
      if (r.shield) { r.shield = false; app.floater(b.left + r.W / 2, b.top + r.H * .3, "🛡 Saved!", "#93c5fd"); }
      else { r.hearts--; app.floater(b.left + r.W / 2, b.top + r.H * .3, "⛽ Out of fuel! −1 ❤️", "#ff7b72"); }
      if (r.hearts <= 0) { finish(); return; }
    }
  }
  // stuck on bedrock for a moment: say so and point at the arrows
  const stuck = !r.dig && !r.gate && tile(r.row + 1, r.col) === "bedrock";
  r.stuckT = stuck ? (r.stuckT || 0) + dt : 0;
  if (r.stuckT > 1.2 && !r.hinted) { r.hinted = true; r.ctrl.classList.add("nudge"); const b = r.wrap.getBoundingClientRect(); app.floater(b.left + r.W / 2, b.top + r.H * .25, "Bedrock! Steer ◀ ▶", "#e9d5ff"); }
  if (!stuck && r.hinted) { r.hinted = false; r.ctrl.classList.remove("nudge"); }
  if (stuck) {
    // boxed in (bedrock both sides and below): the floor cracks so nobody is ever trapped
    const blocked = (c) => c < 0 || c >= COLS || /bedrock|door/.test(tile(r.row, c));
    if (r.stuckT > 1 && blocked(r.col - 1) && blocked(r.col + 1)) { setTile(r.row + 1, r.col, "stone"); r.shake = 6; r.stuckT = 0; }
    else if (r.mode === "relaxed" && r.stuckT > 3) { r.stuckT = 2; findWayDown(); }   // Relaxed: the drill finds its own way
  }
  r.shake = Math.max(0, r.shake - dt * 30);
  for (const p of r.parts) { p.life -= dt; p.vy += 600 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  r.parts = r.parts.filter((p) => p.life > 0);
  if ((r.hudT += dt) > .3) { r.hudT = 0; paintHud(); }
}

function makeVault() {
  const r = run, vr = r.row + 4; ensureRows(vr + 3);
  for (let y = vr - 1; y <= vr + 1; y++) for (let c = 0; c < COLS; c++) r.rows[y][c] = y === vr + 1 ? "bedrock" : "empty";
  r.vaultRow = vr;
}
async function openVault() {
  const r = run; r.opened = true;
  sfx.win(); r.shake = 8;
  const p = screenOf(r.vaultRow, 3);
  for (let i = 0; i < 5; i++) setTimeout(() => run && burst(p.x + r.T / 2, p.y, ["#ffd166", "#fbbf24", "#fde68a", "#5cc8ff"][i % 4], 30), i * 160);
  const b = r.wrap.getBoundingClientRect(); app.floater(b.left + r.W / 2, b.top + p.y - 20, "💰 Treasure vault! +25", "#ffd166");
  app.earn(25); r.score += 300;
  await wait(2200);
  if (run) finish();
}

function burst(x, y, c, n) { for (let i = 0; i < n; i++) run.parts.push({ x, y, vx: (Math.random() - .5) * 300, vy: -60 - Math.random() * 260, life: .5 + Math.random() * .5, c }); }

function paintHud() {
  const r = run;
  const kids = r.mode === "relaxed"
    ? [h("span", { class: "chip" }, "🚪 ", h("b", {}, Math.min(r.n + 1, ROUND)), " / " + ROUND)]
    : [h("span", { class: "chip" }, "❤️".repeat(Math.max(0, r.hearts)) + "🤍".repeat(3 - Math.max(0, r.hearts)) + (r.shield ? " 🛡" : "")),
       h("span", { class: "chip fuel" + (r.fuel < .25 ? " low" : ""), "aria-label": "Fuel " + Math.round(r.fuel * 100) + "%" }, "⛽ ", h("i", { style: `--f:${Math.round(r.fuel * 100)}%` }))];
  kids.push(h("span", { class: "chip" }, "⬇ ", h("b", {}, Math.max(0, r.row * 2) + " m")), app.coinChip(), h("span", { class: "chip" }, "⭐ ", h("b", {}, r.score)));
  r.hud.replaceChildren(...kids);
}

/* =================================================================== draw */
function screenOf(row, col) { const r = run; return { x: col * r.T, y: (row - r.cam) * r.T }; }
function tileCol(t) {
  switch (t) {
    case "clay": return ["#9a6a4a", "#7c5238", "#b37c55"];
    case "stone": return ["#6b7280", "#4b5563", "#9ca3af"];
    case "bedrock": return ["#26222e", "#16131c", "#3a3445"];
    default: return ["#8a5a3b", "#6f452b", "#a06a45"];
  }
}
function drawTile(t, x, y, T, seed, row) {
  const c = run.ctx;
  if (t === "sky") return;
  if (t === "empty" || t === "door") {
    c.fillStyle = "#1a120c"; c.fillRect(x, y, T + .5, T + .5);
    c.fillStyle = "rgba(255,255,255,.03)"; c.fillRect(x + T * .1, y + T * .1, T * .8, T * .8);
    return;
  }
  const base = t === "gem" || t === "gold" ? tileCol(layerAt(row) >= 2 ? "stone" : "dirt") : tileCol(t);
  const g = c.createLinearGradient(x, y, x, y + T); g.addColorStop(0, base[2]); g.addColorStop(.25, base[0]); g.addColorStop(1, base[1]);
  c.fillStyle = g; c.fillRect(x, y, T + .5, T + .5);
  c.fillStyle = "rgba(0,0,0,.18)";
  for (let i = 0; i < 4; i++) { const sx = (seed * (i + 3) * 97) % 1, sy = (seed * (i + 7) * 61) % 1; c.fillRect(x + sx * T * .8 + 2, y + sy * T * .8 + 2, 3, 3); }
  c.strokeStyle = "rgba(0,0,0,.25)"; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, T - 1, T - 1);
  if (t === "stone") { c.strokeStyle = "rgba(20,20,30,.5)"; c.beginPath(); c.moveTo(x + T * .2, y + T * .3); c.lineTo(x + T * .45, y + T * .5); c.lineTo(x + T * .4, y + T * .8); c.stroke(); }
  if (t === "bedrock") { c.fillStyle = "rgba(120,110,150,.18)"; for (let i = 0; i < 3; i++) c.fillRect(x + T * (.15 + i * .28), y + T * (.2 + (i % 2) * .4), T * .18, T * .12); c.strokeStyle = "rgba(160,150,190,.35)"; c.lineWidth = 2; c.strokeRect(x + 2, y + 2, T - 4, T - 4); }
  if (t === "gem") {
    const cx = x + T / 2, cy = y + T / 2, s = T * .28, hue = ["#5cc8ff", "#6ee7b7", "#f472b6", "#c4b5fd"][(seed * 4) | 0];
    c.fillStyle = hue; c.beginPath(); c.moveTo(cx, cy - s); c.lineTo(cx + s * .8, cy - s * .2); c.lineTo(cx, cy + s); c.lineTo(cx - s * .8, cy - s * .2); c.closePath(); c.fill();
    c.fillStyle = "rgba(255,255,255,.6)"; c.beginPath(); c.moveTo(cx, cy - s); c.lineTo(cx + s * .3, cy - s * .2); c.lineTo(cx - s * .3, cy - s * .2); c.closePath(); c.fill();
    c.fillStyle = `rgba(255,255,255,${.4 + .4 * Math.sin(run.t * 4 + seed * 9)})`; c.beginPath(); c.arc(cx + s * .5, cy - s * .6, 2, 0, 6.29); c.fill();
  }
  if (t === "gold") {
    c.fillStyle = "#fbbf24";
    for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(x + T * (.3 + i * .2), y + T * (.4 + (i % 2) * .25), T * .1, 0, 6.29); c.fill(); }
    c.fillStyle = "rgba(255,255,255,.55)"; c.beginPath(); c.arc(x + T * .33, y + T * .37, 2, 0, 6.29); c.fill();
  }
}

function draw() {
  const r = run, c = r.ctx, W = r.W, H = r.H, T = r.T;
  c.save();
  if (r.shake > .4 && !reducedMotion()) c.translate((Math.random() - .5) * r.shake, (Math.random() - .5) * r.shake);
  c.fillStyle = "#1a1f3a"; c.fillRect(0, 0, W, H);
  const skyY = (1 - r.cam) * T;
  if (skyY > 0) {
    const g = c.createLinearGradient(0, 0, 0, skyY); g.addColorStop(0, "#7dd3fc"); g.addColorStop(1, "#bae6fd");
    c.fillStyle = g; c.fillRect(0, 0, W, skyY);
    c.fillStyle = "#3f9e4d"; c.fillRect(0, skyY - 8, W, 10);
    c.fillStyle = "#fff7c2"; c.beginPath(); c.arc(W * .82, skyY - T * .9, T * .35, 0, 6.29); c.fill();
  }
  const r0 = Math.floor(r.cam) - 1, r1 = Math.ceil(r.cam + H / T) + 1;
  ensureRows(r1 + 2);
  for (let y = Math.max(0, r0); y <= r1; y++) for (let x = 0; x < COLS; x++) {
    const p = screenOf(y, x);
    drawTile(r.rows[y][x], p.x, p.y, T, ((y * 13 + x * 7) % 17) / 17, y);
  }
  if (r.gate) {
    for (let i = 0; i < 3; i++) {
      const p = screenOf(r.gate.row, DOORS[i]), sel = r.gate.picked === i;
      c.fillStyle = sel ? "#ffb020" : "#3a2a1a"; c.strokeStyle = sel ? "#ffe0a3" : "#c8a979"; c.lineWidth = 3;
      c.beginPath(); c.moveTo(p.x + T * .12, p.y + T); c.lineTo(p.x + T * .12, p.y + T * .35); c.quadraticCurveTo(p.x + T / 2, p.y - T * .05, p.x + T * .88, p.y + T * .35); c.lineTo(p.x + T * .88, p.y + T); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = sel ? "#2a1a00" : "#fff"; c.font = `800 ${Math.round(T * .42)}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("ABC"[i], p.x + T / 2, p.y + T * .62);
    }
  }
  if (r.vaultRow) drawVault();
  drawDrill();
  for (const p of r.parts) { c.globalAlpha = Math.max(0, Math.min(1, p.life * 2)); c.fillStyle = p.c; c.fillRect(p.x - 3, p.y - 3, 6, 6); }
  c.globalAlpha = 1;
  // the deeper you go the darker it gets, with a warm lamp around the drill
  const dark = Math.min(.8, Math.max(0, (r.row - 3) / 30));
  if (dark > 0.02) {
    const d = screenOf(r.rowF, r.colF), lx = d.x + T / 2, ly = d.y + T / 2;
    const g = c.createRadialGradient(lx, ly + T * .6, T * .9, lx, ly + T * .6, T * 4.4);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(5,3,10,${dark})`);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = `rgba(255,200,120,${.07 + .03 * Math.sin(r.t * 5)})`; c.beginPath(); c.moveTo(lx - T * .2, ly + T * .6); c.lineTo(lx - T * 1.4, ly + T * 3.5); c.lineTo(lx + T * 1.4, ly + T * 3.5); c.lineTo(lx + T * .2, ly + T * .6); c.fill();
  }
  c.restore();
  placeSigns();
}

function drawDrill() {
  const r = run, c = r.ctx, T = r.T;
  const p = screenOf(r.rowF, r.colF), x = p.x + T / 2, y = p.y + T * .45, s = T * .42;
  const busy = !!r.dig;
  c.save(); c.translate(x + (busy && !reducedMotion() ? (Math.random() - .5) * 1.5 : 0), y);
  const body = c.createLinearGradient(-s, 0, s, 0); body.addColorStop(0, r.sk.b); body.addColorStop(.5, r.sk.a); body.addColorStop(1, r.sk.b);
  c.fillStyle = body; c.beginPath(); c.roundRect ? c.roundRect(-s, -s * 1.1, s * 2, s * 1.35, s * .35) : c.rect(-s, -s * 1.1, s * 2, s * 1.35); c.fill();
  c.fillStyle = "rgba(0,0,0,.25)"; c.fillRect(-s, s * .05, s * 2, s * .2);
  c.fillStyle = "#0f172a"; c.beginPath(); c.arc(0, -s * .45, s * .45, 0, 6.29); c.fill();
  c.fillStyle = "rgba(125,211,252,.55)"; c.beginPath(); c.arc(0, -s * .45, s * .4, 0, 6.29); c.fill();
  c.fillStyle = "#f2c29b"; c.beginPath(); c.arc(0, -s * .38, s * .17, 0, 6.29); c.fill();
  c.fillStyle = "#facc15"; c.beginPath(); c.arc(0, -s * .5, s * .2, Math.PI, 0); c.fill();
  c.fillStyle = "#fff7c2"; c.beginPath(); c.arc(s * .07, -s * .62, s * .05, 0, 6.29); c.fill();
  const spin = r.t * (busy ? 26 : 6);
  c.fillStyle = "#cbd5e1"; c.beginPath(); c.moveTo(-s * .7, s * .25); c.lineTo(s * .7, s * .25); c.lineTo(0, s * 1.35); c.closePath(); c.fill();
  c.strokeStyle = "#64748b"; c.lineWidth = 2;
  for (let i = 0; i < 4; i++) { const k = (spin / 3 + i / 4) % 1, yy = s * .25 + k * s * 1.05, w = s * .7 * (1 - k * .95); c.beginPath(); c.moveTo(-w, yy); c.lineTo(w, yy + s * .12); c.stroke(); }
  c.restore();
  if (busy && Math.random() < 0.6) r.parts.push({ x: x + (Math.random() - .5) * T * .5, y: y + T * .5, vx: (Math.random() - .5) * 140, vy: -30 - Math.random() * 90, life: .35, c: tileCol(r.dig.type)[0] });
}

function drawVault() {
  const r = run, c = r.ctx, T = r.T, p = screenOf(r.vaultRow, 3), x = p.x + T / 2, y = p.y + T * .5, s = T * .55;
  c.fillStyle = "rgba(255,209,102,.18)"; c.beginPath(); c.arc(x, y, T * 2.4, 0, 6.29); c.fill();
  c.fillStyle = "#8b5a2b"; c.fillRect(x - s * 1.3, y - s * .2, s * 2.6, s * 1.2);
  c.fillStyle = "#a16207"; c.beginPath(); c.moveTo(x - s * 1.3, y - s * .2); c.quadraticCurveTo(x, y - s * 1.2 - (r.opened ? s * .7 : 0), x + s * 1.3, y - s * .2); c.fill();
  c.fillStyle = "#fbbf24"; c.fillRect(x - s * .18, y - s * .3, s * .36, s * .45); c.fillRect(x - s * 1.3, y + s * .25, s * 2.6, s * .14);
  if (r.opened) { c.fillStyle = "#ffd166"; for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(x - s + i * s * .4, y - s * .35 - (i % 2) * s * .2, s * .16, 0, 6.29); c.fill(); } }
}

function placeSigns() {
  const r = run; if (!r || !r.gate || !r.signEls) return;
  const T = r.T, top = screenOf(r.gate.row, 0).y;
  r.signEls.forEach((s, i) => {
    const w = r.W / 3 - 6;                       // one third each, never overlapping
    s.style.width = w + "px";
    s.style.left = (i * r.W / 3 + 3) + "px";
    s.style.transform = `translateY(${Math.round(Math.min(top + T + 4, r.H - s.offsetHeight - 6))}px)`;   // hang below the door
  });
}

function finish() {
  const r = run; if (!r) return; stop();
  app.results({ score: r.score, correct: r.correct, total: r.n, missed: r.missed, extra: [[r.row * 2 + " m", "deep"], [r.gems, "gems"]] });
}

/* ========================================================= attract mode */
function demo(el) { setTimeout(() => startDemo(el)); }
function startDemo(el) {
  if (!el.isConnected) return;
  stop(); fx.quiet = true;
  el.classList.add("live-demo");
  const canvas = h("canvas", { class: "mine" });
  const wrap = h("div", { class: "demowrap" }, canvas);
  el.append(wrap);
  run = { demo: true, mode: "relaxed", cards: [], sk: skin("block"), deck: null, canvas, ctx: canvas.getContext("2d"), rows: [], n: 0, correct: 0, score: 0, streak: 0, hearts: 3, missed: [],
          gems: 0, frozen: false, last: performance.now(), t: 0, col: 3, colF: 3, row: 0, rowF: 0, cam: -2.6, dig: null, shake: 0, parts: [], fuel: 1, hudT: 0,
          shield: false, gate: null, target: null, nextGateRow: 1e9, vaultRow: null, opened: false,
          hud: h("div"), q: h("div"), signs: h("div"), wrap, ctrl: h("div") };
  for (let i = 0; i < 40; i++) genRow();
  window.addEventListener("resize", resize);
  resize(); raf = requestAnimationFrame(loop);
}
function findWayDown() {
  const r = run;
  for (let d = 1; d < 7; d++) for (const sd of [-1, 1]) {
    const c = r.col + sd * d; if (c < 0 || c > 6) continue;
    let open = true; for (let k = 1; k <= d; k++) if (/bedrock|door/.test(tile(r.row, r.col + sd * k))) open = false;
    if (open && tile(r.row + 1, c) !== "bedrock") { steer(sd); return; }
  }
  setTile(r.row + 1, r.col, "stone");                      // no route: crack the floor
}
function autopilot() {
  const r = run; if (r.dig || Math.random() > .25) return;
  if (tile(r.row + 1, r.col) === "bedrock") findWayDown();
  else {
    for (const s of [-1, 1]) { const c = r.col + s; if (c >= 0 && c < 7 && /gem|gold/.test(tile(r.row + 1, c)) && Math.random() < .5) { steer(s); return; } }
  }
}
