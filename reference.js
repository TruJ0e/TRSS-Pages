// TRSS — TruReview Student Studier: Chapter 7 Progressive Study & Practice Reference
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
    currentView: "home", // "home" | "course" | "chapter" | "study"
    mode: "flashcards",  // "flashcards" | "quiz"
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
    // Views
    homeView: document.getElementById("homeView"),
    courseView: document.getElementById("courseView"),
    chapterView: document.getElementById("chapterView"),
    studyView: document.getElementById("studyView"),

    // Breadcrumbs
    bcHome: document.getElementById("bcHome"),
    bcSepCourse: document.getElementById("bcSepCourse"),
    bcCourse: document.getElementById("bcCourse"),
    bcSepChapter: document.getElementById("bcSepChapter"),
    bcChapter: document.getElementById("bcChapter"),
    bcSepStudy: document.getElementById("bcSepStudy"),
    bcStudy: document.getElementById("bcStudy"),

    // Study Header & Mode Switcher
    modeFlashcardsBtn: document.getElementById("modeFlashcardsBtn"),
    modeQuizBtn: document.getElementById("modeQuizBtn"),
    shuffleBtn: document.getElementById("shuffleBtn"),
    resetBtn: document.getElementById("resetBtn"),
    searchInput: document.getElementById("searchInput"),
    typeFilter: document.getElementById("typeFilter"),
    categoryFilter: document.getElementById("categoryFilter"),
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
    if (!els.categoryFilter) return;
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
    if (!els.searchInput || !els.typeFilter || !els.categoryFilter) return;
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
    if (els.modeFlashcardsBtn) {
      els.modeFlashcardsBtn.classList.toggle("active", isFc);
      els.modeFlashcardsBtn.setAttribute("aria-selected", isFc ? "true" : "false");
    }
    if (els.modeQuizBtn) {
      els.modeQuizBtn.classList.toggle("active", !isFc);
      els.modeQuizBtn.setAttribute("aria-selected", isFc ? "false" : "true");
    }

    if (els.fcWorkspace) els.fcWorkspace.classList.toggle("hidden", !isFc);
    if (els.quizWorkspace) els.quizWorkspace.classList.toggle("hidden", isFc);

    state.isFlipped = false;
    render();
  }

  // Flashcards Navigation & Render with Scaffolded Breakdown
  function renderFlashcards() {
    const deck = state.flashcardDeck;
    const isEmpty = deck.length === 0;

    if (els.emptyState) els.emptyState.classList.toggle("hidden", !isEmpty);
    if (els.fcWorkspace) els.fcWorkspace.classList.toggle("hidden", isEmpty);
    if (isEmpty) return;

    if (state.flashcardIndex >= deck.length) state.flashcardIndex = 0;
    const card = deck[state.flashcardIndex];

    const typeLabel = labelForType(card.type);
    const counterText = `${state.flashcardIndex + 1} / ${deck.length}`;

    // Front Face
    if (els.fcTypeBadge) els.fcTypeBadge.textContent = typeLabel;
    if (els.fcCategoryBadge) els.fcCategoryBadge.textContent = card.category;
    if (els.fcCardNumber) els.fcCardNumber.textContent = counterText;
    if (els.fcTerm) els.fcTerm.textContent = card.term;

    // Back Face: Scaffolded Breakdown
    if (els.fcBackTypeBadge) els.fcBackTypeBadge.textContent = typeLabel;
    if (els.fcBackCategoryBadge) els.fcBackCategoryBadge.textContent = card.category;
    if (els.fcBackCardNumber) els.fcBackCardNumber.textContent = counterText;
    if (els.fcBackTerm) els.fcBackTerm.textContent = card.term;
    if (els.fcCue) els.fcCue.textContent = card.cue;
    if (els.fcSimple) els.fcSimple.textContent = card.simple;

    // Lesson Connections / Examples (Naturally shown)
    const hasExamples = (card.examples || []).length > 0;
    if (els.fcLessonLayer) {
      els.fcLessonLayer.classList.toggle("hidden", !hasExamples);
      if (hasExamples && els.fcExamplesList) {
        els.fcExamplesList.innerHTML = "";
        card.examples.forEach(ex => {
          const li = document.createElement("li");
          li.textContent = ex;
          els.fcExamplesList.appendChild(li);
        });
      }
    }

    // Distinguish It (Naturally shown when present)
    const hasCompare = Boolean(card.compare);
    if (els.fcApplicationLayer) {
      els.fcApplicationLayer.classList.toggle("hidden", !hasCompare);
      if (hasCompare && els.fcCompareBox && els.fcCompareText) {
        els.fcCompareBox.classList.remove("hidden");
        els.fcCompareText.textContent = card.compare;
      }
    }

    // Flip state
    if (els.fcElement) {
      els.fcElement.classList.toggle("flipped", state.isFlipped);
      els.fcElement.setAttribute("aria-expanded", state.isFlipped ? "true" : "false");
    }

    if (els.fcPrevBtn) els.fcPrevBtn.disabled = deck.length <= 1;
    if (els.fcNextBtn) els.fcNextBtn.disabled = deck.length <= 1;
  }

  function toggleFlip() {
    if (!state.flashcardDeck.length || !els.fcElement) return;
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
    const sameCatCards = allCards.filter(c => c.category === question.category && c.term !== correctTerm);
    const diffCatCards = allCards.filter(c => c.category !== question.category && c.term !== correctTerm);

    const shuffledSame = shuffleArray(sameCatCards);
    const shuffledDiff = shuffleArray(diffCatCards);

    const distractors = [];
    while (distractors.length < 3 && shuffledSame.length > 0) {
      const c = shuffledSame.pop();
      if (!distractors.includes(c.term)) distractors.push(c.term);
    }
    while (distractors.length < 3 && shuffledDiff.length > 0) {
      const c = shuffledDiff.pop();
      if (!distractors.includes(c.term)) distractors.push(c.term);
    }

    const options = shuffleArray([correctTerm, ...distractors]);
    return options;
  }

  function renderQuiz() {
    const deck = state.quizDeck;
    const isEmpty = deck.length === 0;

    if (els.emptyState) els.emptyState.classList.toggle("hidden", !isEmpty);
    if (els.quizWorkspace) els.quizWorkspace.classList.toggle("hidden", isEmpty);
    if (isEmpty) return;

    if (state.quizIndex >= deck.length) state.quizIndex = 0;
    const q = deck[state.quizIndex];

    if (els.quizLevelBadge) els.quizLevelBadge.textContent = q.level;
    if (els.quizCategoryBadge) els.quizCategoryBadge.textContent = q.category;
    if (els.quizQuestionNumber) els.quizQuestionNumber.textContent = `Question ${state.quizIndex + 1} / ${deck.length}`;
    if (els.quizPromptText) els.quizPromptText.textContent = q.prompt;

    // Render 4 answer choices
    if (els.quizOptionsContainer) {
      els.quizOptionsContainer.innerHTML = "";
      const letters = ["A", "B", "C", "D"];
      const options = generateOptions(q);

      options.forEach((optText, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "quiz-option-btn";
        btn.setAttribute("role", "radio");
        btn.setAttribute("aria-checked", "false");
        btn.disabled = state.quizAnswered;

        const letterSpan = document.createElement("span");
        letterSpan.className = "option-letter";
        letterSpan.textContent = letters[i];

        const textSpan = document.createElement("span");
        textSpan.className = "option-text";
        textSpan.textContent = optText;

        btn.appendChild(letterSpan);
        btn.appendChild(textSpan);

        if (state.quizAnswered) {
          if (optText === q.term) {
            btn.classList.add("correct");
          } else if (optText === state.quizSelectedAnswer) {
            btn.classList.add("wrong");
          }
        }

        btn.addEventListener("click", () => handleQuizAnswer(optText, q));
        els.quizOptionsContainer.appendChild(btn);
      });
    }

    // Feedback box
    if (els.quizFeedbackBox) {
      if (state.quizAnswered) {
        els.quizFeedbackBox.classList.remove("hidden");
        const isCorrect = state.quizSelectedAnswer === q.term;

        if (els.feedbackResultTitle) {
          els.feedbackResultTitle.textContent = isCorrect
            ? "✅ Correct! Excellent recall."
            : `❌ Incorrect. The correct concept is "${q.term}".`;
          els.feedbackResultTitle.className = `feedback-title ${isCorrect ? "correct" : "wrong"}`;
        }

        if (els.feedbackCueText) els.feedbackCueText.textContent = q.cue;
        if (els.feedbackMeaningText) els.feedbackMeaningText.textContent = q.simple;
        if (els.feedbackCompareText) {
          if (q.compare) {
            els.feedbackCompareText.classList.remove("hidden");
            els.feedbackCompareText.textContent = `Distinction: ${q.compare}`;
          } else {
            els.feedbackCompareText.classList.add("hidden");
          }
        }
      } else {
        els.quizFeedbackBox.classList.add("hidden");
      }
    }

    // Quiz score display
    if (els.quizScoreText) els.quizScoreText.textContent = `${state.quizScore.correct} / ${state.quizScore.total}`;
    if (els.quizAccuracyText) {
      const pct = state.quizScore.total > 0
        ? Math.round((state.quizScore.correct / state.quizScore.total) * 100)
        : 0;
      els.quizAccuracyText.textContent = `(${pct}%)`;
    }

    if (els.quizNextBtn) els.quizNextBtn.disabled = !state.quizAnswered;
  }

  function handleQuizAnswer(selectedTerm, question) {
    if (state.quizAnswered) return;
    state.quizAnswered = true;
    state.quizSelectedAnswer = selectedTerm;

    const isCorrect = selectedTerm === question.term;
    state.quizScore.total += 1;
    if (isCorrect) state.quizScore.correct += 1;

    // Track card progress
    const cardId = question.cardId;
    const existing = state.progress[cardId] || { seen: 0, gotIt: 0, review: 0 };
    existing.seen += 1;
    if (isCorrect) existing.gotIt += 1;
    else {
      existing.review += 1;
      existing.status = "review";
    }
    state.progress[cardId] = existing;
    saveProgress();

    renderQuiz();
    renderStatusBar();
  }

  function nextQuizQuestion() {
    if (!state.quizDeck.length) return;
    state.quizIndex = (state.quizIndex + 1) % state.quizDeck.length;
    state.quizAnswered = false;
    state.quizSelectedAnswer = null;
    renderQuiz();
  }

  // Status Bar
  function renderStatusBar() {
    const isFc = state.mode === "flashcards";
    const count = isFc ? state.flashcardDeck.length : state.quizDeck.length;
    const total = isFc ? allCards.length : fullQuizBank.length;

    if (els.deckStatus) {
      els.deckStatus.textContent = count === total
        ? `${count} ${isFc ? "cards" : "questions"} in view · ${total} total`
        : `${count} of ${total} ${isFc ? "cards" : "questions"}`;
    }

    if (els.categoryStatus && els.categoryFilter) {
      els.categoryStatus.textContent = els.categoryFilter.value !== "all"
        ? `· Section: ${els.categoryFilter.value}`
        : "";
    }

    if (els.progressStatus) {
      let gotItCount = 0;
      let reviewCount = 0;
      Object.values(state.progress).forEach(p => {
        if (p.status === "got-it") gotItCount++;
        if (p.status === "review") reviewCount++;
      });
      els.progressStatus.textContent = `${gotItCount} got it · ${reviewCount} review`;
    }
  }

  function render() {
    renderStatusBar();
    if (state.mode === "flashcards") {
      renderFlashcards();
    } else {
      renderQuiz();
    }
  }

  // Multi-View Site Router
  function showView(viewId) {
    state.currentView = viewId;

    if (els.homeView) els.homeView.classList.toggle("hidden", viewId !== "home");
    if (els.courseView) els.courseView.classList.toggle("hidden", viewId !== "course");
    if (els.chapterView) els.chapterView.classList.toggle("hidden", viewId !== "chapter");
    if (els.studyView) els.studyView.classList.toggle("hidden", viewId !== "study");

    // Update Breadcrumbs
    updateBreadcrumbs(viewId);

    // Scroll view to top if landing page
    if (viewId === "home" && els.homeView) els.homeView.scrollTop = 0;
    if (viewId === "course" && els.courseView) els.courseView.scrollTop = 0;
    if (viewId === "chapter" && els.chapterView) els.chapterView.scrollTop = 0;

    if (viewId === "study") {
      render();
    }
  }

  function updateBreadcrumbs(viewId) {
    if (!els.bcHome) return;

    if (viewId === "home") {
      els.bcHome.classList.add("active");
      if (els.bcSepCourse) els.bcSepCourse.style.display = "none";
      if (els.bcCourse) els.bcCourse.style.display = "none";
      if (els.bcSepChapter) els.bcSepChapter.style.display = "none";
      if (els.bcChapter) els.bcChapter.style.display = "none";
      if (els.bcSepStudy) els.bcSepStudy.style.display = "none";
      if (els.bcStudy) els.bcStudy.style.display = "none";
    } else if (viewId === "course") {
      els.bcHome.classList.remove("active");
      if (els.bcSepCourse) els.bcSepCourse.style.display = "inline";
      if (els.bcCourse) {
        els.bcCourse.style.display = "inline";
        els.bcCourse.classList.add("active");
      }
      if (els.bcSepChapter) els.bcSepChapter.style.display = "none";
      if (els.bcChapter) els.bcChapter.style.display = "none";
      if (els.bcSepStudy) els.bcSepStudy.style.display = "none";
      if (els.bcStudy) els.bcStudy.style.display = "none";
    } else if (viewId === "chapter") {
      els.bcHome.classList.remove("active");
      if (els.bcSepCourse) els.bcSepCourse.style.display = "inline";
      if (els.bcCourse) {
        els.bcCourse.style.display = "inline";
        els.bcCourse.classList.remove("active");
      }
      if (els.bcSepChapter) els.bcSepChapter.style.display = "inline";
      if (els.bcChapter) {
        els.bcChapter.style.display = "inline";
        els.bcChapter.classList.add("active");
      }
      if (els.bcSepStudy) els.bcSepStudy.style.display = "none";
      if (els.bcStudy) els.bcStudy.style.display = "none";
    } else if (viewId === "study") {
      els.bcHome.classList.remove("active");
      if (els.bcSepCourse) els.bcSepCourse.style.display = "inline";
      if (els.bcCourse) {
        els.bcCourse.style.display = "inline";
        els.bcCourse.classList.remove("active");
      }
      if (els.bcSepChapter) els.bcSepChapter.style.display = "inline";
      if (els.bcChapter) {
        els.bcChapter.style.display = "inline";
        els.bcChapter.classList.remove("active");
      }
      if (els.bcSepStudy) els.bcSepStudy.style.display = "inline";
      if (els.bcStudy) els.bcStudy.style.display = "inline";
    }
  }

  function handleRouting() {
    const rawHash = window.location.hash || "#/";
    const [routePath, queryString] = rawHash.split("?");

    if (routePath === "#/" || routePath === "" || routePath === "#") {
      showView("home");
    } else if (routePath === "#/general-psychology") {
      showView("course");
    } else if (routePath === "#/general-psychology/chapter-7") {
      showView("chapter");
    } else if (routePath.startsWith("#/general-psychology/chapter-7/study") || routePath.startsWith("#/study")) {
      showView("study");
      if (queryString && queryString.includes("mode=quiz")) {
        switchMode("quiz");
      } else if (queryString && queryString.includes("mode=flashcards")) {
        switchMode("flashcards");
      }
    } else {
      // Fallback
      showView("home");
    }
  }

  // Event Listeners
  window.addEventListener("hashchange", handleRouting);

  if (els.modeFlashcardsBtn) els.modeFlashcardsBtn.addEventListener("click", () => switchMode("flashcards"));
  if (els.modeQuizBtn) els.modeQuizBtn.addEventListener("click", () => switchMode("quiz"));

  if (els.searchInput) els.searchInput.addEventListener("input", () => applyFilters(true));
  if (els.typeFilter) els.typeFilter.addEventListener("change", () => applyFilters(true));
  if (els.categoryFilter) els.categoryFilter.addEventListener("change", () => applyFilters(true));

  if (els.clearFiltersBtn) {
    els.clearFiltersBtn.addEventListener("click", () => {
      if (els.searchInput) els.searchInput.value = "";
      if (els.typeFilter) els.typeFilter.value = "all";
      if (els.categoryFilter) els.categoryFilter.value = "all";
      applyFilters(true);
    });
  }

  if (els.shuffleBtn) {
    els.shuffleBtn.addEventListener("click", () => {
      if (state.mode === "flashcards") {
        state.flashcardDeck = shuffleArray(state.flashcardDeck);
        state.flashcardIndex = 0;
        state.isFlipped = false;
        renderFlashcards();
      } else {
        state.quizDeck = shuffleArray(state.quizDeck);
        state.quizIndex = 0;
        state.quizAnswered = false;
        state.quizSelectedAnswer = null;
        renderQuiz();
      }
    });
  }

  if (els.resetBtn) {
    els.resetBtn.addEventListener("click", () => {
      if (confirm("Reset your study progress for Chapter 7?")) {
        state.progress = {};
        state.quizScore = { correct: 0, total: 0 };
        saveProgress();
        applyFilters(true);
      }
    });
  }

  // Flashcards interaction
  if (els.fcElement) els.fcElement.addEventListener("click", () => toggleFlip());
  if (els.fcNextBtn) els.fcNextBtn.addEventListener("click", nextFlashcard);
  if (els.fcPrevBtn) els.fcPrevBtn.addEventListener("click", prevFlashcard);
  if (els.fcGotItBtn) els.fcGotItBtn.addEventListener("click", () => markProgress("got-it"));
  if (els.fcReviewBtn) els.fcReviewBtn.addEventListener("click", () => markProgress("review"));

  // Quiz interaction
  if (els.quizNextBtn) els.quizNextBtn.addEventListener("click", nextQuizQuestion);
  if (els.quizSkipBtn) els.quizSkipBtn.addEventListener("click", nextQuizQuestion);

  // Keyboard Shortcuts
  document.addEventListener("keydown", (e) => {
    if (state.currentView !== "study") return;
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
  handleRouting();
})();
