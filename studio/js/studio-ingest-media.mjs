/**
 * TRSS Upload Studio — media ingestors (Track 1b: audio + EPUB/books).
 *
 * Client-side only. No paid APIs, no servers — files never leave the device.
 *
 * Wiring: the studio's extract handler feeds whatever we return here into
 * renderReader(pages) as {pages: [{n, text}], label?}.
 *
 * CDN pins (verified 2026-09-27 via data.jsdelivr.com):
 *   jszip@3.10.2        https://cdn.jsdelivr.net/npm/jszip@3.10.2/+esm
 *   @xenova/transformers@2.17.2
 *       https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/src/transformers.js
 *
 * The model libraries are loaded LAZILY (dynamic import) so dropping a plain
 * text file never pays for the Whisper download, and dropping an EPUB never
 * loads the transformers runtime.
 */

/* ------------------------------------------------------------------ */
/* CDN pins                                                            */
/* ------------------------------------------------------------------ */

const JSZIP_CDN =
  'https://cdn.jsdelivr.net/npm/jszip@3.10.2/+esm';
const TRANSFORMERS_CDN =
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/src/transformers.js';
const WHISPER_MODEL = 'Xenova/whisper-tiny.en';

const CHUNK_SECONDS = 30;          // Whisper's native window size
const WHISPER_SAMPLE_RATE = 16000;
const MAX_AUDIO_SECONDS = 20 * 60; // refuse anything longer than 20 minutes
const SEGMENTS_PER_PAGE = 5;

/* ------------------------------------------------------------------ */
/* File-type routing                                                   */
/* ------------------------------------------------------------------ */

const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'webm', 'mp4']);

/**
 * supportedMediaExt(filename) → 'epub' | 'audio' | null
 * The sibling docs ingestor (studio-ingest-docs.mjs) owns the other types.
 */
export function supportedMediaExt(filename) {
  if (typeof filename !== 'string') return null;
  const base = filename.split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  if (ext === 'epub') return 'epub';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return null;
}

/* ------------------------------------------------------------------ */
/* EPUB — pure, DOM-free helpers                                       */
/* ------------------------------------------------------------------ */

/** Pull an attribute value out of a tag string, e.g. attr(tag, 'href'). */
function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i'));
  return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
}

/**
 * opfSpineOrder(opfXml) → [href, href, …]
 * Reads an OPF package document and returns the manifest hrefs in spine
 * (reading) order. hrefs are returned relative to the EPUB zip root,
 * i.e. resolved against the OPF file's own directory.
 * Pure and DOM-free — plain regex parsing of machine-generated XML.
 */
export function opfSpineOrder(opfXml) {
  if (typeof opfXml !== 'string') return [];
  // Manifest: id → href
  const manifest = new Map();
  const itemRe = /<item\b[^>]*>/gi;
  let m;
  while ((m = itemRe.exec(opfXml)) !== null) {
    const id = attr(m[0], 'id');
    const href = attr(m[0], 'href');
    if (id && href) manifest.set(id, href);
  }
  // Spine: idref sequence
  const spineMatch = opfXml.match(/<spine\b[^>]*>([\s\S]*?)<\/spine\s*>/i);
  if (!spineMatch) return [];
  const order = [];
  const refRe = /<itemref\b[^>]*>/gi;
  let r;
  while ((r = refRe.exec(spineMatch[1])) !== null) {
    const idref = attr(r[0], 'idref');
    if (idref && manifest.has(idref)) order.push(manifest.get(idref));
  }
  return order;
}

/** Resolve an OPF-relative href against the OPF file's directory in the zip. */
function resolveOpfPath(opfDir, href) {
  // Strip any fragment (#…) — spine hrefs can carry them.
  const clean = String(href).split('#')[0];
  const parts = (opfDir ? opfDir + '/' : '').split('/').filter(Boolean);
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** container.xml → OPF path inside the zip. */
function opfPathFromContainer(containerXml) {
  const m = String(containerXml).match(
    /<rootfile\b[^>]*full-path\s*=\s*("([^"]*)"|'([^']*)')/i
  );
  const path = m ? (m[2] !== undefined ? m[2] : m[3]) : null;
  return path || 'OEBPS/content.opf';
}

/** Decode the common XML/HTML entities. */
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * xhtmlToText(xhtml) → { title, text }
 * Strips tags but KEEPS heading/paragraph text; block elements become
 * line breaks so the reader pane keeps the chapter's shape.
 * Pure and DOM-free.
 */
export function xhtmlToText(xhtml) {
  const src = String(xhtml || '');
  let title = '';
  const titleMatch = src.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (titleMatch) {
    title = decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim().replace(/\s+/g, ' ');
  }
  let body = src;
  // Drop script/style/svg/head noise (title already captured).
  body = body.replace(/<script[\s\S]*?<\/script\s*>/gi, ' ');
  body = body.replace(/<style[\s\S]*?<\/style\s*>/gi, ' ');
  body = body.replace(/<svg[\s\S]*?<\/svg\s*>/gi, ' ');
  body = body.replace(/<head[\s\S]*?<\/head\s*>/gi, ' ');
  // Block-level elements → line breaks (keeps headings readable as headings).
  body = body.replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|section|article|header|footer|hr)\b[^>]*>/gi, '\n');
  body = body.replace(/<[^>]+>/g, ' ');
  body = decodeEntities(body);
  const text = body
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return { title, text };
}

/**
 * extractEpub(file, onProgress) → { pages: [{n, text}], label }
 * One page per spine item (chapter/section), titled with the XHTML <title>
 * or "Section N" as a fallback. This is the long-document chunking path:
 * each chapter becomes a navigable page in the reader.
 *
 * onProgress(phase, done, total) — phase is 'read'.
 * All failures surface as plain-language Errors; raw exceptions are never leaked.
 */
export async function extractEpub(file, onProgress) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  try {
    const { default: JSZip } = await import(JSZIP_CDN).catch(() => {
      throw new Error(
        'Could not load the book-reading helper. Check your connection and try again.'
      );
    });

    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch {
      throw new Error('This file does not look like a valid EPUB book.');
    }

    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) throw new Error('This EPUB is missing its table of contents.');
    const opfPath = opfPathFromContainer(await containerFile.async('string'));
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

    const opfFile = zip.file(opfPath);
    if (!opfFile) throw new Error('Could not find the book’s chapter list.');
    const spineHrefs = opfSpineOrder(await opfFile.async('string'));
    if (spineHrefs.length === 0) throw new Error('This book has no readable chapters.');

    const pages = [];
    let sectionN = 0;
    for (const href of spineHrefs) {
      const path = resolveOpfPath(opfDir, href);
      const entry = zip.file(path);
      if (!entry) continue; // skip dangling spine refs rather than failing the book
      const { title, text } = xhtmlToText(await entry.async('string'));
      if (!text) continue;  // skip image-only or empty sections
      sectionN += 1;
      pages.push({ n: title || `Section ${sectionN}`, text });
      progress('read', pages.length, spineHrefs.length);
    }

    if (pages.length === 0) {
      throw new Error('No readable text was found in this book.');
    }
    return {
      pages,
      label: `${file.name || 'Book'} — ${pages.length} section${pages.length === 1 ? '' : 's'}`,
    };
  } catch (err) {
    if (err instanceof Error && err.message && !/^\s*$/.test(err.message)) throw err;
    throw new Error('Something went wrong reading this book. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/* Audio transcription — Whisper in the browser                        */
/* ------------------------------------------------------------------ */

/** mm:ss (or h:mm:ss) — used for "Transcript 00:00" page labels. */
function fmtTimestamp(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * segmentsToPages(segments) → [{n, text}]
 * Groups ~5 transcript segments per reader page so long recordings stay
 * navigable. Each page is labeled with its start time ("Transcript 04:30").
 * Pure and DOM-free. segments: [{start, end, text}] (seconds).
 */
export function segmentsToPages(segments) {
  const clean = (Array.isArray(segments) ? segments : [])
    .filter((s) => s && typeof s.text === 'string' && s.text.trim().length > 0)
    .map((s) => ({
      start: Number.isFinite(+s.start) ? Math.max(0, +s.start) : 0,
      end: Number.isFinite(+s.end) ? Math.max(0, +s.end) : 0,
      text: s.text.trim(),
    }))
    .sort((a, b) => a.start - b.start);
  if (clean.length === 0) return [];

  const pages = [];
  for (let i = 0; i < clean.length; i += SEGMENTS_PER_PAGE) {
    const group = clean.slice(i, i + SEGMENTS_PER_PAGE);
    pages.push({
      n: `Transcript ${fmtTimestamp(group[0].start)}`,
      text: group.map((s) => `[${fmtTimestamp(s.start)}] ${s.text}`).join('\n'),
    });
  }
  return pages;
}

/** Linear-resample a mono Float32Array to 16 kHz for Whisper. */
function resampleTo16k(samples, sampleRate) {
  if (sampleRate === WHISPER_SAMPLE_RATE) return samples;
  const ratio = sampleRate / WHISPER_SAMPLE_RATE;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = pos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/** Downmix all channels to mono and resample to 16 kHz. */
function toWhisperInput(audioBuffer) {
  const channels = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  const len = channels[0].length;
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i];
    mono[i] = sum / channels.length;
  }
  return resampleTo16k(mono, audioBuffer.sampleRate);
}

/**
 * transcribeAudio(file, onProgress) → { pages: [{n, text}], label }
 *
 * Runs Whisper (tiny.en, quantized) entirely in the browser via
 * @xenova/transformers — the audio never leaves the device. The model is a
 * one-time ~75MB download, cached by the browser afterwards.
 *
 * Audio is decoded with AudioContext, split into 30s windows, and each
 * window is transcribed in sequence so long clips get progress updates.
 *
 * onProgress(phase, done, total):
 *   phase 'download'    — model download (done/total are bytes or 0/1)
 *   phase 'transcribe'  — chunk transcription (done/total are chunk counts)
 *
 * Refusals / failures are plain-language Errors, never raw exceptions.
 */
export async function transcribeAudio(file, onProgress) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};

  // 1. Decode first — fail fast on unreadable files before any big download.
  let audioBuffer;
  try {
    // AudioContext only exists in the browser; keep it inside this function
    // so the pure helpers stay testable in Node.
    const Ctx =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : typeof webkitAudioContext !== 'undefined'
          ? webkitAudioContext
          : null;
    if (!Ctx) throw new Error('no-audio-context');
    const ctx = new Ctx();
    try {
      const bytes = await file.arrayBuffer();
      audioBuffer = await ctx.decodeAudioData(bytes.slice(0));
    } finally {
      if (typeof ctx.close === 'function') await ctx.close().catch(() => {});
    }
  } catch {
    throw new Error(
      'We couldn’t read this audio file. Try converting it to MP3 or WAV and dropping it in again.'
    );
  }

  if (!audioBuffer || !Number.isFinite(audioBuffer.duration) || audioBuffer.duration <= 0) {
    throw new Error('We couldn’t read this audio file. Try converting it to MP3 or WAV and dropping it in again.');
  }
  if (audioBuffer.duration > MAX_AUDIO_SECONDS) {
    throw new Error(
      'This recording is longer than 20 minutes. Please trim it to a shorter clip and try again.'
    );
  }

  // 2. Load the Whisper runtime + model (one-time ~75MB download, then cached).
  let pipeline;
  try {
    const { pipeline: makePipeline } = await import(TRANSFORMERS_CDN);
    pipeline = await makePipeline('automatic-speech-recognition', WHISPER_MODEL, {
      progress_callback: (info) => {
        // transformers.js reports {status, file, loaded, total} per weight file.
        if (info && typeof info.loaded === 'number' && typeof info.total === 'number' && info.total > 0) {
          progress('download', info.loaded, info.total);
        }
      },
    });
  } catch {
    throw new Error(
      'Transcription needs a one-time ~75MB download — check your connection and retry.'
    );
  }

  // 3. Chunk into 30s windows and transcribe sequentially.
  const samples = toWhisperInput(audioBuffer);
  const windowLen = WHISPER_SAMPLE_RATE * CHUNK_SECONDS;
  const totalChunks = Math.max(1, Math.ceil(samples.length / windowLen));
  const segments = [];

  try {
    for (let i = 0; i < totalChunks; i++) {
      const offset = i * CHUNK_SECONDS;
      const chunk = samples.slice(i * windowLen, (i + 1) * windowLen);
      if (chunk.length === 0) continue;
      progress('transcribe', i, totalChunks);
      const result = await pipeline(chunk, { return_timestamps: true });
      const chunks = result && Array.isArray(result.chunks) ? result.chunks : null;
      if (chunks && chunks.length > 0) {
        for (const c of chunks) {
          const ts = Array.isArray(c.timestamp) ? c.timestamp : [0, 0];
          segments.push({
            start: offset + (ts[0] || 0),
            end: offset + (ts[1] || 0),
            text: String(c.text || '').trim(),
          });
        }
      } else if (result && String(result.text || '').trim()) {
        segments.push({ start: offset, end: offset + CHUNK_SECONDS, text: String(result.text).trim() });
      }
    }
    progress('transcribe', totalChunks, totalChunks);
  } catch {
    throw new Error(
      'Transcription stopped partway through. Please check your connection and try again.'
    );
  }

  const pages = segmentsToPages(segments);
  if (pages.length === 0) {
    throw new Error(
      'We didn’t catch any speech in this recording. Make sure there’s talking in the audio and try again.'
    );
  }

  const name = file.name || 'Recording';
  return {
    pages,
    label: `${name} — auto transcript, review before making cards`,
  };
}
