// Memory Match (concentration) for TRSS study games.
// No external deps. Imports the shared card loader via ES module.
import { CHAPTERS, loadChapterCards, shuffle } from '../common/cards-loader.js';

const root = document.getElementById('root');
const restartBtn = document.getElementById('restart-btn');

const LS_CHAPTER = 'trss-match-chapter';
const LS_BEST = 'trss-match-best';

const PAIRS = 6;
const FLIP_BACK_MS = 800;
// Score = max(0, 1000 - 25 * moves - 2 * elapsedSeconds)
const SCORE_BASE = 1000;
const SCORE_PER_MOVE = 25;
const SCORE_PER_SEC = 2;

let state = null;

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function getBest() {
  const v = Number(localStorage.getItem(LS_BEST));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function setBest(v) {
  localStorage.setItem(LS_BEST, String(v));
}

function errorBox(msg) {
  root.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'error';
  d.textContent = msg;
  root.appendChild(d);
}

// ---------- start screen ----------
function renderStart(selected) {
  root.innerHTML = '';
  restartBtn.hidden = true;

  const wrap = document.createElement('div');
  wrap.className = 'start-wrap';

  const p = document.createElement('p');
  p.textContent = 'Match each term with its definition. Pick a chapter:';
  wrap.appendChild(p);

  const ch = document.createElement('div');
  ch.className = 'chapters';
  for (const key of Object.keys(CHAPTERS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = CHAPTERS[key].label || key;
    b.dataset.chapter = key;
    b.setAttribute('aria-pressed', key === selected ? 'true' : 'false');
    b.addEventListener('click', () => {
      localStorage.setItem(LS_CHAPTER, key);
      renderStart(key);
    });
    ch.appendChild(b);
  }
  wrap.appendChild(ch);

  const best = getBest();
  if (best > 0) {
    const bi = document.createElement('p');
    bi.textContent = 'Best score: ' + best;
    wrap.appendChild(bi);
  }

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'start-btn';
  start.textContent = 'Start';
  start.addEventListener('click', () => startGame(selected, start));
  wrap.appendChild(start);

  root.appendChild(wrap);
}

async function startGame(chapterId, startBtnEl) {
  startBtnEl.disabled = true;
  startBtnEl.textContent = 'Loading cards…';
  let cards;
  try {
    cards = await loadChapterCards(chapterId);
  } catch (e) {
    errorBox('Couldn\u2019t load card data for this chapter. Check your connection and try again.');
    return;
  }
  if (!Array.isArray(cards) || cards.length < PAIRS) {
    errorBox('Not enough cards in this chapter to play Memory Match (need at least ' + PAIRS + ').');
    return;
  }
  const picked = shuffle(cards).slice(0, PAIRS);
  const tiles = shuffle(
    picked.flatMap((c) => [
      { cardId: c.id, kind: 'term', text: c.term },
      { cardId: c.id, kind: 'def', text: c.simple },
    ])
  ).map((t, i) => ({ ...t, index: i, matched: false, faceUp: false }));

  state = {
    tiles,
    first: null,
    moves: 0,
    matchedCount: 0,
    startAt: Date.now(),
    elapsed: 0,
    timerId: null,
    over: false,
  };
  renderGame();
  state.timerId = setInterval(() => {
    if (!state || state.over) return;
    state.elapsed = (Date.now() - state.startAt) / 1000;
    const el = document.getElementById('hud-time');
    if (el) el.textContent = fmtTime(state.elapsed);
  }, 500);
}

// ---------- in-game screen ----------
function renderGame() {
  root.innerHTML = '';
  restartBtn.hidden = false;

  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.innerHTML =
    '<div class="stat"><span class="label">Moves</span><b id="hud-moves">0</b></div>' +
    '<div class="stat"><span class="label">Time</span><b id="hud-time">00:00</b></div>' +
    '<div class="stat"><span class="label">Best</span><b>' + getBest() + '</b></div>';
  root.appendChild(hud);

  const grid = document.createElement('div');
  grid.className = 'grid';
  state.tiles.forEach((t) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.index = t.index;
    tile.dataset.kind = t.kind;
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');
    tile.setAttribute('aria-label', 'hidden card');
    tile.innerHTML =
      '<div class="tile-inner">' +
      '<div class="tile-face tile-back">?</div>' +
      '<div class="tile-face tile-front"><span></span></div>' +
      '</div>';
    tile.querySelector('.tile-front span').textContent = t.text;
    tile.addEventListener('click', () => onTileTap(tile, t));
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onTileTap(tile, t);
      }
    });
    grid.appendChild(tile);
  });
  root.appendChild(grid);
}

function onTileTap(el, t) {
  if (state.over || t.matched || t.faceUp) return;
  if (state.first && state.first.lock) return; // evaluating a pair, ignore
  if (state.first && state.first.tile === t) return; // tapped same tile twice

  t.faceUp = true;
  el.classList.add('flipped');

  if (!state.first) {
    state.first = { tile: t, el };
    return;
  }

  // Second tile of the pair
  const first = state.first;
  state.first = { lock: true };
  state.moves++;
  document.getElementById('hud-moves').textContent = state.moves;

  if (first.tile.cardId === t.cardId) {
    first.tile.matched = true;
    t.matched = true;
    first.el.classList.add('matched');
    el.classList.add('matched');
    state.matchedCount++;
    state.first = null;
    if (state.matchedCount === PAIRS) endGame();
  } else {
    setTimeout(() => {
      first.tile.faceUp = false;
      t.faceUp = false;
      first.el.classList.remove('flipped');
      el.classList.remove('flipped');
      state.first = null;
    }, FLIP_BACK_MS);
  }
}

function endGame() {
  state.over = true;
  clearInterval(state.timerId);
  state.elapsed = (Date.now() - state.startAt) / 1000;
  const secs = Math.floor(state.elapsed);
  const score = Math.max(0, SCORE_BASE - SCORE_PER_MOVE * state.moves - SCORE_PER_SEC * secs);
  const prevBest = getBest();
  const isNewBest = score > prevBest;
  if (isNewBest) setBest(score);

  const panel = document.createElement('div');
  panel.className = 'win-panel';
  panel.innerHTML =
    '<h2>You matched them all!</h2>' +
    '<p>Moves: <b>' + state.moves + '</b> &nbsp; Time: <b>' + fmtTime(secs) + '</b></p>' +
    '<p>Score: <b>' + score + '</b></p>' +
    (isNewBest ? '<div class="new-best">NEW BEST!</div>' : '<p>Best: ' + prevBest + '</p>');
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'again';
  again.textContent = 'Play again';
  again.addEventListener('click', () => {
    restartBtn.hidden = true;
    startGame(localStorage.getItem(LS_CHAPTER) || 'ch7', again);
    again.disabled = true;
    again.textContent = 'Loading cards…';
  });
  panel.appendChild(again);
  root.appendChild(panel);
}

// ---------- restart ----------
restartBtn.addEventListener('click', () => {
  if (state && state.timerId) clearInterval(state.timerId);
  state = null;
  renderStart(localStorage.getItem(LS_CHAPTER) || 'ch7');
});

// ---------- boot ----------
(function init() {
  let saved = null;
  try {
    saved = localStorage.getItem(LS_CHAPTER);
  } catch (e) {
    saved = null;
  }
  const initial = saved && CHAPTERS[saved] ? saved : 'ch7';
  try {
    localStorage.setItem(LS_CHAPTER, initial);
  } catch (e) {
    // private browsing: game still works, chapter just won't persist
  }
  renderStart(initial);
})();
