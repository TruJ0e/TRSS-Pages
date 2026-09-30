/**
 * studio-ingest-docs.mjs — TRSS upload-studio document ingestors (Track 1a).
 *
 * Client-side extractors that turn student files into the studio's canonical
 * shape: { pages: [{ n, text }], label }, ready for renderReader(pages).
 *
 * Intake beyond PDF/.txt: images (OCR), .docx, .pptx, .md/.markdown.
 * Zero-cost, client-side only — files never leave the device. Third-party
 * libraries are lazy-loaded from a pinned CDN on first use (never bundled).
 *
 * CDN pins (verified 2026-09-27 via https://data.jsdelivr.com/v1/packages/npm/):
 *   tesseract.js  5.1.1  ESM build      https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js
 *   mammoth       1.13.0 browser build  https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js
 *   jszip         3.10.2 UMD build      https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js
 *
 * Pure, DOM-free helpers (testable in node): supportedDocExt, stripMarkdown,
 * slideTextFromXml, paginateParagraphs.
 */

const TESSERACT_ESM_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
const MAMMOTH_BROWSER_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js';

/**
 * Shared JSZip loader (the .zip archive intake in studio.js uses this;
 * the .pptx path keeps its own call). Exposed so both stay on one pin.
 */
export function loadJsZip() {
  return loadScriptOnce(JSZIP_URL, 'JSZip', 'the zip reader');
}

/** Default progress sink: (done, total, label) => void */
const noopProgress = () => {};

// ---------------------------------------------------------------------------
// supportedDocExt
// ---------------------------------------------------------------------------

const EXT_KIND = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image',
  docx: 'docx',
  pptx: 'pptx',
  txt: 'text', md: 'text', markdown: 'text',
};

/**
 * Map a filename to its ingest kind.
 * @param {string} filename
 * @returns {'image'|'docx'|'pptx'|'text'|null}
 */
export function supportedDocExt(filename) {
  if (typeof filename !== 'string') return null;
  const clean = filename.split(/[?#]/)[0].trim();
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return null; // no ext, dotfile, or trailing dot
  const ext = clean.slice(dot + 1).toLowerCase();
  return EXT_KIND[ext] || null;
}

// ---------------------------------------------------------------------------
// Library loaders (lazy, cached, browser-only)
// ---------------------------------------------------------------------------

const scriptCache = new Map();

/** Load a UMD/global script once via <script> tag. Rejects with a friendly Error. */
function loadScriptOnce(src, globalName, friendlyName) {
  if (scriptCache.has(src)) return scriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error(`${friendlyName} needs a browser page to load.`));
      return;
    }
    const existing = document.querySelector(`script[data-ingest-lib="${src}"]`);
    if (existing) {
      if (globalName && typeof window !== 'undefined' && window[globalName]) {
        resolve(window[globalName]);
        return;
      }
      existing.addEventListener('load', () => resolve(window[globalName]));
      existing.addEventListener('error', () =>
        reject(new Error(`Couldn't download ${friendlyName} — check your connection and try again.`)));
      return;
    }
    const tag = document.createElement('script');
    tag.src = src;
    tag.async = true;
    tag.dataset.ingestLib = src;
    tag.onload = () => resolve(globalName ? window[globalName] : undefined);
    tag.onerror = () =>
      reject(new Error(`Couldn't download ${friendlyName} — check your connection and try again.`));
    document.head.appendChild(tag);
  });
  scriptCache.set(src, p);
  return p;
}

let tesseractModulePromise = null;

/**
 * Lazy-load the Tesseract.js ESM build (dynamic import, cached).
 * Note: the pinned ESM build exposes a single default export carrying the
 * whole namespace ({ createWorker, OEM, PSM, ... }), so we unpack from that.
 */
function loadTesseract() {
  if (!tesseractModulePromise) {
    tesseractModulePromise = import(/* @vite-ignore */ TESSERACT_ESM_URL)
      .then((mod) => mod && mod.default ? mod.default : mod)
      .catch(() => {
        tesseractModulePromise = null; // allow retry
        throw new Error(
          "The text-recognition engine couldn't load — check your connection and try again."
        );
      });
  }
  return tesseractModulePromise;
}

let ocrWorkerPromise = null;

/**
 * Get (creating on first use) a shared Tesseract worker. The worker, its WASM
 * core, and the English language data all come from the pinned jsDelivr URLs
 * (tesseract.js v5 defaults), so the first image needs a connection; later
 * images reuse the warm worker.
 */
async function getOcrWorker(logger) {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const Tesseract = await loadTesseract();
      const { createWorker, OEM } = Tesseract || {};
      if (typeof createWorker !== 'function') {
        throw new Error(
          "The text-recognition engine couldn't start — try reloading the page."
        );
      }
      const worker = await createWorker('eng', OEM ? OEM.LSTM_ONLY : 1, { logger });
      return worker;
    })().catch((e) => {
      ocrWorkerPromise = null; // allow retry
      throw e instanceof Error
        ? e
        : new Error("The text-recognition engine couldn't start — try again.");
    });
  }
  return ocrWorkerPromise;
}

// ---------------------------------------------------------------------------
// extractImage — OCR via Tesseract.js
// ---------------------------------------------------------------------------

/**
 * OCR an image file in-browser.
 * @param {File|Blob} file — must have .name and be a supported image
 * @param {(done:number,total:number,label:string)=>void} [onProgress]
 * @returns {Promise<{pages:[{n:number,text:string}], label:string}>}
 */
export async function extractImage(file, onProgress = noopProgress) {
  const name = (file && file.name) || 'image';
  try {
    onProgress(0, 100, 'Loading text-recognition engine…');
    const logger = (m) => {
      // Tesseract status ticks: 'loading tesseract core', 'initializing tesseract',
      // 'loading language traineddata', 'initializing api', 'recognizing text'
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress(20 + Math.round(m.progress * 75), 100, 'Reading text from image…');
      } else if (typeof m.status === 'string') {
        onProgress(10, 100, 'Preparing text-recognition engine…');
      }
    };
    const worker = await getOcrWorker(logger);
    onProgress(20, 100, 'Reading text from image…');
    const { data } = await worker.recognize(file);
    const text = (data && typeof data.text === 'string' ? data.text : '').trim();
    const confidence = typeof data?.confidence === 'number' ? data.confidence : 0;
    onProgress(100, 100, 'Done');
    if (!text) {
      throw new Error(
        "Couldn't find any text in that image — try a clearer photo with good lighting."
      );
    }
    const pct = Math.max(0, Math.min(100, Math.round(confidence)));
    let label = `${name} — OCR (avg confidence ${pct}%)`;
    // HONEST LABELING: Tesseract is strong on printed/typed text; handwriting
    // is best-effort. Low mean confidence is the signal we can measure.
    if (pct < 60) label += ' — low confidence, verify text before making cards';
    return { pages: [{ n: 1, text }], label };
  } catch (e) {
    if (e instanceof Error && /^(Couldn't|The text-recognition)/.test(e.message)) throw e;
    throw new Error("Couldn't read that image — it may be damaged or in an unsupported format.");
  }
}

// ---------------------------------------------------------------------------
// DOCX helpers (pure, DOM-free)
// ---------------------------------------------------------------------------

/** Decode the XML/HTML entities mammoth/pptx text can carry. */
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // &amp; last so &lt; etc. survive
}

/**
 * Convert mammoth's HTML output into paragraph objects, DOM-free.
 * Block-level elements (h1-h6, p, li, tr, blockquote, div) become paragraphs in
 * document order; headings are flagged so pagination can break before them.
 * @param {string} html
 * @returns {Array<{text:string, heading:boolean}>}
 */
function docxHtmlToParagraphs(html) {
  const paras = [];
  const re = /<(h[1-6]|p|li|tr|blockquote|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    let inner = m[2]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>\s*<t[dh]\b[^>]*>/gi, ' | ') // table cells on one line
      .replace(/<[^>]+>/g, '');
    inner = decodeEntities(inner).replace(/[ \t]+/g, ' ').trim();
    if (!inner) continue;
    paras.push({ text: inner, heading: tag[0] === 'h' });
  }
  return paras;
}

const PAGE_TARGET_PARAS = 40; // ~40 paragraphs per page
const PAGE_MIN_BEFORE_HEADING_BREAK = 25; // don't break for a heading on a nearly-empty page

/**
 * Paginate paragraphs, breaking preferentially at headings (a heading starts a
 * new page once the current page is reasonably full) and never stranding a
 * heading as the last paragraph of a page.
 * Accepts {text, heading} objects or plain strings (treated as non-headings).
 * @param {Array<{text:string,heading:boolean}|string>} paras
 * @param {number} [target=40]
 * @returns {Array<{n:number,text:string}>}
 */
export function paginateParagraphs(paras, target = PAGE_TARGET_PARAS) {
  const items = (paras || [])
    .map((p) => (typeof p === 'string' ? { text: p, heading: false } : p))
    .filter((p) => p && typeof p.text === 'string' && p.text.trim().length > 0)
    .map((p) => ({ text: p.text.trim(), heading: !!p.heading }));

  const pages = [];
  let cur = [];
  const pushPage = () => {
    if (cur.length) pages.push(cur);
    cur = [];
  };

  for (const p of items) {
    // Prefer a heading opening a fresh page once this one has real content.
    if (p.heading && cur.length >= PAGE_MIN_BEFORE_HEADING_BREAK) pushPage();
    // Hard cap: never exceed target paragraphs per page.
    if (cur.length >= target) pushPage();
    cur.push(p);
    // Don't strand a heading as the last paragraph of a full page.
    if (cur.length >= target && p.heading) {
      cur.pop();
      pushPage();
      cur.push(p);
    }
  }
  pushPage();

  return pages.map((pageParas, i) => ({
    n: i + 1,
    text: pageParas.map((p) => p.text).join('\n\n'),
  }));
}

// ---------------------------------------------------------------------------
// extractDocx — via mammoth.js browser build
// ---------------------------------------------------------------------------

/**
 * Extract text from a .docx file (mammoth.js, in-browser).
 * @param {File|Blob} file
 * @param {(done:number,total:number,label:string)=>void} [onProgress]
 * @returns {Promise<{pages:[{n:number,text:string}], label:string}>}
 */
export async function extractDocx(file, onProgress = noopProgress) {
  const name = (file && file.name) || 'document.docx';
  try {
    onProgress(0, 100, 'Loading Word reader…');
    const mammoth = await loadScriptOnce(MAMMOTH_BROWSER_URL, 'mammoth', 'the Word reader');
    if (!mammoth || typeof mammoth.convertToHtml !== 'function') {
      throw new Error('The Word reader failed to start — try reloading the page.');
    }
    onProgress(25, 100, 'Reading Word document…');
    const arrayBuffer = await file.arrayBuffer();
    // convertToHtml (not extractRawText) so headings survive for pagination.
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
    onProgress(70, 100, 'Organizing pages…');
    const paras = docxHtmlToParagraphs(html);
    if (!paras.length) {
      throw new Error(
        "Couldn't find any text in that Word file — it may contain only images or be empty."
      );
    }
    const pages = paginateParagraphs(paras);
    onProgress(100, 100, 'Done');
    return {
      pages,
      label: `${name} — Word document (${pages.length} page${pages.length === 1 ? '' : 's'})`,
    };
  } catch (e) {
    if (e instanceof Error && /^(Couldn't|The Word reader)/.test(e.message)) throw e;
    throw new Error(
      "Couldn't open that Word file — it may be corrupted, password-protected, or an old .doc format (only .docx works)."
    );
  }
}

// ---------------------------------------------------------------------------
// PPTX helpers (pure, DOM-free)
// ---------------------------------------------------------------------------

/** Matches exactly the slide part files inside a .pptx zip. */
const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

/**
 * Extract visible text from one slide's XML (ppt/slides/slideN.xml).
 * Collects <a:t> text nodes in document order, grouped by <a:p> paragraphs.
 * DOM-free.
 * @param {string} xmlString
 * @returns {string} paragraphs joined with newlines
 */
export function slideTextFromXml(xmlString) {
  if (typeof xmlString !== 'string' || !xmlString) return '';
  const paras = [];
  // Split on paragraph close tags to preserve paragraph breaks; runs (<a:t>)
  // inside a paragraph join without added spaces (spacing lives in the runs).
  const chunks = xmlString.split(/<\/a:p\s*>/i);
  const runRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t\s*>/gi;
  for (const chunk of chunks) {
    const runs = [];
    let m;
    runRe.lastIndex = 0;
    while ((m = runRe.exec(chunk)) !== null) runs.push(decodeEntities(m[1]));
    const para = runs.join('').replace(/\s+/g, ' ').trim();
    if (para) paras.push(para);
  }
  return paras.join('\n');
}

/**
 * Read slides from a .pptx ArrayBuffer using a JSZip-compatible loader.
 * Internal; takes the zip implementation so browser code passes the CDN
 * build and tests can pass the npm build.
 */
async function readPptxSlides(arrayBuffer, JSZipImpl, onProgress) {
  const zip = await JSZipImpl.loadAsync(arrayBuffer);
  const slideFiles = Object.keys(zip.files)
    .map((path) => {
      const m = SLIDE_PATH_RE.exec(path);
      return m ? { path, num: parseInt(m[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num); // numeric order: slide2 before slide10

  if (!slideFiles.length) {
    throw new Error(
      "Couldn't find any slides in that PowerPoint file — it may be corrupted."
    );
  }

  const pages = [];
  let i = 0;
  for (const { path, num } of slideFiles) {
    i += 1;
    onProgress(Math.round((i / slideFiles.length) * 80), 100, `Reading slide ${num}…`);
    const xml = await zip.file(path).async('string');
    const text = slideTextFromXml(xml);
    pages.push({ n: pages.length + 1, text: `Slide ${num}\n\n${text}`.trimEnd() });
  }
  return pages;
}

// ---------------------------------------------------------------------------
// extractPptx — via JSZip
// ---------------------------------------------------------------------------

/**
 * Extract text from a .pptx file (JSZip, in-browser). One page per slide.
 * Note: text order and layout are lost — bullets/columns come out as plain
 * paragraphs in XML document order; images and charts are skipped.
 * @param {File|Blob} file
 * @param {(done:number,total:number,label:string)=>void} [onProgress]
 * @returns {Promise<{pages:[{n:number,text:string}], label:string}>}
 */
export async function extractPptx(file, onProgress = noopProgress) {
  const name = (file && file.name) || 'slides.pptx';
  try {
    onProgress(0, 100, 'Loading PowerPoint reader…');
    const JSZip = await loadScriptOnce(JSZIP_URL, 'JSZip', 'the PowerPoint reader');
    if (!JSZip || typeof JSZip.loadAsync !== 'function') {
      throw new Error('The PowerPoint reader failed to start — try reloading the page.');
    }
    onProgress(15, 100, 'Opening PowerPoint file…');
    const arrayBuffer = await file.arrayBuffer();
    const pages = await readPptxSlides(arrayBuffer, JSZip, onProgress);
    onProgress(100, 100, 'Done');
    return {
      pages,
      label: `${name} — PowerPoint (${pages.length} slide${pages.length === 1 ? '' : 's'})`,
    };
  } catch (e) {
    if (e instanceof Error && /^(Couldn't|The PowerPoint reader)/.test(e.message)) throw e;
    throw new Error(
      "Couldn't open that PowerPoint file — it may be corrupted, password-protected, or an old .ppt format (only .pptx works)."
    );
  }
}

// ---------------------------------------------------------------------------
// Text helpers (pure, DOM-free)
// ---------------------------------------------------------------------------

/**
 * Strip Markdown formatting, keeping the readable text. DOM-free.
 * @param {string} text
 * @returns {string}
 */
export function stripMarkdown(text) {
  if (typeof text !== 'string') return '';
  let out = text;

  out = out.replace(/<!--[\s\S]*?-->/g, ''); // HTML comments
  // Fenced code blocks: drop the fence, keep the code.
  out = out.replace(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm, (_, code) => code);
  out = out.replace(/```/g, '');
  // ATX headings: "# Title" -> "Title"
  out = out.replace(/^#{1,6}\s+/gm, '');
  // Setext underlines / horizontal rules
  out = out.replace(/^[ \t]*([=*_-][ \t]*){3,}$/gm, '');
  // Blockquotes
  out = out.replace(/^[ \t]*>[ \t]?/gm, '');
  // Unordered list markers
  out = out.replace(/^([ \t]*)[*+-][ \t]+/gm, '$1');
  // Ordered list markers
  out = out.replace(/^([ \t]*)\d+[.)][ \t]+/gm, '$1');
  // Markdown tables: drop separator rows, turn pipes into spaces
  out = out
    .split('\n')
    .filter((line) => !/^\s*\|?[\s:|-]+\|?[\s:|-]*$/.test(line) || !line.includes('|'))
    .map((line) => (line.includes('|') ? line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').replace(/\|/g, '  ').trim() : line))
    .join('\n');
  // Images: ![alt](url) -> alt ; links: [text](url) -> text ; refs: [text][ref] -> text
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  out = out.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  // Bold/italic (paired markers)
  out = out.replace(/(\*\*|__)(.+?)\1/g, '$2');
  out = out.replace(/(^|[\s(>"'])(\*|_)(?=\S)(.+?)(?<=\S)\2/g, '$1$3');
  // Inline code
  out = out.replace(/`([^`]+)`/g, '$1');
  // Any leftover HTML tags
  out = out.replace(/<[^>]+>/g, '');
  // Decode common entities
  out = decodeEntities(out);
  // Tidy: collapse 3+ blank lines to 2, trim trailing whitespace per line
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return out;
}

// ---------------------------------------------------------------------------
// extractTextFile
// ---------------------------------------------------------------------------

/**
 * Extract text from .txt / .md / .markdown files. Markdown is stripped to
 * readable plain text; .txt passes through untouched.
 * @param {File|Blob & {name?:string}} file
 * @param {(done:number,total:number,label:string)=>void} [onProgress]
 * @returns {Promise<{pages:[{n:number,text:string}], label:string}>}
 */
export async function extractTextFile(file, onProgress = noopProgress) {
  const name = (file && file.name) || 'notes.txt';
  try {
    onProgress(10, 100, 'Reading text file…');
    const raw = await file.arrayBuffer().then(
      (buf) => new TextDecoder('utf-8', { fatal: false }).decode(buf)
    );
    const kind = supportedDocExt(name);
    const text = kind === 'text' && /\.(md|markdown)$/i.test(name) ? stripMarkdown(raw) : raw;
    onProgress(100, 100, 'Done');
    if (!text.trim()) throw new Error("That file looks empty — there's no text to study.");
    const isMd = /\.(md|markdown)$/i.test(name);
    return {
      pages: [{ n: 1, text: text.trim() }],
      label: `${name} — ${isMd ? 'Markdown' : 'plain text'}`,
    };
  } catch (e) {
    if (e instanceof Error && /^(That file|Couldn't)/.test(e.message)) throw e;
    throw new Error("Couldn't read that text file — it may use an unusual encoding.");
  }
}
