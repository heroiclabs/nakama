// lt_calendar.ts
// ─────────────────────────────────────────────────────────────────────────────
// LearnerToolbelt — per-country exam calendar (Wave 4 — PLAN § 4.5).
//
// Inline JSON literal covering 5 countries × 2 years (2026, 2027). Per the
// plan we cite each entry to its primary source — pulled from the Firecrawl
// corpus at Quizverse-web-frontend/.firecrawl/learner-toolbelt/09-exam-calendar.json
// (crawled 2026-05-24). Where the official body has NOT published a fixed
// date yet (e.g. NTA 2027 JEE schedule lands Nov-2026), we use the historical
// window with date_iso=null and a date_window_label.
//
// Read path: rpcExamCalendarGet(country, year) → filtered list. Anonymous-OK.
//
// To refresh annually: ai-content updates the literals below and bumps
// EXAM_CALENDAR_VERSION. No S3 fetch required at runtime (saves a ~50ms hop).
//
// Sources (all in 09-exam-calendar.json):
//   - College Board "SAT Dates and Deadlines" (US: SAT)
//   - ACT.org "Test Dates" (US: ACT)
//   - College Board AP Exam Schedule (US: AP, fixed first 2 weeks of May)
//   - NTA press releases — Jee Main 2026 sessions (IN: JEE)
//   - NMC 2026 NEET-UG bulletin (IN: NEET)
//   - JCAB CUET 2026 schedule (IN: CUET)
//   - IIM CAT 2025/2026 (IN: CAT, fixed last Sunday of Nov)
//   - GATE 2026 by IIT (IN: GATE)
//   - AQA/OCR/Edexcel May-June 2026 final timetable (UK: A-Level, GCSE)
//   - INEP ENEM 2026/2027 release (BR: ENEM)
//   - FUVEST 2026 (BR: FUVEST 1ª/2ª fase)
//   - SEAB SG GCE O/A-Level 2026 (SG)

namespace LearnerToolbelt {

  export var EXAM_CALENDAR_VERSION = "lt-calendar/2026-2027.v1";

  export interface ExamCalendarEntry {
    exam_id: string;
    exam_label: string;
    country: string;          // ISO-3166 alpha-2
    year: number;
    date_iso: string | null;  // YYYY-MM-DD; null when only a window is known
    date_window_label: string;
    registration_open_iso: string | null;
    registration_close_iso: string | null;
    source_url: string;
  }

  // The full literal. Kept compact: one row per administration. Where College
  // Board publishes the test date (e.g. SAT Aug 2026 = 2026-08-29) we pin
  // date_iso; otherwise we leave it null and rely on the window label.
  var EXAM_CALENDAR: ExamCalendarEntry[] = [
    // ── US: SAT (College Board) — 2026 administrations ──
    { exam_id: "sat", exam_label: "SAT", country: "US", year: 2026,
      date_iso: "2026-08-29", date_window_label: "August 2026",
      registration_open_iso: null, registration_close_iso: "2026-08-15",
      source_url: "https://satsuite.collegeboard.org/sat/dates-deadlines" },
    { exam_id: "sat", exam_label: "SAT", country: "US", year: 2026,
      date_iso: "2026-10-03", date_window_label: "October 2026",
      registration_open_iso: null, registration_close_iso: "2026-09-19",
      source_url: "https://satsuite.collegeboard.org/sat/dates-deadlines" },
    { exam_id: "sat", exam_label: "SAT", country: "US", year: 2026,
      date_iso: "2026-11-07", date_window_label: "November 2026",
      registration_open_iso: null, registration_close_iso: "2026-10-24",
      source_url: "https://satsuite.collegeboard.org/sat/dates-deadlines" },
    { exam_id: "sat", exam_label: "SAT", country: "US", year: 2026,
      date_iso: "2026-12-05", date_window_label: "December 2026",
      registration_open_iso: null, registration_close_iso: "2026-11-21",
      source_url: "https://satsuite.collegeboard.org/sat/dates-deadlines" },
    // ── US: SAT (College Board) — 2027 administrations ──
    { exam_id: "sat", exam_label: "SAT", country: "US", year: 2027,
      date_iso: "2027-03-13", date_window_label: "March 2027",
      registration_open_iso: null, registration_close_iso: "2027-02-26",
      source_url: "https://satsuite.collegeboard.org/sat/dates-deadlines" },
    { exam_id: "sat", exam_label: "SAT", country: "US", year: 2027,
      date_iso: "2027-05-08", date_window_label: "May 2027",
      registration_open_iso: null, registration_close_iso: "2027-04-23",
      source_url: "https://satsuite.collegeboard.org/sat/dates-deadlines" },
    { exam_id: "sat", exam_label: "SAT", country: "US", year: 2027,
      date_iso: "2027-06-05", date_window_label: "June 2027",
      registration_open_iso: null, registration_close_iso: "2027-05-21",
      source_url: "https://satsuite.collegeboard.org/sat/dates-deadlines" },

    // ── US: ACT — 2026 ──
    { exam_id: "act", exam_label: "ACT", country: "US", year: 2026,
      date_iso: "2026-09-12", date_window_label: "September 2026",
      registration_open_iso: null, registration_close_iso: "2026-08-21",
      source_url: "https://www.act.org/content/act/en/products-and-services/the-act/registration.html" },
    { exam_id: "act", exam_label: "ACT", country: "US", year: 2026,
      date_iso: "2026-10-24", date_window_label: "October 2026",
      registration_open_iso: null, registration_close_iso: "2026-09-25",
      source_url: "https://www.act.org/content/act/en/products-and-services/the-act/registration.html" },
    { exam_id: "act", exam_label: "ACT", country: "US", year: 2026,
      date_iso: "2026-12-12", date_window_label: "December 2026",
      registration_open_iso: null, registration_close_iso: "2026-11-13",
      source_url: "https://www.act.org/content/act/en/products-and-services/the-act/registration.html" },
    // ── US: ACT — 2027 ──
    { exam_id: "act", exam_label: "ACT", country: "US", year: 2027,
      date_iso: "2027-02-13", date_window_label: "February 2027",
      registration_open_iso: null, registration_close_iso: "2027-01-15",
      source_url: "https://www.act.org/content/act/en/products-and-services/the-act/registration.html" },
    { exam_id: "act", exam_label: "ACT", country: "US", year: 2027,
      date_iso: "2027-04-10", date_window_label: "April 2027",
      registration_open_iso: null, registration_close_iso: "2027-03-12",
      source_url: "https://www.act.org/content/act/en/products-and-services/the-act/registration.html" },
    { exam_id: "act", exam_label: "ACT", country: "US", year: 2027,
      date_iso: "2027-06-12", date_window_label: "June 2027",
      registration_open_iso: null, registration_close_iso: "2027-05-14",
      source_url: "https://www.act.org/content/act/en/products-and-services/the-act/registration.html" },
    { exam_id: "act", exam_label: "ACT", country: "US", year: 2027,
      date_iso: "2027-07-17", date_window_label: "July 2027",
      registration_open_iso: null, registration_close_iso: "2027-06-18",
      source_url: "https://www.act.org/content/act/en/products-and-services/the-act/registration.html" },

    // ── US: AP exams — College Board fixed first 2 weeks of May ──
    { exam_id: "ap", exam_label: "AP Exams (all subjects)", country: "US", year: 2026,
      date_iso: null, date_window_label: "May 4-15, 2026",
      registration_open_iso: null, registration_close_iso: "2025-11-15",
      source_url: "https://apcentral.collegeboard.org/courses/exam-dates-and-fees" },
    { exam_id: "ap", exam_label: "AP Exams (all subjects)", country: "US", year: 2027,
      date_iso: null, date_window_label: "May 3-14, 2027",
      registration_open_iso: null, registration_close_iso: "2026-11-15",
      source_url: "https://apcentral.collegeboard.org/courses/exam-dates-and-fees" },

    // ── IN: JEE Main — Session 1 (Jan-Feb) + Session 2 (Apr) per NTA ──
    { exam_id: "jee_main", exam_label: "JEE Main 2026 — Session 1", country: "IN", year: 2026,
      date_iso: null, date_window_label: "Jan 22 - Feb 1, 2026",
      registration_open_iso: "2025-10-28", registration_close_iso: "2025-11-22",
      source_url: "https://jeemain.nta.nic.in/" },
    { exam_id: "jee_main", exam_label: "JEE Main 2026 — Session 2", country: "IN", year: 2026,
      date_iso: null, date_window_label: "Apr 1-12, 2026",
      registration_open_iso: "2026-02-15", registration_close_iso: "2026-03-15",
      source_url: "https://jeemain.nta.nic.in/" },
    { exam_id: "jee_main", exam_label: "JEE Main 2027 — Session 1 (provisional)", country: "IN", year: 2027,
      date_iso: null, date_window_label: "Jan 2027 (TBC by NTA, ~Nov 2026)",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://jeemain.nta.nic.in/" },
    { exam_id: "jee_main", exam_label: "JEE Main 2027 — Session 2 (provisional)", country: "IN", year: 2027,
      date_iso: null, date_window_label: "Apr 2027 (TBC by NTA)",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://jeemain.nta.nic.in/" },

    // ── IN: NEET-UG — May (NMC) ──
    { exam_id: "neet", exam_label: "NEET-UG 2026", country: "IN", year: 2026,
      date_iso: "2026-05-03", date_window_label: "May 2026",
      registration_open_iso: "2026-02-09", registration_close_iso: "2026-03-09",
      source_url: "https://neet.nta.nic.in/" },
    { exam_id: "neet", exam_label: "NEET-UG 2027 (provisional)", country: "IN", year: 2027,
      date_iso: null, date_window_label: "May 2027 (TBC by NMC)",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://neet.nta.nic.in/" },

    // ── IN: CUET-UG — May-Jun NTA ──
    { exam_id: "cuet", exam_label: "CUET-UG 2026", country: "IN", year: 2026,
      date_iso: null, date_window_label: "May 13 - Jun 3, 2026",
      registration_open_iso: "2026-02-25", registration_close_iso: "2026-03-25",
      source_url: "https://cuet.nta.nic.in/" },
    { exam_id: "cuet", exam_label: "CUET-UG 2027 (provisional)", country: "IN", year: 2027,
      date_iso: null, date_window_label: "May-Jun 2027 (TBC by NTA)",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://cuet.nta.nic.in/" },

    // ── IN: CAT — IIM, last Sunday of November ──
    { exam_id: "cat", exam_label: "CAT 2026", country: "IN", year: 2026,
      date_iso: "2026-11-29", date_window_label: "November 2026 (last Sunday)",
      registration_open_iso: "2026-08-02", registration_close_iso: "2026-09-13",
      source_url: "https://iimcat.ac.in/" },
    { exam_id: "cat", exam_label: "CAT 2027 (provisional)", country: "IN", year: 2027,
      date_iso: "2027-11-28", date_window_label: "November 2027 (last Sunday, est.)",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://iimcat.ac.in/" },

    // ── IN: GATE — IIT, first Sat-Sun of Feb across 2 weekends ──
    { exam_id: "gate", exam_label: "GATE 2026", country: "IN", year: 2026,
      date_iso: null, date_window_label: "Feb 7-15, 2026",
      registration_open_iso: "2025-08-28", registration_close_iso: "2025-10-04",
      source_url: "https://gate2026.iitg.ac.in/" },
    { exam_id: "gate", exam_label: "GATE 2027 (provisional)", country: "IN", year: 2027,
      date_iso: null, date_window_label: "Feb 2027 (TBC by host IIT)",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://gate.iitr.ac.in/" },

    // ── UK: A-Level (AQA/OCR/Edexcel/WJEC combined window) ──
    { exam_id: "alevel", exam_label: "A-Level (May-Jun)", country: "UK", year: 2026,
      date_iso: null, date_window_label: "May 11 - Jun 26, 2026",
      registration_open_iso: null, registration_close_iso: "2026-02-21",
      source_url: "https://www.aqa.org.uk/exams-administration/dates-and-timetables" },
    { exam_id: "alevel", exam_label: "A-Level (May-Jun)", country: "UK", year: 2027,
      date_iso: null, date_window_label: "May-Jun 2027 (final timetable Oct-2026)",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://www.aqa.org.uk/exams-administration/dates-and-timetables" },

    // ── UK: GCSE ──
    { exam_id: "gcse", exam_label: "GCSE (May-Jun)", country: "UK", year: 2026,
      date_iso: null, date_window_label: "May 11 - Jun 19, 2026",
      registration_open_iso: null, registration_close_iso: "2026-02-21",
      source_url: "https://www.aqa.org.uk/exams-administration/dates-and-timetables" },
    { exam_id: "gcse", exam_label: "GCSE (May-Jun)", country: "UK", year: 2027,
      date_iso: null, date_window_label: "May-Jun 2027 (final timetable Oct-2026)",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://www.aqa.org.uk/exams-administration/dates-and-timetables" },

    // ── BR: ENEM (INEP) — 2 Sundays in Nov ──
    { exam_id: "enem", exam_label: "ENEM 2026 — Dia 1", country: "BR", year: 2026,
      date_iso: "2026-11-08", date_window_label: "8 de novembro de 2026 (Domingo)",
      registration_open_iso: "2026-05-25", registration_close_iso: "2026-06-05",
      source_url: "https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem" },
    { exam_id: "enem", exam_label: "ENEM 2026 — Dia 2", country: "BR", year: 2026,
      date_iso: "2026-11-15", date_window_label: "15 de novembro de 2026 (Domingo)",
      registration_open_iso: "2026-05-25", registration_close_iso: "2026-06-05",
      source_url: "https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem" },
    { exam_id: "enem", exam_label: "ENEM 2027 (provisional)", country: "BR", year: 2027,
      date_iso: null, date_window_label: "Novembro de 2027 (TBC INEP)",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem" },

    // ── BR: FUVEST — 1ª fase (Nov) + 2ª fase (Jan) ──
    { exam_id: "fuvest", exam_label: "FUVEST 1ª fase", country: "BR", year: 2026,
      date_iso: "2026-11-22", date_window_label: "22 de novembro de 2026",
      registration_open_iso: null, registration_close_iso: "2026-09-30",
      source_url: "https://www.fuvest.br/" },
    { exam_id: "fuvest", exam_label: "FUVEST 2ª fase", country: "BR", year: 2027,
      date_iso: null, date_window_label: "Janeiro de 2027",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://www.fuvest.br/" },

    // ── SG: GCE O-Level + A-Level (SEAB) ──
    { exam_id: "olevel", exam_label: "GCE O-Level (written papers)", country: "SG", year: 2026,
      date_iso: null, date_window_label: "Oct 12 - Nov 13, 2026",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://www.seab.gov.sg/" },
    { exam_id: "alevel_sg", exam_label: "GCE A-Level (written papers)", country: "SG", year: 2026,
      date_iso: null, date_window_label: "Oct 26 - Nov 27, 2026",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://www.seab.gov.sg/" },
    { exam_id: "olevel", exam_label: "GCE O-Level (written papers)", country: "SG", year: 2027,
      date_iso: null, date_window_label: "Oct-Nov 2027 (TBC SEAB)",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://www.seab.gov.sg/" },
    { exam_id: "alevel_sg", exam_label: "GCE A-Level (written papers)", country: "SG", year: 2027,
      date_iso: null, date_window_label: "Oct-Nov 2027 (TBC SEAB)",
      registration_open_iso: null, registration_close_iso: null,
      source_url: "https://www.seab.gov.sg/" },
  ];

  // Filter helper — used by rpcExamCalendarGet.
  export function getCalendarEntries(country: string, year: number): ExamCalendarEntry[] {
    var c = ("" + (country || "")).toUpperCase();
    var out: ExamCalendarEntry[] = [];
    for (var i = 0; i < EXAM_CALENDAR.length; i++) {
      var e = EXAM_CALENDAR[i];
      if (e.country === c && e.year === year) out.push(e);
    }
    return out;
  }

  // Quick exam_id → primary upcoming entry (for the predictor's
  // "days_until_exam" join). Picks the soonest entry whose date_iso is in
  // the future, or the first matching entry if no date is set.
  export function lookupExamUpcoming(examId: string, nowUnix: number): ExamCalendarEntry | null {
    var match: ExamCalendarEntry | null = null;
    var matchTs = Infinity;
    for (var i = 0; i < EXAM_CALENDAR.length; i++) {
      var e = EXAM_CALENDAR[i];
      if (e.exam_id !== examId) continue;
      if (!e.date_iso) {
        if (!match) match = e;
        continue;
      }
      var ts = Math.floor(new Date(e.date_iso + "T00:00:00Z").getTime() / 1000);
      if (ts > nowUnix && ts < matchTs) {
        matchTs = ts;
        match = e;
      }
    }
    return match;
  }
}
