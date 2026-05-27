// =============================================================================
// topic_catalog.ts — Tournament topic → content-factory mapping
//
// Plan ref: §1B (launch slate topics) + §1G (content pipeline). Maps each
// tournament's `topic_tag` to:
//   - exam_board string for content-factory ExamPrepBundle pipeline
//   - language defaults
//   - learning series video script prompts
//
// Why this exists: tournament_economy.ts owns the *economic* parameters of a
// tournament; this file owns the *content* parameters. A weekly tournament's
// economy is fixed but its content rotates (Brain Bowl Wk1 = Science, Wk2 =
// History, etc.); the catalog encodes that rotation.
// =============================================================================

namespace TournamentTopicCatalog {

  export interface TopicEntry {
    tag: string;                   // matches TournamentConfig.topic_tag
    exam_board: string;            // passed to content-factory's exam_prep_bundle
    concept: string;               // high-level subject prompt
    learning_series_prompts: string[];  // 6 video script prompts (AMOE unlock = 6/6)
    rotation?: string[];           // if present, weekly cron rotates through these tags
    languages_supported: string[]; // ISO-639-1 codes; default ["en"]
  }

  // The 12-language matrix we backfill across (matches en.json + 11 locales
  // from web/lib/locales). content-factory will localize each pack.
  const LANG_12 = ["en", "es", "hi", "pt", "fr", "de", "ja", "ko", "zh", "ar", "ru", "id"];

  const CATALOG: { [tag: string]: TopicEntry } = {
    // ── Generic learner tracks ──
    "general_knowledge": {
      tag: "general_knowledge",
      exam_board: "General Knowledge",
      concept: "General knowledge across science, history, geography, current affairs, pop culture",
      learning_series_prompts: [
        "Top 10 facts about the solar system most people get wrong",
        "Why did the Roman Empire fall? The 3 biggest misconceptions",
        "Geography quirks: countries that don't have rivers, capitals on coastlines",
        "How the internet actually works in 90 seconds",
        "Three Oscar-winning films that changed cinema forever",
        "The science of how memories form — and why we forget them",
      ],
      languages_supported: LANG_12,
    },
    "brain_bowl_science": {
      tag: "brain_bowl_science",
      exam_board: "Science Quiz",
      concept: "Cross-disciplinary science: physics, biology, chemistry, earth science, computer science",
      learning_series_prompts: [
        "Why is the sky blue? The Rayleigh scattering explanation",
        "How DNA replication actually works — the lock-and-key story",
        "What is entropy? The 2nd law of thermodynamics for non-physicists",
        "The discovery of penicillin — the messy mold story",
        "How does a transistor work? The basis of every device you own",
        "What is dark matter? Why scientists are 95% sure it exists",
      ],
      rotation: ["brain_bowl_science", "brain_bowl_history", "brain_bowl_geography", "brain_bowl_tech"],
      languages_supported: LANG_12,
    },
    "brain_bowl_history": {
      tag: "brain_bowl_history",
      exam_board: "History Quiz",
      concept: "World history covering ancient civilizations through modern era",
      learning_series_prompts: [
        "The Silk Road in 6 minutes — how it connected three continents",
        "Why did WWI start? The 5 dominoes",
        "The Library of Alexandria — what we lost when it burned",
        "How the printing press changed civilization more than the internet",
        "The 100 Years War — actually 116 years, here's why",
        "Decolonization in 90 seconds — the wave that reshaped the 20th century",
      ],
      languages_supported: LANG_12,
    },
    "brain_bowl_geography": {
      tag: "brain_bowl_geography",
      exam_board: "Geography Quiz",
      concept: "Physical and political geography, capitals, landmarks, biomes",
      learning_series_prompts: [
        "Why does Africa look smaller on world maps than it actually is",
        "The 7 most extreme places on Earth — and the people who live there",
        "How rivers shaped every major civilization",
        "Time zones explained — including the weirdest ones",
        "The Ring of Fire — why 75% of volcanoes cluster here",
        "How a country becomes a country (and what 'recognition' actually means)",
      ],
      languages_supported: LANG_12,
    },
    "brain_bowl_tech": {
      tag: "brain_bowl_tech",
      exam_board: "Technology Quiz",
      concept: "Computing, internet, AI, hardware, software history",
      learning_series_prompts: [
        "How a search engine actually finds a webpage in 0.2 seconds",
        "Public-key cryptography — how Alice talks to Bob without anyone listening",
        "Moore's Law — what it actually said and why it broke",
        "How GPS works — the relativity correction nobody mentions",
        "What is a database transaction? ACID for non-engineers",
        "How large language models work — token by token",
      ],
      languages_supported: LANG_12,
    },
    "movies_tv": {
      tag: "movies_tv",
      exam_board: "Movies and TV",
      concept: "Films, TV shows, directors, actors, soundtracks, Oscar history",
      learning_series_prompts: [
        "Why The Godfather is the most-studied film in cinema schools",
        "The 5 directors who reshaped the 1970s",
        "How Christopher Nolan structures time — Memento to Tenet",
        "Why the MCU's Phase 1 worked and Phase 4 didn't",
        "The Oscars best-picture upsets that aged the worst",
        "How streaming changed which movies even get made",
      ],
      languages_supported: LANG_12,
    },
    "mixed_difficulty": {
      tag: "mixed_difficulty",
      exam_board: "Mixed Trivia",
      concept: "Pick-5 style: 5 stand-alone questions across categories with calibrated difficulty",
      learning_series_prompts: [
        "How to think about probability when you have 5 picks",
        "The Monty Hall problem — why switching wins",
        "Bayes' theorem in everyday decisions",
        "Why most polls are wrong by more than their margin of error",
        "The expected-value mindset — how poker pros think",
        "Streak math — why long winning streaks aren't 'overdue' to end",
      ],
      languages_supported: LANG_12,
    },
    // ── Exam-prep tracks (US-focused for high-LTV) ──
    "exam_sat": {
      tag: "exam_sat",
      exam_board: "SAT",
      concept: "SAT Math, Reading, Writing prep — College Board format, current digital SAT spec",
      learning_series_prompts: [
        "SAT Math: the 5 question patterns that cover 60% of the test",
        "SAT Reading: how to read a passage in 90 seconds and still answer all 11 questions",
        "SAT Writing: comma rules cheat sheet",
        "Linear equations on the digital SAT — the 3 forms you'll see",
        "Data analysis on the SAT — reading scatterplots and two-way tables",
        "How to manage time on the digital SAT — pacing per module",
      ],
      languages_supported: ["en"],
    },
    "exam_act": {
      tag: "exam_act",
      exam_board: "ACT",
      concept: "ACT English, Math, Reading, Science sections",
      learning_series_prompts: [
        "ACT Science: how to skip the passage and still get the answer",
        "ACT Math: the 4 topics that dominate the test",
        "ACT English: punctuation rules ranked by frequency",
        "ACT Reading: how to handle 4 passages in 35 minutes",
        "Trigonometry on the ACT — the 3 patterns",
        "ACT pacing strategy by section",
      ],
      languages_supported: ["en"],
    },
    "exam_ap_general": {
      tag: "exam_ap_general",
      exam_board: "AP General Prep",
      concept: "Cross-AP test prep covering writing FRQs, time management, score interpretation",
      learning_series_prompts: [
        "How AP scores are actually scaled — the curve explained",
        "FRQ template that works across AP Stats, Psych, and Econ",
        "How to structure an AP English essay in 40 minutes",
        "AP Calculus AB vs BC — the topics that overlap",
        "AP score release strategy — when to retake, when to submit",
        "AP Lang vs AP Lit — picking the right one",
      ],
      languages_supported: ["en"],
    },
    "exam_neet": {
      tag: "exam_neet",
      exam_board: "NEET",
      concept: "NEET India: biology (botany + zoology), chemistry (organic, inorganic, physical), physics",
      learning_series_prompts: [
        "NEET Biology: the 5 chapters that contribute 40% of marks",
        "NEET Chemistry: organic conversions you must memorize",
        "NEET Physics: thermodynamics formula sheet",
        "Plant kingdom classification — the dichotomous key",
        "Coordination compounds — naming + isomerism",
        "Modern physics for NEET — Bohr to photoelectric",
      ],
      languages_supported: ["en", "hi"],
    },
    "exam_jee": {
      tag: "exam_jee",
      exam_board: "JEE Main",
      concept: "JEE Main: mathematics, physics, chemistry — Indian engineering entrance",
      learning_series_prompts: [
        "JEE Maths: integration techniques ranked by frequency",
        "JEE Physics: rotational mechanics in 6 minutes",
        "JEE Chemistry: organic reaction mechanisms cheat sheet",
        "Coordinate geometry shortcuts for JEE",
        "Electrostatics — Gauss's law applied",
        "Thermochemistry — Hess's law worked examples",
      ],
      languages_supported: ["en", "hi"],
    },
    "exam_gmat": {
      tag: "exam_gmat",
      exam_board: "GMAT",
      concept: "GMAT: verbal (CR, RC, SC), quantitative, integrated reasoning, data sufficiency",
      learning_series_prompts: [
        "GMAT Sentence Correction: the 7 grammar rules tested",
        "GMAT Critical Reasoning: assumption vs strengthen vs weaken",
        "Data Sufficiency: the C trap and how to avoid it",
        "GMAT Quant: number properties cheat sheet",
        "GMAT pacing — when to guess and move on",
        "Integrated Reasoning: how it's scored and why it matters less than Quant/Verbal",
      ],
      languages_supported: ["en"],
    },
  };

  export function getEntry(tag: string): TopicEntry | null {
    return CATALOG[tag] || null;
  }

  // Returns the current-week tag for rotating tournaments (e.g. brain_bowl
  // cycles through science → history → geography → tech weekly).
  export function getRotatedTag(baseTag: string, weekNum: number): string {
    var entry = CATALOG[baseTag];
    if (!entry || !entry.rotation || entry.rotation.length === 0) return baseTag;
    return entry.rotation[weekNum % entry.rotation.length];
  }

  export function listAllTags(): string[] {
    var out: string[] = [];
    for (var k in CATALOG) if (CATALOG.hasOwnProperty(k)) out.push(k);
    return out;
  }
}
