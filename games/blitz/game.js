import { CHAPTERS, loadChapterCards, pickDistractors, shuffle } from '../common/cards-loader.js';

const LS_CHAPTER = 'trss-blitz-chapter';
const LS_BEST = 'trss-blitz-best';
const GAME_SECONDS = 60;
const PTS_CORRECT = 100;
const PTS_PER_STREAK = 25;

const $ = (id) => document.getElementById(id);
const screens = { start: $('start-screen'), game: $('game-screen'), over: $('over-screen') };

const state = {
  cards: [],
  deck: [],        // shuffled queue of remaining card indexes
  current: null,  // { card, shownTrue }
  score: 0,
  streak: 0,
  answered: 0,
  correct: 0,
  secondsLeft: GAME_SECONDS,
  timerId: null,
  accepting: true,
  chapterId: localStorage.getItem(LS_CHAPTER) || 'ch7',
};

function getBest() {
  const v = parseInt(localStorage.getItem(LS_BEST) || '0', 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
function setBest(v) {
  localStorage.setItem(LS_BEST, String(v));
}

function showScreen(name) {
  for (const k of Object.keys(screens)) screens[k].classList.toggle('active', k === name);
}

function showError(msg) {
  const el = $('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  $('error-msg').style.display = 'none';
}

// ---------- start screen ----------
function buildChapterPicker() {
  const picker = $('chapter-picker');
  picker.innerHTML = '';
  const valid = Object.keys(CHAPTERS);
  if (!valid.includes(state.chapterId)) state.chapterId = valid[0] || 'ch7';
  for (const id of valid) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = CHAPTERS[id].label || id;
    b.dataset.id = id;
    b.classList.toggle('selected', id === state.chapterId);
    b.addEventListener('click', () => {
      state.chapterId = id;
      localStorage.setItem(LS_CHAPTER, id);
      picker.querySelectorAll('button').forEach((x) => x.classList.toggle('selected', x.dataset.id === id));
    });
    picker.appendChild(b);
  }
}

// ---------- game ----------
function nextCard() {
  if (state.deck.length === 0) {
    // reshuffle a fresh deck when exhausted
    state.deck = shuffle(state.cards.map((_, i) => i));
  }
  return state.cards[state.deck.pop()];
}

function presentQuestion() {
  const card = nextCard();
  const shownTrue = Math.random() < 0.5;
  let defn;
  if (shownTrue) {
    defn = card.simple;
  } else {
    // guard against a distractor that happens to have identical wording
    let tries = 0;
    let d = pickDistractors(state.cards, card.id, 1)[0];
    while (d && d.simple === card.simple && tries < 5) {
      d = pickDistractors(state.cards, card.id, 1)[0];
      tries++;
    }
    defn = d ? d.simple : card.simple;
    // if we fell back to the true definition, the answer is TRUE
    if (defn === card.simple) return presentQuestion();
  }
  state.current = { card, shownTrue: defn === card.simple };
  $('term').textContent = card.term;
  $('defn').textContent = defn;
  const fb = $('feedback');
  fb.textContent = '';
  fb.className = '';
  $('qcard').classList.remove('correct', 'wrong');
  state.accepting = true;
}

function updateHud() {
  $('score').textContent = state.score;
  $('streak').textContent = '×' + state.streak;
  $('streak-box').classList.toggle('hot', state.streak >= 3);
  const t = $('timer');
  t.textContent = state.secondsLeft;
  $('timer-box').classList.toggle('warn', state.secondsLeft <= 10);
}

function answer(playerSaysTrue) {
  if (!state.accepting || !state.current) return;
  state.accepting = false;
  const { card, shownTrue } = state.current;
  const hit = playerSaysTrue === shownTrue;
  state.answered++;
  const cardEl = $('qcard');
  const fb = $('feedback');
  if (hit) {
    state.streak++;
    state.correct++;
    state.score += PTS_CORRECT + PTS_PER_STREAK * state.streak;
    cardEl.classList.add('correct');
    fb.textContent = `+${PTS_CORRECT + PTS_PER_STREAK * state.streak}`;
    fb.className = 'good';
  } else {
    state.streak = 0;
    cardEl.classList.add('wrong');
    fb.textContent = `That was: ${card.term}`;
    fb.className = 'bad';
  }
  updateHud();
  setTimeout(() => {
    if (state.secondsLeft > 0) presentQuestion();
  }, 700);
}

function tick() {
  state.secondsLeft--;
  if (state.secondsLeft <= 0) {
    state.secondsLeft = 0;
    updateHud();
    endGame();
  } else {
    updateHud();
  }
}

function endGame() {
  clearInterval(state.timerId);
  state.timerId = null;
  $('hud').hidden = true;
  const prevBest = getBest();
  const isNewBest = state.score > prevBest;
  if (isNewBest) setBest(state.score);
  $('final-score').textContent = state.score;
  $('final-best').textContent = Math.max(prevBest, state.score);
  $('final-answered').textContent = state.answered;
  $('final-accuracy').textContent = state.answered > 0 ? Math.round((state.correct / state.answered) * 100) + '%' : '—';
  $('new-best').classList.toggle('show', isNewBest && state.score > 0);
  showScreen('over');
}

function resetGameState() {
  clearInterval(state.timerId);
  state.timerId = null;
  state.score = 0;
  state.streak = 0;
  state.answered = 0;
  state.correct = 0;
  state.secondsLeft = GAME_SECONDS;
  state.current = null;
  state.accepting = true;
}

async function startGame() {
  hideError();
  if (state.cards.length === 0) {
    try {
      state.cards = await loadChapterCards(state.chapterId);
    } catch (err) {
      showError('Could not load card data for this chapter. Check your connection and try again.');
      console.error('[blitz] loadChapterCards failed:', err);
      return;
    }
    if (!state.cards || state.cards.length === 0) {
      showError('No cards found for this chapter. Pick a different chapter.');
      return;
    }
  }
  resetGameState();
  state.deck = shuffle(state.cards.map((_, i) => i));
  $('best-hud').textContent = getBest();
  $('hud').hidden = false;
  showScreen('game');
  updateHud();
  presentQuestion();
  state.timerId = setInterval(tick, 1000);
}

function restart() {
  // reload cards fresh for the currently selected chapter, then start
  state.cards = [];
  buildChapterPicker();
  showScreen('start');
  $('hud').hidden = true;
  resetGameState();
}

// ---------- wiring ----------
$('start-btn').addEventListener('click', startGame);
$('play-again-btn').addEventListener('click', restart);
$('restart-top').addEventListener('click', restart);
$('true-btn').addEventListener('click', () => answer(true));
$('false-btn').addEventListener('click', () => answer(false));

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (screens.start.classList.contains('active') && k === 'enter') {
    startGame();
    return;
  }
  if (screens.over.classList.contains('active') && k === 'enter') {
    restart();
    return;
  }
  if (!screens.game.classList.contains('active')) return;
  if (k === 't' || k === 'arrowright') answer(true);
  else if (k === 'f' || k === 'arrowleft') answer(false);
});

buildChapterPicker();
$('best-hud').textContent = getBest();
