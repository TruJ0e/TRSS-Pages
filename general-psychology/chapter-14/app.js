/* TRSS digital-reference runtime — psychology-chapter-14 (prefix CH14).
   Zero dependencies, zero network calls. Reads the card payloads emitted
   by trss-generator and provides Reference / Flashcards / Practice Quiz.
*/
(function () {
  "use strict";
  var P = "CH14";
  var core = window[P + "_CORE_CARDS"] || [];
  var lesson = window[P + "_LESSON_CARDS"] || [];
  var extra = window[P + "_EXTRA_CARDS"] || [];
  var study = window[P + "_STUDY_DATA"] || {};
  var targets = window[P + "_LESSON_TARGETS"] || [];
  var all = core.concat(lesson, extra);

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  $("stat-cards").textContent = all.length;
  $("stat-questions").textContent = all.length * 3;
  $("targets").innerHTML = targets.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");

  var categories = [];
  all.forEach(function (c) { if (categories.indexOf(c.category) < 0) categories.push(c.category); });
  categories.sort();
  ["ref-category", "quiz-category"].forEach(function (id) {
    var sel = $(id);
    categories.forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o);
    });
  });

  /* ---- mode switching ---- */
  var modes = document.querySelectorAll(".mode");
  modes.forEach(function (btn) {
    btn.addEventListener("click", function () {
      modes.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
      $("view-" + btn.dataset.mode).classList.add("active");
    });
  });

  /* ---- reference view ---- */
  function renderRefList() {
    var q = $("ref-search").value.toLowerCase();
    var cat = $("ref-category").value, type = $("ref-type").value;
    var list = $("ref-list"); list.innerHTML = "";
    var shown = 0;
    all.forEach(function (c) {
      if (q && (c.term + " " + c.simple + " " + c.category).toLowerCase().indexOf(q) < 0) return;
      if (cat && c.category !== cat) return;
      if (type && c.type !== type) return;
      shown++;
      var li = document.createElement("li");
      li.innerHTML = '<span class="t">' + esc(c.term) + '</span>' +
        '<span class="badge ' + esc(c.type) + '">' + esc(c.type) + "</span><br>" +
        '<span class="muted">' + esc(c.category) + "</span>";
      li.addEventListener("click", function () {
        list.querySelectorAll("li").forEach(function (x) { x.classList.remove("sel"); });
        li.classList.add("sel");
        renderDetail(c);
      });
      list.appendChild(li);
    });
    if (!shown) list.innerHTML = '<li class="muted">No items match the selected filters.</li>';
  }
  function renderDetail(c) {
    var h = "<h2>" + esc(c.term) + ' <span class="badge ' + esc(c.type) + '">' + esc(c.type) + "</span></h2>";
    h += '<p class="muted">' + esc(c.category) + " · " + esc(c.id) + "</p>";
    h += '<p class="cue">⚡ ' + esc(c.cue) + "</p>";
    h += "<p><strong>Plain meaning:</strong> " + esc(c.simple) + "</p>";
    h += "<h3>Lesson examples</h3><ul>" + c.examples.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul>";
    h += "<h3>Apply it</h3><ul>" + c.apply.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul>";
    if (c.compare) h += "<h3>Distinguish it</h3><p>" + esc(c.compare) + "</p>";
    $("ref-detail").innerHTML = h;
  }
  ["ref-search", "ref-category", "ref-type"].forEach(function (id) {
    $(id).addEventListener("input", renderRefList);
    $(id).addEventListener("change", renderRefList);
  });
  renderRefList();

  /* ---- flashcards ---- */
  var deck = all.slice(), fi = 0;
  function renderFc() {
    var c = deck[fi];
    $("fc-card").classList.remove("flipped");
    $("fc-term").textContent = c.term;
    $("fc-cue").textContent = c.cue;
    $("fc-simple").textContent = c.simple;
    $("fc-example").textContent = c.examples[0] || "";
    $("fc-count").textContent = (fi + 1) + " / " + deck.length + " · " + c.category;
  }
  $("fc-card").addEventListener("click", function () { this.classList.toggle("flipped"); });
  document.addEventListener("keydown", function (e) {
    if (!$("view-flashcards").classList.contains("active")) return;
    if (e.code === "Space") { e.preventDefault(); $("fc-card").classList.toggle("flipped"); }
    if (e.code === "ArrowRight") { fi = (fi + 1) % deck.length; renderFc(); }
    if (e.code === "ArrowLeft") { fi = (fi - 1 + deck.length) % deck.length; renderFc(); }
  });
  $("fc-prev").addEventListener("click", function () { fi = (fi - 1 + deck.length) % deck.length; renderFc(); });
  $("fc-next").addEventListener("click", function () { fi = (fi + 1) % deck.length; renderFc(); });
  $("fc-flip").addEventListener("click", function () { $("fc-card").classList.toggle("flipped"); });
  $("fc-shuffle").addEventListener("click", function () { deck = shuffle(deck); fi = 0; renderFc(); });
  if (deck.length) renderFc();

  /* ---- quiz: 3 questions per card ---- */
  function distractors(card, n) {
    var same = shuffle(all.filter(function (c) { return c !== card && c.category === card.category; }));
    var rest = shuffle(all.filter(function (c) { return c !== card && c.category !== card.category; }));
    var pool = same.concat(rest), out = [], seen = {};
    pool.forEach(function (c) { if (out.length < n && !seen[c.term]) { seen[c.term] = 1; out.push(c.term); } });
    return out;
  }
  function blankTerm(text, term) {
    var rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    return rx.test(text) ? text.replace(rx, "_____") : text;
  }
  function buildQuestions(cards) {
    var qs = [];
    cards.forEach(function (c) {
      var d3 = distractors(c, 3);
      // L3 — application scenario (from apply prompts)
      qs.push({
        level: "L3 · Application", card: c,
        stem: c.apply[0] + " Which concept are you being asked to use?",
        options: shuffle([c.term].concat(d3)), answer: c.term,
        explain: c.cue + " " + c.simple
      });
      // L2 — lesson scenario (example with the term blanked)
      var ex = c.examples[0] || c.simple;
      qs.push({
        level: "L2 · Lesson scenario", card: c,
        stem: "Which concept does this describe? “" + blankTerm(ex, c.term) + "”",
        options: shuffle([c.term].concat(d3)), answer: c.term,
        explain: c.simple
      });
      // L1 — core meaning
      qs.push({
        level: "L1 · Core meaning", card: c,
        stem: "What does “" + c.term + "” mean?",
        options: shuffle([c.term].concat(d3)), answer: c.term,
        explain: c.simple
      });
    });
    return qs;
  }

  var quiz = [], qi = 0, score = 0, answered = 0;
  function startQuiz() {
    var cat = $("quiz-category").value;
    var cards = cat ? all.filter(function (c) { return c.category === cat; }) : all.slice();
    if (!cards.length) return;
    quiz = buildQuestions(shuffle(cards)); qi = 0; score = 0; answered = 0;
    $("quiz-setup").hidden = true; $("quiz-done").hidden = true; $("quiz-run").hidden = false;
    renderQ();
  }
  function renderQ() {
    var q = quiz[qi];
    $("quiz-pos").textContent = "Question " + (qi + 1) + " / " + quiz.length;
    $("quiz-level").textContent = q.level;
    $("quiz-score").textContent = score + " / " + answered;
    $("quiz-bar").style.width = (100 * qi / quiz.length) + "%";
    $("quiz-stem").textContent = q.stem;
    $("quiz-feedback").hidden = true; $("quiz-next").hidden = true;
    var box = $("quiz-options"); box.innerHTML = "";
    q.options.forEach(function (opt) {
      var b = document.createElement("button");
      b.textContent = opt;
      b.addEventListener("click", function () { answerQ(b, opt, q); });
      box.appendChild(b);
    });
  }
  function answerQ(btn, opt, q) {
    var buttons = $("quiz-options").querySelectorAll("button");
    buttons.forEach(function (b) {
      b.disabled = true;
      if (b.textContent === q.answer) b.classList.add("correct");
    });
    answered++;
    var fb = $("quiz-feedback");
    if (opt === q.answer) { score++; fb.className = "quiz-feedback good"; fb.textContent = "✓ Correct. " + q.explain; }
    else { btn.classList.add("wrong"); fb.className = "quiz-feedback bad"; fb.textContent = "✗ The answer is “" + q.answer + "”. " + q.explain; }
    fb.hidden = false;
    $("quiz-score").textContent = score + " / " + answered;
    $("quiz-next").hidden = false;
  }
  $("quiz-next").addEventListener("click", function () {
    qi++;
    if (qi >= quiz.length) {
      $("quiz-run").hidden = true; $("quiz-done").hidden = false;
      var pct = Math.round(100 * score / answered);
      $("quiz-final").textContent = "You scored " + score + " / " + answered + " (" + pct + "%).";
      $("quiz-bar").style.width = "100%";
    } else renderQ();
  });
  $("quiz-start").addEventListener("click", startQuiz);
  $("quiz-restart").addEventListener("click", function () {
    $("quiz-done").hidden = true; $("quiz-setup").hidden = false;
  });

  /* Test hook: exposes the pure quiz builders when a harness sets
     window.__TRSS_TEST_HOOK__ before this script runs. */
  if (typeof window !== "undefined" && window.__TRSS_TEST_HOOK__) {
    window.__TRSS_TEST_HOOK__({
      all: all, distractors: distractors,
      blankTerm: blankTerm, buildQuestions: buildQuestions
    });
  }
})();
