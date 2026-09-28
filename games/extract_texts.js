// Prints every card term and meaning (JSON array) by running the site's real card files.
// usage: node extract_texts.js <site_root>
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = process.argv[2] || ".";
const src = fs.readFileSync(path.join(__dirname, "common/cards-loader.js"), "utf8");
const files = [...src.matchAll(/"([^"]*cards\.js)"/g)].map((m) => m[1]);
const ctx = { window: {} }; vm.createContext(ctx);
for (const f of files) { const p = path.join(root, f); if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, "utf8"), ctx); }
const out = new Set();
for (const c of Object.values(ctx.window).flat()) {
  if (!c || !c.term) continue;
  out.add(String(c.term).trim());
  const m = String(c.simple || c.cue || "").trim(); if (m) out.add(m);
}
console.log(JSON.stringify([...out]));
