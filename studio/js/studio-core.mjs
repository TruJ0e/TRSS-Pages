/* TRSS Upload Studio — pure card logic.
 *
 * No DOM, no IndexedDB, no network. Imported by js/studio.js (browser UI)
 * and by tests/studio.test.mjs (Node). The card schema mirrors
 * chapter-landing/audit-chapter.py: CARD_FIELDS must all be non-empty,
 * examples must be a non-empty array, ids unique, type one of the three.
 */

export const CARD_FIELDS = ["id", "term", "type", "category", "cue", "simple", "examples", "apply"];
export const CARD_TYPES = ["book-term", "lesson-concept", "research-skill"];
export const TYPE_TO_KEY = { "book-term": "core", "lesson-concept": "lesson", "research-skill": "extra" };
export const EXPORT_FORMAT = "trss-studio-cards";
export const EXPORT_VERSION = 1;

/** Next stable card id, e.g. "studio-core-001". `counters` is mutated. */
export function nextId(counters, type) {
  const key = TYPE_TO_KEY[type] || "core";
  counters[key] = (counters[key] || 0) + 1;
  return "studio-" + key + "-" + String(counters[key]).padStart(3, "0");
}

/** One-per-line textarea -> trimmed non-empty array. */
export function splitExamples(text) {
  return String(text == null ? "" : text)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normalize raw editor input into a base-model card object.
 * `input.examples` may be an array already; otherwise `input.examplesText`
 * (one per line) is split. `counters` supplies the id when none is given.
 */
export function buildCard(input, counters) {
  const type = CARD_TYPES.includes(input.type) ? input.type : "book-term";
  const card = {
    id: input.id || nextId(counters || {}, type),
    term: String(input.term || "").trim(),
    type: type,
    category: String(input.category || "").trim() || "General",
    cue: String(input.cue || "").trim(),
    simple: String(input.simple || "").trim(),
    examples: Array.isArray(input.examples)
      ? input.examples.map((s) => String(s).trim()).filter(Boolean)
      : splitExamples(input.examplesText),
    apply: String(input.apply || "").trim(),
  };
  const compare = String(input.compare || "").trim();
  card.compare = compare; // may be empty — same as audit-chapter.py
  return card;
}

/**
 * Validate one card. Mirrors chapter-landing/audit-chapter.py's card checks.
 * Returns an array of problem strings (empty = valid). `seenIds` is a Set
 * used to catch duplicates across a whole export.
 */
export function validateCard(card, seenIds) {
  const problems = [];
  const label = card && card.id ? card.id : "?";
  for (const f of CARD_FIELDS) {
    const v = card ? card[f] : undefined;
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      problems.push("card " + label + " missing/empty field " + JSON.stringify(f));
    }
  }
  if (!Array.isArray(card.examples) || card.examples.length === 0) {
    problems.push("card " + label + " has empty examples list");
  } else {
    card.examples.forEach((ex, i) => {
      if (typeof ex !== "string" || ex.trim() === "") {
        problems.push("card " + label + " examples[" + i + "] empty");
      }
    });
  }
  if (!CARD_TYPES.includes(card.type)) {
    problems.push("card " + label + " has invalid type " + JSON.stringify(card.type));
  }
  if (card.compare !== undefined && typeof card.compare !== "string") {
    problems.push("card " + label + " compare must be a string");
  }
  if (seenIds) {
    if (seenIds.has(card.id)) problems.push("duplicate card id: " + card.id);
    else seenIds.add(card.id);
  }
  return problems;
}

/** Wrap cards in the versioned export envelope. */
export function exportDoc(cards) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    cards: cards,
  };
}

/** Validate a whole export document. Returns problem strings (empty = valid). */
export function validateExport(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return ["export is not a JSON object"];
  }
  const problems = [];
  if (doc.format !== EXPORT_FORMAT) {
    problems.push("format " + JSON.stringify(doc.format) + " != " + JSON.stringify(EXPORT_FORMAT));
  }
  if (doc.version !== EXPORT_VERSION) {
    problems.push("version " + JSON.stringify(doc.version) + " != " + EXPORT_VERSION);
  }
  if (!Array.isArray(doc.cards)) {
    problems.push("cards is not an array");
    return problems;
  }
  const seen = new Set();
  doc.cards.forEach((c, i) => {
    validateCard(c, seen).forEach((p) => problems.push("cards[" + i + "]: " + p));
  });
  return problems;
}

/**
 * Parse imported file text. Returns {cards, problems}; cards is [] unless
 * the document validates cleanly — invalid imports never partially apply.
 */
export function parseImport(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { cards: [], problems: ["invalid JSON: " + e.message] };
  }
  const problems = validateExport(doc);
  return { cards: problems.length ? [] : doc.cards, problems: problems };
}
