// quality_gate.ts — pure-utility validation layer for the QuizVerse question pipeline.
//
// NO RPCs IN THIS FILE — utility namespace only.
// Called by question_cache.ts during the cache-refresh cycle, before any question
// is written to qv_cache_{topic}. Never called inline on a player request.
//
// ── API surface ───────────────────────────────────────────────────────────────
//
//   QvQualityGate.htmlDecode(text)
//     Decodes HTML entities (named, decimal, hex) from a raw provider string.
//     Safe to call on already-decoded text — idempotent.
//     No DOM, no XHR — pure string replacement, Goja-safe.
//
//   QvQualityGate.validateQuestion(q, seenTextSet)
//     Applies the 6 quality gates in order (see below).
//     ✦ Mutates q in-place: question_text and all option texts are HTML-decoded
//       before any gate runs. The stored question is always clean.
//     Returns: { valid, reject_reason }
//
//   QvQualityGate.buildSeenTextSet(questions)
//     Builds a plain-object lookup map (normalized_text → true) from an array
//     of already-validated questions. Pass this into validateQuestion() to detect
//     within-batch duplicates without O(n²) linear scans.
//
// ── The 6 quality gates ───────────────────────────────────────────────────────
//
//   GATE 0 — Preprocess (not a rejection gate, but precondition for all others)
//             Call htmlDecode() on question_text and every option text.
//             Also strip residual HTML tags (<br>, <b>, etc.) from the decoded
//             text; reject if any field still carries raw markup after stripping.
//
//   GATE 1 — question_text length
//             Reject if question_text is empty or has < MIN_Q_LEN visible chars
//             after trim+decode. Catches "?" or " " placeholder questions.
//
//   GATE 2 — minimum options
//             Reject if options[] has fewer than MIN_OPTIONS entries.
//             Single-option questions cannot be fair trivia.
//
//   GATE 3 — correct answer integrity
//             Reject if correct_option_ids is empty or contains any ID that is
//             not present in options[].id. Catches bad provider normalizations
//             where the answer key went missing or was mis-labelled.
//
//   GATE 4 — duplicate option texts
//             Reject if any two options share identical text after trim+lowercase.
//             Duplicate answer choices make the question trivially solvable.
//
//   GATE 5 — residual HTML / raw markup
//             Reject if question_text or any option text still contains a raw
//             HTML tag pattern (<tag> or </tag>) after entity decoding.
//             Catches providers that embed <br/>, <sup>, <em> etc. in content.
//
//   GATE 6 — duplicate question in pool
//             Reject if the question's copy key already exists in seenTextSet.
//             Text questions: normalized(question_text).
//             Media questions (has_media): provider_key, else media.url, else id.
//             ImageGuess templates share one prompt; uniqueness is image + options.
//
// ── Usage pattern in question_cache.ts ───────────────────────────────────────
//
//   var seenTexts = QvQualityGate.buildSeenTextSet([]);
//   var passed = 0, rejected = 0;
//   var topRejectReason: string | null = null;
//
//   for (var i = 0; i < rawQuestions.length; i++) {
//     var r = QvQualityGate.validateQuestion(rawQuestions[i], seenTexts);
//     if (!r.valid) {
//       rejected++;
//       if (!topRejectReason) topRejectReason = r.reject_reason;
//       continue;
//     }
//     // q is now decoded in-place — safe to add to pool
//     seenTexts[QvQualityGate.normalizeForDedup(rawQuestions[i].question_text)] = true;
//     pool.push(rawQuestions[i]);
//     passed++;
//   }

namespace QvQualityGate {

  // ── Constants ────────────────────────────────────────────────────────────

  var MIN_Q_LEN    = 10;   // minimum visible chars in question_text after decode+trim
  var MIN_OPTIONS  = 2;    // minimum answer options required

  // Raw-HTML-tag pattern: catches <br>, </p>, <strong class="x">, etc.
  // A simple check — not a full HTML parser, but sufficient for trivia content.
  var HTML_TAG_RE = /<\/?[a-zA-Z][^>]{0,100}>/;

  // ── Named HTML entity map ─────────────────────────────────────────────────
  // Covers entities commonly emitted by quiz providers (OpenTDB, TMDB, GNews…).
  // Ordered alphabetically by entity name for easy extension.

  var NAMED_ENTITIES: { [key: string]: string } = {
    "AElig":   "Æ",  "Aacute":  "Á",  "Acirc":   "Â",  "Agrave":  "À",
    "Aring":   "Å",  "Atilde":  "Ã",  "Auml":    "Ä",
    "Ccedil":  "Ç",
    "ETH":     "Ð",  "Eacute":  "É",  "Ecirc":   "Ê",  "Egrave":  "È",
    "Euml":    "Ë",
    "Iacute":  "Í",  "Icirc":   "Î",  "Igrave":  "Ì",  "Iuml":    "Ï",
    "Ntilde":  "Ñ",
    "Oacute":  "Ó",  "Ocirc":   "Ô",  "Ograve":  "Ò",  "Oslash":  "Ø",
    "Otilde":  "Õ",  "Ouml":    "Ö",
    "THORN":   "Þ",
    "Uacute":  "Ú",  "Ucirc":   "Û",  "Ugrave":  "Ù",  "Uuml":    "Ü",
    "Yacute":  "Ý",
    "aacute":  "á",  "acirc":   "â",  "aelig":   "æ",  "agrave":  "à",
    "amp":     "&",  "apos":    "'",  "aring":   "å",  "atilde":  "ã",
    "auml":    "ä",
    "bdquo":   "„",  "bull":    "•",
    "ccedil":  "ç",  "cedil":   "¸",  "cent":    "¢",  "copy":    "©",
    "curren":  "¤",
    "deg":     "°",  "divide":  "÷",
    "eacute":  "é",  "ecirc":   "ê",  "egrave":  "è",  "eth":     "ð",
    "euml":    "ë",
    "frac12":  "½",  "frac14":  "¼",  "frac34":  "¾",
    "gt":      ">",
    "hellip":  "…",
    "iacute":  "í",  "icirc":   "î",  "iexcl":   "¡",  "igrave":  "ì",
    "iquest":  "¿",  "iuml":    "ï",
    "laquo":   "«",  "ldquo":   "\u201C", "lsquo": "\u2018", "lt": "<",
    "macr":    "¯",  "mdash":   "—",  "micro":   "µ",  "middot":  "·",
    "nbsp":    " ",  "ndash":   "–",  "not":     "¬",  "ntilde":  "ñ",
    "oacute":  "ó",  "ocirc":   "ô",  "ograve":  "ò",  "ordf":    "ª",
    "ordm":    "º",  "oslash":  "ø",  "otilde":  "õ",  "ouml":    "ö",
    "para":    "¶",  "plusmn":  "±",  "pound":   "£",
    "quot":    "\"", "raquo":   "»",  "rdquo":   "\u201D", "reg": "®",
    "rsquo":   "\u2019",
    "sect":    "§",  "shy":     "",   "sup1":    "¹",  "sup2":    "²",
    "sup3":    "³",  "szlig":   "ß",
    "thorn":   "þ",  "times":   "×",  "trade":   "™",
    "uacute":  "ú",  "ucirc":   "û",  "ugrave":  "ù",  "uuml":    "ü",
    "uml":     "¨",
    "yacute":  "ý",  "yuml":    "ÿ",
    "yen":     "¥",
    // Pokémon-specific frequent entity
    "#039":    "'"
  };

  // ── Public: htmlDecode ────────────────────────────────────────────────────

  /**
   * Decode HTML entities in a raw provider string.
   * Handles: named entities (&amp; &eacute; …), decimal (&#160;), hex (&#xA0;).
   * Safe to call on already-clean strings — idempotent, no DOM required.
   */
  export function htmlDecode(text: string): string {
    if (!text || typeof text !== "string") return text || "";

    return text.replace(/&([^;\s]{1,12});/g, function(_full: string, entity: string): string {

      // ── Numeric entity ─────────────────────────────────────────────
      if (entity.charAt(0) === "#") {
        var inner = entity.substring(1);
        var code: number;
        if (inner.charAt(0) === "x" || inner.charAt(0) === "X") {
          code = parseInt(inner.substring(1), 16);
        } else {
          code = parseInt(inner, 10);
        }
        if (!isNaN(code) && code > 0 && code < 0x110000) {
          // ES5 fromCharCode is safe for BMP; surrogate pair for SMP
          if (code < 0x10000) return String.fromCharCode(code);
          // Surrogate pair for code points > U+FFFF
          var offset = code - 0x10000;
          return String.fromCharCode(0xD800 + (offset >> 10), 0xDC00 + (offset & 0x3FF));
        }
        return _full;
      }

      // ── Named entity ──────────────────────────────────────────────
      var replacement = NAMED_ENTITIES[entity];
      return replacement !== undefined ? replacement : _full;
    });
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Strip residual raw HTML tags after entity decoding.
   * Returns the stripped text so callers can detect if anything was removed.
   */
  function stripHtmlTags(text: string): string {
    // Two-pass: remove self-closing, then open/close tags.
    return text
      .replace(/<[a-zA-Z][^>]{0,200}\/>/g, "")   // <br/> <img ... />
      .replace(/<\/[a-zA-Z][^>]{0,100}>/g, "")    // </p> </strong>
      .replace(/<[a-zA-Z][^>]{0,200}>/g,  "");    // <p> <strong class="x">
  }

  /**
   * Normalize text for deduplication comparison:
   * lowercase → collapse whitespace → trim.
   * Not used for display — only for equality checks.
   */
  export function normalizeForDedup(text: string): string {
    if (!text) return "";
    return text.toLowerCase().replace(/\s+/g, " ").trim();
  }

  /**
   * Dedup key for GATE 6 and buildSeenTextSet.
   * Media questions share template prompts — key on provider_key / media.url instead.
   */
  export function questionDedupeKey(q: any): string {
    if (q && q.has_media === true) {
      if (q.provider_key && typeof q.provider_key === "string") {
        return normalizeForDedup("media_pk:" + q.provider_key);
      }
      if (q.media && q.media.url && typeof q.media.url === "string") {
        return normalizeForDedup("media_url:" + q.media.url);
      }
      if (q.id && typeof q.id === "string") {
        return normalizeForDedup("media_id:" + q.id);
      }
    }
    var qText = (q && q.question_text && typeof q.question_text === "string")
      ? q.question_text : "";
    return normalizeForDedup(qText);
  }

  /**
   * Decode HTML entities in question_text and every option text, in-place.
   * Also strips residual raw HTML tags and returns whether any stripping occurred.
   */
  function decodeQuestion(q: any): { hadEntities: boolean; hadTags: boolean } {
    var hadEntities = false;
    var hadTags     = false;

    // question_text
    if (q.question_text && typeof q.question_text === "string") {
      var decoded = htmlDecode(q.question_text);
      if (decoded !== q.question_text) hadEntities = true;
      var stripped = stripHtmlTags(decoded);
      if (stripped !== decoded) hadTags = true;
      q.question_text = stripped.trim();
    }

    // explanation (best-effort clean — not a gate, but keep storage tidy)
    if (q.explanation && typeof q.explanation === "string") {
      var decEx = htmlDecode(q.explanation);
      q.explanation = stripHtmlTags(decEx).trim();
    }

    // options[].text
    if (q.options && Array.isArray(q.options)) {
      for (var i = 0; i < q.options.length; i++) {
        var opt = q.options[i];
        if (opt && typeof opt.text === "string") {
          var decOpt  = htmlDecode(opt.text);
          if (decOpt !== opt.text) hadEntities = true;
          var stripOpt = stripHtmlTags(decOpt);
          if (stripOpt !== decOpt) hadTags = true;
          opt.text = stripOpt.trim();
        }
      }
    }

    return { hadEntities: hadEntities, hadTags: hadTags };
  }

  // ── Public: buildSeenTextSet ──────────────────────────────────────────────

  /**
   * Build a plain-object lookup set from an existing pool of validated questions.
   * Use this for O(1) duplicate detection inside validateQuestion().
   *
   * Start with an empty set for a fresh batch, or seed it with an existing pool
   * when appending to an already-populated cache doc:
   *
   *   var seen = QvQualityGate.buildSeenTextSet(existingPoolQuestions);
   *   // then call validateQuestion(q, seen) for each new candidate
   */
  export function buildSeenTextSet(questions: any[]): { [key: string]: boolean } {
    var set: { [key: string]: boolean } = {};
    if (!questions || !Array.isArray(questions)) return set;
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      if (q) {
        set[questionDedupeKey(q)] = true;
      }
    }
    return set;
  }

  // ── Public: validateQuestion ──────────────────────────────────────────────

  /**
   * Run all 6 quality gates against a single candidate question.
   *
   * ✦ SIDE EFFECT: q.question_text and q.options[].text are HTML-decoded
   *   in-place before any gate runs. This is intentional — the caller receives
   *   a cleaned question ready for storage without needing a second decode pass.
   *
   * @param q           Raw (provider-normalised) question object.
   * @param seenTextSet Plain-object set returned by buildSeenTextSet().
   *                    Caller is responsible for adding accepted questions to
   *                    the set AFTER this function returns valid=true.
   * @returns           { valid, reject_reason }
   *                    reject_reason is null when valid=true.
   */
  export function validateQuestion(
    q:           any,
    seenTextSet: { [key: string]: boolean }
  ): { valid: boolean; reject_reason: string | null } {

    // ── Guard: malformed input ────────────────────────────────────────────
    if (!q || typeof q !== "object") {
      return { valid: false, reject_reason: "null_or_non_object_question" };
    }

    // ══════════════════════════════════════════════════════════════════════
    // GATE 0 — Preprocess: HTML decode + strip raw tags (in-place mutation)
    // Must run before all other gates so every comparison sees clean text.
    // ══════════════════════════════════════════════════════════════════════
    var decodeResult = decodeQuestion(q);
    void decodeResult; // result available for logging if caller wants it

    // ══════════════════════════════════════════════════════════════════════
    // GATE 1 — question_text length
    // ══════════════════════════════════════════════════════════════════════
    var qText: string = (q.question_text && typeof q.question_text === "string")
      ? q.question_text.trim() : "";

    if (qText.length === 0) {
      return { valid: false, reject_reason: "empty_question_text" };
    }
    if (qText.length < MIN_Q_LEN) {
      return { valid: false, reject_reason: "question_text_too_short:" + qText.length + "ch" };
    }

    // ══════════════════════════════════════════════════════════════════════
    // GATE 2 — minimum options count
    // ══════════════════════════════════════════════════════════════════════
    var options: any[] = (q.options && Array.isArray(q.options)) ? q.options : [];

    if (options.length < MIN_OPTIONS) {
      return { valid: false, reject_reason: "too_few_options:" + options.length };
    }

    // ══════════════════════════════════════════════════════════════════════
    // GATE 3 — correct answer integrity
    // correct_option_ids must be non-empty and every ID must exist in options
    // ══════════════════════════════════════════════════════════════════════
    var correctIds: any[] = (q.correct_option_ids && Array.isArray(q.correct_option_ids))
      ? q.correct_option_ids : [];

    if (correctIds.length === 0) {
      return { valid: false, reject_reason: "no_correct_option_ids" };
    }

    // Build an O(1) lookup of valid option IDs
    var optionIdSet: { [key: string]: boolean } = {};
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      if (opt && opt.id != null) {
        optionIdSet[String(opt.id)] = true;
      }
    }

    for (var ci = 0; ci < correctIds.length; ci++) {
      var cid = String(correctIds[ci]);
      if (!optionIdSet[cid]) {
        return { valid: false, reject_reason: "correct_id_not_in_options:" + cid };
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // GATE 4 — duplicate option texts
    // Reject if any two options share the same text (trim + lowercase)
    // ══════════════════════════════════════════════════════════════════════
    var seenOptionTexts: { [key: string]: boolean } = {};

    for (var oi = 0; oi < options.length; oi++) {
      var optText = options[oi] && typeof options[oi].text === "string"
        ? options[oi].text.trim().toLowerCase()
        : "";
      if (!optText) {
        return { valid: false, reject_reason: "empty_option_text:index_" + oi };
      }
      if (seenOptionTexts[optText]) {
        return { valid: false, reject_reason: "duplicate_option_text:" + optText.substring(0, 40) };
      }
      seenOptionTexts[optText] = true;
    }

    // ══════════════════════════════════════════════════════════════════════
    // GATE 5 — residual raw HTML tags
    // Reject if question_text or any option text still contains HTML markup
    // after entity decoding (e.g. <br>, <strong>, <sup> from providers).
    // ══════════════════════════════════════════════════════════════════════
    if (HTML_TAG_RE.test(q.question_text)) {
      return {
        valid: false,
        reject_reason: "raw_html_in_question:" + q.question_text.substring(0, 60)
      };
    }

    for (var ti = 0; ti < options.length; ti++) {
      var tOpt = options[ti];
      if (tOpt && typeof tOpt.text === "string" && HTML_TAG_RE.test(tOpt.text)) {
        return {
          valid: false,
          reject_reason: "raw_html_in_option_" + ti + ":" + tOpt.text.substring(0, 40)
        };
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // GATE 6 — duplicate question in pool
    // Text: normalized question_text. Media: provider_key / media.url / id.
    // ══════════════════════════════════════════════════════════════════════
    var dedupeKey = questionDedupeKey(q);
    if (seenTextSet[dedupeKey]) {
      return { valid: false, reject_reason: "duplicate_question_text" };
    }

    // ── All gates passed ──────────────────────────────────────────────────
    return { valid: true, reject_reason: null };
  }

  // ── Public: batchValidate ─────────────────────────────────────────────────

  /**
   * Validate an entire array of raw questions in one call.
   * Builds the seen-text set internally (starting empty) so callers don't have
   * to manage it when processing a fresh provider response from scratch.
   *
   * Returns only the questions that passed all 6 gates, plus quality stats
   * suitable for writing into the qv_cache_{topic} quality_gate object.
   *
   * If you are appending to an existing pool, use buildSeenTextSet() +
   * validateQuestion() in a manual loop instead (to seed with existing texts).
   *
   * @param questions   Array of raw normalized question objects.
   * @param logger      Optional Nakama logger for reject-reason debug lines.
   * @param topicTag    Short label used in log lines (e.g. "anime").
   */
  export function batchValidate(
    questions: any[],
    logger?:   nkruntime.Logger,
    topicTag?: string
  ): {
    passed:            any[];
    rejected_count:    number;
    total_processed:   number;
    top_reject_reason: string | null;
  } {
    var passed:   any[]         = [];
    var rejected  = 0;
    var topReason: string | null = null;
    var seen                    = buildSeenTextSet([]);
    var tag                     = topicTag || "unknown";

    if (!questions || !Array.isArray(questions)) {
      return {
        passed:            [],
        rejected_count:    0,
        total_processed:   0,
        top_reject_reason: null
      };
    }

    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      var result = validateQuestion(q, seen);

      if (!result.valid) {
        rejected++;
        if (!topReason) topReason = result.reject_reason;
        if (logger) {
          logger.debug("[QvQualityGate/" + tag + "] reject[" + i + "]: " +
            (result.reject_reason || "unknown"));
        }
        continue;
      }

      // Gate passed: add to seen set to catch within-batch duplicates
      seen[questionDedupeKey(q)] = true;
      passed.push(q);
    }

    return {
      passed:            passed,
      rejected_count:    rejected,
      total_processed:   questions.length,
      top_reject_reason: topReason
    };
  }
}
