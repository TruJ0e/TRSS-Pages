import { CHAPTERS, loadChapterCards, pickDistractors, shuffle } from '../common/cards-loader.js';

// ---------- config ----------
const LS_CHAPTER = 'trss-hop-chapter';
const LS_BEST = 'trss-hop-best';
const GRAV = 2000;        // px/s^2
const JUMP_V = -760;      // px/s
const MOVE = 320;         // px/s horizontal
const STEP = 1 / 60;      // fixed physics step
const START_LIVES = 3;
const CHAPTER_ORDER = ['ch7', 'ch14', 'ch16', 'exam1'].filter(k => CHAPTERS && CHAPTERS[k]);

// ---------- dom ----------
const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const stage = $('stage'), overlay = $('overlay'), panel = $('panel');
const scoreEl = $('score'), livesEl = $('lives'), defText = $('deftext');
const chaptersNav = $('chapters'), restartBtn = $('restart');

// ---------- sizing ----------
let W = 0, H = 0;
function resize() {
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(280, r.width); H = Math.max(320, r.height);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 100));

// ---------- state ----------
let state = 'menu';       // menu | loading | playing | gameover
let cards = [], deck = [], deckIdx = 0, target = null;
let chapter = localStorage.getItem(LS_CHAPTER) || 'ch7';
if (!CHAPTER_ORDER.includes(chapter)) chapter = CHAPTER_ORDER[0];
let best = parseInt(localStorage.getItem(LS_BEST) || '0', 10) || 0;

let score = 0, lives = START_LIVES, graceT = 0;
let firstRound = true;
let player, platforms, popups, camY;
let platformW = 120;

// ---------- audio (tiny beeps, no assets) ----------
let actx = null;
function ensureAudio() {
  try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ }
}
function beep(freq, ms, type) {
  if (!actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.08, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + ms / 1000);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + ms / 1000);
  } catch (e) { /* ignore */ }
}

// ---------- chapter picker ----------
function renderChapterButtons() {
  chaptersNav.innerHTML = '';
  CHAPTER_ORDER.forEach(id => {
    const b = document.createElement('button');
    b.textContent = CHAPTERS[id].label || id;
    b.className = id === chapter ? 'active' : '';
    b.addEventListener('click', () => { ensureAudio(); setChapter(id, state === 'playing'); });
    chaptersNav.appendChild(b);
  });
}
async function setChapter(id, autostart) {
  chapter = id;
  localStorage.setItem(LS_CHAPTER, id);
  renderChapterButtons();
  if (autostart) { await loadCardsThenStart(); }
  else { cards = []; showMenu('Loading cards…'); loadCardsForMenu(); }
}

// ---------- card loading ----------
function showLoading(msg) {
  state = 'loading';
  overlay.classList.remove('hidden');
  panel.innerHTML = '<h1>Term Hop</h1><p>' + escapeHtml(msg) + '</p>';
}
function showError(msg) {
  state = 'menu';
  overlay.classList.remove('hidden');
  panel.innerHTML =
    '<h1>Term Hop</h1>' +
    '<p>Couldn\'t load the study cards for this chapter.<br><span class="hint">' + escapeHtml(msg) + '</span></p>' +
    '<button class="bigbtn" id="retryBtn">↻ Retry</button>';
  $('retryBtn').addEventListener('click', () => { ensureAudio(); loadCardsForMenu(); });
}
async function fetchCards() {
  const data = await loadChapterCards(chapter);
  if (!data || !data.length) throw new Error('No cards found for this chapter.');
  return data;
}
async function loadCardsForMenu() {
  showLoading('Loading cards for ' + (CHAPTERS[chapter] && CHAPTERS[chapter].label || chapter) + '…');
  try {
    cards = await fetchCards();
    showMenu();
  } catch (e) { showError(e.message || 'Unknown error'); }
}
async function loadCardsThenStart() {
  showLoading('Loading cards…');
  try { cards = await fetchCards(); startGame(); }
  catch (e) { showError(e.message || 'Unknown error'); }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- run setup ----------
function nextCard() {
  if (deckIdx >= deck.length) { deck = shuffle(cards.slice()); deckIdx = 0; }
  let c = deck[deckIdx++];
  if (deck.length > 1 && target && c.id === target.id) { // avoid immediate repeat
    if (deckIdx >= deck.length) { deck = shuffle(cards.slice()); deckIdx = 0; }
    c = deck[deckIdx++];
  }
  return c;
}
function gapMax() { return 90 + Math.min(40, score * 1.5); }

function spawnWorld() {
  platformW = Math.min(140, Math.max(104, W * 0.34));
  platforms = []; popups = [];
  player = { x: W / 2, y: 0, w: 30, h: 30, vy: JUMP_V };
  const baseY = H * 0.72;
  player.y = baseY - player.h;
  let y = baseY, x = W / 2;
  while (y > -H * 2) { // enough platforms above the screen
    platforms.push({ x: x - platformW / 2, y, w: platformW, h: 16, term: '', isTarget: false });
    const dx = (Math.random() * 2 - 1) * 190;
    x = (x + dx + W) % W;
    y -= 60 + Math.random() * 50;
  }
  camY = player.y - H * 0.38;
  graceT = 2.5; // spawn grace so a new player learns steering before lives are at risk
}
function genAbove() {
  let top = Infinity;
  for (const p of platforms) if (p.y < top) top = p.y;
  let prevX = W / 2;
  for (const p of platforms) if (p.y === top) prevX = p.x + p.w / 2;
  while (top > camY - 300) {
    const dx = (Math.random() * 2 - 1) * 190;
    const x = (prevX + dx + W) % W;
    top -= 60 + Math.random() * (gapMax() - 60);
    platforms.push({ x: x - platformW / 2, y: top, w: platformW, h: 16, term: '', isTarget: false });
    prevX = x;
  }
  platforms = platforms.filter(p => p.y < camY + H + 120);
  // newly generated platforms need labels for the current round
  if (target) labelFreshPlatforms();
}
function labelFreshPlatforms() {
  const unlabeled = platforms.filter(p => !p.term);
  if (!unlabeled.length) return;
  const distractors = pickDistractors(cards, target.id, unlabeled.length);
  unlabeled.forEach((p, i) => {
    const d = distractors[i % distractors.length];
    p.term = d.term; p.isTarget = false;
  });
}
function newRound() {
  target = nextCard();
  defText.textContent = target.simple;
  // exactly one correct platform: pick one above the player, relabel everything
  const above = platforms.filter(p => p.y < player.y - 20);
  let correct;
  if (firstRound && above.length) {
    // first round: nearest platform above, so a new player can actually reach it
    correct = above.reduce((a, b) => (Math.abs(a.y - player.y) < Math.abs(b.y - player.y) ? a : b));
    firstRound = false;
  } else {
    correct = above.length ? above[(Math.random() * above.length) | 0] : platforms[0];
  }
  const others = platforms.length - 1;
  const distractors = others > 0 ? pickDistractors(cards, target.id, others) : [];
  let di = 0;
  for (const p of platforms) {
    if (p === correct) { p.term = target.term; p.isTarget = true; }
    else {
      const d = distractors[di++ % distractors.length];
      p.term = d.term; p.isTarget = false;
    }
  }
}
function startGame() {
  if (!cards.length) { loadCardsThenStart(); return; }
  deck = shuffle(cards.slice()); deckIdx = 0; target = null;
  score = 0; lives = START_LIVES; firstRound = true;
  scoreEl.textContent = '0'; updateLives();
  spawnWorld();
  newRound();
  overlay.classList.add('hidden');
  state = 'playing';
  beep(520, 90, 'triangle');
}
function updateLives() { livesEl.textContent = '♥'.repeat(lives) + '♡'.repeat(Math.max(0, START_LIVES - lives)); }

function loseLife() {
  if (graceT > 0 || state !== 'playing') return;
  lives--; updateLives();
  graceT = 1.2;
  beep(160, 220, 'sawtooth');
  if (lives <= 0) gameOver();
}
function respawnAfterFall() {
  const floorY = camY + H - 120;
  const cands = platforms.filter(p => p.y < floorY);
  let spot = cands.length ? cands.reduce((a, b) => (a.y > b.y ? a : b)) : null;
  if (!spot) {
    spot = { x: W / 2 - platformW / 2, y: floorY, w: platformW, h: 16, term: '', isTarget: false };
    platforms.push(spot);
  }
  player.x = spot.x + spot.w / 2;
  player.y = spot.y - player.h;
  player.vy = JUMP_V;
  if (!spot.term) { const d = pickDistractors(cards, target.id, 1)[0]; spot.term = d.term; spot.isTarget = false; }
}
function gameOver() {
  state = 'gameover';
  if (score > best) { best = score; localStorage.setItem(LS_BEST, String(best)); }
  beep(220, 300, 'square'); setTimeout(() => beep(150, 400, 'square'), 160);
  overlay.classList.remove('hidden');
  panel.innerHTML =
    '<h1>Game over</h1>' +
    '<div class="stat">Score <b>' + score + '</b></div>' +
    '<div class="stat">Best <b>' + best + '</b></div>' +
    '<button class="bigbtn" id="againBtn">↻ Play again</button>' +
    '<p class="hint">Tip: read the definition, then steer to the platform with the matching term.</p>';
  $('againBtn').addEventListener('click', () => { ensureAudio(); startGame(); });
}

// ---------- menu ----------
function showMenu(note) {
  state = 'menu';
  overlay.classList.remove('hidden');
  defText.textContent = 'Pick a chapter and tap Start.';
  panel.innerHTML =
    '<h1>🐸 Term Hop</h1>' +
    '<p>Bounce between platforms. Land on the platform whose <b>term</b> matches the definition at the top. Wrong term or a fall costs a life — you have 3.</p>' +
    (note ? '<p class="hint">' + escapeHtml(note) + '</p>' : '') +
    '<button class="bigbtn" id="startBtn">▶ Start</button>' +
    '<p class="hint">Best score: <b>' + best + '</b><br>Move: press and hold the left / right half of the screen, or ← → keys.</p>';
  $('startBtn').addEventListener('click', () => {
    ensureAudio();
    if (cards.length) startGame(); else loadCardsThenStart();
  });
}

// ---------- input ----------
const input = { left: false, right: false };
const pointers = new Map(); // pointerId -> 'left' | 'right'
function syncInput() {
  const held = [...pointers.values()];
  const keyL = keys.left, keyR = keys.right;
  input.left = keyL || held.includes('left');
  input.right = keyR || held.includes('right');
}
const keys = { left: false, right: false };
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') { keys.left = true; syncInput(); e.preventDefault(); }
  if (e.key === 'ArrowRight') { keys.right = true; syncInput(); e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft') { keys.left = false; syncInput(); }
  if (e.key === 'ArrowRight') { keys.right = false; syncInput(); }
});
stage.addEventListener('pointerdown', e => {
  if (state !== 'playing') return;
  const r = stage.getBoundingClientRect();
  pointers.set(e.pointerId, (e.clientX - r.left) < r.width / 2 ? 'left' : 'right');
  syncInput();
  e.preventDefault();
});
function endPointer(e) { if (pointers.delete(e.pointerId)) syncInput(); }
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('contextmenu', e => e.preventDefault());
// kill page scroll / pinch-zoom interference during play
document.addEventListener('touchmove', e => { if (state === 'playing') e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
restartBtn.addEventListener('click', () => { ensureAudio(); startGame(); });

// ---------- physics ----------
function step(dt) {
  if (state !== 'playing') return;
  if (graceT > 0) graceT -= dt;

  // horizontal
  if (input.left && !input.right) player.x -= MOVE * dt;
  if (input.right && !input.left) player.x += MOVE * dt;
  if (player.x < -player.w / 2) player.x = W + player.w / 2;
  if (player.x > W + player.w / 2) player.x = -player.w / 2;

  // vertical
  const prevBottom = player.y + player.h;
  player.vy += GRAV * dt;
  player.y += player.vy * dt;
  const newBottom = player.y + player.h;

  // landing (only while falling)
  if (player.vy > 0) {
    for (const p of platforms) {
      if (prevBottom <= p.y + 6 && newBottom >= p.y &&
          player.x + player.w > p.x && player.x < p.x + p.w) {
        player.y = p.y - player.h;
        player.vy = JUMP_V;
        if (p.isTarget) {
          score++; scoreEl.textContent = String(score);
          popups.push({ x: player.x + player.w / 2, y: p.y - 10, text: '+1', ttl: 0.8 });
          beep(660, 100, 'triangle'); setTimeout(() => beep(880, 120, 'triangle'), 70);
          newRound();
        } else {
          loseLife();
          if (state === 'playing') beep(240, 120, 'square');
        }
        break;
      }
    }
  }

  // camera follows upward
  if (player.y < camY + H * 0.38) camY = player.y - H * 0.38;
  genAbove();

  // fell below screen
  if (player.y - camY > H + 60) {
    loseLife();
    if (state === 'playing') respawnAfterFall();
  }

  // popups
  for (const pu of popups) { pu.y -= 40 * dt; pu.ttl -= dt; }
  popups = popups.filter(pu => pu.ttl > 0);
}

// ---------- rendering ----------
function fitText(text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function render() {
  // background
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#101b33'); g.addColorStop(1, '#0b1322');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  if (state === 'playing' || state === 'gameover') {
    // platforms
    ctx.font = '600 13px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of platforms) {
      const sy = p.y - camY;
      if (sy < -40 || sy > H + 40) continue;
      ctx.fillStyle = '#2f9e63';
      roundRect(p.x, sy, p.w, p.h, 8); ctx.fill();
      ctx.fillStyle = '#0d2417';
      roundRect(p.x, sy, p.w, p.h, 8);
      ctx.lineWidth = 2; ctx.strokeStyle = '#57d68d'; ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(fitText(p.term, p.w - 12), p.x + p.w / 2, sy + p.h / 2 + 0.5);
    }
    // player (skip draw every other 0.1s during grace for blink)
    const blink = graceT > 0 && Math.floor(graceT * 10) % 2 === 0;
    if (!blink) {
      const px = player.x, py = player.y - camY;
      ctx.fillStyle = '#ff9f1c';
      ctx.beginPath(); ctx.arc(px + 15, py + 15, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0e1626';
      ctx.beginPath(); ctx.arc(px + 10, py + 12, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 20, py + 12, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0e1626'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px + 15, py + 17, 6, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
    }
    // popups
    ctx.font = '700 18px -apple-system, "Segoe UI", Roboto, sans-serif';
    for (const pu of popups) {
      ctx.globalAlpha = Math.min(1, pu.ttl * 2);
      ctx.fillStyle = '#ffd166';
      ctx.fillText(pu.text, pu.x, pu.y - camY);
      ctx.globalAlpha = 1;
    }
  }
}

// ---------- main loop (fixed timestep) ----------
let last = 0, acc = 0;
function loop(t) {
  requestAnimationFrame(loop);
  if (!last) last = t;
  let dt = (t - last) / 1000; last = t;
  if (dt > 0.25) dt = 0.25; // tab was hidden
  acc += dt;
  while (acc >= STEP) { step(STEP); acc -= STEP; }
  render();
}

// ---------- boot ----------
renderChapterButtons();
resize();
showMenu();
loadCardsForMenu(); // preload so Start is instant
requestAnimationFrame(loop);
