// TRSS — Chapter 7 Progressive Study & Practice Reference
(function() {
  "use strict";

  const allCards = [
    ...(window.CH7_CORE_CARDS || []),
    ...(window.CH7_LESSON_CARDS || []),
    ...(window.CH7_EXTRA_CARDS || [])
  ];

  // Pre-generate 3 progressive quiz questions per card (108 cards * 3 = 324 total questions)
  function buildQuizBank(cards) {
    const questions = [];
    cards.forEach(card => {
      // Level 3: Application Scenario
      const applyPrompt = (card.apply && card.apply.length > 0)
        ? card.apply[0]
        : `Which concept applies to this scenario: "${card.examples ? card.examples[0] : card.simple}"?`;
      questions.push({
        id: `${card.id}-apply`,
        cardId: card.id,
        term: card.term,
        category: card.category,
        cue: card.cue,
        simple: card.simple,
        compare: card.compare,
        level: "Level 3: Application Scenario",
        prompt: applyPrompt
      });

      // Level 2: Lesson Context Scenario
      const examplePrompt = (card.examples && card.examples.length > 0)
        ? `In the Chapter 7 lesson: "${card.examples[0]}". Which concept is being described?`
        : `Which concept connects directly with: "${card.simple}"?`;
      questions.push({
        id: `${card.id}-lesson`,
        cardId: card.id,
        term: card.term,
        category: card.category,
        cue: card.cue,
        simple: card.simple,
        compare: card.compare,
        level: "Level 2: Lesson Scenario",
        prompt: examplePrompt
      });

      // Level 1: Core Concept Recognition
      questions.push({
        id: `${card.id}-core`,
        cardId: card.id,
        term: card.term,
        category: card.category,
        cue: card.cue,
        simple: card.simple,
        compare: card.compare,
        level: "Level 1: Core Meaning",
        prompt: `Which concept means: "${card.simple}"?`
      });
    });
    return questions;
  }

  const fullQuizBank = buildQuizBank(allCards);

  // Application State
  const state = {
    mode: "flashcards", // "flashcards" | "quiz"
    flashcardDeck: [...allCards],
    flashcardIndex: 0,
    isFlipped: false,
    quizDeck: [...fullQuizBank],
    quizIndex: 0,
    quizSelectedAnswer: null,
    quizAnswered: false,
    quizScore: { correct: 0, total: 0 },
    progress: JSON.parse(localStorage.getItem("trss-chapter7-progress") || "{}")
  };

  // DOM Elements
  const els = {
    modeFlashcardsBtn: document.getElementById("modeFlashcardsBtn"),
    modeQuizBtn: document.getElementById("modeQuizBtn"),
    shuffleBtn: document.getElementById("shuffleBtn"),
    resetBtn: document.getElementById("resetBtn"),
    searchInput: document.getElementById("searchInput"),
    typeFilter: document.getElementById("typeFilter"),
    categoryFilter: document.getElementById("categoryFilter"),
    depthControlWrap: document.getElementById("depthControlWrap"),
    depthSelect: document.getElementById("depthSelect"),
    deckStatus: document.getElementById("deckStatus"),
    categoryStatus: document.getElementById("categoryStatus"),
    progressStatus: document.getElementById("progressStatus"),
    emptyState: document.getElementById("emptyState"),
    clearFiltersBtn: document.getElementById("clearFiltersBtn"),

    // Flashcards Workspace
    fcWorkspace: document.getElementById("flashcardsWorkspace"),
    fcElement: document.getElementById("flashcardElement"),
    fcTypeBadge: document.getElementById("fcTypeBadge"),
    fcCategoryBadge: document.getElementById("fcCategoryBadge"),
    fcCardNumber: document.getElementById("fcCardNumber"),
    fcTerm: document.getElementById("fcTerm"),
    fcBackTypeBadge: document.getElementById("fcBackTypeBadge"),
    fcBackCategoryBadge: document.getElementById("fcBackCategoryBadge"),
    fcBackCardNumber: document.getElementById("fcBackCardNumber"),
    fcBackTerm: document.getElementById("fcBackTerm"),
    fcCue: document.getElementById("fcCue"),
    fcSimple: document.getElementById("fcSimple"),
    fcLessonLayer: document.getElementById("fcLessonLayer"),
    fcExamplesList: document.getElementById("fcExamplesList"),
    fcApplicationLayer: document.getElementById("fcApplicationLayer"),
    fcApplyList: document.getElementById("fcApplyList"),
    fcCompareBox: document.getElementById("fcCompareBox"),
    fcCompareText: document.getElementById("fcCompareText"),
    fcReviewBtn: document.getElementById("fcReviewBtn"),
    fcGotItBtn: document.getElementById("fcGotItBtn"),
    fcPrevBtn: document.getElementById("fcPrevBtn"),
    fcNextBtn: document.getElementById("fcNextBtn"),

    // Quiz Workspace
    quizWorkspace: document.getElementById("quizWorkspace"),
    quizLevelBadge: document.getElementById("quizLevelBadge"),
    quizCategoryBadge: document.getElementById("quizCategoryBadge"),
    quizQuestionNumber: document.getElementById("quizQuestionNumber"),
    quizPromptText: document.getElementById("quizPromptText"),
    quizOptionsContainer: document.getElementById("quizOptionsContainer"),
    quizFeedbackBox: document.getElementById("quizFeedbackBox"),
    feedbackResultTitle: document.getElementById("feedbackResultTitle"),
    feedbackCueText: document.getElementById("feedbackCueText"),
    feedbackMeaningText: document.getElementById("feedbackMeaningText"),
    feedbackCompareText: document.getElementById("feedbackCompareText"),
    quizScoreText: document.getElementById("quizScoreText"),
    quizAccuracyText: document.getElementById("quizAccuracyText"),
    quizSkipBtn: document.getElementById("quizSkipBtn"),
    quizNextBtn: document.getElementById("quizNextBtn")
  };

  function normalize(str) {
    return (str || "").toLowerCase().trim();
  }

  function labelForType(type) {
    if (type === "book-term") return "Book term";
    if (type === "research-skill") return "Research skill";
    return "Lesson concept";
  }

  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function populateCategories() {
    const categories = [...new Set(allCards.map(c => c.category))].sort((a, b) => a.localeCompare(b));
    for (const cat of categories) {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      els.categoryFilter.appendChild(opt);
    }
  }

  function saveProgress() {
    localStorage.setItem("trss-chapter7-progress", JSON.stringify(state.progress));
  }

  function markProgress(status) {
    const card = state.flashcardDeck[state.flashcardIndex];
    if (!card) return;
    const existing = state.progress[card.id] || { seen: 0, gotIt: 0, review: 0 };
    existing.seen += 1;
    existing.status = status;
    if (status === "got-it") existing.gotIt += 1;
    if (status === "review") existing.review += 1;
    existing.updatedAt = new Date().toISOString();
    state.progress[card.id] = existing;
    saveProgress();
    nextFlashcard();
  }

  function applyFilters(resetIndex = true) {
    const query = normalize(els.searchInput.value);
    const typeVal = els.typeFilter.value;
    const catVal = els.categoryFilter.value;

    // Filter flashcards
    state.flashcardDeck = allCards.filter(card => {
      const cardProgress = state.progress[card.id]?.status;
      const typeMatches = (typeVal === "all")
        || (typeVal === card.type)
        || (typeVal === "review" && cardProgress === "review");
      const catMatches = (catVal === "all") || (card.category === catVal);
      
      const searchHaystack = [
        card.term,
        card.cue,
        card.simple,
        card.category,
        ...(card.examples || []),
        ...(card.apply || []),
        card.compare || ""
      ].join(" ").toLowerCase();
      const searchMatches = !query || searchHaystack.includes(query);

      return typeMatches && catMatches && searchMatches;
    });

    // Filter quiz questions
    state.quizDeck = fullQuizBank.filter(q => {
      const catMatches = (catVal === "all") || (q.category === catVal);
      const searchHaystack = [
        q.term,
        q.cue,
        q.simple,
        q.category,
        q.prompt,
        q.compare || ""
      ].join(" ").toLowerCase();
      const searchMatches = !query || searchHaystack.includes(query);
      return catMatches && searchMatches;
    });

    if (resetIndex) {
      state.flashcardIndex = 0;
      state.quizIndex = 0;
    }
    state.isFlipped = false;
    state.quizAnswered = false;
    state.quizSelectedAnswer = null;

    render();
  }

  function switchMode(newMode) {
    state.mode = newMode;
    const isFc = newMode === "flashcards";
    els.modeFlashcardsBtn.classList.toggle("active", isFc);
    els.modeFlashcardsBtn.setAttribute("aria-selected", isFc ? "true" : "false");
    els.modeQuizBtn.classList.toggle("active", !isFc);
    els.modeQuizBtn.setAttribute("aria-selected", isFc ? "false" : "true");

    els.fcWorkspace.classList.toggle("hidden", !isFc);
    els.quizWorkspace.classList.toggle("hidden", isFc);
    els.depthControlWrap.classList.toggle("hidden", !isFc);

    state.isFlipped = false;
    render();
  }

  // Flashcards Navigation & Render
  function renderFlashcards() {
    const deck = state.flashcardDeck;
    const isEmpty = deck.length === 0;

    els.emptyState.classList.toggle("hidden", !isEmpty);
    els.fcWorkspace.classList.toggle("hidden", isEmpty);
    if (isEmpty) return;

    if (state.flashcardIndex >= deck.length) state.flashcardIndex = 0;
    const card = deck[state.flashcardIndex];

    const typeLabel = labelForType(card.type);
    const counterText = `${state.flashcardIndex + 1} / ${deck.length}`;

    // Front
    els.fcTypeBadge.textContent = typeLabel;
    els.fcCategoryBadge.textContent = card.category;
    els.fcCardNumber.textContent = counterText;
    els.fcTerm.textContent = card.term;

    // Back
    els.fcBackTypeBadge.textContent = typeLabel;
    els.fcBackCategoryBadge.textContent = card.category;
    els.fcBackCardNumber.textContent = counterText;
    els.fcBackTerm.textContent = card.term;
    els.fcCue.textContent = card.cue;
    els.fcSimple.textContent = card.simple;

    // Detail Levels
    const depth = Number(els.depthSelect.value);
    const hasExamples = (card.examples || []).length > 0;
    const hasApply = (card.apply || []).length > 0 || Boolean(card.compare);

    els.fcLessonLayer.classList.toggle("hidden", depth < 2 || !hasExamples);
    if (depth >= 2 && hasExamples) {
      els.fcExamplesList.innerHTML = "";
      card.examples.forEach(ex => {
        const li = document.createElement("li");
        li.textContent = ex;
        els.fcExamplesList.appendChild(li);
      });
    }

    els.fcApplicationLayer.classList.toggle("hidden", depth < 3 || !hasApply);
    if (depth >= 3 && hasApply) {
      els.fcApplyList.innerHTML = "";
      (card.apply || []).forEach(ap => {
        const li = document.createElement("li");
        li.textContent = ap;
        els.fcApplyList.appendChild(li);
      });
      els.fcCompareBox.classList.toggle("hidden", !card.compare);
      els.fcCompareText.textContent = card.compare || "";
    }

    // Flip state
    els.fcElement.classList.toggle("flipped", state.isFlipped);
    els.fcElement.setAttribute("aria-expanded", state.isFlipped ? "true" : "false");

    els.fcPrevBtn.disabled = deck.length <= 1;
    els.fcNextBtn.disabled = deck.length <= 1;
  }

  function toggleFlip() {
    if (!state.flashcardDeck.length) return;
    state.isFlipped = !state.isFlipped;
    els.fcElement.classList.toggle("flipped", state.isFlipped);
    els.fcElement.setAttribute("aria-expanded", state.isFlipped ? "true" : "false");
  }

  function nextFlashcard() {
    if (!state.flashcardDeck.length) return;
    state.flashcardIndex = (state.flashcardIndex + 1) % state.flashcardDeck.length;
    state.isFlipped = false;
    renderFlashcards();
  }

  function prevFlashcard() {
    if (!state.flashcardDeck.length) return;
    state.flashcardIndex = (state.flashcardIndex - 1 + state.flashcardDeck.length) % state.flashcardDeck.length;
    state.isFlipped = false;
    renderFlashcards();
  }

  // Quiz Mode Logic
  function generateOptions(question) {
    const correctTerm = question.term;
    // Find candidate distractors, prioritizing same category
    const sameCatCards = allCards.filter(c => c.category === question.category && c.term !== correctTerm);
    const diffCatCards = allCards.filter(c => c.category !== question.category && c.term !== correctTerm);

    const shuffledSame = shuffleArray(sameCatCards);
    const shuffledDiff = shuffleArray(diffCatCards);

    const distractors = [];
    while (distractors.length < 3 && shuffledSame.length > 0) {
      distractors.push(shuffledSame.pop().term);
    }
    while (distractors.length < 3 && shuffledDiff.length > 0) {
      distractors.push(shuffledDiff.pop().term);
    }

    const options = shuffleArray([correctTerm, ...distractors.slice(0, 3)]);
    return options;
  }

  function renderQuiz() {
    const deck = state.quizDeck;
    const isEmpty = deck.length === 0;

    els.emptyState.classList.toggle("hidden", !isEmpty);
    els.quizWorkspace.classList.toggle("hidden", isEmpty);
    if (isEmpty) return;

    if (state.quizIndex >= deck.length) state.quizIndex = 0;
    const question = deck[state.quizIndex];

    els.quizLevelBadge.textContent = question.level;
    els.quizCategoryBadge.textContent = question.category;
    els.quizQuestionNumber.textContent = `Question ${state.quizIndex + 1} / ${deck.length}`;
    els.quizPromptText.textContent = question.prompt;

    // Reset feedback
    if (!state.quizAnswered) {
      els.quizFeedbackBox.classList.add("hidden");
      els.quizNextBtn.disabled = true;
      els.quizSkipBtn.disabled = false;
    }

    // Render Options
    els.quizOptionsContainer.innerHTML = "";
    const options = question.options || (question.options = generateOptions(question));
    const letters = ["A", "B", "C", "D"];

    options.forEach((optTerm, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-option-btn";
      btn.innerHTML = `<span class="option-letter">${letters[idx]}</span> <span class="option-text">${optTerm}</span>`;

      if (state.quizAnswered) {
        btn.disabled = true;
        if (optTerm === question.term) {
          btn.classList.add("correct");
        } else if (optTerm === state.quizSelectedAnswer) {
          btn.classList.add("wrong");
        }
      } else {
        btn.addEventListener("click", () => handleQuizSelect(optTerm, question));
      }

      els.quizOptionsContainer.appendChild(btn);
    });

    // Render Score
    els.quizScoreText.textContent = `${state.quizScore.correct} / ${state.quizScore.total}`;
    const percent = state.quizScore.total > 0
      ? Math.round((state.quizScore.correct / state.quizScore.total) * 100)
      : 0;
    els.quizAccuracyText.textContent = `(${percent}%)`;
  }

  function handleQuizSelect(selectedTerm, question) {
    if (state.quizAnswered) return;
    state.quizAnswered = true;
    state.quizSelectedAnswer = selectedTerm;

    const isCorrect = selectedTerm === question.term;
    state.quizScore.total += 1;
    if (isCorrect) state.quizScore.correct += 1;

    // Feedback content
    els.feedbackResultTitle.textContent = isCorrect ? "🎉 Correct!" : "❌ Incorrect";
    els.feedbackResultTitle.className = `feedback-title ${isCorrect ? "correct" : "wrong"}`;
    els.feedbackCueText.textContent = question.cue;
    els.feedbackMeaningText.innerHTML = `<strong>${question.term}:</strong> ${question.simple}`;
    
    if (question.compare) {
      els.feedbackCompareText.classList.remove("hidden");
      els.feedbackCompareText.innerHTML = `<strong>Distinguish:</strong> ${question.compare}`;
    } else {
      els.feedbackCompareText.classList.add("hidden");
    }

    els.quizFeedbackBox.classList.remove("hidden");
    els.quizNextBtn.disabled = false;

    renderQuiz();
  }

  function nextQuizQuestion() {
    if (!state.quizDeck.length) return;
    state.quizIndex = (state.quizIndex + 1) % state.quizDeck.length;
    state.quizAnswered = false;
    state.quizSelectedAnswer = null;
    renderQuiz();
  }

  function render() {
    const gotItCount = allCards.filter(c => state.progress[c.id]?.status === "got-it").length;
    const reviewCount = allCards.filter(c => state.progress[c.id]?.status === "review").length;

    if (state.mode === "flashcards") {
      els.deckStatus.textContent = `${state.flashcardDeck.length} cards in view · ${allCards.length} total`;
      els.progressStatus.textContent = `${gotItCount} got it · ${reviewCount} review`;
      renderFlashcards();
    } else {
      els.deckStatus.textContent = `${state.quizDeck.length} scenarios in view · ${fullQuizBank.length} total`;
      els.progressStatus.textContent = `Score: ${state.quizScore.correct}/${state.quizScore.total}`;
      renderQuiz();
    }
  }

  // Event Listeners
  els.modeFlashcardsBtn.addEventListener("click", () => switchMode("flashcards"));
  els.modeQuizBtn.addEventListener("click", () => switchMode("quiz"));

  els.searchInput.addEventListener("input", () => applyFilters(true));
  els.typeFilter.addEventListener("change", () => applyFilters(true));
  els.categoryFilter.addEventListener("change", () => applyFilters(true));
  els.depthSelect.addEventListener("change", () => renderFlashcards());

  els.clearFiltersBtn.addEventListener("click", () => {
    els.searchInput.value = "";
    els.typeFilter.value = "all";
    els.categoryFilter.value = "all";
    applyFilters(true);
  });

  els.shuffleBtn.addEventListener("click", () => {
    if (state.mode === "flashcards") {
      state.flashcardDeck = shuffleArray(state.flashcardDeck);
      state.flashcardIndex = 0;
      state.isFlipped = false;
    } else {
      state.quizDeck = shuffleArray(state.quizDeck);
      state.quizIndex = 0;
      state.quizAnswered = false;
      state.quizSelectedAnswer = null;
    }
    render();
  });

  els.resetBtn.addEventListener("click", () => {
    if (confirm("Reset all study and quiz progress on this device?")) {
      state.progress = {};
      state.quizScore = { correct: 0, total: 0 };
      saveProgress();
      applyFilters(true);
    }
  });

  // Flashcards interaction
  els.fcElement.addEventListener("click", () => toggleFlip());
  els.fcNextBtn.addEventListener("click", nextFlashcard);
  els.fcPrevBtn.addEventListener("click", prevFlashcard);
  els.fcGotItBtn.addEventListener("click", () => markProgress("got-it"));
  els.fcReviewBtn.addEventListener("click", () => markProgress("review"));

  // Quiz interaction
  els.quizNextBtn.addEventListener("click", nextQuizQuestion);
  els.quizSkipBtn.addEventListener("click", nextQuizQuestion);

  // Keyboard Shortcuts
  document.addEventListener("keydown", (e) => {
    const activeEl = document.activeElement;
    const isTyping = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "SELECT" || activeEl.tagName === "TEXTAREA");
    if (isTyping) return;

    if (state.mode === "flashcards") {
      if (e.code === "Space") {
        e.preventDefault();
        toggleFlip();
      } else if (e.key === "ArrowRight") {
        nextFlashcard();
      } else if (e.key === "ArrowLeft") {
        prevFlashcard();
      } else if (e.key === "1") {
        markProgress("review");
      } else if (e.key === "2") {
        markProgress("got-it");
      }
    } else if (state.mode === "quiz") {
      if (!state.quizAnswered && ["1", "2", "3", "4"].includes(e.key)) {
        const idx = Number(e.key) - 1;
        const btns = els.quizOptionsContainer.querySelectorAll(".quiz-option-btn");
        if (btns[idx]) btns[idx].click();
      } else if (state.quizAnswered && (e.key === "Enter" || e.key === "ArrowRight")) {
        nextQuizQuestion();
      }
    }
  });

  // Initialize
  populateCategories();
  applyFilters(false);
})();
