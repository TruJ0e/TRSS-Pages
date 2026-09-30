/* TRSS Upload Studio — browser UI.
 *
 * PDF -> text (PDF.js, pinned CDN build) -> reader pane ->
 * select text -> "Make flashcard" -> card editor -> IndexedDB ->
 * JSON export/import in the base-model card schema.
 *
 * Everything runs client-side. The file never leaves the device.
 * Serve over HTTP (module scripts + worker); e.g. `python3 -m http.server`.
 */
import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import {
  buildCard,
  validateCard,
  exportDoc,
  parseImport,
  splitExamples,
  CARD_TYPES,
} from "./studio-core.mjs";
import {
  supportedDocExt,
  extractImage,
  extractDocx,
  extractPptx,
  extractTextFile,
  loadJsZip,
} from "./studio-ingest-docs.mjs";
import {
  supportedMediaExt,
  extractEpub,
  transcribeAudio,
} from "./studio-ingest-media.mjs";

pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const readerEl = $("reader"), offerBtn = $("offer"), logEl = $("log");
const listEl = $("card-list"), countEl = $("card-count");

function log(msg) {
  logEl.textContent += (logEl.textContent.endsWith("…") ? "" : "\n") + msg;
  logEl.scrollTop = logEl.scrollHeight;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── IndexedDB ─────────────────────────────────────────────── */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("trss-upload-studio", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("cards", { keyPath: "id" });
      db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let db = null;
async function getAllCards() {
  const t = db.transaction("cards", "readonly");
  const all = await txDone(t.objectStore("cards").getAll());
  return all.sort((a, b) => (a.id < b.id ? -1 : 1));
}
async function putCard(card) {
  const t = db.transaction("cards", "readwrite");
  await txDone(t.objectStore("cards").put(card));
}
async function deleteCard(id) {
  const t = db.transaction("cards", "readwrite");
  await txDone(t.objectStore("cards").delete(id));
}
async function clearCards() {
  const t = db.transaction("cards", "readwrite");
  await txDone(t.objectStore("cards").clear());
}
async function getCounters() {
  const t = db.transaction("meta", "readonly");
  const row = await txDone(t.objectStore("meta").get("counters"));
  return (row && row.value) || { core: 0, lesson: 0, extra: 0 };
}
async function saveCounters(counters) {
  const t = db.transaction("meta", "readwrite");
  await txDone(t.objectStore("meta").put({ key: "counters", value: counters }));
}

/* ── PDF text extraction (approach reused from the upload prototype) ── */

async function extractPdfText(file, onProgress) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let t = "";
    for (const item of tc.items) {
      t += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push({ n: i, text: t.trim() });
    if (onProgress && i % 5 === 0) onProgress(i, pdf.numPages);
    await sleep(0);
  }
  return { numPages: pdf.numPages, pages };
}

/* ── Scanned-PDF fallback: render each page to an image and OCR it ──
 * Scanned PDFs have no text layer, so text extraction yields empty pages
 * ("Page 1", "Page 2", nothing under them). Instead of making the user
 * convert pages to images by hand, do it automatically: render each page
 * to a canvas and run it through the shared Tesseract worker from the
 * image ingestor. Pages that yield no text are skipped. Capped so a huge
 * scan can't hang a phone. */
const SCANNED_PDF_PAGE_CAP = 30;

async function ocrScannedPdf(file, numPages, onProgress) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const total = Math.min(numPages, SCANNED_PDF_PAGE_CAP);
  const pages = [];
  for (let i = 1; i <= total; i++) {
    if (onProgress) onProgress(i - 1, total, "Reading scanned page " + i + "/" + total);
    try {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      if (!blob) continue;
      blob.name = "page-" + i + ".png";
      const r = await extractImage(blob, () => {});
      const text = (r.pages[0] && r.pages[0].text ? r.pages[0].text : "").trim();
      if (text) pages.push({ n: i, text });
    } catch (e) {
      // Blank or unreadable page — skip it and keep going.
    }
    await sleep(0);
  }
  if (onProgress) onProgress(total, total, "Done");
  if (!pages.length) {
    throw new Error("Couldn't find readable text in this PDF — even reading " +
      "the pages as images. Try clearer scans or photos of the pages.");
  }
  let label = file.name + " — PDF (scanned, OCR, " + pages.length + "/" +
    numPages + " pages with text)";
  if (numPages > SCANNED_PDF_PAGE_CAP) {
    label += " — first " + SCANNED_PDF_PAGE_CAP + " pages only";
  }
  return { pages, label };
}

/* Human-readable page title: extractors use a number ("Page N") or a
 * string label ("Slide 3", "Chapter: Photosynthesis"). */
function pageTitle(p) {
  const base = typeof p.n === "number" ? "Page " + p.n : String(p.n);
  return p.src ? base + " — " + p.src : base;
}

let lastPages = []; // pages most recently rendered, for auto-draft

function renderReader(pages) {
  lastPages = Array.isArray(pages) ? pages : [];
  readerEl.innerHTML = "";
  // Long documents get a jump-to-section dropdown.
  if (pages.length > 3) {
    const nav = document.createElement("div");
    nav.className = "pagejump";
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", "Jump to section");
    pages.forEach((p, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = pageTitle(p);
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => {
      const blocks = readerEl.querySelectorAll("[data-page]");
      const t = blocks[+sel.value];
      if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    nav.appendChild(sel);
    readerEl.appendChild(nav);
  }
  pages.forEach((p, i) => {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-page", String(i));
    const h = document.createElement("h3");
    h.textContent = pageTitle(p);
    wrap.appendChild(h);
    const div = document.createElement("div");
    div.className = "page-text";
    div.textContent = p.text;
    wrap.appendChild(div);
    readerEl.appendChild(wrap);
  });
}

/* ── file intake ── */

const drop = $("drop"), fileInput = $("file");
["dragover", "dragenter"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => {
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    log("Picked: " + e.dataTransfer.files[0].name);
  }
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) log("Picked: " + fileInput.files[0].name);
});

/* ── file intake: every supported type funnels to {pages:[{n,text}]} ── */

const INGESTORS = {
  image: extractImage,
  docx: extractDocx,
  pptx: extractPptx,
  text: extractTextFile,
  epub: extractEpub,
  audio: transcribeAudio,
};

/** Ingest one non-zip file → {pages, label}. Shared by picker, drop, zip, folder. */
async function ingestSingleFile(file, prog) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    log("Extracting text from PDF: " + file.name);
    const r = await extractPdfText(file,
      (i, n) => log("…page " + i + "/" + n));
    const chars = r.pages.reduce(
      (a, p) => a + (p.text ? p.text.length : 0), 0);
    if (r.numPages > 0 && chars < 200) {
      // Scanned PDF: no text layer. Read the pages as images automatically.
      log("No readable text found — this looks like a scanned PDF. " +
        "Reading pages as images instead (slower, automatic)…");
      return ocrScannedPdf(file, r.numPages,
        (d, t, label) => log("…" + label + " (" + d + "/" + t + ")"));
    }
    return { pages: r.pages,
             label: file.name + " — PDF (" + r.numPages + " pages)" };
  }
  const kind = supportedDocExt(name) || supportedMediaExt(name);
  if (!kind || !INGESTORS[kind]) {
    throw new Error("Unsupported file type: " + file.name +
      " — see the supported list above.");
  }
  if (kind === "audio") {
    log("Transcribing audio — first run downloads a ~75MB model " +
        "(one-time, stays on this device).");
  }
  if (kind === "image") {
    log("Running OCR — printed text works best; handwriting is best-effort.");
  }
  return INGESTORS[kind](file, prog);
}

const ZIP_ENTRY_CAP = 200; // sanity cap: a study-materials zip is never bigger

/** Ingest a .zip: every supported file inside becomes pages, labeled zip/inner. */
async function ingestZip(file, prog) {
  let zip;
  try {
    zip = await (await loadJsZip()).loadAsync(file);
  } catch (e) {
    throw new Error("That zip file couldn't be opened — it may be corrupted.");
  }
  const entries = Object.keys(zip.files)
    .filter((p) => { const f = zip.files[p]; return f && !f.dir; })
    .sort();
  if (!entries.length) throw new Error("That zip is empty — nothing to read.");
  if (entries.length > ZIP_ENTRY_CAP) {
    throw new Error("That zip has " + entries.length + " files (max " +
      ZIP_ENTRY_CAP + ") — split it up and try again.");
  }
  const pages = [];
  let skipped = 0, n = 0;
  for (const path of entries) {
    const base = path.split("/").pop();
    const lname = (base || "").toLowerCase();
    const kind = supportedDocExt(lname);
    const usable = base && (lname.endsWith(".pdf") ||
      (kind && INGESTORS[kind] && kind !== "audio"));
    if (!usable) { skipped++; continue; } // audio, nested zips, unsupported: skip
    prog(n + 1, entries.length, "Reading " + base + "…");
    const blob = await zip.file(path).async("blob");
    const inner = new File([blob], base, { type: blob.type || "" });
    const r = await ingestSingleFile(inner, prog);
    for (const p of r.pages) {
      pages.push({ n: ++n, text: p.text, src: file.name + "/" + path });
    }
  }
  if (!pages.length) {
    throw new Error("No readable files found in that zip" +
      (skipped ? " (skipped " + skipped + ")" : "") + ".");
  }
  if (skipped) log("Skipped " + skipped + " file(s) in the zip (unsupported type).");
  return { pages, label: file.name + " — zip (" + pages.length + " sections)" };
}

/** Shared pipeline: files in → sanitized pages → reader pane. */
async function processFiles(files, srcOf) {
  const btn = $("extract");
  btn.disabled = true;
  logEl.textContent = "Starting…";
  try {
    const hasAudio = files.some(
      (f) => supportedMediaExt(f.name.toLowerCase()) === "audio");
    if (hasAudio && files.length > 1) {
      throw new Error(
        "Transcribe one audio file at a time — it needs the device's full attention.");
    }
    const prog = (done, total, label) =>
      log("…" + label + " (" + done + "/" + total + ")");
    const allPages = [];
    const labels = [];
    for (const file of files) {
      const name = file.name.toLowerCase();
      const srcLabel = srcOf ? srcOf(file) : file.name;
      let out;
      if (name.endsWith(".zip")) {
        log("Opening zip archive: " + file.name);
        out = await ingestZip(file, prog);
      } else {
        out = await ingestSingleFile(file, prog);
      }
      out.pages.forEach((p) => allPages.push({
        n: p.n,
        text: sanitizeExtractedText(p.text),
        src: p.src || (files.length > 1 ? srcLabel : undefined),
      }));
      labels.push(out.label);
    }
    const total = allPages.reduce((a, p) => a + p.text.length, 0);
    if (total < 200) {
      throw new Error(
        "Only " + total + " characters of text found. " +
        "Scanned-image PDF? Try it as an image file (OCR) instead. " +
        "Audio with no clear speech? Try a clearer recording.");
    }
    renderReader(allPages);
    $("step-read").hidden = false;
    log("Done: " + labels.join(" · ") + " — " + total.toLocaleString() +
        " characters. Select any text to make a flashcard.");
    $("step-read").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    log("❌ " + (err && err.message ? err.message : err));
  } finally {
    btn.disabled = false;
    btn.textContent = "Process files";
  }
}

$("extract").addEventListener("click", async () => {
  const files = Array.from(fileInput.files);
  if (!files.length) { log("Choose a file first."); return; }
  processFiles(files, null);
});

/* ── folder upload (webkitdirectory): a whole folder of readings at once ── */

$("folder").addEventListener("click", () => $("folder-input").click());
$("folder-input").addEventListener("change", () => {
  const files = Array.from($("folder-input").files);
  if (!files.length) return;
  log("Picked folder: " + files.length + " file(s).");
  processFiles(files, (f) => f.webkitRelativePath || f.name);
});

/* ── paste text directly (no file needed) ── */

function ingestPastedText(text) {
  const t = sanitizeExtractedText(text || "");
  if (t.length < 10) { log("Pasted text is too short — copy more material first."); return; }
  renderReader([{ n: 1, text: t }]);
  $("step-read").hidden = false;
  log("Pasted " + t.length.toLocaleString() +
      " characters. Select any text to make a flashcard.");
  $("step-read").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("paste").addEventListener("click", async () => {
  const btn = $("paste");
  btn.disabled = true;
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      throw new Error("clipboard API unavailable");
    }
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      log("Clipboard is empty \u2014 copy some text first, then tap Paste text.");
      return;
    }
    ingestPastedText(text);
  } catch (err) {
    // iOS Safari and other permission denials: fall back to manual paste.
    $("paste-fallback").hidden = false;
    log("Clipboard read was blocked \u2014 paste manually in the box below.");
    $("paste-text").focus();
  } finally {
    btn.disabled = false;
  }
});

$("paste-use").addEventListener("click", () => {
  ingestPastedText($("paste-text").value);
  $("paste-text").value = "";
});

/* ── auto-draft: text → term/definition candidate cards ──
 * Heuristic, conservative by design: only high-confidence patterns
 * become drafts, and nothing is saved until the user approves each
 * one in the review list. All client-side, zero network. */

/* AUTO-DRAFT PURE BEGIN */
const AUTODRAFT_CAP = 100;
const AUTODRAFT_STOP = new Set(("this that these those it its they them their " +
  "he she we you i the a an one some such what which who how why when where " +
  "there here something anything nothing everything someone anyone " +
  "even if while although though because since unless whether whereas " +
  "true false " +
  "chapter page figure table section lesson module unit slide term definition " +
  "note example ex tip warning key answer question summary overview objective " +
  "conclusion result results introduction").split(" "));
// Verb-ish words: a "term" containing one is a clause, not a term
// ("Hermann Ebbinghaus documented the forgetting curve" is a sentence).
const AUTODRAFT_VERBS = new Set(
  ("was were is are be been being has have had will would could should did does do can may might must shall " +
   "documented described proposed introduced discovered identified named called " +
   "describe control controls regulate regulates " +
   "found shown reported demonstrated observed concluded suggested stated claimed argued noted believed " +
   "illustrates illustrate " +
   "happens occurs means involves contains holds lasts plays encodes stores transfers replays remains " +
   "survives persists describes").split(" "));
// Personal pronouns: a "term" containing one is a clause, not a term
// ("Biological Psychology If you" is not a flashcard term).
const AUTODRAFT_PRONOUNS = new Set(
  "i me my mine we us our ours you your yours he him his she her hers it its they them their theirs".split(" "));

function autodraftSentences(text) {
  const out = [];
  const t0 = String(text == null ? "" : text).replace(/\s+/g, " ");
  // Keep multi-initial abbreviations (H.M., U.S.A.) from splitting sentences:
  // their dots hide behind an ASCII placeholder until after the split.
  const PH = "ABBRDOT";
  const t = t0
    .replace(/([A-Z])\. ([A-Z]\.)/g, "$1.$2")
    .replace(/\b((?:[A-Z]\.){2,})/g, (m) => m.split(".").join(PH));
  const re = /[^.!?]+[.!?]+/g;
  let m;
  while ((m = re.exec(t)) !== null && out.length < 4000) out.push(m[0].trim().split(PH).join("."));
  return out;
}

function autodraftCleanTerm(t) {
  return String(t == null ? "" : t)
    .replace(/\s+/g, " ").trim()
    .replace(/^[("“‘'[]+/, "")
    .replace(/[)"”’'.,;:!?-]+$/, "");
}

// Shared term cleanup: strip articles, leading ordinals ("Third,"), trailing
// filler adverbs ("often"), "such as" asides, and parenthetical qualifiers
// ("Iconic memory (visual)" -> "Iconic memory").
function autodraftBaseTerm(t) {
  const noParen = String(t == null ? "" : t).replace(/\s*\([^)]*\)/g, "");
  return autodraftCleanTerm(noParen)
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s*,\s+/i, "")
    .replace(/\s+(often|usually|typically|generally|normally|always|never|also|even|just|still)$/i, "")
    .replace(/,\s*such as\s+[^,]+,/i, "")
    .replace(/,\s*such as\s+[^,]+$/i, "")
    .replace(/\s+/g, " ").trim();
}

function autodraftTermOk(term) {
  if (!term) return false;
  if (term.length > 70) return false;
  if (/[:;]/.test(term)) return false;   // glossary/heading artifact, not a term
  const words = term.split(/\s+/);
  if (words.length > 8) return false;
  if (/[.!?]/.test(term)) return false;          // sentence fragment, not a term
  if (/^\d+$/.test(term.replace(/\s/g, ""))) return false; // bare number
  const toks = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));
  if (toks.some((w) => AUTODRAFT_VERBS.has(w))) return false;
  if (toks.some((w) => AUTODRAFT_PRONOUNS.has(w))) return false; // clause, not a term
  // First word: hyphenated compounds ("short-term") count as one token so the
  // "term" stopword (meant for "Key term:" header debris) doesn't kill them.
  // Otherwise split on non-letters ("TRUE/FALSE" checks as true+false).
  const firstWord = words[0].toLowerCase();
  const firstToks = firstWord.indexOf("-") >= 0
    ? [firstWord.replace(/[^a-z]/g, "")]
    : firstWord.split(/[^a-z]+/).filter(Boolean);
  if (firstToks.some((t) => AUTODRAFT_STOP.has(t))) return false;
  return true;
}

function autodraftDefOk(def) {
  const d = String(def == null ? "" : def).replace(/\s+/g, " ").trim();
  if (d.length < 15 || d.length > 500) return false;
  // Quiz/answer-key debris, not study content.
  if (/^(feedback|correct answers?|incorrect|true|false)\b/i.test(d)) return false;
  return true;
}

/**
 * sanitizeExtractedText — drop debris that extractors can leave behind
 * (web content pasted or saved as .txt, HTML fragments inside docs):
 * <style>/<script> blocks, HTML comments, CSS-rule lines, and ALL-CAPS
 * header/disclaimer lines (fixture banners, "CHAPTER 7" headings).
 * Conservative: only lines that look like debris are removed; ordinary
 * prose — even with braces — stays.
 */
function sanitizeExtractedText(text) {
  let t = String(text == null ? "" : text);
  t = t.replace(/<style[\s\S]*?<\/style\s*>/gi, " ");
  t = t.replace(/<script[\s\S]*?<\/script\s*>/gi, " ");
  t = t.replace(/<!--[\s\S]*?-->/g, " ");
  const cssDebris = (line) => {
    const l = line.trim();
    if (!l || !/[{}]/.test(l)) return false;
    if (l.includes(";")) return true;                 // declarations & rule tails
    if (/^\s*\}\s*$/.test(l)) return true;            // lone closing brace
    if (/[a-z0-9)\]"']\s*\{/.test(l)) return true;    // selector before "{"
    return false;
  };
  // No lowercase letters at all: "DISCLAIMER: THIS IS A SYNTHETIC FIXTURE",
  // "CHAPTER 7: HOW MEMORY WORKS". Real prose always has lowercase.
  const capsDebris = (line) => {
    const l = line.trim();
    return l.length >= 8 && /[A-Z]/.test(l) && !/[a-z]/.test(l);
  };
  t = t.split("\n").filter((line) => !cssDebris(line) && !capsDebris(line)).join("\n");
  return t.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

/* Extract candidate {term, simple, src} pairs from reader pages.
 * pages: [{n, text, src?}] — same shape renderReader takes. */
function extractDrafts(pages) {
  const drafts = [];
  const seen = new Set();
  const srcOf = (p) => {
    const base = typeof p.n === "number" ? "Page " + p.n : String(p.n);
    return p.src ? p.src + " · " + base : base;
  };
  // "Working memory, proposed by Baddeley" -> term "Working memory"; the
  // attribution is folded into the definition so the fact isn't lost.
  const splitAttribution = (term) => {
    const m = /^(.*?),\s*(proposed|introduced|described|developed|created|founded|discovered|named)\s+by\s+([^,;]+?)\s*,?\s*$/i.exec(term);
    if (!m) return { term, note: "" };
    return { term: m[1].trim(), note: " (" + m[2].toLowerCase() + " by " + m[3].trim() + ")" };
  };
  // Returns true when a card was kept, so a rejected match falls through to
  // the next pattern instead of silently dropping the sentence.
  const push = (term, def, p) => {
    const attr = splitAttribution(autodraftBaseTerm(term));
    const t = attr.term;
    let simple = (String(def == null ? "" : def).replace(/\s+/g, " ").trim() + attr.note).trim();
    if (!/[.!?]$/.test(simple)) simple += ".";
    if (!autodraftTermOk(t) || !autodraftDefOk(simple)) return false;
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    drafts.push({ term: t, simple: simple, src: srcOf(p) });
    return true;
  };
  // Factual linking verbs for the generic branch (multi-word verbs included).
  const FACT_VERBS = "holds|contains|controls?|regulates?|lasts|involves|encodes|stores|transfers|replays|blocks|impairs|improves|" +
    "means|shows|demonstrates|describes|plays|survives|persists|remains|outperforms?|has|have|" +
    "depends\\s+on|relies\\s+on|results\\s+in|leads\\s+to|consists\\s+of|is\\s+caused\\s+by|results\\s+from";
  const STUDY_VERBS = "found|reported|showed|demonstrated|discovered|observed|concluded";
  const CLAIM_VERBS = "states|suggests|proposes|claims|argues|demonstrates|shows";
  const isCapsDebris = (u) => /[A-Z]/.test(u) && !/[a-z]/.test(u);
  // Optional leading "In|During <...>, " clause ("In a 1975 study, X found
  // that ...", "During slow-wave sleep, the hippocampus replays ...").
  const leaderOf = (s) => {
    const lm = /^(in|during)\s+([^,]{2,60}?)\s*,\s*/i.exec(s);
    return lm ? { text: lm[2].trim(), rest: s.slice(lm[0].length) } : { text: "", rest: s };
  };
  const factBranch = (r, L, p) => {
    let m;
    if ((m = new RegExp("^(.{2,60}?)\\s+(" + STUDY_VERBS + ")\\s+that\\s+(.{15,})$", "i").exec(r))) {
      const yr = (/\b((?:19|20)\d{2})\b/.exec(L.text) || [])[1];
      return push(m[1], m[2].toLowerCase() + " that " + m[3] + (yr ? " [" + yr + " study]" : ""), p);
    }
    if ((m = /^(.{2,60}?)\s+([a-z]+ed)\s+(.{10,})$/.exec(r))) {
      const nyr = (/\b((?:19|20)\d{2})\b/.exec(L.text) || [])[1];
      if (nyr || /\bstud(y|ies)\b/i.test(L.text)) {
        return push(m[1], m[2].toLowerCase() + " " + m[3] + (nyr ? " [" + nyr + "]" : ""), p);
      }
    }
    if ((m = new RegExp("^(.{2,60}?)\\s+(" + CLAIM_VERBS + ")\\s+that\\s+(.{15,})$", "i").exec(r))) {
      return push(m[1], m[2].toLowerCase() + " that " + m[3], p);
    }
    if ((m = /^(.{2,60}?)\s+(happens|occurs)\s+when\s+(.{15,})$/i.exec(r))) {
      return push(m[1], m[2].toLowerCase() + " when " + m[3], p);
    }
    if ((m = /^(.{2,60}?)\s+(occurs|takes place)\s+during\s+(.{15,})$/i.exec(r))) {
      return push(m[1], m[2].toLowerCase() + " during " + m[3], p);
    }
    if ((m = new RegExp("^(.{2,60}?)\\s+(" + FACT_VERBS + ")\\s+(.{15,})$", "i").exec(r))) {
      const lead = L.text.length >= 8 ? L.text + ", " : "";
      return push(m[1], lead + m[2].toLowerCase().replace(/\s+/g, " ") + " " + m[3], p);
    }
    return false;
  };
  for (const p of pages || []) {
    const text = String((p && p.text) || "").trim();
    if (!text) continue;
    // Multi-fact sentences are split into clauses so each fact becomes its
    // own card ("Sensory memory holds …; iconic memory lasts …, while
    // echoic memory lasts …").
    const units = [];
    for (const block of text.split(/\n\s*\n/)) {
      for (const s of autodraftSentences(block)) {
        if (s.length > 400 || isCapsDebris(s)) continue;
        for (const f of s.split(/\s*;\s*/)) {
          for (const u of f.split(/\s*,\s*while\s+/)) {
            const t = u.trim();
            if (t) units.push(t);
          }
        }
      }
    }
    // 1) glossary units: "Term: definition" / "Term — definition".
    // Sentence-level FIRST: definitions wrapped across line breaks stay
    // whole (line-only matching clipped them at the break, producing
    // half-meaning cards). Line-level second as a fallback; the seen-set
    // dedup keeps the first (fullest) match per term.
    const colonRe = /^([^:\n]{2,70}?)\s*[:\u2013\u2014-]\s+(.{15,})$/u;
    for (const u of units) {
      const m = colonRe.exec(u);
      if (m) push(m[1], m[2], p);
    }
    // Pasted text often arrives as one long line, so long lines are also
    // tried sentence-by-sentence (the whole-line match would swallow
    // unrelated sentences into one bloated definition).
    for (const raw of text.split(/\n/)) {
      const l = raw.trim();
      if (!l || isCapsDebris(l)) continue;
      const targets = l.length > 260
        ? autodraftSentences(l).filter((s) => s.length <= 260)
        : [l];
      for (const u of targets) {
        const m = colonRe.exec(u);
        if (m) push(m[1], m[2], p);
      }
    }
    // 2) definition sentences. The linking verb is restored so definitions
    // read as sentences.
    const docRe = /^(.{2,60}?)\s+(documented|described|introduced|proposed|discovered|identified)\s+(?:the\s+)?(.{2,60}?)\s*:\s*(.{15,})$/i;
    const defAsRe = /^(.{2,70}?)\s+is defined as\s+(.{15,})$/i;
    const defAsPlRe = /^(.{2,70}?)\s+are defined as\s+(.{15,})$/i;
    const refersRe = /^(.{2,70}?)\s+refers to\s+(.{15,})$/i;
    const enumRe = /^(.{2,60}?)\s+is\s+(a|an)\s+([^:;]{10,120}?)\s+with\s+(two|three|four|five|six|seven|eight|\d+)\s+parts?\s*:\s*(.{20,})$/i;
    const isARe = /^(.{2,70}?)\s+is (a|an)\s+(.{15,})$/i;
    const areRe = /^(.{2,70}?)\s+are\s+(.{15,})$/i;
    const isTheRe = /^(.{2,70}?)\s+is\s+(the|a|an|our|their|his|her|its)\s+(.{15,})$/i;
    const knownAsRe = /^(.{2,60}?)\s+(is|are)\s+(known as|called)\s+(.{15,})$/i;
    for (const s of units) {
      let m; let done = false;
      // "X documented the Y: Z" — the discovery becomes the card, not the clause.
      if (!done && (m = docRe.exec(s))) {
        let who = m[1].trim();
        const yl = /^in\s+(\d{4})\s*,\s*(.+)$/i.exec(who);
        const yrNote = yl ? " [" + yl[1] + "]" : "";
        if (yl) who = yl[2];
        done = push(m[3], m[2].toLowerCase() + " by " + who + ": " + m[4] + yrNote, p);
      }
      if (!done && (m = defAsRe.exec(s))) done = push(m[1], "is defined as " + m[2], p);
      if (!done && (m = defAsPlRe.exec(s))) done = push(m[1], "are defined as " + m[2], p);
      if (!done && (m = refersRe.exec(s))) done = push(m[1], "refers to " + m[2], p);
      // "X is a Y with N parts: a, b, c" — main card plus one card per part.
      if (!done && (m = enumRe.exec(s))) {
        done = push(m[1], "is " + m[2] + " " + m[3] + " with " + m[4] + " parts: " + m[5], p);
        const base = autodraftBaseTerm(m[1]);
        const am = /^(.*?),\s*(proposed|introduced|described|developed|created|founded|discovered|named)\s+by\s+[^,;]+,?\s*$/i.exec(base);
        const mainTerm = am ? am[1].trim() : base;
        const raw = m[5];
        const items = (raw.includes(",") ? raw.split(/\s*;\s*|,\s*(?:and\s+)?/) : raw.split(/\s*;\s*|\s+and\s+/))
          .map((x) => x.trim()).filter((x) => x && x.length <= 90);
        if (items.length >= 2) {
          for (const it of items) {
            const im = /^(.*?)\s+(with|for|that|which|who|where|when)\s+(.+)$/i.exec(it);
            const iname = (im ? im[1] : it).replace(/^(the|a|an|and)\s+/i, "").trim();
            const idesc = im ? im[3].replace(/[.!?]+$/, "") : "";
            push(iname, im ? im[2].toLowerCase() + " " + idesc + " (part of " + mainTerm + ")" : "part of " + mainTerm, p);
          }
        }
      }
      // "X describe(s)/divide(s) N categories: A, and B." - same main+sub-card treatment.
      if (!done) {
        const me = /^(.{2,70}?)\s+(?:describe|describes|divide|divides|fall\s+into|group\s+into)\s+(two|three|four|five|six|seven|eight|\d+)\s+(?:broad\s+)?(parts|categories|stages|types|phases|steps|divisions)\s*:\s*(.{15,})$/i.exec(s);
        if (me) {
          const mainTerm2 = autodraftBaseTerm(me[1]);
          const raw2 = me[4];
          const items2 = (raw2.includes(",") ? raw2.split(/\s*;\s*|,\s*(?:and\s+)?/) : raw2.split(/\s*;\s*|\s+and\s+/))
            .map((x) => x.trim()).filter((x) => x && x.length <= 90);
          if (items2.length >= 2 && mainTerm2) {
            done = push(mainTerm2, "has " + me[2] + " " + me[3] + ": " + me[4].trim(), p);
            for (const it of items2) {
              const im2 = /^(.*?)\s+(with|for|that|which|who|where|when)\s+(.+)$/i.exec(it);
              const iname2 = (im2 ? im2[1] : it).replace(/^(the|a|an|and)\s+/i, "").trim();
              const idesc2 = im2 ? im2[3].replace(/[.!?]+$/, "") : "";
              push(iname2, im2 ? im2[2].toLowerCase() + " " + idesc2 + " (part of " + mainTerm2 + ")" : "part of " + mainTerm2, p);
            }
          }
        }
      }
      if (!done && (m = isARe.exec(s))) done = push(m[1], "is " + m[2] + " " + m[3], p);
      if (!done && (m = areRe.exec(s))) done = push(m[1], "are " + m[2], p);
      // "X is the <anything>" — the noun is kept so the back stays grammatical
      // ("retrieval" / "is the process of getting information out of storage").
      if (!done && (m = isTheRe.exec(s))) done = push(m[1], "is " + m[2] + " " + m[3], p);
      if (!done && (m = knownAsRe.exec(s))) done = push(m[1], m[2].toLowerCase() + " " + m[3] + " " + m[4], p);
      if (!done) {
        const L = leaderOf(s);
        done = factBranch(L.rest, L, p);
      }
    }
    if (drafts.length >= AUTODRAFT_CAP) break;
  }
  return drafts.slice(0, AUTODRAFT_CAP);
}
/* AUTO-DRAFT PURE END */


/* ── auto-draft: review UI ──
 * The studio finds term–definition pairs in the extracted text and
 * shows them here for review. Nothing touches the deck until the
 * user approves: keep (checkbox) + "Add kept to My Cards", edit
 * (opens the normal card editor), or delete. */

let currentDrafts = [];

$("autodraft").addEventListener("click", async () => {
  if (!lastPages.length) {
    log("No text to draft from — process a file or paste text first.");
    return;
  }
  const btn = $("autodraft");
  btn.disabled = true;
  try {
    const existingTerms = new Set(
      (await getAllCards()).map((c) => String(c.term || "").toLowerCase()));
    const drafts = extractDrafts(lastPages)
      .filter((d) => !existingTerms.has(d.term.toLowerCase()));
    if (!drafts.length) {
      log("Auto-draft found no new term–definition pairs in this text. " +
          "Highlight text manually for trickier material.");
      return;
    }
    currentDrafts = drafts;
    renderDrafts();
    $("step-drafts").hidden = false;
    $("step-drafts").scrollIntoView({ behavior: "smooth", block: "start" });
    log("Drafted " + drafts.length + " card(s) for review — nothing saved yet. " +
        "Keep the good ones, edit or delete the rest.");
  } finally {
    btn.disabled = false;
  }
});

function draftPreset(d) {
  return {
    term: d.term,
    type: "book-term",
    category: d.src || "General",
    cue: "Define: " + d.term,
    simple: d.simple,
    examples: [(d.src ? d.src + ": " : "") + d.simple.slice(0, 180)],
    apply: "Explain " + d.term + " in your own words, with one real example.",
    compare: "",
  };
}

function removeDraft(d) {
  const i = currentDrafts.indexOf(d);
  if (i >= 0) currentDrafts.splice(i, 1);
  if (!currentDrafts.length) $("step-drafts").hidden = true;
  else renderDrafts();
}

function renderDrafts() {
  const dl = $("draft-list");
  $("draft-count").textContent =
    currentDrafts.length + " draft" + (currentDrafts.length === 1 ? "" : "s");
  dl.innerHTML = "";
  currentDrafts.forEach((d) => {
    const div = document.createElement("div");
    div.className = "cardrow";
    div._draft = d;
    const label = document.createElement("label");
    label.style.cssText =
      "display:flex;gap:8px;align-items:flex-start;flex:1;cursor:pointer";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.style.marginTop = "4px";
    cb.setAttribute("aria-label", "Keep draft: " + d.term);
    const span = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = d.term;
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = d.simple.length > 140
      ? d.simple.slice(0, 140) + "…" : d.simple;
    span.appendChild(strong);
    span.appendChild(document.createElement("br"));
    span.appendChild(hint);
    label.appendChild(cb);
    label.appendChild(span);
    div.appendChild(label);
    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      openEditor(draftPreset(d));
      removeDraft(d); // it now lives in the editor, not the draft list
    });
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "danger";
    del.addEventListener("click", () => removeDraft(d));
    div.appendChild(edit);
    div.appendChild(del);
    dl.appendChild(div);
  });
}

$("draft-keep").addEventListener("click", async () => {
  const dl = $("draft-list");
  const counters = await getCounters();
  const seen = new Set();
  (await getAllCards()).forEach((c) => seen.add(c.id));
  let added = 0, skipped = 0;
  for (const row of Array.from(dl.children)) {
    const cb = row.querySelector('input[type="checkbox"]');
    if (!cb || !cb.checked || !row._draft) continue;
    const card = buildCard(draftPreset(row._draft), counters);
    const problems = validateCard(card, seen);
    if (problems.length) { skipped++; continue; }
    seen.add(card.id);
    await putCard(card);
    added++;
  }
  await saveCounters(counters);
  currentDrafts = [];
  dl.innerHTML = "";
  $("step-drafts").hidden = true;
  await renderList();
  log("Added " + added + " drafted card(s) to My Cards" +
      (skipped ? " (" + skipped + " skipped by validation)" : "") + ".");
});

$("draft-clear").addEventListener("click", () => {
  currentDrafts = [];
  $("draft-list").innerHTML = "";
  $("step-drafts").hidden = true;
  log("Drafts discarded — nothing was saved.");
});

/* ── select text -> offer "Make flashcard" ── */

function hideOffer() { offerBtn.hidden = true; }

function maybeOffer() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideOffer(); return; }
  const range = sel.getRangeAt(0);
  if (!readerEl.contains(range.commonAncestorContainer)) { hideOffer(); return; }
  const text = sel.toString().trim().replace(/\s+/g, " ");
  if (text.length < 3 || text.length > 400) { hideOffer(); return; }
  const rect = range.getBoundingClientRect();
  offerBtn.style.top = Math.max(8, window.scrollY + rect.bottom + 8) + "px";
  offerBtn.style.left = Math.max(8, Math.min(window.innerWidth - 170,
    window.scrollX + rect.left)) + "px";
  offerBtn.hidden = false;
  offerBtn.onclick = () => { hideOffer(); openEditor({ term: text }); };
}
readerEl.addEventListener("mouseup", () => setTimeout(maybeOffer, 10));
readerEl.addEventListener("keyup", () => setTimeout(maybeOffer, 10));
document.addEventListener("mousedown", (e) => {
  if (e.target !== offerBtn) hideOffer();
});

/* ── card editor ── */

const dialog = $("editor");
const F = (id) => dialog.querySelector("#f-" + id);
let editingId = null;

function openEditor(preset) {
  preset = preset || {};
  editingId = preset.id || null;
  dialog.querySelector("#editor-title").textContent =
    editingId ? "Edit flashcard" : "New flashcard";
  F("term").value = preset.term || "";
  F("type").value = preset.type || "book-term";
  F("category").value = preset.category || "";
  F("cue").value = preset.cue || "";
  F("simple").value = preset.simple || "";
  F("examples").value = (preset.examples || []).join("\n");
  F("apply").value = preset.apply || "";
  F("compare").value = preset.compare || "";
  $("editor-errors").textContent = "";
  refreshCategoryDatalist();
  dialog.showModal();
  F("term").focus();
}

async function refreshCategoryDatalist() {
  const cards = await getAllCards();
  const dl = $("category-list");
  dl.innerHTML = "";
  [...new Set(cards.map((c) => c.category))].sort().forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    dl.appendChild(o);
  });
}

dialog.querySelector("#editor-save").addEventListener("click", async (e) => {
  e.preventDefault();
  const counters = await getCounters();
  const card = buildCard({
    id: editingId || undefined,
    term: F("term").value,
    type: F("type").value,
    category: F("category").value,
    cue: F("cue").value,
    simple: F("simple").value,
    examplesText: F("examples").value,
    apply: F("apply").value,
    compare: F("compare").value,
  }, counters);
  // Re-validate without the duplicate-id trip on self-edit.
  const seen = new Set();
  (await getAllCards()).forEach((c) => { if (c.id !== editingId) seen.add(c.id); });
  const problems = validateCard(card, seen);
  if (problems.length) {
    $("editor-errors").textContent = "⚠ " + problems.join(" · ");
    return;
  }
  await saveCounters(counters);
  await putCard(card);
  dialog.close();
  await renderList();
  log((editingId ? "Updated " : "Saved ") + card.id + " — “" + card.term + "”");
});

dialog.querySelector("#editor-cancel").addEventListener("click", () => dialog.close());

/* ── card list ── */

const TYPE_BADGE = { "book-term": "book", "lesson-concept": "lesson", "research-skill": "extra" };

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function renderList() {
  const cards = await getAllCards();
  countEl.textContent = cards.length
    ? cards.length + " card" + (cards.length === 1 ? "" : "s")
    : "no cards yet";
  listEl.innerHTML = "";
  for (const c of cards) {
    const div = document.createElement("div");
    div.className = "cardrow";
    div.innerHTML =
      '<span class="badge ' + TYPE_BADGE[c.type] + '">' + esc(c.type) + "</span>" +
      "<strong>" + esc(c.term) + "</strong>" +
      '<span class="cat">' + esc(c.category) + "</span>" +
      '<span class="spacer"></span>' +
      '<button data-act="edit">Edit</button>' +
      '<button data-act="del" class="danger">Delete</button>';
    div.querySelector('[data-act="edit"]').addEventListener("click", () =>
      openEditor(c));
    div.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (confirm("Delete “" + c.term + "”?")) {
        await deleteCard(c.id);
        await renderList();
      }
    });
    listEl.appendChild(div);
  }
  $("export").disabled = cards.length === 0;
}

/* ── export / import / clear ── */

$("export").addEventListener("click", async () => {
  const cards = await getAllCards();
  const doc = exportDoc(cards);
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  a.download = "trss-studio-cards-" + d + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  log("Exported " + cards.length + " card(s) as JSON (base-model schema).");
});

$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const { cards, problems } = parseImport(text);
    if (problems.length) {
      log("❌ Import rejected: " + problems.slice(0, 5).join(" · ") +
        (problems.length > 5 ? " · (+" + (problems.length - 5) + " more)" : ""));
      return;
    }
    const counters = await getCounters();
    let added = 0, skipped = 0;
    for (const c of cards) {
      const exists = await txDone(db.transaction("cards", "readonly").objectStore("cards").get(c.id));
      if (exists) { skipped++; continue; }
      // Advance counters past imported ids so future ids stay unique.
      const m = /^studio-(core|lesson|extra)-(\d+)$/.exec(c.id);
      if (m) counters[m[1]] = Math.max(counters[m[1]] || 0, parseInt(m[2], 10));
      await putCard(c);
      added++;
    }
    await saveCounters(counters);
    await renderList();
    log("Imported " + added + " card(s)" + (skipped ? ", skipped " + skipped + " duplicate(s)" : "") + ".");
  } catch (err) {
    log("❌ Import failed: " + (err && err.message ? err.message : err));
  } finally {
    $("import-file").value = "";
  }
});

$("clear").addEventListener("click", async () => {
  if (!confirm("Delete ALL cards in this studio? This cannot be undone.")) return;
  await clearCards();
  await saveCounters({ core: 0, lesson: 0, extra: 0 });
  await renderList();
  log("Cleared all cards.");
});

/* ── boot ── */

(async function init() {
  if (!("indexedDB" in window)) {
    log("❌ This browser has no IndexedDB — the studio needs it to save cards.");
    return;
  }
  db = await openDb();
  await renderList();
  log("Ready. Drop a file above to start — your file never leaves this device.");
})();
