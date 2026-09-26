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

function renderReader(pages) {
  readerEl.innerHTML = "";
  for (const p of pages) {
    const h = document.createElement("h3");
    h.textContent = "Page " + p.n;
    readerEl.appendChild(h);
    const div = document.createElement("div");
    div.className = "page-text";
    div.textContent = p.text;
    readerEl.appendChild(div);
  }
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

$("extract").addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) { log("Choose a PDF first."); return; }
  const btn = $("extract");
  btn.disabled = true;
  logEl.textContent = "Starting…";
  try {
    const name = file.name.toLowerCase();
    let pages, numPages;
    if (name.endsWith(".pdf")) {
      log("Extracting text from PDF…");
      const out = await extractPdfText(file, (i, n) => log("…page " + i + "/" + n));
      pages = out.pages; numPages = out.numPages;
    } else if (name.endsWith(".txt")) {
      const text = await file.text();
      pages = [{ n: 1, text: text.trim() }]; numPages = 1;
    } else {
      throw new Error("Unsupported file type — use a .pdf or .txt file.");
    }
    const total = pages.reduce((a, p) => a + p.text.length, 0);
    if (total < 200) {
      throw new Error(
        "Only " + total + " characters of text found — this looks like a scanned-image PDF. " +
        "Try a PDF with selectable text or a .txt file.");
    }
    renderReader(pages);
    $("step-read").hidden = false;
    log("Done: " + numPages + " page(s), " + total.toLocaleString() +
        " characters. Select any text to make a flashcard.");
    $("step-read").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    log("❌ " + (err && err.message ? err.message : err));
  } finally {
    btn.disabled = false;
    btn.textContent = "Extract text";
  }
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
  log("Ready. Drop a PDF above to start — your file never leaves this device.");
})();
