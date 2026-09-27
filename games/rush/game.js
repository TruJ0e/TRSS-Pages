// Type Rush — TRSS study game.
// Definitions fall from the top of the playfield toward a deadline line.
// Type the matching term (auto-clears on exact case-insensitive match, or Enter).
//
// Speed ramp (documented): fall speed *= 1.15 every 10 clears AND += 10px/s
// every 15 seconds of play. Spawn interval shrinks from 2.6s to a 1.1s floor
// as clears grow. Max 3 concurrent chips on phone widths, 4 on >=720px.

import { CHAPTERS, loadChapterCards, shuffle } from '../common/cards-loader.js';

const LS_CHAPTER = 'trss-rush-chapter';
const LS_BEST = 'trss-rush-best';
const CHAPTER_IDS = ['ch7', 'ch14', 'ch16', 'exam1'];
const MAX_TERM_LEN = 16;

const $ = (id) => document.getElementById(id);
const menuEl = $('menu'), gameEl = $('game'), overEl = $('over'), errEl = $('load-error');
const chapBtnsEl = $('chapbtns'), startBtn = $('startbtn'), menuBestEl = $('menubest');
const fieldEl = $('field'), deadlineEl = $('deadline');
const inputEl = $('guess'), focusPill = $('focuspill');
const scoreEl = $('score'), bestHudEl = $('besthud'), clearedEl = $('cleared'), livesEl = $('lives');
const restartBtn = $('restartbtn'), restartSpacer = $('restartspacer');
const againBtn = $('againbtn'), changeBtn = $('changebtn'), retryBtn = $('retrybtn');

let chapterId = localStorage.getItem(LS_CHAPTER) || 'ch7';
if (!CHAPTER_IDS.includes(chapterId)) chapterId = 'ch7';
let best = parseInt(localStorage.getItem(LS_BEST) || '0', 10) || 0;

// ---------- game state ----------
let state = 'menu'; // menu | playing | over
let cards = [];
let deck = [];
let items = []; // {card, el, y, speed}
let rafId = 0, lastT = 0, spawnT = 0, elapsed = 0, lastRampT = 0;
let score = 0, clears = 0, lives = 3, fallSpeed = 46; // px/s base

// ---------- chapter picker ----------
function renderChapterButtons() {
  chapBtnsEl.innerHTML = '';
  CHAPTER_IDS.forEach((id) => {
    const b = document.createElement('button');
    b.className = 'chapbtn' + (id === chapterId ? ' sel' : '');
    b.textContent = CHAPTERS[id] ? CHAPTERS[id].label : id;
    b.addEventListener('click', () => {
      chapterId = id;
      localStorage.setItem(LS_CHAPTER, chapterId);
      renderChapterButtons();
    });
    chapBtnsEl.appendChild(b);
  });
}

function refreshMenuBest() {
  menuBestEl.textContent = best > 0 ? `Your best: ${best}` : '';
}

// ---------- screen switching ----------
function show(el) {
  [menuEl, gameEl, overEl, errEl].forEach((s) => { s.hidden = s !== el; });
  const inGame = el === gameEl;
  restartBtn.hidden = !inGame;
  restartSpacer.hidden = inGame; // keep title centered when restart hidden
  if (inGame) {
    // game section keeps its inline flex layout from the shell;
    // the [hidden] rule above handles visibility
    keepFocus();
  }
}

function showError(msg) {
  $('errmsg').textContent = msg;
  show(errEl);
}

// ---------- deck ----------
function buildDeck() {
  let pool = cards.filter((c) => c.term && c.term.trim().length <= MAX_TERM_LEN);
  if (pool.length === 0) pool = cards.slice(); // graceful fallback: long terms allowed
  deck = shuffle(pool);
}
function drawCard() {
  if (deck.length === 0) buildDeck();
  return deck.pop();
}

// ---------- gameplay ----------
function startGame() {
  items.forEach((it) => it.el.remove());
  items = [];
  score = 0; clears = 0; lives = 3; fallSpeed = 46;
  elapsed = 0; lastRampT = 0; spawnT = 0;
  buildDeck();
  inputEl.value = '';
  updateHud();
  state = 'playing';
  show(gameEl);
  lastT = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function updateHud() {
  scoreEl.textContent = score;
  bestHudEl.textContent = best;
  clearedEl.textContent = clears;
  livesEl.textContent = '♥'.repeat(lives) + '♡'.repeat(Math.max(0, 3 - lives));
}

function maxActive() {
  return window.innerWidth >= 720 ? 4 : 3;
}

function spawnInterval() {
  return Math.max(1100, 2600 - clears * 40); // ms
}

function spawnItem() {
  const card = drawCard();
  if (!card) return;
  const el = document.createElement('div');
  el.className = 'chip';
  el.textContent = card.simple || card.term; // definition on the chip
  fieldEl.appendChild(el);

  const fieldW = fieldEl.clientWidth;
  const chipW = Math.min(el.offsetWidth, fieldW * 0.9);
  const maxLeft = Math.max(4, fieldW - chipW - 8);
  const x = 4 + Math.random() * maxLeft;
  el.style.left = x + 'px';

  items.push({
    card,
    el,
    y: -el.offsetHeight - 4,
    speed: fallSpeed * (0.9 + Math.random() * 0.2),
  });
}

function deadlineY() {
  return fieldEl.clientHeight - 10;
}

function tick(now) {
  if (state !== 'playing') return;
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  elapsed += dt;

  // time-based ramp: +10px/s every 15s
  if (elapsed - lastRampT >= 15) {
    lastRampT = elapsed;
    fallSpeed += 10;
  }

  // spawn
  spawnT += dt * 1000;
  const topClear = items.every((it) => it.y > 90);
  if (items.length < maxActive() && spawnT >= spawnInterval() && topClear) {
    spawnT = 0;
    spawnItem();
  }

  const line = deadlineY();
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.y += it.speed * dt;
    it.el.style.transform = `translateY(${it.y}px)`;
    if (it.y + it.el.offsetHeight >= line) {
      // crossed the deadline: lose a life
      it.el.remove();
      items.splice(i, 1);
      lives -= 1;
      fieldEl.classList.remove('hit');
      void fieldEl.offsetWidth; // restart flash animation
      fieldEl.classList.add('hit');
      updateHud();
      if (lives <= 0) { gameOver(); return; }
    }
  }

  rafId = requestAnimationFrame(tick);
}

function clearItem(it) {
  const line = deadlineY();
  const heightBonus = Math.round(60 * Math.max(0, 1 - it.y / line));
  score += 100 + heightBonus;
  clears += 1;
  it.el.remove();
  items = items.filter((x) => x !== it);
  // clear-count ramp: *= 1.15 every 10 clears
  if (clears % 10 === 0) fallSpeed *= 1.15;
  updateHud();
}

function tryMatch() {
  if (state !== 'playing') return;
  const v = inputEl.value.trim().toLowerCase();
  if (!v) return;
  const hit = items.find((it) => (it.card.term || '').trim().toLowerCase() === v);
  if (hit) {
    clearItem(hit);
    inputEl.value = '';
  }
}

function gameOver() {
  state = 'over';
  cancelAnimationFrame(rafId);
  items.forEach((it) => it.el.remove());
  items = [];
  const isBest = score > best;
  if (isBest) {
    best = score;
    localStorage.setItem(LS_BEST, String(best));
  }
  $('newbest').hidden = !isBest;
  $('overstats').innerHTML =
    `Score: <b>${score}</b><br>Best: <b>${best}</b><br>Words cleared: <b>${clears}</b>`;
  show(overEl);
}

// ---------- input / focus handling (iPhone) ----------
// Strategy: never steal focus ourselves (clearing doesn't blur the input),
// and if focus IS lost mid-game (user tapped the field, keyboard dismissed),
// show a "Tap to focus" pill instead of fighting iOS. Compromise: we cannot
// programmatically re-open the iOS keyboard without a user tap, so the pill
// is the affordance. Also the layout is pure flex with 100dvh so the keyboard
// shrinking the visual viewport just shrinks the playfield — chips keep falling.
function keepFocus() {
  if (state === 'playing' && document.activeElement !== inputEl) {
    inputEl.focus({ preventScroll: true });
  }
}
inputEl.addEventListener('input', tryMatch);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); tryMatch(); }
});
inputEl.addEventListener('blur', () => {
  if (state === 'playing') focusPill.hidden = false;
});
inputEl.addEventListener('focus', () => {
  focusPill.hidden = true;
});
focusPill.addEventListener('click', () => {
  inputEl.focus({ preventScroll: true });
});
// If the user taps the field (which would dismiss the keyboard), offer refocus.
fieldEl.addEventListener('touchstart', () => {
  if (state === 'playing' && document.activeElement !== inputEl) {
    focusPill.hidden = false;
  }
}, { passive: true });

// ---------- buttons ----------
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = 'Loading…';
  try {
    cards = await loadChapterCards(chapterId);
    if (!cards || cards.length === 0) throw new Error('Card list came back empty.');
    startGame();
  } catch (err) {
    showError(`Could not load cards for this chapter (${err && err.message ? err.message : err}). Check your connection and retry.`);
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
  }
});
retryBtn.addEventListener('click', () => show(menuEl));
restartBtn.addEventListener('click', () => startGame());
againBtn.addEventListener('click', () => startGame());
changeBtn.addEventListener('click', () => {
  state = 'menu';
  refreshMenuBest();
  show(menuEl);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) keepFocus();
});

// ---------- init ----------
renderChapterButtons();
refreshMenuBest();
show(menuEl);
