// per-exam-config.ts
// ─────────────────────────────────────────────────────────────────────────────
// QuizVerse Learner Toolbelt — per-exam predictor configuration table.
//
// This table is the dispatcher metadata consumed by lt_score_predict so that
// every USA + India high-volume exam returns the right { method, phase,
// score_range } envelope BEFORE the wave-4/5 algorithm work lands. Web routes
// (Wave-3) and the gateway ToolDispatcher (Wave-6) wire against this contract
// and never need to change again once individual algorithms ship.
//
// Plan source of truth:
//   intelliverse-x-games-platform-2/games/quiz-verse/Docs/plans/
//     PLAN-LEARNER_TOOLBELT.md  §3.10 (per-exam coverage matrix)
//                               §12   (Firecrawl-verified citations)
//
// Coverage (21 exams)
// -------------------
//   USA (10):  sat · act · ap_exams · psat · gre · gmat · mcat · lsat ·
//              amc · bar_exam
//   IN  (11):  jee_main · jee_advanced · neet · cat · gate · upsc_cse ·
//              clat · cuet · nda · ssc_cgl · rbi_grade_b
//
// Phase labelling (per PLAN-LEARNER_TOOLBELT §3.10):
//   A — Week-4 launch    (SAT, AP Bio/Calc, JEE Main, JEE Advanced, NEET)
//   B — Weeks 5-8        (ACT, PSAT, GRE, GMAT, +remaining AP × 36, CAT,
//                         GATE, UPSC, CLAT, CUET)
//   C — Q4 2026          (MCAT, LSAT, AMC, Bar, NDA, SSC CGL, RBI Grade-B)
//
// Long-tail exams not in this table fall through to the Bayes fallback
// predictor (method: 'bayes-fallback') — so the predictor is NEVER silent.
//
// Use TypeScript namespaces here (NOT ES modules) because the modules/
// tsconfig outputs a single concatenated bundle (outFile mode). Every public
// symbol must live under a namespace to participate in the global scope the
// Nakama Goja runtime sees at boot.

namespace PerExamConfig {

  export type PredictorMethod =
    | 'irt-2pl'
    | 'concordance'
    | 'ap-composite'
    | 'irt-section-adaptive'
    | 'irt-focus-edition'
    | 'percentile-4section'
    | 'raw-to-scaled-120-180'
    | 'cutoff-band'
    | 'mbe-mee-mpt-composite'
    | 'nta-percentile-to-air'
    | 'marks-vs-rank-curve'
    | 'section-percentile-to-oa'
    | 'gate-score-formula'
    | 'prelims-cutoff-band'
    | 'marks-to-nlu-rank'
    | 'nta-percentile-multisubject'
    | 'written-cutoff-only'
    | 'tier-1-2-composite'
    | 'phase-1-2-cutoff'
    | 'bayes-fallback'
    | 'uk-boundary';

  export type PredictorPhase = 'A' | 'B' | 'C';

  export interface ExamSection {
    id: string;
    max: number;
    weight?: number;
  }

  export interface ExamPredictorConfig {
    method: PredictorMethod;
    phase: PredictorPhase;
    /** ISO-3166 alpha-2 default country (for diaspora users we still honour
     *  per-call locale + country query params; this is just the *exam* origin). */
    countryDefault: string;
    /** [min, max] inclusive of the published scale. */
    scoreRange: [number, number];
    /** Sections this exam has (e.g. SAT = math+verbal, JEE Main = phy+chem+math).
     *  Empty array is acceptable for composite-only exams. */
    sections: ExamSection[];
    /** Public source URLs cited in plan §3.10 / §12. */
    citations: string[];
    /** ISO date of the last calibration data refresh (optional — populated when
     *  the per-exam algorithm lands in wave 4-5). */
    lastCalibration?: string;
    /** Goal-rank tiers used by the §3.5 context block — e.g. for JEE we surface
     *  ['IIT', 'NIT', 'IIIT', 'private']. */
    goalTiers?: string[];
  }

  // ── 21 supported exams (USA × 10 + India × 11) ───────────────────────────
  export var CONFIG: { [examId: string]: ExamPredictorConfig } = {

    // ============================================================== USA (10)

    sat: {
      method: 'irt-2pl',
      phase: 'A',
      countryDefault: 'US',
      scoreRange: [400, 1600],
      sections: [
        { id: 'math', max: 800 },
        { id: 'reading_writing', max: 800 },
      ],
      citations: [
        'https://satsuite.collegeboard.org/scores/what-scores-mean/how-scores-calculated',
        'https://mathchops.substack.com/p/item-response-theory-and-the-digital-sat',
        'https://mindfish.com/blog/what-is-item-response-theory/',
      ],
      goalTiers: ['ivy', 't20', 't50', 'state-flagship', 'community-college'],
    },

    act: {
      method: 'concordance',
      phase: 'B',
      countryDefault: 'US',
      scoreRange: [1, 36],
      sections: [
        { id: 'english', max: 36 },
        { id: 'math', max: 36 },
        { id: 'reading', max: 36 },
        { id: 'science', max: 36 },
      ],
      citations: [
        'https://www.act.org/content/act/en/products-and-services/the-act/scores/act-sat-concordance.html',
        'https://www.albert.io/blog/act-score-calculator/',
        'https://test-ninjas.com/act-score-calculator',
      ],
      goalTiers: ['ivy', 't20', 't50', 'state-flagship', 'community-college'],
    },

    ap_exams: {
      method: 'ap-composite',
      phase: 'A',
      countryDefault: 'US',
      scoreRange: [1, 5],
      // AP papers vary by subject but every paper has MCQ + FRQ. Per-subject
      // section weights are looked up at runtime from the wave-5 ap-curves S3
      // blob; the sections list here is the generic skeleton.
      sections: [
        { id: 'mcq', max: 100, weight: 0.5 },
        { id: 'frq', max: 100, weight: 0.5 },
      ],
      citations: [
        'https://test-ninjas.com/ap-score-calculators',
        'https://www.albert.io/blog/ap-calculus-bc-score-calculator/',
        'https://knowt.com/exams/AP/score-calculator',
      ],
      goalTiers: ['5', '4', '3', '2', '1'],
    },

    psat: {
      method: 'irt-2pl',
      phase: 'B',
      countryDefault: 'US',
      scoreRange: [320, 1520],
      sections: [
        { id: 'math', max: 760 },
        { id: 'reading_writing', max: 760 },
      ],
      citations: [
        'https://satsuite.collegeboard.org/scores/what-scores-mean/how-scores-calculated',
        'https://mindfish.com/blog/what-is-item-response-theory/',
      ],
      goalTiers: ['national-merit', 'commended', 'state-recognized', 'practice'],
    },

    gre: {
      method: 'irt-section-adaptive',
      phase: 'B',
      countryDefault: 'US',
      scoreRange: [130, 170],
      sections: [
        { id: 'verbal', max: 170 },
        { id: 'quant', max: 170 },
        { id: 'awa', max: 6 },
      ],
      citations: [
        'https://magoosh.com/gre/score-calculator-how-to-predict-your-gre-score/',
        'https://www.kaptest.com/study/gre/gre-score-predictor-whats-your-gre-score/',
        'https://www.prepscholar.com/gre/blog/gre-score-range/',
      ],
      goalTiers: ['t10-grad', 't25-grad', 't50-grad', 'regional-grad'],
    },

    gmat: {
      method: 'irt-focus-edition',
      phase: 'B',
      countryDefault: 'US',
      scoreRange: [205, 805],
      sections: [
        { id: 'quant', max: 90 },
        { id: 'verbal', max: 90 },
        { id: 'data_insights', max: 90 },
      ],
      citations: [
        'https://test-ninjas.com/gmat-focus-edition-score-calculator',
        'https://www.gmac.com/gmat-other-assessments/about-the-gmat-focus-edition/exam-scores',
        'https://gmat.targettestprep.com/gmat_focus_score_chart_and_calculator',
      ],
      goalTiers: ['m7', 't10-mba', 't25-mba', 't50-mba', 'regional-mba'],
    },

    mcat: {
      method: 'percentile-4section',
      phase: 'C',
      countryDefault: 'US',
      scoreRange: [472, 528],
      sections: [
        { id: 'cpbs', max: 132 }, // Chem/Phys Bio Systems
        { id: 'cars', max: 132 }, // Critical Analysis/Reasoning
        { id: 'bbls', max: 132 }, // Bio/Biochem Living Systems
        { id: 'psbb', max: 132 }, // Psych/Soc Behaviour
      ],
      citations: [
        'https://bootcamp.com/mcat/mcat-score-calculator',
        'https://www.kaptest.com/study/mcat/whats-a-good-mcat-score/',
        'https://www.reddit.com/r/Mcat/comments/uwmkow/comprehensive_mcat_score_prediction_tool/',
      ],
      goalTiers: ['t10-med', 't25-med', 't50-med', 'do-school', 'caribbean'],
    },

    lsat: {
      method: 'raw-to-scaled-120-180',
      phase: 'C',
      countryDefault: 'US',
      scoreRange: [120, 180],
      sections: [
        { id: 'logical_reasoning', max: 25 },
        { id: 'reading_comprehension', max: 27 },
        { id: 'analytical_reasoning', max: 23 },
      ],
      citations: [
        'https://7sage.com/lsat-resources/lsat-score-calculator',
        'https://magoosh.com/lsat/lsat-score-conversion-table/',
      ],
      goalTiers: ['t14-law', 't50-law', 't100-law', 'regional-law'],
    },

    amc: {
      method: 'cutoff-band',
      phase: 'C',
      countryDefault: 'US',
      scoreRange: [0, 150],
      sections: [
        { id: 'amc_10_12', max: 150 },
        { id: 'aime', max: 15 },
      ],
      citations: [
        'https://maa.org/news/2025-26-aime-thresholds-are-now-available/',
        'https://artofproblemsolving.com/wiki/index.php/AMC_historical_results',
      ],
      goalTiers: ['usamo', 'usajmo', 'aime-qual', 'amc-distinguished', 'participant'],
    },

    bar_exam: {
      method: 'mbe-mee-mpt-composite',
      phase: 'C',
      countryDefault: 'US',
      scoreRange: [200, 400],
      sections: [
        { id: 'mbe', max: 200, weight: 0.5 },
        { id: 'mee', max: 200, weight: 0.3 },
        { id: 'mpt', max: 200, weight: 0.2 },
      ],
      citations: [
        'https://www.ncbex.org/exams/ube/ube-minimum-scores',
        'https://jdadvising.com/what-mbe-raw-score-is-passing/',
      ],
      goalTiers: ['pass-strict-280', 'pass-typical-266-275', 'pass-low-260', 'fail'],
    },

    // ============================================================== IN  (11)

    jee_main: {
      method: 'nta-percentile-to-air',
      phase: 'A',
      countryDefault: 'IN',
      scoreRange: [0, 300],
      sections: [
        { id: 'physics', max: 100 },
        { id: 'chemistry', max: 100 },
        { id: 'mathematics', max: 100 },
      ],
      citations: [
        'https://www.vedantu.com/jee-main/rank-predictor',
        'https://allen.in/jee-main/percentile-predictor',
        'https://cracku.in/jee-advanced-score-calculator',
      ],
      goalTiers: ['iit-eligible', 'nit-top10', 'nit', 'iiit', 'gfti', 'private'],
    },

    jee_advanced: {
      method: 'marks-vs-rank-curve',
      phase: 'A',
      countryDefault: 'IN',
      scoreRange: [0, 360],
      sections: [
        { id: 'paper1_physics', max: 60 },
        { id: 'paper1_chemistry', max: 60 },
        { id: 'paper1_mathematics', max: 60 },
        { id: 'paper2_physics', max: 60 },
        { id: 'paper2_chemistry', max: 60 },
        { id: 'paper2_mathematics', max: 60 },
      ],
      citations: [
        'https://my.newtonschool.co/jee-college-predictor-by-iit-roorkee-alumni-and-nst-students/jee-college-predictor',
        'https://cracku.in/jee-advanced-score-calculator',
      ],
      goalTiers: ['iit-bombay-cs', 'iit-top5', 'iit-newer', 'iiser'],
    },

    neet: {
      method: 'nta-percentile-to-air',
      phase: 'A',
      countryDefault: 'IN',
      scoreRange: [0, 720],
      sections: [
        { id: 'physics', max: 180 },
        { id: 'chemistry', max: 180 },
        { id: 'biology', max: 360 }, // Botany + Zoology combined
      ],
      citations: [
        'https://www.vedantu.com/jee-main/rank-predictor',
        'https://allen.in/jee-main/percentile-predictor',
      ],
      goalTiers: ['aiims-delhi', 'aiims-other', 'jipmer', 'state-govt-mbbs', 'private-mbbs', 'bds'],
    },

    cat: {
      method: 'section-percentile-to-oa',
      phase: 'B',
      countryDefault: 'IN',
      scoreRange: [0, 198],
      sections: [
        { id: 'varc', max: 66 },
        { id: 'dilr', max: 66 },
        { id: 'qa', max: 66 },
      ],
      citations: [
        'https://cracku.in/iim-call-predictor',
        'https://www.toprankers.com/cat-cut-off-for-iim',
      ],
      goalTiers: ['iim-abc', 'iim-blackjack', 'new-iim', 'tier1-private', 'tier2-private'],
    },

    gate: {
      method: 'gate-score-formula',
      phase: 'B',
      countryDefault: 'IN',
      scoreRange: [0, 1000],
      sections: [
        { id: 'general_aptitude', max: 15 },
        { id: 'engineering_math', max: 13 },
        { id: 'subject', max: 72 },
      ],
      citations: [
        'https://margdarshanprep.com/Collegepredictor/collegepredictor.html',
        'https://testbook.com/gate/minimum-gate-score-for-iit',
      ],
      goalTiers: ['iit-mtech', 'iisc', 'nit-mtech', 'psu-recruitment', 'phd-eligible'],
    },

    upsc_cse: {
      method: 'prelims-cutoff-band',
      phase: 'B',
      countryDefault: 'IN',
      scoreRange: [0, 200],
      sections: [
        { id: 'gs_paper_1', max: 200 },
        { id: 'csat_paper_2', max: 200 }, // qualifying (33%)
      ],
      citations: [
        'https://www.pw.live/upsc/exams/upsc-prelims-expected-cut-off-2026',
        'https://www.nextias.com/prelims-cut-off-predictor',
      ],
      goalTiers: ['ias', 'ips', 'ifs', 'irs', 'group-b'],
    },

    clat: {
      method: 'marks-to-nlu-rank',
      phase: 'B',
      countryDefault: 'IN',
      scoreRange: [0, 150],
      sections: [
        { id: 'english', max: 30 },
        { id: 'gk_current_affairs', max: 38 },
        { id: 'legal_reasoning', max: 38 },
        { id: 'logical_reasoning', max: 28 },
        { id: 'quantitative_techniques', max: 16 },
      ],
      citations: [
        'https://law.careers360.com/clat-college-predictor',
        'https://www.clatnlti.com/blog-details/397/clat-2026-marks-cut-off-expected-cut-off-for-top-nlus',
      ],
      goalTiers: ['nlsiu-bangalore', 'nalsar-nujs', 'top5-nlu', 'top10-nlu', 'other-nlu', 'private-law'],
    },

    cuet: {
      method: 'nta-percentile-multisubject',
      phase: 'B',
      countryDefault: 'IN',
      scoreRange: [0, 800],
      sections: [
        { id: 'language', max: 200 },
        { id: 'domain_1', max: 200 },
        { id: 'domain_2', max: 200 },
        { id: 'general_test', max: 200 },
      ],
      citations: [
        'https://collegedunia.com/articles/e-1361-cuet-2026-rank-predictor',
        'https://university.careers360.com/articles/cuet-cut-off',
      ],
      goalTiers: ['du', 'jnu', 'bhu', 'central-univ', 'state-univ'],
    },

    nda: {
      method: 'written-cutoff-only',
      phase: 'C',
      countryDefault: 'IN',
      scoreRange: [0, 900],
      sections: [
        { id: 'mathematics', max: 300 },
        { id: 'gat_general_ability', max: 600 },
      ],
      citations: [
        'https://ncaacademy.com/cds-cut-off-marks-2026-entry-wise-expected-cutoff/',
      ],
      goalTiers: ['ssb-qualifying', 'army', 'navy', 'air-force'],
    },

    ssc_cgl: {
      method: 'tier-1-2-composite',
      phase: 'C',
      countryDefault: 'IN',
      scoreRange: [0, 800],
      sections: [
        { id: 'tier_1', max: 200 },
        { id: 'tier_2_paper_1', max: 450 }, // Quant + Reasoning + English
        { id: 'tier_2_paper_2', max: 150 }, // Statistics (optional post-group)
      ],
      citations: [
        'https://testbook.com/ssc-cgl-exam/rank-predictor',
        'https://prepgrind.com/blog/ssc-cgl-expected-cutoff',
      ],
      goalTiers: ['group-a-inspector', 'group-b-assistant', 'group-c-auditor', 'lower-division'],
    },

    rbi_grade_b: {
      method: 'phase-1-2-cutoff',
      phase: 'C',
      countryDefault: 'IN',
      scoreRange: [0, 300],
      sections: [
        { id: 'phase_1', max: 200 },
        { id: 'phase_2_paper_1', max: 100 }, // Economic & Social Issues
        { id: 'phase_2_paper_2', max: 100 }, // English Writing
        { id: 'phase_2_paper_3', max: 100 }, // Finance & Management
      ],
      citations: [
        'https://www.oliveboard.in/rbi-grade-b-cut-off/',
      ],
      goalTiers: ['officer-general', 'depr', 'dsim'],
    },

  };

  /** Returns the supported exam_id list (alphabetical) — used by /tools/score-predictor for the dropdown. */
  export function listSupportedExamIds(): string[] {
    var ids: string[] = [];
    for (var k in CONFIG) {
      if (Object.prototype.hasOwnProperty.call(CONFIG, k)) ids.push(k);
    }
    ids.sort();
    return ids;
  }

  /** Returns the config for a given exam_id, or null if not in the supported set
   *  (in which case the caller MUST fall through to the Bayes fallback). */
  export function lookup(examId: string): ExamPredictorConfig | null {
    if (!examId) return null;
    if (Object.prototype.hasOwnProperty.call(CONFIG, examId)) {
      return CONFIG[examId];
    }
    return null;
  }
}
