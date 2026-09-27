/* TRSS Games — shared chapter card loader.
 *
 * Loads the live site's card data files (the same files the chapter pages
 * use) and normalizes to [{id, term, simple, cue, examples[]}].
 * No dependencies. Assumes the game lives at /games/<name>/ on the site,
 * so site root is ../../ from this module.
 */

const SITE_ROOT = new URL("../../", import.meta.url);

export const CHAPTERS = {
  ch7: {
    label: "Chapter 7 — Emotion & Motivation",
    files: ["core-cards.js", "lesson-cards.js", "extra-cards.js"],
    globals: ["CH7_CORE_CARDS", "CH7_LESSON_CARDS", "CH7_EXTRA_CARDS"],
  },
  ch14: {
    label: "Chapter 14 — The Troubled Mind",
    files: [
      "general-psychology/chapter-14/core-cards.js",
      "general-psychology/chapter-14/lesson-cards.js",
      "general-psychology/chapter-14/extra-cards.js",
    ],
    globals: ["CH14_CORE_CARDS", "CH14_LESSON_CARDS", "CH14_EXTRA_CARDS"],
  },
  ch16: {
    label: "Chapter 16 — The Healthy Mind",
    files: [
      "general-psychology/chapter-16/core-cards.js",
      "general-psychology/chapter-16/lesson-cards.js",
      "general-psychology/chapter-16/extra-cards.js",
    ],
    globals: ["CH16_CORE_CARDS", "CH16_LESSON_CARDS", "CH16_EXTRA_CARDS"],
  },
  exam1: {
    label: "Exam 1 Guide — Ch 7 + 14 + 16",
    include: ["ch7", "ch14", "ch16"],
  },
};

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error("failed to load " + url));
    document.head.appendChild(s);
  });
}

function normalize(raw) {
  return {
    id: String(raw.id || ""),
    term: String(raw.term || "").trim(),
    simple: String(raw.simple || "").trim(),
    cue: String(raw.cue || "").trim(),
    examples: Array.isArray(raw.examples) ? raw.examples.map(String) : [],
  };
}

/** [{id, label}] for chapter-select UI. */
export function chapterList() {
  return Object.entries(CHAPTERS).map(([id, c]) => ({ id, label: c.label }));
}

/**
 * Load and normalize all cards for a chapter id.
 * onProgress(url) is called before each file loads (may be used for a loader UI).
 * Throws when nothing usable loads.
 */
export async function loadChapterCards(id, onProgress) {
  const def = CHAPTERS[id];
  if (!def) throw new Error("unknown chapter: " + id);
  const ids = def.include || [id];
  const cards = [];
  const seen = new Set();
  for (const cid of ids) {
    const c = CHAPTERS[cid];
    for (let i = 0; i < c.files.length; i++) {
      const url = new URL(c.files[i], SITE_ROOT).toString();
      if (onProgress) onProgress(url);
      await loadScript(url);
      const arr = window[c.globals[i]] || [];
      for (const raw of arr) {
        const n = normalize(raw);
        if (n.id && n.term && n.simple && !seen.has(n.id)) {
          seen.add(n.id);
          cards.push(n);
        }
      }
    }
  }
  if (!cards.length) throw new Error("no cards loaded for chapter " + id);
  return cards;
}

/** n random distractors (full card objects) from the set, excluding one id. */
export function pickDistractors(cards, excludeId, n) {
  const pool = cards.filter((c) => c.id !== excludeId);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
