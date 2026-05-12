// analytics_firecrawl.js — Phase 7 (2026-05) Firecrawl External Intelligence.
//
// Goal: add market/content intelligence (not player telemetry) by calling
// the Firecrawl REST API from Nakama and storing the results as searchable
// intel documents. Lets the live-ops and product teams pull app-store reviews,
// competitor pricing, release notes, and market signals without any local
// tooling or manual copy-paste.
//
// ─── Architecture ────────────────────────────────────────────────────────────
//
//   Nakama (Goja JS) calls Firecrawl's REST API via nk.httpRequest.
//   Results are stored in Nakama storage under `external_intel_docs`.
//   All actions are admin-gated; the API key comes from env/config.
//
// ─── Supported actions ───────────────────────────────────────────────────────
//
//   scrape        Single URL → markdown + metadata + summary.
//   extract       LLM-structured extraction from a URL using a JSON schema.
//   search        Web search returning scraped results (top N pages).
//   map           URL discovery — returns all links found at a domain/path.
//   crawl_start   Async multi-page crawl → returns job_id.
//   crawl_status  Poll a crawl job and store completed pages as intel docs.
//
// ─── Storage layout ──────────────────────────────────────────────────────────
//
//   external_intel_docs / <doc_id>      (system user)
//     Stored intelligence: url, title, summary, markdown (capped at 50 KB),
//     extracted fields, tag, source_action, scraped_at, job_id (for crawls).
//
//   firecrawl_jobs / <job_id>           (system user)
//     Async crawl job state: job_id, url, status, pages_done, pages_total,
//     started_at, last_checked_at, completed_at.
//
//   firecrawl_meta / last_status        (system user)
//     Last run summary + credit usage marker.
//
// ─── Registered RPCs (all admin-gated) ──────────────────────────────────────
//
//   analytics_firecrawl_run
//     Main entry point. Routes on `action` field.
//     Payload: { action, url?, query?, urls?, doc_id?, tag?, prompt?,
//               schema?, limit?, max_depth?, job_id?, dashboard_secret? }
//
//   analytics_firecrawl_intel
//     Read stored intel documents.
//     Payload: { doc_id?, tag?, limit?, cursor? }
//
//   analytics_firecrawl_status
//     Engine status: last job list, pending crawls, config fingerprint.
//
// ─── Configuration ───────────────────────────────────────────────────────────
//
//   FIRECRAWL_API_KEY     env var (required)    Bearer token for Firecrawl API
//   FIRECRAWL_BASE_URL    env var (optional)    defaults to https://api.firecrawl.dev
//   FIRECRAWL_TIMEOUT_MS  env var (optional)    defaults to 30000 ms
//   FIRECRAWL_ENABLED     env var (optional)    set to "false" to disable all RPCs
//
// ─── Use-case templates ──────────────────────────────────────────────────────
//
//   The `tag` field on any run is free-form text for categorizing stored intel.
//   Recommended tags:
//     app_store_reviews    competitor_pricing    release_notes
//     market_signals       public_docs           player_feedback

var FC_SYSTEM_USER       = "00000000-0000-0000-0000-000000000000";
var FC_ADMIN_COLLECTION  = "admin_users";
var FC_INTEL_COLLECTION  = "external_intel_docs";
var FC_JOBS_COLLECTION   = "firecrawl_jobs";
var FC_META_COLLECTION   = "firecrawl_meta";

var FC_DEFAULT_BASE_URL  = "https://api.firecrawl.dev";
var FC_DEFAULT_TIMEOUT   = 30000;

// Maximum markdown bytes stored per document.
// Nakama has a ~1 MB storage doc limit; 50 KB is a safe ceiling that
// still captures the bulk of any scraped page without bloating the collection.
var FC_MAX_MARKDOWN_BYTES = 50000;

// Maximum pages to store from a single crawl job in one poll call.
var FC_MAX_CRAWL_PAGES    = 50;

// Maximum search results to store per search call.
var FC_MAX_SEARCH_RESULTS = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fcParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}

function fcOk(data) {
    var out = { success: true };
    if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
    return JSON.stringify(out);
}

function fcErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}

function fcEnv(ctx, key) {
    if (key === "DASHBOARD_SECRET" && typeof AA_FALLBACK_DASHBOARD_SECRET === "string") {
        return AA_FALLBACK_DASHBOARD_SECRET;
    }
    try {
        if (ctx && ctx.env && ctx.env[key]) {
            var v = String(ctx.env[key]).trim();
            if (v.length > 0) return v;
        }
    } catch (e) { /* */ }
    return "";
}

function fcIsAdmin(ctx, nk) {
    if (!ctx.userId) return false;
    if (ctx.userId === FC_SYSTEM_USER) return true;
    if (!ctx.username || ctx.username.indexOf("admin:") !== 0) return false;
    try {
        var recs = nk.storageRead([{ collection: FC_ADMIN_COLLECTION, key: "profile", userId: ctx.userId }]);
        if (!recs || recs.length === 0) return false;
        var r = recs[0].value || {};
        if (!r.isAdmin) return false;
        if (r.expiresAt && r.expiresAt < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch (e) { return false; }
}

function fcRequireAdmin(ctx, nk, data) {
    var secret = fcEnv(ctx, "DASHBOARD_SECRET");
    if (secret && data && data.dashboard_secret === secret) return { ok: true, bypass: "secret" };
    if (fcIsAdmin(ctx, nk)) return { ok: true, bypass: "session" };
    return { ok: false, reason: "admin authentication required" };
}

function fcFeatureEnabled(ctx) {
    var v = fcEnv(ctx, "FIRECRAWL_ENABLED");
    return (v === "" || v === "true" || v === "1");
}

function fcReadOne(nk, collection, key) {
    try {
        var r = nk.storageRead([{ collection: collection, key: key, userId: FC_SYSTEM_USER }]);
        return (r && r.length > 0) ? (r[0].value || null) : null;
    } catch (e) { return null; }
}

function fcWriteOne(nk, collection, key, value) {
    try {
        nk.storageWrite([{
            collection: collection, key: key, userId: FC_SYSTEM_USER,
            value: value, permissionRead: 0, permissionWrite: 0
        }]);
    } catch (e) { /* best-effort */ }
}

function fcIsoNow() { return new Date().toISOString(); }

// Truncate a string to N bytes (safely — doesn't split UTF-8 surrogates).
function fcTruncate(s, maxBytes) {
    if (!s || typeof s !== "string") return s;
    if (s.length <= maxBytes) return s;
    return s.slice(0, maxBytes) + "\n\n[… truncated at " + maxBytes + " bytes …]";
}

// Safe doc_id from a URL (strips protocol, replaces unsafe chars).
function fcDocId(url, tag) {
    var slug = String(url || "")
        .replace(/^https?:\/\//, "")
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase()
        .slice(0, 80);
    if (tag) slug = tag.replace(/\s+/g, "_").replace(/[^a-z0-9_]/gi, "").slice(0, 20) + "_" + slug;
    return slug + "_" + Math.floor(Date.now() / 1000);
}

// ─── Firecrawl HTTP client ───────────────────────────────────────────────────

/**
 * Call the Firecrawl REST API.
 * Returns { ok, code, data } — data is already JSON-parsed on success.
 */
function fcHttp(ctx, nk, logger, method, path, body) {
    var apiKey  = fcEnv(ctx, "FIRECRAWL_API_KEY");
    if (!apiKey) return { ok: false, code: 0, data: null, error: "FIRECRAWL_API_KEY not configured" };

    var base    = fcEnv(ctx, "FIRECRAWL_BASE_URL") || FC_DEFAULT_BASE_URL;
    var timeout = parseInt(fcEnv(ctx, "FIRECRAWL_TIMEOUT_MS"), 10) || FC_DEFAULT_TIMEOUT;
    var url     = base.replace(/\/$/, "") + path;

    var headers = {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + apiKey
    };
    var bodyStr = (body == null) ? "" : (typeof body === "string" ? body : JSON.stringify(body));

    try {
        var resp = nk.httpRequest(url, method, headers, bodyStr, timeout);
        var code = (resp && resp.code) || 0;
        if (code >= 200 && code < 300) {
            var parsed = null;
            try { parsed = JSON.parse(resp.body || "{}"); } catch (e) { parsed = { raw: resp.body }; }
            return { ok: true, code: code, data: parsed, error: null };
        }
        logger.warn("[analytics_firecrawl] HTTP " + code + " " + method + " " + path +
            ": " + (resp && resp.body ? resp.body.slice(0, 300) : "no body"));
        return { ok: false, code: code, data: null,
                 error: "HTTP " + code + (resp && resp.body ? ": " + resp.body.slice(0, 200) : "") };
    } catch (e) {
        logger.warn("[analytics_firecrawl] request error " + method + " " + path + ": " + e.message);
        return { ok: false, code: 0, data: null, error: e.message };
    }
}

// ─── Action: scrape ──────────────────────────────────────────────────────────

/**
 * Scrape a single URL. Returns markdown + metadata + summary.
 * Stores result in external_intel_docs/<doc_id>.
 *
 * Options in data: url (required), doc_id, tag, formats (default: markdown),
 *                  only_main_content (default: true)
 */
function fcActionScrape(ctx, nk, logger, data) {
    var url = data.url;
    if (!url) return { ok: false, error: "url required" };

    var formats = Array.isArray(data.formats) ? data.formats : ["markdown"];
    var body = {
        url:             url,
        formats:         formats,
        onlyMainContent: data.only_main_content !== false
    };
    if (data.wait_for)   body.waitFor  = parseInt(data.wait_for, 10);
    if (data.timeout)    body.timeout  = parseInt(data.timeout, 10);

    var resp = fcHttp(ctx, nk, logger, "POST", "/v1/scrape", body);
    if (!resp.ok) return { ok: false, error: resp.error, code: resp.code };

    var result = resp.data && resp.data.data ? resp.data.data : (resp.data || {});
    var docId  = data.doc_id || fcDocId(url, data.tag || "scrape");
    var tag    = data.tag    || "scrape";

    var doc = {
        doc_id:        docId,
        url:           url,
        tag:           tag,
        source_action: "scrape",
        title:         (result.metadata && result.metadata.title) || null,
        description:   (result.metadata && result.metadata.description) || null,
        summary:       result.summary || null,
        markdown:      fcTruncate(result.markdown || "", FC_MAX_MARKDOWN_BYTES),
        links:         Array.isArray(result.links) ? result.links.slice(0, 50) : [],
        metadata:      result.metadata || {},
        scraped_at:    fcIsoNow()
    };
    fcWriteOne(nk, FC_INTEL_COLLECTION, docId, doc);
    fcUpdateMeta(nk, "scrape", docId);

    return { ok: true, doc_id: docId, url: url, tag: tag,
             title: doc.title, summary: doc.summary,
             markdown_bytes: (doc.markdown || "").length };
}

// ─── Action: extract ─────────────────────────────────────────────────────────

/**
 * LLM-structured extraction: give Firecrawl a URL + schema/prompt,
 * get back structured JSON fields.
 *
 * Options: url (or urls[]), prompt, schema (JSON object), doc_id, tag
 */
function fcActionExtract(ctx, nk, logger, data) {
    var urls = data.urls || (data.url ? [data.url] : null);
    if (!urls || urls.length === 0) return { ok: false, error: "url or urls required" };

    var body = { urls: urls };
    if (data.prompt) body.prompt = data.prompt;
    if (data.schema && typeof data.schema === "object") body.schema = data.schema;
    if (data.enable_web_search) body.enableWebSearch = true;

    var resp = fcHttp(ctx, nk, logger, "POST", "/v1/extract", body);
    if (!resp.ok) return { ok: false, error: resp.error, code: resp.code };

    var result = resp.data && resp.data.data ? resp.data.data : (resp.data || {});
    var docId  = data.doc_id || fcDocId(urls[0], data.tag || "extract");
    var tag    = data.tag    || "extract";

    var doc = {
        doc_id:          docId,
        url:             urls[0],
        urls:            urls,
        tag:             tag,
        source_action:   "extract",
        prompt:          data.prompt || null,
        extracted_data:  result,
        scraped_at:      fcIsoNow()
    };
    fcWriteOne(nk, FC_INTEL_COLLECTION, docId, doc);
    fcUpdateMeta(nk, "extract", docId);

    return { ok: true, doc_id: docId, url: urls[0], tag: tag,
             extracted_data: result };
}

// ─── Action: search ──────────────────────────────────────────────────────────

/**
 * Web search: Firecrawl searches the web and returns scraped content
 * for the top N results.
 *
 * Options: query (required), limit (1–10), lang, country, doc_id, tag
 */
function fcActionSearch(ctx, nk, logger, data) {
    var query = data.query;
    if (!query) return { ok: false, error: "query required" };

    var limit  = Math.min(FC_MAX_SEARCH_RESULTS, Math.max(1, parseInt(data.limit, 10) || 5));
    var body   = { query: query, limit: limit };
    if (data.lang)    body.lang    = data.lang;
    if (data.country) body.country = data.country;
    if (data.scrape_options) body.scrapeOptions = data.scrape_options;

    var resp = fcHttp(ctx, nk, logger, "POST", "/v1/search", body);
    if (!resp.ok) return { ok: false, error: resp.error, code: resp.code };

    var results = (resp.data && resp.data.data) ? resp.data.data : [];
    var tag     = data.tag || "search";
    var stored  = [];

    for (var i = 0; i < results.length && i < limit; i++) {
        var r    = results[i];
        var dId  = data.doc_id
            ? data.doc_id + "_" + i
            : fcDocId(r.url || query, tag);
        var doc  = {
            doc_id:        dId,
            url:           r.url           || null,
            tag:           tag,
            query:         query,
            source_action: "search",
            title:         r.title         || (r.metadata && r.metadata.title) || null,
            description:   r.description   || (r.metadata && r.metadata.description) || null,
            markdown:      fcTruncate(r.markdown || "", FC_MAX_MARKDOWN_BYTES),
            metadata:      r.metadata      || {},
            result_index:  i,
            scraped_at:    fcIsoNow()
        };
        fcWriteOne(nk, FC_INTEL_COLLECTION, dId, doc);
        stored.push({ doc_id: dId, url: doc.url, title: doc.title });
    }
    fcUpdateMeta(nk, "search", stored.length > 0 ? stored[0].doc_id : query);

    return { ok: true, query: query, tag: tag,
             results_stored: stored.length, docs: stored };
}

// ─── Action: map ─────────────────────────────────────────────────────────────

/**
 * URL map: discover all URLs on a domain/path. Returns a list of links,
 * stored as a single intel document.
 *
 * Options: url (required), limit (default 100), include_subdomains, doc_id, tag
 */
function fcActionMap(ctx, nk, logger, data) {
    var url = data.url;
    if (!url) return { ok: false, error: "url required" };

    var limit = Math.min(5000, Math.max(1, parseInt(data.limit, 10) || 100));
    var body  = { url: url, limit: limit };
    if (data.include_subdomains) body.includeSubdomains = true;
    if (data.search)             body.search = data.search;

    var resp = fcHttp(ctx, nk, logger, "POST", "/v1/map", body);
    if (!resp.ok) return { ok: false, error: resp.error, code: resp.code };

    var links  = (resp.data && resp.data.links) ? resp.data.links : [];
    var docId  = data.doc_id || fcDocId(url, data.tag || "map");
    var tag    = data.tag    || "map";

    var doc = {
        doc_id:        docId,
        url:           url,
        tag:           tag,
        source_action: "map",
        links:         links,
        link_count:    links.length,
        scraped_at:    fcIsoNow()
    };
    fcWriteOne(nk, FC_INTEL_COLLECTION, docId, doc);
    fcUpdateMeta(nk, "map", docId);

    return { ok: true, doc_id: docId, url: url, tag: tag,
             link_count: links.length };
}

// ─── Action: crawl_start ─────────────────────────────────────────────────────

/**
 * Start an async multi-page crawl. Returns a job_id to poll with crawl_status.
 *
 * Options: url (required), max_depth (default 2), limit (default 20),
 *          include_paths (string[]), exclude_paths (string[]), tag
 */
function fcActionCrawlStart(ctx, nk, logger, data) {
    var url = data.url;
    if (!url) return { ok: false, error: "url required" };

    var maxDepth = Math.min(5, Math.max(1, parseInt(data.max_depth, 10) || 2));
    var pageLimit = Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20));
    var tag = data.tag || "crawl";

    var body = {
        url:          url,
        maxDepth:     maxDepth,
        limit:        pageLimit,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true }
    };
    if (Array.isArray(data.include_paths)) body.includePaths = data.include_paths;
    if (Array.isArray(data.exclude_paths)) body.excludePaths = data.exclude_paths;

    var resp = fcHttp(ctx, nk, logger, "POST", "/v1/crawl", body);
    if (!resp.ok) return { ok: false, error: resp.error, code: resp.code };

    var jobId = (resp.data && (resp.data.id || resp.data.jobId)) || null;
    if (!jobId) return { ok: false, error: "no job_id in response", raw: resp.data };

    var jobDoc = {
        job_id:         jobId,
        url:            url,
        tag:            tag,
        max_depth:      maxDepth,
        page_limit:     pageLimit,
        status:         "pending",
        pages_stored:   0,
        started_at:     fcIsoNow(),
        last_checked_at: null,
        completed_at:   null
    };
    fcWriteOne(nk, FC_JOBS_COLLECTION, jobId, jobDoc);
    fcUpdateMeta(nk, "crawl_start", jobId);

    return { ok: true, job_id: jobId, url: url, tag: tag,
             hint: "Call analytics_firecrawl_run with action=crawl_status and job_id=" + jobId +
                   " to poll results." };
}

// ─── Action: crawl_status ────────────────────────────────────────────────────

/**
 * Poll a crawl job and store any completed pages as intel documents.
 *
 * Options: job_id (required), tag
 */
function fcActionCrawlStatus(ctx, nk, logger, data) {
    var jobId = data.job_id || data.jobId;
    if (!jobId) return { ok: false, error: "job_id required" };

    var resp = fcHttp(ctx, nk, logger, "GET", "/v1/crawl/" + jobId, null);
    if (!resp.ok) return { ok: false, error: resp.error, code: resp.code, job_id: jobId };

    var rd    = resp.data || {};
    var status = rd.status || "unknown";
    var pages  = Array.isArray(rd.data) ? rd.data : [];
    var tag    = data.tag || (fcReadOne(nk, FC_JOBS_COLLECTION, jobId) || {}).tag || "crawl";

    var stored  = [];
    var toStore = pages.slice(0, FC_MAX_CRAWL_PAGES);

    for (var pi = 0; pi < toStore.length; pi++) {
        var p    = toStore[pi];
        var pUrl = p.url || p.metadata && p.metadata.url || ("page_" + pi);
        var dId  = fcDocId(pUrl, tag) + "_" + pi;
        var doc  = {
            doc_id:        dId,
            url:           pUrl,
            tag:           tag,
            job_id:        jobId,
            source_action: "crawl",
            title:         (p.metadata && p.metadata.title) || null,
            summary:       p.summary || null,
            markdown:      fcTruncate(p.markdown || "", FC_MAX_MARKDOWN_BYTES),
            metadata:      p.metadata || {},
            page_index:    pi,
            scraped_at:    fcIsoNow()
        };
        fcWriteOne(nk, FC_INTEL_COLLECTION, dId, doc);
        stored.push({ doc_id: dId, url: pUrl });
    }

    // Update job state.
    var jobDoc = fcReadOne(nk, FC_JOBS_COLLECTION, jobId) || { job_id: jobId };
    jobDoc.status           = status;
    jobDoc.pages_stored     = (jobDoc.pages_stored || 0) + stored.length;
    jobDoc.pages_total      = rd.total || pages.length;
    jobDoc.completed_pages  = rd.completed || pages.length;
    jobDoc.last_checked_at  = fcIsoNow();
    if (status === "completed" || status === "done") {
        jobDoc.completed_at = fcIsoNow();
    }
    fcWriteOne(nk, FC_JOBS_COLLECTION, jobId, jobDoc);
    fcUpdateMeta(nk, "crawl_status", jobId);

    return {
        ok:            true,
        job_id:        jobId,
        status:        status,
        pages_total:   jobDoc.pages_total   || 0,
        pages_stored:  stored.length,
        docs:          stored,
        completed:     (status === "completed" || status === "done")
    };
}

// ─── Meta bookkeeping ────────────────────────────────────────────────────────

function fcUpdateMeta(nk, action, lastDocId) {
    try {
        var m = fcReadOne(nk, FC_META_COLLECTION, "last_status") || {};
        m.last_action    = action;
        m.last_doc_id    = lastDocId;
        m.last_run_at    = fcIsoNow();
        m.run_count      = (m.run_count || 0) + 1;
        fcWriteOne(nk, FC_META_COLLECTION, "last_status", m);
    } catch (e) { /* best-effort */ }
}

// ─── RPC: analytics_firecrawl_run ────────────────────────────────────────────

/**
 * Main entry-point. Routes on `action` field.
 *
 * Payload:
 *   action         : "scrape" | "extract" | "search" | "map" |
 *                    "crawl_start" | "crawl_status"
 *   url            : required for scrape/extract/map/crawl_start
 *   urls           : string[] for extract (multiple URLs)
 *   query          : required for search
 *   job_id         : required for crawl_status
 *   doc_id         : optional custom storage key
 *   tag            : optional label for grouping intel docs
 *   prompt         : extract only — LLM prompt
 *   schema         : extract only — JSON schema object
 *   limit          : search (1–10) / crawl (pages, 1–100) / map (URLs)
 *   max_depth      : crawl_start only (1–5, default 2)
 *   dashboard_secret : admin auth
 */
function rpcAnalyticsFirecrawlRun(ctx, logger, nk, payload) {
    if (!fcFeatureEnabled(ctx)) {
        return fcErr("Firecrawl disabled (FIRECRAWL_ENABLED=false)", 503);
    }
    var data = fcParse(payload);
    var gate = fcRequireAdmin(ctx, nk, data);
    if (!gate.ok) return fcErr(gate.reason, 401);

    var apiKey = fcEnv(ctx, "FIRECRAWL_API_KEY");
    if (!apiKey) {
        return fcErr("FIRECRAWL_API_KEY environment variable not set. " +
                     "Set it in your Nakama deployment config.", 503);
    }

    var action = (data.action || "scrape").toLowerCase();
    var result;

    switch (action) {
        case "scrape":
            result = fcActionScrape(ctx, nk, logger, data);
            break;
        case "extract":
            result = fcActionExtract(ctx, nk, logger, data);
            break;
        case "search":
            result = fcActionSearch(ctx, nk, logger, data);
            break;
        case "map":
            result = fcActionMap(ctx, nk, logger, data);
            break;
        case "crawl_start":
            result = fcActionCrawlStart(ctx, nk, logger, data);
            break;
        case "crawl_status":
            result = fcActionCrawlStatus(ctx, nk, logger, data);
            break;
        default:
            return fcErr("Unknown action '" + action + "'. Valid: scrape, extract, " +
                         "search, map, crawl_start, crawl_status", 400);
    }

    if (!result.ok) {
        return fcErr(result.error || "action failed", result.code || 500);
    }

    // Echo the action for client clarity.
    result.action = action;
    return fcOk(result);
}

// ─── RPC: analytics_firecrawl_intel ──────────────────────────────────────────

/**
 * Read stored intel documents.
 *
 * Payload:
 *   doc_id   : read one specific document
 *   tag      : filter by tag (scans list, returns matching)
 *   limit    : 1–100, default 20
 *   cursor   : pagination cursor
 */
function rpcAnalyticsFirecrawlIntel(ctx, logger, nk, payload) {
    var data = fcParse(payload);
    var gate = fcRequireAdmin(ctx, nk, data);
    if (!gate.ok) return fcErr(gate.reason, 401);

    // Single doc read.
    if (data.doc_id) {
        var doc = fcReadOne(nk, FC_INTEL_COLLECTION, data.doc_id);
        if (!doc) return fcErr("doc_id not found: " + data.doc_id, 404);
        return fcOk({ doc: doc });
    }

    // List (with optional tag filter).
    var limit      = Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20));
    var cursor     = data.cursor || "";
    var tagFilter  = data.tag || null;

    var docs       = [];
    var nextCursor = null;

    try {
        var r = nk.storageList(FC_SYSTEM_USER, FC_INTEL_COLLECTION, limit * 3, cursor);
        var items = (r && r.objects) ? r.objects : [];
        nextCursor = (r && r.cursor) ? r.cursor : null;

        for (var i = 0; i < items.length && docs.length < limit; i++) {
            var v = items[i].value;
            if (!v) continue;
            if (tagFilter && v.tag !== tagFilter) continue;
            // Return a slim summary (skip full markdown to keep payload small).
            docs.push({
                doc_id:        v.doc_id,
                url:           v.url           || null,
                tag:           v.tag           || null,
                title:         v.title         || null,
                summary:       v.summary       || null,
                source_action: v.source_action || null,
                scraped_at:    v.scraped_at    || null,
                markdown_bytes: v.markdown ? v.markdown.length : 0,
                job_id:        v.job_id        || null
            });
        }
    } catch (e) {
        logger.warn("[analytics_firecrawl] intel list error: " + e.message);
        return fcErr("list error: " + e.message, 500);
    }

    return fcOk({
        docs:        docs,
        count:       docs.length,
        next_cursor: nextCursor || null,
        has_more:    !!(nextCursor),
        tag_filter:  tagFilter
    });
}

// ─── RPC: analytics_firecrawl_status ─────────────────────────────────────────

/**
 * Engine status: last runs, pending crawl jobs, config fingerprint.
 */
function rpcAnalyticsFirecrawlStatus(ctx, logger, nk, payload) {
    var data = fcParse(payload);
    var gate = fcRequireAdmin(ctx, nk, data);
    if (!gate.ok) return fcErr(gate.reason, 401);

    var meta    = fcReadOne(nk, FC_META_COLLECTION, "last_status") || {};
    var apiKey  = fcEnv(ctx, "FIRECRAWL_API_KEY");
    var baseUrl = fcEnv(ctx, "FIRECRAWL_BASE_URL") || FC_DEFAULT_BASE_URL;

    // List pending/recent jobs.
    var jobs = [];
    try {
        var jr = nk.storageList(FC_SYSTEM_USER, FC_JOBS_COLLECTION, 20, "");
        if (jr && jr.objects) {
            for (var i = 0; i < jr.objects.length; i++) {
                var j = jr.objects[i].value;
                if (j) jobs.push({
                    job_id:         j.job_id,
                    url:            j.url,
                    tag:            j.tag,
                    status:         j.status,
                    pages_stored:   j.pages_stored,
                    started_at:     j.started_at,
                    completed_at:   j.completed_at
                });
            }
        }
    } catch (e) { /* ignore */ }

    // Count intel docs.
    var docCount = 0;
    try {
        var dr = nk.storageList(FC_SYSTEM_USER, FC_INTEL_COLLECTION, 1, "");
        if (dr && dr.objects) docCount = dr.objects.length;
    } catch (e) { /* */ }

    function fp(s) {
        if (!s || s.length === 0) return null;
        return s.slice(0, 4) + "…" + s.slice(-4) + " (len=" + s.length + ")";
    }

    return fcOk({
        enabled:          fcFeatureEnabled(ctx),
        api_key_fp:       fp(apiKey),
        base_url:         baseUrl,
        timeout_ms:       parseInt(fcEnv(ctx, "FIRECRAWL_TIMEOUT_MS"), 10) || FC_DEFAULT_TIMEOUT,
        last_action:      meta.last_action   || null,
        last_run_at:      meta.last_run_at   || null,
        run_count:        meta.run_count     || 0,
        intel_docs_visible: docCount,
        crawl_jobs:       jobs,
        valid_actions:    ["scrape","extract","search","map","crawl_start","crawl_status"],
        use_case_tags:    ["app_store_reviews","competitor_pricing","release_notes",
                           "market_signals","public_docs","player_feedback"],
        checked_at:       fcIsoNow()
    });
}

// ─── Registration ─────────────────────────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_firecrawl_run",    rpcAnalyticsFirecrawlRun);
    initializer.registerRpc("analytics_firecrawl_intel",  rpcAnalyticsFirecrawlIntel);
    initializer.registerRpc("analytics_firecrawl_status", rpcAnalyticsFirecrawlStatus);
    logger.info("[analytics_firecrawl] Registered: analytics_firecrawl_run (actions: scrape, " +
                "extract, search, map, crawl_start, crawl_status), " +
                "analytics_firecrawl_intel, analytics_firecrawl_status. " +
                "Requires FIRECRAWL_API_KEY env var.");
}
