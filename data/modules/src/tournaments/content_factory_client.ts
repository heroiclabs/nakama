// =============================================================================
// content_factory_client.ts — Nakama ↔ content-factory in-cluster HTTP client
//
// Plan ref: §1G Content Pipeline Integration
//
// Discovery (from kube-infra inspection):
//   - content-factory-api lives at: content-factory-api.aicart.svc.cluster.local:8001
//   - Same EKS cluster (`aicart` namespace) as Nakama → ~1ms latency, no TLS
//   - Auth: X-API-Key header (env CONTENT_FACTORY_API_KEY); existing M2M pattern
//   - Endpoints used:
//       POST /api/pipelines/exam-prep-bundle   → quiz question packs (5/15/30 MCQ)
//       POST /api/pipelines/viral-lesson-short → 15-120s Learning Series video
//       GET  /api/pipelines/tasks/{task_id}    → async poll status
//
// All generation is async: POST returns task_id (status=pending), then poll
// until status=completed (or failed/timeout). For pre-enrollment we batch
// generate via a cron (see crons.ts); for on-demand we poll inline with a
// budget timeout.
//
// Three-tier integration (§1G):
//   1. Catalog cache (Nakama owns) — fast O(1) reads, no CF round-trip
//   2. On-demand generation — only when cache misses
//   3. Pre-generation orchestrator — bulk seeds the cache during pre-enroll
// =============================================================================

namespace ContentFactoryClient {

  // Env vars (set on Nakama deployment per §6 Phase 3 EKS notes)
  function getBaseUrl(ctx: nkruntime.Context): string {
    return "" + ((ctx.env && ctx.env["CONTENT_FACTORY_INTERNAL_URL"]) || "http://content-factory-api.aicart.svc.cluster.local:8001");
  }
  function getApiKey(ctx: nkruntime.Context): string {
    return "" + ((ctx.env && ctx.env["CONTENT_FACTORY_API_KEY"]) || "");
  }

  // Catalog storage (Nakama-owned). Plan §1I storage layout.
  const CATALOG_COLLECTION = "tournament_pack_catalog";
  const VIDEO_CATALOG_COLLECTION = "tournament_video_catalog";

  export interface CatalogEntry {
    s3_url: string;
    generated_at: number;
    question_count: number;
    content_factory_task_id: string;
    tags: string[];
  }

  export interface VideoCatalogEntry {
    s3_url: string;
    duration_s: number;
    generated_at: number;
    content_factory_task_id: string;
  }

  function catalogKey(slug: string, language: string, weekNum: number): string {
    return slug + "_" + language + "_w" + weekNum;
  }

  function videoCatalogKey(slug: string, videoIndex: number, language: string): string {
    return slug + "_v" + videoIndex + "_" + language;
  }

  // ── Catalog read (hot-path; never blocks on CF) ─────────────────────────────
  export function readPackCatalog(nk: nkruntime.Nakama, slug: string, language: string, weekNum: number): CatalogEntry | null {
    try {
      var key = catalogKey(slug, language, weekNum);
      var rows = nk.storageRead([{ collection: CATALOG_COLLECTION, key: key, userId: Constants.SYSTEM_USER_ID }]);
      if (rows && rows.length > 0) return rows[0].value as CatalogEntry;
    } catch (_) { }
    return null;
  }

  export function writePackCatalog(nk: nkruntime.Nakama, slug: string, language: string, weekNum: number, entry: CatalogEntry): void {
    var key = catalogKey(slug, language, weekNum);
    nk.storageWrite([{
      collection: CATALOG_COLLECTION,
      key: key,
      userId: Constants.SYSTEM_USER_ID,
      value: entry,
      permissionRead: 2,    // public read so anonymous web visitors can resolve S3 URLs
      permissionWrite: 0,
    }]);
  }

  export function readVideoCatalog(nk: nkruntime.Nakama, slug: string, videoIndex: number, language: string): VideoCatalogEntry | null {
    try {
      var key = videoCatalogKey(slug, videoIndex, language);
      var rows = nk.storageRead([{ collection: VIDEO_CATALOG_COLLECTION, key: key, userId: Constants.SYSTEM_USER_ID }]);
      if (rows && rows.length > 0) return rows[0].value as VideoCatalogEntry;
    } catch (_) { }
    return null;
  }

  export function writeVideoCatalog(nk: nkruntime.Nakama, slug: string, videoIndex: number, language: string, entry: VideoCatalogEntry): void {
    var key = videoCatalogKey(slug, videoIndex, language);
    nk.storageWrite([{
      collection: VIDEO_CATALOG_COLLECTION,
      key: key,
      userId: Constants.SYSTEM_USER_ID,
      value: entry,
      permissionRead: 2,
      permissionWrite: 0,
    }]);
  }

  // ── HTTP helpers ────────────────────────────────────────────────────────────
  function authHeaders(ctx: nkruntime.Context): { [k: string]: string } {
    return {
      "Content-Type": "application/json",
      "X-API-Key": getApiKey(ctx),
    };
  }

  // ── POST: enqueue quiz pack generation ──────────────────────────────────────
  // Returns task_id. Caller polls getTaskStatus until complete.
  export interface EnqueuePackArgs {
    concept: string;
    exam_board: string;
    language: string;
    num_cards?: number;           // default 30 (max for the pipeline today)
    days_until_exam?: number;     // default 7 (signals difficulty in the tier)
    tags?: string[];              // for catalog lookup later
  }

  export function enqueuePackGeneration(ctx: nkruntime.Context, nk: nkruntime.Nakama, args: EnqueuePackArgs): { ok: boolean; task_id?: string; error?: string } {
    var url = getBaseUrl(ctx) + "/api/pipelines/exam-prep-bundle";
    var body = {
      concept: args.concept,
      exam_board: args.exam_board,
      language: args.language || "en",
      num_lessons: 1,
      num_cards: args.num_cards || 30,
      days_until_exam: args.days_until_exam || 7,
      tags: args.tags || [],
    };
    try {
      var res = nk.httpRequest(url, "post", authHeaders(ctx), JSON.stringify(body), 30000);
      if (res.code >= 200 && res.code < 300) {
        var parsed: any = JSON.parse(res.body);
        return { ok: true, task_id: "" + (parsed.task_id || parsed.id || "") };
      }
      return { ok: false, error: "cf returned " + res.code + ": " + (res.body || "").slice(0, 200) };
    } catch (err: any) {
      return { ok: false, error: "" + (err && err.message ? err.message : err) };
    }
  }

  // ── POST: enqueue video generation ──────────────────────────────────────────
  export interface EnqueueVideoArgs {
    concept: string;
    language: string;
    target_duration_sec?: number;  // default 90s (within 15-120 max)
    tags?: string[];
  }

  export function enqueueVideoGeneration(ctx: nkruntime.Context, nk: nkruntime.Nakama, args: EnqueueVideoArgs): { ok: boolean; task_id?: string; error?: string } {
    var url = getBaseUrl(ctx) + "/api/pipelines/viral-lesson-short";
    var body = {
      concept: args.concept,
      language: args.language || "en",
      target_duration_sec: Math.min(120, Math.max(15, args.target_duration_sec || 90)),
      tags: args.tags || [],
    };
    try {
      var res = nk.httpRequest(url, "post", authHeaders(ctx), JSON.stringify(body), 30000);
      if (res.code >= 200 && res.code < 300) {
        var parsed: any = JSON.parse(res.body);
        return { ok: true, task_id: "" + (parsed.task_id || parsed.id || "") };
      }
      return { ok: false, error: "cf returned " + res.code };
    } catch (err: any) {
      return { ok: false, error: "" + (err && err.message ? err.message : err) };
    }
  }

  // ── GET: poll task status ───────────────────────────────────────────────────
  export interface TaskStatus {
    ok: boolean;
    status?: "pending" | "running" | "completed" | "failed";
    result?: any;
    error?: string;
  }

  export function getTaskStatus(ctx: nkruntime.Context, nk: nkruntime.Nakama, taskId: string): TaskStatus {
    var url = getBaseUrl(ctx) + "/api/pipelines/tasks/" + encodeURIComponent(taskId);
    try {
      var res = nk.httpRequest(url, "get", authHeaders(ctx), null, 10000);
      if (res.code >= 200 && res.code < 300) {
        var parsed: any = JSON.parse(res.body);
        return { ok: true, status: parsed.status, result: parsed.result || null };
      }
      return { ok: false, error: "cf returned " + res.code };
    } catch (err: any) {
      return { ok: false, error: "" + (err && err.message ? err.message : err) };
    }
  }

  // ── Helper: extract S3 URL + question count from a completed task result ───
  export function extractPackResultUrl(result: any): { s3_url: string; question_count: number } | null {
    if (!result) return null;
    // content-factory may surface the manifest URL at result.s3.manifest_url or
    // result.quizPacks[0].s3_url depending on pipeline; we accept either shape.
    var s3 = "";
    var count = 0;
    if (result.s3 && result.s3.manifest_url) s3 = "" + result.s3.manifest_url;
    if (!s3 && result.manifest_url) s3 = "" + result.manifest_url;
    if (!s3 && result.quizPacks && result.quizPacks[0] && result.quizPacks[0].s3_url) s3 = "" + result.quizPacks[0].s3_url;
    if (result.quizPacks && result.quizPacks[0] && result.quizPacks[0].questions) count = result.quizPacks[0].questions.length;
    if (result.question_count) count = result.question_count | 0;
    if (!s3) return null;
    return { s3_url: s3, question_count: count };
  }

  export function extractVideoResultUrl(result: any): { s3_url: string; duration_s: number } | null {
    if (!result) return null;
    var url = "";
    var dur = 0;
    if (result.videoUrl) url = "" + result.videoUrl;
    if (!url && result.s3 && result.s3.video_url) url = "" + result.s3.video_url;
    if (result.duration_sec) dur = parseFloat(result.duration_sec) || 0;
    if (!url) return null;
    return { s3_url: url, duration_s: dur };
  }
}
