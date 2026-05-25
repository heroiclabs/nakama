// lt_grading.ts
// ─────────────────────────────────────────────────────────────────────────────
// LearnerToolbelt — GPA grading tables + compute logic (Wave 4 — PLAN § 5).
//
// We ship 6 grading systems in this wave (§ 5.2 Phase A names):
//   us-4.0-unweighted   us-4.0-weighted   india-cbse-cgpa
//   india-isc-percentage   uk-alevel-a*-e   ib-1-7
//
// The remaining 6 (uk-gcse-9-1, uk-ucas-tariff, us-5.0-weighted, eu-ects,
// france-20pt, germany-1.0-6.0) land in Wave B per the plan.
//
// WES iGPA conversion source: WES Grade Conversion Guide (Nov 2018) +
// applications.wes.org/igpa-calculator/. Tables are baked inline (small,
// stable, refreshed ~annually) — see plan § 5.3 / § 7.2.
//
// Stateless. No auth, no storage. Powers the public SEO landing page at
// /tools/gpa-calculator AND the score predictor's prior-GPA correlation
// signal (plan § 5.1 US-GPA-04).

namespace LearnerToolbelt {

  // ── Public types ──────────────────────────────────────────────────────────
  export interface GpaCourseInput {
    name?: string;
    grade?: string | number;
    credits?: number;
    is_ap?: boolean;     // weighted variant: +1.0 boost
    is_honors?: boolean; // weighted variant: +1.0 boost
  }

  export interface GpaCourseBreakdown {
    name: string;
    grade_input: string;
    grade_native: number;
    grade_us4: number;
    credits: number;
    weighted_bonus: number;
    quality_points_native: number;
    quality_points_us4: number;
  }

  export interface GpaComputeResult {
    ok: boolean;
    system: string;
    system_label: string;
    native_gpa: number;
    native_max: number;
    wes_4_0: number;          // WES-iGPA US-4.0 equivalent (deterministic per § 5.3)
    percentile_band: string;  // "top-10%" | "top-25%" | "mid" | "below-median"
    breakdown: GpaCourseBreakdown[];
    courses_used: number;
    courses_skipped: number;
    warnings: string[];
  }

  // ── System #1: US 4.0 unweighted ─────────────────────────────────────────
  // College Board / ACT standard letter scale used by ~80% of US public HS.
  var US40_LETTERS: { [k: string]: number } = {
    "A+": 4.0, "A": 4.0, "A-": 3.7,
    "B+": 3.3, "B": 3.0, "B-": 2.7,
    "C+": 2.3, "C": 2.0, "C-": 1.7,
    "D+": 1.3, "D": 1.0, "D-": 0.7,
    "F": 0.0,
  };

  // ── System #2: India CBSE 10-point CGPA ──────────────────────────────────
  // CBSE Class X/XII 2012+ grading. A1=10 down to E2=2; F treated as 0.
  // WES iGPA conversion uses the Indian band-conversion guidance
  // (60+ → A → 4.0, 50–59 → B → 3.0, 35–49 → C → 2.0, <35 → F → 0).
  var CBSE_GRADES: { [k: string]: { native: number; us4: number } } = {
    "A1": { native: 10, us4: 4.0 },
    "A2": { native: 9,  us4: 4.0 },
    "B1": { native: 8,  us4: 3.7 },
    "B2": { native: 7,  us4: 3.3 },
    "C1": { native: 6,  us4: 3.0 },
    "C2": { native: 5,  us4: 2.7 },
    "D":  { native: 4,  us4: 2.0 },
    "E1": { native: 3,  us4: 1.0 },
    "E2": { native: 2,  us4: 0.7 },
    "F":  { native: 0,  us4: 0.0 },
  };

  // ── System #3: UK A-Level A*-E ───────────────────────────────────────────
  // Per user spec (verified against WES iGPA unweighted A-Level mapping):
  //   A*=5.3, A=4.0, B=3.0, C=2.0, D=1.0, E=0.5, U=0
  // (Native scale topped at 5.3 to honour A*; WES still caps usable iGPA at
  // 4.0 in the official guide, so we clamp wes_4_0 to 4.0 on output.)
  var ALEVEL_GRADES: { [k: string]: { native: number; us4: number } } = {
    "A*": { native: 5.3, us4: 4.0 },
    "A":  { native: 4.0, us4: 4.0 },
    "B":  { native: 3.0, us4: 3.0 },
    "C":  { native: 2.0, us4: 2.0 },
    "D":  { native: 1.0, us4: 1.0 },
    "E":  { native: 0.5, us4: 0.5 },
    "U":  { native: 0.0, us4: 0.0 },
  };

  // ── System #4: IB 1-7 ────────────────────────────────────────────────────
  // IB Diploma Programme per-subject grade. WES iGPA conversion per the
  // 2018 guide: 7→4.0, 6→3.7, 5→3.3, 4→3.0, 3→2.0, 2→1.0, 1→0.
  var IB_GRADES: { [k: string]: { native: number; us4: number } } = {
    "7": { native: 7, us4: 4.0 },
    "6": { native: 6, us4: 3.7 },
    "5": { native: 5, us4: 3.3 },
    "4": { native: 4, us4: 3.0 },
    "3": { native: 3, us4: 2.0 },
    "2": { native: 2, us4: 1.0 },
    "1": { native: 1, us4: 0.0 },
  };

  // ── System #5: India ISC / state-board / generic 0-100% percentage ───────
  // WES iGPA conversion per § 5.3 / India guidance table (2018 PDF).
  // Bands deliberately overlap with CBSE so users can mix and match.
  // Input is a number in 0..100 (per course %), output is mapped to US-4.0.
  function pctToUs4_india(pct: number): number {
    if (pct >= 60) return 4.0;
    if (pct >= 55) return 3.7;
    if (pct >= 50) return 3.3;
    if (pct >= 45) return 3.0;
    if (pct >= 40) return 2.7;
    if (pct >= 35) return 2.0;
    return 0.0;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function normalizeGradeToken(raw: any): string {
    if (raw === null || raw === undefined) return "";
    var s = ("" + raw).toUpperCase().replace(/\s+/g, "");
    // Some users type "A*" as "A*" or "A∗"; normalize the unicode star too.
    s = s.replace("∗", "*");
    return s;
  }

  function clamp4(v: number): number {
    if (v < 0) return 0;
    if (v > 4.0) return 4.0;
    return v;
  }

  function round2(v: number): number {
    return Math.round(v * 100) / 100;
  }

  function bandFromUs4(us4: number): string {
    if (us4 >= 3.85) return "top-10%";
    if (us4 >= 3.5)  return "top-25%";
    if (us4 >= 3.0)  return "mid";
    if (us4 >= 2.0)  return "below-median";
    return "bottom-tier";
  }

  // ── Per-system compute ───────────────────────────────────────────────────
  function lookupLetter(table: { [k: string]: { native: number; us4: number } | number }, token: string): { native: number; us4: number } | null {
    var hit = table[token];
    if (!hit && hit !== 0) return null;
    if (typeof hit === "number") return { native: hit, us4: hit };
    return hit as { native: number; us4: number };
  }

  function computeLetterSystem(
    courses: GpaCourseInput[],
    table: { [k: string]: number } | { [k: string]: { native: number; us4: number } },
    nativeMax: number,
    label: string,
    systemId: string,
    weighted: boolean
  ): GpaComputeResult {
    var breakdown: GpaCourseBreakdown[] = [];
    var warnings: string[] = [];
    var sumNative = 0, sumUs4 = 0, sumCredits = 0;
    var skipped = 0;

    for (var i = 0; i < courses.length; i++) {
      var c = courses[i] || {};
      var token = normalizeGradeToken(c.grade);
      var hit: { native: number; us4: number } | null = null;
      var raw = (table as any)[token];
      if (raw !== undefined && raw !== null) {
        hit = (typeof raw === "number") ? { native: raw, us4: raw } : raw;
      }
      if (!hit) {
        warnings.push("course " + (i + 1) + ": unknown grade '" + (c.grade || "") + "' (skipped)");
        skipped++;
        continue;
      }
      var credits = (typeof c.credits === "number" && c.credits > 0) ? c.credits : 1.0;
      var bonus = 0;
      if (weighted && (c.is_ap || c.is_honors)) bonus = 1.0;

      var native = hit.native + bonus;
      var us4 = clamp4(hit.us4 + bonus);

      sumNative += native * credits;
      sumUs4 += us4 * credits;
      sumCredits += credits;

      breakdown.push({
        name: c.name ? ("" + c.name).slice(0, 80) : ("Course " + (i + 1)),
        grade_input: ("" + (c.grade !== undefined ? c.grade : "")),
        grade_native: round2(native),
        grade_us4: round2(us4),
        credits: credits,
        weighted_bonus: bonus,
        quality_points_native: round2(native * credits),
        quality_points_us4: round2(us4 * credits),
      });
    }

    var nativeGpa = sumCredits > 0 ? sumNative / sumCredits : 0;
    var us4 = sumCredits > 0 ? sumUs4 / sumCredits : 0;

    return {
      ok: true,
      system: systemId,
      system_label: label,
      native_gpa: round2(nativeGpa),
      native_max: nativeMax,
      wes_4_0: round2(us4),
      percentile_band: bandFromUs4(us4),
      breakdown: breakdown,
      courses_used: breakdown.length,
      courses_skipped: skipped,
      warnings: warnings,
    };
  }

  function computePercentSystem(
    courses: GpaCourseInput[],
    label: string,
    systemId: string,
    pctToUs4: (p: number) => number
  ): GpaComputeResult {
    var breakdown: GpaCourseBreakdown[] = [];
    var warnings: string[] = [];
    var sumNative = 0, sumUs4 = 0, sumCredits = 0;
    var skipped = 0;

    for (var i = 0; i < courses.length; i++) {
      var c = courses[i] || {};
      var pct = typeof c.grade === "number" ? c.grade : parseFloat("" + (c.grade || ""));
      if (!(pct >= 0 && pct <= 100)) {
        warnings.push("course " + (i + 1) + ": grade must be 0-100 (was '" + (c.grade || "") + "')");
        skipped++;
        continue;
      }
      var credits = (typeof c.credits === "number" && c.credits > 0) ? c.credits : 1.0;
      var us4 = pctToUs4(pct);
      sumNative += pct * credits;
      sumUs4 += us4 * credits;
      sumCredits += credits;
      breakdown.push({
        name: c.name ? ("" + c.name).slice(0, 80) : ("Course " + (i + 1)),
        grade_input: "" + pct,
        grade_native: pct,
        grade_us4: us4,
        credits: credits,
        weighted_bonus: 0,
        quality_points_native: round2(pct * credits),
        quality_points_us4: round2(us4 * credits),
      });
    }

    var nativeGpa = sumCredits > 0 ? sumNative / sumCredits : 0;
    var us4Final = sumCredits > 0 ? sumUs4 / sumCredits : 0;

    return {
      ok: true,
      system: systemId,
      system_label: label,
      native_gpa: round2(nativeGpa),
      native_max: 100,
      wes_4_0: round2(us4Final),
      percentile_band: bandFromUs4(us4Final),
      breakdown: breakdown,
      courses_used: breakdown.length,
      courses_skipped: skipped,
      warnings: warnings,
    };
  }

  // ── Public entry: compute GPA for any supported system ───────────────────
  export function computeGpa(systemId: string, courses: GpaCourseInput[]): GpaComputeResult {
    var sys = ("" + (systemId || "")).toLowerCase();
    switch (sys) {
      case "us-4.0-unweighted":
        return computeLetterSystem(courses, US40_LETTERS, 4.0, "US 4.0 (Unweighted)", sys, false);
      case "us-4.0-weighted":
        return computeLetterSystem(courses, US40_LETTERS, 5.0, "US 4.0 (Weighted, +1.0 AP/Honors)", sys, true);
      case "india-cbse-cgpa":
        return computeLetterSystem(courses, CBSE_GRADES, 10.0, "India CBSE 10-point CGPA", sys, false);
      case "india-isc-percentage":
        return computePercentSystem(courses, "India ISC / state-board percentage", sys, pctToUs4_india);
      case "uk-alevel-a*-e":
      case "uk-alevel":
        return computeLetterSystem(courses, ALEVEL_GRADES, 5.3, "UK A-Level (A*-E)", "uk-alevel-a*-e", false);
      case "ib-1-7":
      case "ib":
        return computeLetterSystem(courses, IB_GRADES, 7.0, "IB Diploma (1-7)", "ib-1-7", false);
      default:
        return {
          ok: false,
          system: sys,
          system_label: "(unsupported)",
          native_gpa: 0,
          native_max: 0,
          wes_4_0: 0,
          percentile_band: "unknown",
          breakdown: [],
          courses_used: 0,
          courses_skipped: courses.length,
          warnings: [
            "system '" + sys + "' not supported in Wave A. Supported: " +
            "us-4.0-unweighted, us-4.0-weighted, india-cbse-cgpa, " +
            "india-isc-percentage, uk-alevel-a*-e, ib-1-7"
          ],
        };
    }
  }
}
