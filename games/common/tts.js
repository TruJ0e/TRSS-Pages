/* TRSS Games — shared speech helper.
 *
 * Browser speechSynthesis, iOS-hardened: long text is chunked by sentence
 * so mobile browsers don't truncate utterances. Default voice, adjustable
 * rate. Games call speak() on question/term display and stopSpeak() when
 * the player answers or navigates away.
 */

let muted = false;

export function setMuted(m) {
  muted = !!m;
  if (muted) stopSpeak();
}
export function isMuted() {
  return muted;
}
export function ttsAvailable() {
  return "speechSynthesis" in window;
}

export function stopSpeak() {
  if (ttsAvailable()) window.speechSynthesis.cancel();
}

function chunkText(text, maxLen = 200) {
  const sentences =
    String(text).match(/[^.!?]+[.!?]+/g) || [String(text)];
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > maxLen && cur) {
      chunks.push(cur.trim());
      cur = "";
    }
    cur += s + " ";
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/**
 * Speak text aloud. opts: {rate (default 1), onend}.
 * No-op when muted or speechSynthesis is unavailable.
 */
export function speak(text, opts = {}) {
  if (muted || !ttsAvailable() || !text) return;
  const synth = window.speechSynthesis;
  synth.cancel(); // never stack utterances in a fast game loop
  const rate = opts.rate || 1;
  const chunks = chunkText(text);
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.rate = rate;
    if (i === chunks.length - 1 && typeof opts.onend === "function") {
      u.onend = opts.onend;
    }
    synth.speak(u);
  });
}
