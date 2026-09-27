import { CHAPTERS, loadChapterCards, shuffle } from '../common/cards-loader.js';

const $ = (sel) => document.querySelector(sel);
const root = $('#root');
const ROUNDS = 10;
const MAX_TILE_LETTERS = 14;
const LS_CHAPTER = 'trss-scramble-chapter';
const LS_BEST = 'trss-scramble-best';

let best = Number(localStorage.getItem(LS_BEST) || 0);

function lettersOf(term) {
  return (term || '').toLowerCase().replace(/[^a-z]/g, '');
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------- start screen ----------
function renderStart() {
  root.innerHTML = '';
  root.appendChild(el('h1', null, 'Word Scramble'));
  root.appendChild(el('p', null, 'Read the definition, then tap the tiles in order to spell the term.'));

  const saved = localStorage.getItem(LS_CHAPTER) || 'ch7';
  const wrap = el('div', 'chapters');
  const keys = ['ch7', 'ch14', 'ch16', 'exam1'].filter((k) => CHAPTERS[k]);
  let selected = keys.includes(saved) ? saved : keys[0];

  keys.forEach((k) => {
    const b = el('button', 'btn ch' + (k === selected ? ' selected' : ''), CHAPTERS[k].label);
    b.type = 'button';
    b.addEventListener('click', () => {
      selected = k;
      wrap.querySelectorAll('.ch').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
    });
    wrap.appendChild(b);
  });
  root.appendChild(wrap);

  const start = el('button', 'btn primary', `Start — ${ROUNDS} words`);
  start.type = 'button';
  start.addEventListener('click', () => {
    localStorage.setItem(LS_CHAPTER, selected);
    renderGame(selected);
  });
  root.appendChild(start);
  root.appendChild(el('p', null, `Best score: ${best}`));
}

// ---------- error screen ----------
function renderError(message) {
  root.innerHTML = '';
  const box = el('div', 'error', `Couldn't load study cards. ${message} Check your connection and tap Restart to try again.`);
  root.appendChild(box);
}

// ---------- game ----------
function renderGame(chapterId) {
  root.innerHTML = '';
  const bar = el('div', 'scorebar');
  const scoreEl = el('span', null, 'Score: 0');
  const bestEl = el('span', null, `Best: ${best}`);
  const roundEl = el('span', null, '');
  bar.append(scoreEl, bestEl, roundEl);
  root.appendChild(bar);

  const msg = el('div', 'msg');
  root.appendChild(msg);

  const defBox = el('div', 'def');
  const lbl = el('span', 'lbl', 'Definition');
  const defText = el('span');
  defBox.append(lbl, defText);
  root.appendChild(defBox);

  const answerRow = el('div', 'answer-row');
  root.appendChild(answerRow);
  const tilesWrap = el('div', 'tiles');
  root.appendChild(tilesWrap);

  const ctrls = el('div', 'controls');
  const backBtn = el('button', 'btn', '⌫ Backspace');
  const clearBtn = el('button', 'btn', 'Clear');
  const hintBtn = el('button', 'btn warn', '💡 Hint (−25)');
  const skipBtn = el('button', 'btn warn', 'Skip (−25)');
  [backBtn, clearBtn, hintBtn, skipBtn].forEach((b) => (b.type = 'button'));
  ctrls.append(backBtn, clearBtn, hintBtn, skipBtn);
  root.appendChild(ctrls);

  const state = {
    words: [],
    idx: 0,
    score: 0,
    solved: 0,
    skips: 0,
    hintsUsed: 0,
    mistakes: 0,
    target: '',
    picked: [], // indexes into tile list
    tiles: [],  // {ch, el, used}
  };

  function setMsg(text, cls) {
    msg.textContent = text || '';
    msg.className = 'msg' + (cls ? ' ' + cls : '');
  }

  function updateBar() {
    scoreEl.textContent = `Score: ${state.score}`;
    bestEl.textContent = `Best: ${best}`;
    roundEl.textContent = `Word ${Math.min(state.idx + 1, ROUNDS)} / ${ROUNDS}`;
  }

  function revealTile(i) {
    const t = state.tiles[i];
    t.used = true;
    t.el.classList.add('used');
  }
  function returnTile(i) {
    const t = state.tiles[i];
    t.used = false;
    t.el.classList.remove('used');
  }

  function renderSlots() {
    answerRow.innerHTML = '';
    const letters = state.picked.map((i) => state.tiles[i].ch);
    for (let i = 0; i < state.target.length; i++) {
      const s = el('div', 'slot' + (i < letters.length ? ' filled' : ''));
      if (i < letters.length) s.textContent = letters[i];
      answerRow.appendChild(s);
    }
  }

  function nextWord() {
    state.idx += 1;
    if (state.idx >= ROUNDS || state.idx >= state.words.length) {
      renderResults();
      return;
    }
    setupWord();
  }

  function setupWord() {
    const card = state.words[state.idx];
    state.target = lettersOf(card.term);
    state.picked = [];
    state.tiles = [];

    defText.textContent = card.simple || '(no definition)';
    setMsg('');

    // Build tile letters; ensure the scramble isn't accidentally already solved.
    let chars = shuffle(state.target.split(''));
    let guard = 0;
    while (chars.join('') === state.target && state.target.length > 1 && guard++ < 20) {
      chars = shuffle(state.target.split(''));
    }

    tilesWrap.innerHTML = '';
    chars.forEach((ch) => {
      const t = el('button', 'tile', ch);
      t.type = 'button';
      const tile = { ch, el: t, used: false };
      t.addEventListener('click', () => tapTile(tile));
      state.tiles.push(tile);
      tilesWrap.appendChild(t);
    });
    renderSlots();
    updateBar();
  }

  function tapTile(tile) {
    if (tile.used || state.picked.length >= state.target.length) return;
    const idx = state.tiles.indexOf(tile);
    state.picked.push(idx);
    revealTile(idx);
    setMsg('');
    renderSlots();
    if (state.picked.length === state.target.length) checkAnswer();
  }

  function built() {
    return state.picked.map((i) => state.tiles[i].ch).join('');
  }

  function checkAnswer() {
    if (built() === state.target) {
      state.score += 100;
      state.solved += 1;
      setMsg('Correct! +100', 'ok');
      defBox.classList.remove('flash-correct');
      void defBox.offsetWidth;
      defBox.classList.add('flash-correct');
      updateBar();
      setTimeout(nextWord, 650);
    } else {
      state.mistakes += 1;
      setMsg('Not quite — try again.', 'err');
      answerRow.classList.remove('shake');
      void answerRow.offsetWidth;
      answerRow.classList.add('shake');
      setTimeout(() => {
        state.picked.forEach(returnTile);
        state.picked = [];
        renderSlots();
      }, 450);
    }
  }

  backBtn.addEventListener('click', () => {
    if (!state.picked.length) return;
    returnTile(state.picked.pop());
    renderSlots();
  });

  clearBtn.addEventListener('click', () => {
    state.picked.forEach(returnTile);
    state.picked = [];
    renderSlots();
    setMsg('');
  });

  hintBtn.addEventListener('click', () => {
    if (!state.target || state.picked.length >= state.target.length) return;
    // find first unused tile matching the next needed letter
    const need = state.target[state.picked.length];
    const cand = state.tiles.find((t) => !t.used && t.ch === need);
    if (!cand) return;
    tapTile(cand);
    state.score -= 25;
    state.hintsUsed += 1;
    setMsg('Hint used (−25)', 'err');
    updateBar();
  });

  skipBtn.addEventListener('click', () => {
    state.score -= 25;
    state.skips += 1;
    setMsg(`Skipped — the word was "${state.target}"`, 'err');
    updateBar();
    setTimeout(nextWord, 900);
  });

  // load cards and start
  (async () => {
    try {
      const cards = await loadChapterCards(chapterId);
      if (!cards || !cards.length) throw new Error('No cards found for this chapter.');
      const withLetters = cards.filter((c) => lettersOf(c.term).length >= 2);
      if (!withLetters.length) throw new Error('No usable terms in this chapter.');
      const short = withLetters.filter((c) => lettersOf(c.term).length <= MAX_TILE_LETTERS);
      const pool = short.length >= ROUNDS ? short : withLetters;
      state.words = shuffle(pool).slice(0, ROUNDS);
      setupWord();
    } catch (err) {
      renderError(err && err.message ? err.message : String(err));
    }
  })();

  function renderResults() {
    if (state.score > best) {
      best = state.score;
      localStorage.setItem(LS_BEST, String(best));
    }
    root.innerHTML = '';
    const box = el('div', 'results');
    box.appendChild(el('h1', null, 'Results'));
    box.appendChild(el('div', 'big', String(state.score)));
    const rows = [
      ['Solved', `${state.solved} / ${ROUNDS}`],
      ['Skipped', String(state.skips)],
      ['Mistakes', String(state.mistakes)],
      ['Hints used', String(state.hintsUsed)],
      ['Best', String(best)],
    ];
    rows.forEach(([k, v]) => {
      const r = el('div', 'row');
      r.appendChild(el('span', null, k));
      const val = el('strong', null, v);
      r.appendChild(val);
      box.appendChild(r);
    });
    const again = el('button', 'btn primary', '↻ Play Again');
    again.type = 'button';
    again.style.marginTop = '14px';
    again.addEventListener('click', () => renderGame(chapterId));
    box.appendChild(again);
    root.appendChild(box);
  }
}

$('#restartBtn').addEventListener('click', () => renderStart());
renderStart();
