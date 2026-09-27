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

$("extract").addEventListener("click", async () => {
  const files = Array.from(fileInput.files);
  if (!files.length) { log("Choose a file first."); return; }
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
      let out;
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
          out = await ocrScannedPdf(file, r.numPages,
            (d, t, label) => log("…" + label + " (" + d + "/" + t + ")"));
        } else {
          out = { pages: r.pages,
                  label: file.name + " — PDF (" + r.numPages + " pages)" };
        }
      } else {
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
        out = await INGESTORS[kind](file, prog);
      }
      out.pages.forEach((p) => allPages.push({
        n: p.n,
        text: p.text,
        src: files.length > 1 ? file.name : undefined,
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
});

/* ── paste text directly (no file needed) ── */

function ingestPastedText(text) {
  const t = (text || "").trim();
  if (t.length < 10) { log("Pasted text is too short \u2014 copy more material first."); return; }
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
const AUTODRAFT_CAP = 40;
const AUTODRAFT_STOP = new Set(("this that these those it its they them their " +
  "he she we you i the a an one some such what which who how why when where " +
  "there here something anything nothing everything someone anyone " +
  "chapter page figure table section lesson module unit slide term definition " +
  "note example ex tip warning key answer question summary overview objective").split(" "));

function autodraftSentences(text) {
  const out = [];
  const re = /[^.!?]+[.!?]+/g;
  const t = String(text == null ? "" : text).replace(/\s+/g, " ");
  let m;
  while ((m = re.exec(t)) !== null && out.length < 4000) out.push(m[0].trim());
  return out;
}

function autodraftCleanTerm(t) {
  return String(t == null ? "" : t)
    .replace(/\s+/g, " ").trim()
    .replace(/^[("\u201c\u2018'[]+/, "")
    .replace(/[)"\u201d\u2019'.,;:!?-]+$/, "");
}

function autodraftTermOk(term) {
  if (!term) return false;
  if (term.length > 70) return false;
  if (term.split(/\s+/).length > 8) return false;
  if (/[.!?]/.test(term)) return false;          // sentence fragment, not a term
  if (/^\d+$/.test(term.replace(/\s/g, ""))) return false; // bare number
  const first = term.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
  if (AUTODRAFT_STOP.has(first)) return false;   // "chapter 3", "this", ...
  return true;
}

function autodraftDefOk(def) {
  const d = String(def == null ? "" : def).replace(/\s+/g, " ").trim();
  return d.length >= 15 && d.length <= 500;
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
  const push = (term, def, p) => {
    term = autodraftCleanTerm(term).replace(/^(the|a|an)\s+/i, "");
    const simple = String(def == null ? "" : def).replace(/\s+/g, " ").trim();
    if (!autodraftTermOk(term) || !autodraftDefOk(simple)) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    drafts.push({ term: term, simple: simple, src: srcOf(p) });
  };
  for (const p of pages || []) {
    const text = String((p && p.text) || "").trim();
    if (!text) continue;
    // 1) glossary lines: "Term: definition" / "Term — definition"
    const lines = text.split(/\n/);
    for (const raw of lines) {
      const l = raw.trim();
      if (!l || l.length > 260) continue;
      let m = /^([^:\n]{2,70}?)\s*[:\u2013\u2014-]\s+(.{15,})$/u.exec(l);
      if (m) push(m[1], m[2], p);
    }
    // 2) definition sentences: "X is defined as Y", "X refers to Y", …
    const sents = autodraftSentences(text);
    for (const s of sents) {
      let m;
      if ((m = /^(.{2,70}?)\s+is defined as\s+(.{15,})$/i.exec(s))) push(m[1], m[2], p);
      else if ((m = /^(.{2,70}?)\s+are defined as\s+(.{15,})$/i.exec(s))) push(m[1], m[2], p);
      else if ((m = /^(.{2,70}?)\s+refers to\s+(.{15,})$/i.exec(s))) push(m[1], m[2], p);
      else if ((m = /^(.{2,70}?)\s+is (?:a|an)\s+(.{15,})$/i.exec(s))) push(m[1], m[2], p);
      else if ((m = /^(.{2,70}?)\s+are\s+(.{15,})$/i.exec(s))) push(m[1], m[2], p);
      else if ((m = /^(.{2,70}?)\s+is the (?:process|tendency|ability|system|study|branch|theory|principle|response|behavior|change|state|condition)\b\s*(?:by which|of|in which)?\s*(.{15,})$/i.exec(s))) push(m[1], m[2], p);
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
