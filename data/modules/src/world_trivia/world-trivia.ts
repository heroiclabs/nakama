/**
 * WorldTrivia — playable world templates game loop for Intelliverse.
 *
 * The founder's loop: a player moves through a generated 3D world, hits
 * CHECKPOINTS, answers a TRIVIA QUESTION at each, and may FINISH after 5
 * CORRECT answers. ALWAYS-UNIQUE COLORED OBJECTS spawn per session as a
 * scavenger-hunt secondary mechanic (uniqueness via seeded RNG from the
 * server-generated sessionId). Full design: docs/worlds/game-loop.md.
 *
 * Follows the router-wallet module conventions: global namespace, storage
 * objects owned by the SYSTEM user, {success,data}/{success,error} envelopes,
 * optimistic concurrency control with up to 3 retries on session mutations.
 *
 * Everything is App-ID scoped (multi-tenant): templates, trivia packs, and
 * sessions all carry an appId consistent with the repo's "apps" model.
 *
 * Auth split:
 *  - authoring RPCs (world_template_upsert, world_trivia_pack_upsert) are
 *    SERVER-TO-SERVER ONLY (http_key), like all router_wallet RPCs;
 *  - gameplay RPCs require an authenticated Nakama user (ctx.userId) and
 *    verify session ownership — the game is server-authoritative, the client
 *    never grades answers or counts progress.
 *
 * Drop-in module for nakama-multiplayer-kernel: copy this folder to
 * data/modules/src/world_trivia/ and call WorldTrivia.register(initializer)
 * from main.ts InitModule. Self-contained; the router-wallet finish-reward
 * hook resolves RouterWallet softly at call time and is skipped when the
 * wallet module is not installed.
 */
namespace WorldTrivia {

  export var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
  export var TEMPLATES_COLLECTION = "world_templates";
  export var PACKS_COLLECTION = "trivia_packs";
  export var SESSIONS_COLLECTION = "world_sessions";
  export var LEADERBOARDS_COLLECTION = "world_leaderboards";
  export var MAX_OCC_RETRIES = 3;

  export var SCORE_CORRECT = 100;
  export var SCORE_OBJECT_FOUND = 25;
  export var SCORE_FINISH_BONUS = 250;
  export var IDLE_EXPIRY_MS = 30 * 60 * 1000;
  export var LEADERBOARD_SIZE = 100;
  // Tolerance multipliers for proximity checks (client lag / interpolation).
  export var PROXIMITY_SLACK = 1.5;
  // Fraction of the theoretical minimum travel time we actually require
  // (20% slack for lag and legitimate shortcuts).
  export var SPEED_SLACK = 0.8;
  // XOR stream separator so the question shuffle and the object layout draw
  // from independent RNG streams of the same session seed.
  export var QUESTION_STREAM = 0x51ab9e3d;
  export var OBJECT_SHAPES = ["sphere", "cube", "cone", "torus"];

  export var DEFAULT_SETTINGS: TemplateSettings = {
    requiredCorrect: 5,      // the founder's completion rule
    objectCount: 8,
    maxSpeed: 10,            // m/s movement sanity bound
    maxAnswerSeconds: 60,
    collectRadius: 3,
    finishRewardCredits: 0   // iv_credits via router-wallet on finish
  };

  // ---- types ----

  export interface Vec3 { x: number; y: number; z: number; }

  export interface Checkpoint {
    id: string;
    name: string;
    position: Vec3;
    radius: number;
  }

  export interface ScavengerVolume { min: Vec3; max: Vec3; }

  export interface TemplateSettings {
    requiredCorrect: number;
    objectCount: number;
    maxSpeed: number;
    maxAnswerSeconds: number;
    collectRadius: number;
    finishRewardCredits: number;
  }

  export interface WorldTemplate {
    appId: string;
    templateId: string;
    name: string;
    packId: string;
    assets: { splatUrl?: string; meshUrl?: string };
    spawnPoint: Vec3;
    checkpoints: Checkpoint[];
    scavengerVolumes: ScavengerVolume[];
    settings: TemplateSettings;
    updatedAt: string;
  }

  export interface TriviaQuestion {
    id: string;
    text: string;
    choices: string[];
    correctIndex: number; // server-side only; never sent pre-answer
    category?: string;
  }

  export interface TriviaPack {
    appId: string;
    packId: string;
    questions: TriviaQuestion[];
    updatedAt: string;
  }

  export interface ScavengerObject {
    id: string;
    color: string;   // hex, unique within the session
    shape: string;
    position: Vec3;
  }

  export interface PendingQuestion {
    questionId: string;
    checkpointId: string;
    issuedAtMs: number;
  }

  export interface SessionValue {
    sessionId: string;
    appId: string;
    userId: string;
    templateId: string;
    packId: string;
    seed: number;                 // fnv1a32(sessionId)
    status: string;               // active | finished | abandoned
    lap: number;
    visitedCheckpoints: string[]; // current lap
    pendingQuestion: PendingQuestion | null;
    questionQueue: string[];      // seeded shuffle; server-only, never sent
    askedQuestionIds: string[];
    correctCount: number;
    wrongCount: number;
    finishEligible: boolean;
    objects: ScavengerObject[];
    objectsFound: string[];
    score: number;
    lastPosition: Vec3;
    lastEventAtMs: number;
    startedAtMs: number;
    finishedAtMs: number | null;
    version: number;              // logical revision (OCC uses storage version)
  }

  export interface LeaderboardEntry {
    sessionId: string;
    userId: string;
    score: number;
    correctCount: number;
    wrongCount: number;
    objectsFound: number;
    durationMs: number;
    finishedAt: string;
  }

  // ---- seeded RNG (duplicated verbatim in worlds-viewer/js/seeded.js so the
  // client can re-derive and assert the scavenger layout from the seed) ----

  var imul = (Math as any).imul || function (a: number, b: number): number {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff;
    var bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
  };

  /** FNV-1a 32-bit hash — session seed derivation from the sessionId UUID. */
  export function fnv1a32(str: string): number {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h = (h ^ str.charCodeAt(i)) >>> 0;
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /** mulberry32 PRNG — tiny, fast, deterministic across JS runtimes. */
  export function mulberry32(seed: number): () => number {
    var a = seed >>> 0;
    return function (): number {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = imul(t ^ (t >>> 15), t | 1);
      t = (t ^ (t + imul(t ^ (t >>> 7), t | 61))) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hslToHex(h: number, s: number, l: number): string {
    var sn = s / 100, ln = l / 100;
    var c = (1 - Math.abs(2 * ln - 1)) * sn;
    var hp = (((h % 360) + 360) % 360) / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = ln - c / 2;
    function hex(v: number): string {
      var n = Math.round((v + m) * 255);
      var out = n.toString(16);
      return out.length === 1 ? "0" + out : out;
    }
    return "#" + hex(r) + hex(g) + hex(b);
  }

  /**
   * Derive the per-session scavenger layout from the seed. Colors are unique
   * within the session by construction: a random start hue, then even
   * 360/N spacing with ±10° jitter (spacing 45° at N=8, so hues can never
   * collide), fixed saturation/lightness. Draw order per object is fixed
   * (jitter, volume, x, y, z) — the viewer replays it byte-for-byte.
   */
  export function deriveObjects(seed: number, count: number, volumes: ScavengerVolume[]): ScavengerObject[] {
    var rnd = mulberry32(seed);
    var startHue = Math.floor(rnd() * 360);
    var objects: ScavengerObject[] = [];
    for (var i = 0; i < count; i++) {
      var jitter = rnd() * 20 - 10;
      var vol = volumes[Math.floor(rnd() * volumes.length)];
      var x = vol.min.x + rnd() * (vol.max.x - vol.min.x);
      var y = vol.min.y + rnd() * (vol.max.y - vol.min.y);
      var z = vol.min.z + rnd() * (vol.max.z - vol.min.z);
      var hue = startHue + (i * 360) / count + jitter;
      objects.push({
        id: "obj-" + (i + 1),
        color: hslToHex(hue, 70, 55),
        shape: OBJECT_SHAPES[i % OBJECT_SHAPES.length],
        position: { x: x, y: y, z: z }
      });
    }
    return objects;
  }

  export function shuffleIds(ids: string[], rnd: () => number): string[] {
    var out = ids.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  // ---- helpers ----

  function ok(data: any): string {
    return JSON.stringify({ success: true, data: data });
  }

  function err(message: string): string {
    return JSON.stringify({ success: false, error: message });
  }

  function parsePayload(payload: string): any {
    if (!payload || payload === "") return {};
    return JSON.parse(payload);
  }

  /** Authoring RPCs are server-to-server only (http_key auth). */
  function requireServerToServer(ctx: nkruntime.Context): void {
    if (ctx.userId) {
      throw new Error("world_trivia authoring RPCs are server-to-server only");
    }
  }

  /** Gameplay RPCs require an authenticated Nakama user session. */
  function requireUser(ctx: nkruntime.Context): string {
    if (!ctx.userId) {
      throw new Error("world_trivia gameplay RPCs require an authenticated user session");
    }
    return ctx.userId;
  }

  function validateVec3(v: any, label: string): Vec3 {
    if (!v || typeof v.x !== "number" || typeof v.y !== "number" || typeof v.z !== "number"
      || !isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) {
      throw new Error(label + " must be {x, y, z} numbers");
    }
    return { x: v.x, y: v.y, z: v.z };
  }

  function dist(a: Vec3, b: Vec3): number {
    var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function nowMs(): number {
    return Date.now();
  }

  // ---- storage ----

  function templateKey(appId: string, templateId: string): string {
    return "template_" + appId + "_" + templateId;
  }

  function packKey(appId: string, packId: string): string {
    return "pack_" + appId + "_" + packId;
  }

  function sessionKey(sessionId: string): string {
    return "session_" + sessionId;
  }

  function leaderboardKey(appId: string, templateId: string): string {
    return "lb_" + appId + "_" + templateId;
  }

  function readSystemObject(nk: nkruntime.Nakama, collection: string, key: string): { value: any; storageVersion: string } {
    var records = nk.storageRead([{ collection: collection, key: key, userId: SYSTEM_USER_ID }]);
    if (records && records.length > 0 && records[0].value) {
      return { value: records[0].value, storageVersion: records[0].version };
    }
    return { value: null, storageVersion: "*" };
  }

  function writeSystemObject(nk: nkruntime.Nakama, collection: string, key: string, value: any, storageVersion?: string): void {
    var write: any = {
      collection: collection,
      key: key,
      userId: SYSTEM_USER_ID,
      value: value,
      permissionRead: 0 as nkruntime.ReadPermissionValues,
      permissionWrite: 0 as nkruntime.WritePermissionValues
    };
    if (storageVersion) write.version = storageVersion;
    nk.storageWrite([write]);
  }

  function readTemplate(nk: nkruntime.Nakama, appId: string, templateId: string): WorldTemplate | null {
    return readSystemObject(nk, TEMPLATES_COLLECTION, templateKey(appId, templateId)).value as WorldTemplate | null;
  }

  function readPack(nk: nkruntime.Nakama, appId: string, packId: string): TriviaPack | null {
    return readSystemObject(nk, PACKS_COLLECTION, packKey(appId, packId)).value as TriviaPack | null;
  }

  /**
   * Read-mutate-write on a session with OCC — identical shape to
   * router-wallet's mutateWallet: business errors thrown by the mutator abort
   * immediately, storage version conflicts retry up to MAX_OCC_RETRIES.
   */
  function mutateSession(nk: nkruntime.Nakama, sessionId: string, mutator: (session: SessionValue) => void): SessionValue {
    var lastError: any = null;
    for (var attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
      var read = readSystemObject(nk, SESSIONS_COLLECTION, sessionKey(sessionId));
      var session = read.value as SessionValue | null;
      if (!session) throw new Error("Session not found: " + sessionId);
      mutator(session);
      session.version = (session.version || 0) + 1;
      try {
        writeSystemObject(nk, SESSIONS_COLLECTION, sessionKey(sessionId), session, read.storageVersion);
        return session;
      } catch (e: any) {
        lastError = e; // version conflict — re-read and retry
      }
    }
    throw new Error("Session write conflict after " + MAX_OCC_RETRIES + " retries: " + (lastError && lastError.message ? lastError.message : String(lastError)));
  }

  // ---- session guards (run inside mutators) ----

  function requireOwnedActive(session: SessionValue, userId: string): void {
    if (session.userId !== userId) {
      throw new Error("Session does not belong to the caller");
    }
    if (session.status !== "active") {
      throw new Error("Session is " + session.status);
    }
  }

  /**
   * Lazy idle expiry: sessions untouched for IDLE_EXPIRY_MS flip to abandoned
   * on the next access instead of via a cron. Returns true when this call
   * performed the flip (the caller persists it and rejects the gameplay op).
   */
  function expireIfIdle(session: SessionValue, now: number): boolean {
    if (now - session.lastEventAtMs > IDLE_EXPIRY_MS) {
      session.status = "abandoned";
      session.finishedAtMs = now;
      return true;
    }
    return false;
  }

  /**
   * Movement sanity: covering distance d from the last validated position
   * must take at least d / maxSpeed * SPEED_SLACK. Rejects teleports without
   * punishing ordinary lag.
   */
  function requireSaneMovement(session: SessionValue, position: Vec3, now: number, maxSpeed: number): void {
    var d = dist(session.lastPosition, position);
    var minMs = (d / maxSpeed) * SPEED_SLACK * 1000;
    if (now - session.lastEventAtMs < minMs) {
      throw new Error("Movement too fast: " + Math.round(d) + "m in " + (now - session.lastEventAtMs) + "ms exceeds maxSpeed " + maxSpeed + "m/s");
    }
  }

  function questionExpired(pending: PendingQuestion, now: number, maxAnswerSeconds: number): boolean {
    return now - pending.issuedAtMs > maxAnswerSeconds * 1000;
  }

  // ---- client views (redaction) ----

  function checkpointView(cp: Checkpoint) {
    return { id: cp.id, name: cp.name, position: cp.position, radius: cp.radius };
  }

  function settingsView(s: TemplateSettings) {
    return {
      requiredCorrect: s.requiredCorrect,
      objectCount: s.objectCount,
      maxSpeed: s.maxSpeed,
      maxAnswerSeconds: s.maxAnswerSeconds,
      collectRadius: s.collectRadius
    };
  }

  /** Question as issued to the player — never includes correctIndex. */
  function questionView(q: TriviaQuestion) {
    var view: any = { questionId: q.id, text: q.text, choices: q.choices };
    if (q.category) view.category = q.category;
    return view;
  }

  /**
   * The session manifest the client renders from. Redacts the question queue
   * (order would leak upcoming questions) and all grading state internals;
   * includes the seed so the viewer can re-derive and assert the scavenger
   * layout (contract check on the shared RNG).
   */
  function sessionView(session: SessionValue, template: WorldTemplate) {
    var checkpoints = [];
    for (var i = 0; i < template.checkpoints.length; i++) checkpoints.push(checkpointView(template.checkpoints[i]));
    return {
      sessionId: session.sessionId,
      appId: session.appId,
      templateId: session.templateId,
      status: session.status,
      seed: session.seed,
      assets: template.assets,
      spawnPoint: template.spawnPoint,
      checkpoints: checkpoints,
      objects: session.objects,
      objectsFound: session.objectsFound,
      visitedCheckpoints: session.visitedCheckpoints,
      lap: session.lap,
      correctCount: session.correctCount,
      wrongCount: session.wrongCount,
      finishEligible: session.finishEligible,
      score: session.score,
      settings: settingsView(template.settings),
      startedAtMs: session.startedAtMs
    };
  }

  function progressView(session: SessionValue, template: WorldTemplate) {
    return {
      correctCount: session.correctCount,
      wrongCount: session.wrongCount,
      requiredCorrect: template.settings.requiredCorrect,
      finishEligible: session.finishEligible,
      score: session.score,
      lap: session.lap,
      objectsFound: session.objectsFound.length,
      objectCount: session.objects.length
    };
  }

  // ---- RPC handlers: authoring (s2s only) ----

  export function rpcTemplateUpsert(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      requireServerToServer(ctx);
      var data = parsePayload(payload);
      if (!data.appId) return err("appId required");
      if (!data.templateId) return err("templateId required");
      if (!data.packId) return err("packId required");
      if (!data.checkpoints || !data.checkpoints.length) return err("checkpoints required (non-empty array)");
      if (!data.scavengerVolumes || !data.scavengerVolumes.length) return err("scavengerVolumes required (non-empty array)");

      var checkpoints: Checkpoint[] = [];
      var seenIds: { [id: string]: boolean } = {};
      for (var i = 0; i < data.checkpoints.length; i++) {
        var cp = data.checkpoints[i];
        if (!cp.id) throw new Error("checkpoint[" + i + "].id required");
        if (seenIds[cp.id]) throw new Error("duplicate checkpoint id: " + cp.id);
        seenIds[cp.id] = true;
        checkpoints.push({
          id: cp.id,
          name: cp.name || cp.id,
          position: validateVec3(cp.position, "checkpoint[" + i + "].position"),
          radius: typeof cp.radius === "number" && cp.radius > 0 ? cp.radius : 5
        });
      }

      var volumes: ScavengerVolume[] = [];
      for (var v = 0; v < data.scavengerVolumes.length; v++) {
        volumes.push({
          min: validateVec3(data.scavengerVolumes[v].min, "scavengerVolumes[" + v + "].min"),
          max: validateVec3(data.scavengerVolumes[v].max, "scavengerVolumes[" + v + "].max")
        });
      }

      var settings: TemplateSettings = {
        requiredCorrect: DEFAULT_SETTINGS.requiredCorrect,
        objectCount: DEFAULT_SETTINGS.objectCount,
        maxSpeed: DEFAULT_SETTINGS.maxSpeed,
        maxAnswerSeconds: DEFAULT_SETTINGS.maxAnswerSeconds,
        collectRadius: DEFAULT_SETTINGS.collectRadius,
        finishRewardCredits: DEFAULT_SETTINGS.finishRewardCredits
      };
      var overrides = data.settings || {};
      for (var key in settings) {
        if (typeof overrides[key] === "number" && isFinite(overrides[key]) && overrides[key] >= 0) {
          (settings as any)[key] = overrides[key];
        }
      }
      if (settings.requiredCorrect < 1) settings.requiredCorrect = 1;

      var template: WorldTemplate = {
        appId: data.appId,
        templateId: data.templateId,
        name: data.name || data.templateId,
        packId: data.packId,
        assets: data.assets || {},
        spawnPoint: data.spawnPoint ? validateVec3(data.spawnPoint, "spawnPoint") : { x: 0, y: 0, z: 0 },
        checkpoints: checkpoints,
        scavengerVolumes: volumes,
        settings: settings,
        updatedAt: new Date().toISOString()
      };

      writeSystemObject(nk, TEMPLATES_COLLECTION, templateKey(data.appId, data.templateId), template);
      return ok(template);
    } catch (e: any) {
      return err(e.message || "world_template_upsert failed");
    }
  }

  export function rpcPackUpsert(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      requireServerToServer(ctx);
      var data = parsePayload(payload);
      if (!data.appId) return err("appId required");
      if (!data.packId) return err("packId required");
      if (!data.questions || !data.questions.length) return err("questions required (non-empty array)");

      var questions: TriviaQuestion[] = [];
      var seen: { [id: string]: boolean } = {};
      for (var i = 0; i < data.questions.length; i++) {
        var q = data.questions[i];
        if (!q.id) throw new Error("questions[" + i + "].id required");
        if (seen[q.id]) throw new Error("duplicate question id: " + q.id);
        seen[q.id] = true;
        if (!q.text) throw new Error("questions[" + i + "].text required");
        if (!q.choices || q.choices.length < 2) throw new Error("questions[" + i + "].choices requires at least 2 entries");
        var correctIndex = Number(q.correctIndex);
        if (!isFinite(correctIndex) || correctIndex !== Math.floor(correctIndex) || correctIndex < 0 || correctIndex >= q.choices.length) {
          throw new Error("questions[" + i + "].correctIndex out of range");
        }
        var question: TriviaQuestion = { id: q.id, text: q.text, choices: q.choices, correctIndex: correctIndex };
        if (q.category) question.category = q.category;
        questions.push(question);
      }

      var pack: TriviaPack = {
        appId: data.appId,
        packId: data.packId,
        questions: questions,
        updatedAt: new Date().toISOString()
      };
      writeSystemObject(nk, PACKS_COLLECTION, packKey(data.appId, data.packId), pack);
      return ok({ appId: data.appId, packId: data.packId, questionCount: questions.length });
    } catch (e: any) {
      return err(e.message || "world_trivia_pack_upsert failed");
    }
  }

  // ---- RPC handlers: gameplay (authenticated user) ----

  export function rpcSessionStart(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = requireUser(ctx);
      var data = parsePayload(payload);
      if (!data.appId) return err("appId required");
      if (!data.templateId) return err("templateId required");

      var template = readTemplate(nk, data.appId, data.templateId);
      if (!template) return err("Template not found: " + data.templateId + " (app " + data.appId + ")");
      var pack = readPack(nk, data.appId, template.packId);
      if (!pack) return err("Trivia pack not found: " + template.packId + " (app " + data.appId + ")");
      if (pack.questions.length < template.settings.requiredCorrect) {
        return err("Trivia pack " + template.packId + " has " + pack.questions.length + " questions; template requires " + template.settings.requiredCorrect + " correct answers");
      }

      var sessionId = nk.uuidv4();
      // Seed derivation: the sessionId is server-generated, so the seed is
      // unique per session and unforgeable by the client.
      var seed = fnv1a32(sessionId);

      var questionIds: string[] = [];
      for (var i = 0; i < pack.questions.length; i++) questionIds.push(pack.questions[i].id);
      var questionQueue = shuffleIds(questionIds, mulberry32((seed ^ QUESTION_STREAM) >>> 0));
      var objects = deriveObjects(seed, template.settings.objectCount, template.scavengerVolumes);

      var now = nowMs();
      var session: SessionValue = {
        sessionId: sessionId,
        appId: data.appId,
        userId: userId,
        templateId: data.templateId,
        packId: template.packId,
        seed: seed,
        status: "active",
        lap: 1,
        visitedCheckpoints: [],
        pendingQuestion: null,
        questionQueue: questionQueue,
        askedQuestionIds: [],
        correctCount: 0,
        wrongCount: 0,
        finishEligible: false,
        objects: objects,
        objectsFound: [],
        score: 0,
        lastPosition: template.spawnPoint,
        lastEventAtMs: now,
        startedAtMs: now,
        finishedAtMs: null,
        version: 0
      };

      writeSystemObject(nk, SESSIONS_COLLECTION, sessionKey(sessionId), session, "*");
      return ok(sessionView(session, template));
    } catch (e: any) {
      return err(e.message || "world_session_start failed");
    }
  }

  export function rpcSessionGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = requireUser(ctx);
      var data = parsePayload(payload);
      if (!data.sessionId) return err("sessionId required");
      var session = readSystemObject(nk, SESSIONS_COLLECTION, sessionKey(data.sessionId)).value as SessionValue | null;
      if (!session) return err("Session not found: " + data.sessionId);
      if (session.userId !== userId) return err("Session does not belong to the caller");
      var template = readTemplate(nk, session.appId, session.templateId);
      if (!template) return err("Template not found: " + session.templateId);
      return ok(sessionView(session, template));
    } catch (e: any) {
      return err(e.message || "world_session_get failed");
    }
  }

  export function rpcCheckpointReach(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = requireUser(ctx);
      var data = parsePayload(payload);
      if (!data.sessionId) return err("sessionId required");
      if (!data.checkpointId) return err("checkpointId required");
      var position = validateVec3(data.position, "position");

      var pre = readSystemObject(nk, SESSIONS_COLLECTION, sessionKey(data.sessionId)).value as SessionValue | null;
      if (!pre) return err("Session not found: " + data.sessionId);
      var template = readTemplate(nk, pre.appId, pre.templateId);
      if (!template) return err("Template not found: " + pre.templateId);
      var pack = readPack(nk, pre.appId, pre.packId);
      if (!pack) return err("Trivia pack not found: " + pre.packId);

      var now = nowMs();
      var expired = false;
      var issuedQuestionId = "";
      var expiredPrevious = false;

      var session = mutateSession(nk, data.sessionId, function (s) {
        requireOwnedActive(s, userId);
        if (expireIfIdle(s, now)) { expired = true; return; }

        var checkpoint: Checkpoint | null = null;
        for (var i = 0; i < template.checkpoints.length; i++) {
          if (template.checkpoints[i].id === data.checkpointId) { checkpoint = template.checkpoints[i]; break; }
        }
        if (!checkpoint) throw new Error("Unknown checkpoint: " + data.checkpointId);

        // A question left pending past its time budget counts as wrong and
        // unblocks the loop; a still-live one blocks new checkpoints.
        if (s.pendingQuestion) {
          if (questionExpired(s.pendingQuestion, now, template.settings.maxAnswerSeconds)) {
            s.wrongCount += 1;
            s.pendingQuestion = null;
            expiredPrevious = true;
          } else {
            throw new Error("Answer the pending question before reaching another checkpoint");
          }
        }

        // Checkpoints are unordered (free-roam) but once-per-lap. Exhausting
        // every checkpoint re-arms them all: a new lap costs travel time,
        // never a dead end (docs/worlds/game-loop.md §4).
        if (s.visitedCheckpoints.indexOf(checkpoint.id) !== -1) {
          if (s.visitedCheckpoints.length >= template.checkpoints.length) {
            s.lap += 1;
            s.visitedCheckpoints = [];
          } else {
            throw new Error("Checkpoint already visited this lap: " + checkpoint.id);
          }
        }

        if (dist(position, checkpoint.position) > checkpoint.radius * PROXIMITY_SLACK) {
          throw new Error("Position is not at checkpoint " + checkpoint.id);
        }
        requireSaneMovement(s, position, now, template.settings.maxSpeed);

        // No repeats within a session by construction: the queue is a seeded
        // shuffle of the whole pack. Only on full exhaustion (small pack +
        // many wrong answers) do asked questions recycle, reshuffled by lap.
        if (s.questionQueue.length === 0) {
          if (s.askedQuestionIds.length === 0) throw new Error("Trivia pack is empty");
          s.questionQueue = shuffleIds(s.askedQuestionIds, mulberry32((s.seed + s.lap) >>> 0));
          s.askedQuestionIds = [];
        }
        var qid = s.questionQueue.shift() as string;
        s.askedQuestionIds.push(qid);
        s.pendingQuestion = { questionId: qid, checkpointId: checkpoint.id, issuedAtMs: now };
        issuedQuestionId = qid;

        s.visitedCheckpoints.push(checkpoint.id);
        s.lastPosition = position;
        s.lastEventAtMs = now;
      });

      if (expired) return err("Session expired after " + (IDLE_EXPIRY_MS / 60000) + " minutes idle");

      var question: TriviaQuestion | null = null;
      for (var qi = 0; qi < pack.questions.length; qi++) {
        if (pack.questions[qi].id === issuedQuestionId) { question = pack.questions[qi]; break; }
      }
      if (!question) return err("Question " + issuedQuestionId + " missing from pack " + pre.packId);

      return ok({
        checkpointId: data.checkpointId,
        question: questionView(question),
        previousQuestionExpired: expiredPrevious,
        progress: progressView(session, template)
      });
    } catch (e: any) {
      return err(e.message || "world_checkpoint_reach failed");
    }
  }

  export function rpcAnswerSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = requireUser(ctx);
      var data = parsePayload(payload);
      if (!data.sessionId) return err("sessionId required");
      if (!data.questionId) return err("questionId required");
      var choiceIndex = Number(data.choiceIndex);
      if (!isFinite(choiceIndex) || choiceIndex !== Math.floor(choiceIndex) || choiceIndex < 0) {
        return err("choiceIndex must be a non-negative integer");
      }

      var pre = readSystemObject(nk, SESSIONS_COLLECTION, sessionKey(data.sessionId)).value as SessionValue | null;
      if (!pre) return err("Session not found: " + data.sessionId);
      var template = readTemplate(nk, pre.appId, pre.templateId);
      if (!template) return err("Template not found: " + pre.templateId);
      var pack = readPack(nk, pre.appId, pre.packId);
      if (!pack) return err("Trivia pack not found: " + pre.packId);

      var question: TriviaQuestion | null = null;
      for (var i = 0; i < pack.questions.length; i++) {
        if (pack.questions[i].id === data.questionId) { question = pack.questions[i]; break; }
      }
      if (!question) return err("Unknown question: " + data.questionId);

      var now = nowMs();
      var sessionExpired = false;
      var answerExpired = false;
      var correct = false;

      var session = mutateSession(nk, data.sessionId, function (s) {
        requireOwnedActive(s, userId);
        if (expireIfIdle(s, now)) { sessionExpired = true; return; }
        if (!s.pendingQuestion || s.pendingQuestion.questionId !== data.questionId) {
          throw new Error("No pending question with id " + data.questionId);
        }

        answerExpired = questionExpired(s.pendingQuestion, now, template.settings.maxAnswerSeconds);
        // Grading is entirely server-side: the client never saw correctIndex.
        correct = !answerExpired && choiceIndex === (question as TriviaQuestion).correctIndex;

        if (correct) {
          s.correctCount += 1;
          s.score += SCORE_CORRECT;
          if (s.correctCount >= template.settings.requiredCorrect) {
            s.finishEligible = true; // the 5-correct completion rule
          }
        } else {
          // Wrong answer policy: miss and move on. The question and the
          // checkpoint are consumed; a new question waits at the next
          // checkpoint — travel time is the cooldown (game-loop.md §4).
          s.wrongCount += 1;
        }
        s.pendingQuestion = null;
        s.lastEventAtMs = now;
      });

      if (sessionExpired) return err("Session expired after " + (IDLE_EXPIRY_MS / 60000) + " minutes idle");

      return ok({
        questionId: data.questionId,
        correct: correct,
        expired: answerExpired,
        // Revealed post-grade only, so the AI host can announce the answer.
        correctIndex: question.correctIndex,
        progress: progressView(session, template)
      });
    } catch (e: any) {
      return err(e.message || "world_answer_submit failed");
    }
  }

  export function rpcObjectFound(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = requireUser(ctx);
      var data = parsePayload(payload);
      if (!data.sessionId) return err("sessionId required");
      if (!data.objectId) return err("objectId required");
      var position = validateVec3(data.position, "position");

      var pre = readSystemObject(nk, SESSIONS_COLLECTION, sessionKey(data.sessionId)).value as SessionValue | null;
      if (!pre) return err("Session not found: " + data.sessionId);
      var template = readTemplate(nk, pre.appId, pre.templateId);
      if (!template) return err("Template not found: " + pre.templateId);

      var now = nowMs();
      var expired = false;
      var found: ScavengerObject | null = null;

      var session = mutateSession(nk, data.sessionId, function (s) {
        requireOwnedActive(s, userId);
        if (expireIfIdle(s, now)) { expired = true; return; }

        var obj: ScavengerObject | null = null;
        for (var i = 0; i < s.objects.length; i++) {
          if (s.objects[i].id === data.objectId) { obj = s.objects[i]; break; }
        }
        // Validates against the seed-derived layout stored at session start.
        if (!obj) throw new Error("Unknown object: " + data.objectId);
        if (s.objectsFound.indexOf(obj.id) !== -1) throw new Error("Object already found: " + obj.id);
        if (dist(position, obj.position) > template.settings.collectRadius * PROXIMITY_SLACK) {
          throw new Error("Position is not at object " + obj.id);
        }
        requireSaneMovement(s, position, now, template.settings.maxSpeed);

        s.objectsFound.push(obj.id);
        s.score += SCORE_OBJECT_FOUND;
        s.lastPosition = position;
        s.lastEventAtMs = now;
        found = obj;
      });

      if (expired) return err("Session expired after " + (IDLE_EXPIRY_MS / 60000) + " minutes idle");

      return ok({
        objectId: (found as any).id,
        color: (found as any).color,
        shape: (found as any).shape,
        foundCount: session.objectsFound.length,
        totalObjects: session.objects.length,
        progress: progressView(session, template)
      });
    } catch (e: any) {
      return err(e.message || "world_object_found failed");
    }
  }

  export function rpcSessionFinish(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = requireUser(ctx);
      var data = parsePayload(payload);
      if (!data.sessionId) return err("sessionId required");

      var pre = readSystemObject(nk, SESSIONS_COLLECTION, sessionKey(data.sessionId)).value as SessionValue | null;
      if (!pre) return err("Session not found: " + data.sessionId);
      var template = readTemplate(nk, pre.appId, pre.templateId);
      if (!template) return err("Template not found: " + pre.templateId);

      var now = nowMs();
      var expired = false;

      // Single-shot: the status flip runs under OCC, so a double-fired finish
      // loses the version race and lands on "Session is finished".
      var session = mutateSession(nk, data.sessionId, function (s) {
        requireOwnedActive(s, userId);
        if (expireIfIdle(s, now)) { expired = true; return; }
        if (!s.finishEligible) {
          throw new Error("Not finish-eligible: " + s.correctCount + "/" + template.settings.requiredCorrect + " correct answers");
        }
        s.status = "finished";
        s.score += SCORE_FINISH_BONUS;
        s.finishedAtMs = now;
        s.lastEventAtMs = now;
      });

      if (expired) return err("Session expired after " + (IDLE_EXPIRY_MS / 60000) + " minutes idle");

      var entry: LeaderboardEntry = {
        sessionId: session.sessionId,
        userId: session.userId,
        score: session.score,
        correctCount: session.correctCount,
        wrongCount: session.wrongCount,
        objectsFound: session.objectsFound.length,
        durationMs: now - session.startedAtMs,
        finishedAt: new Date().toISOString()
      };
      var rank = upsertLeaderboardEntry(nk, session.appId, session.templateId, entry);

      var reward = creditFinishReward(nk, logger, session, template);

      return ok({
        sessionId: session.sessionId,
        score: session.score,
        correctCount: session.correctCount,
        wrongCount: session.wrongCount,
        objectsFound: session.objectsFound.length,
        totalObjects: session.objects.length,
        durationMs: entry.durationMs,
        rank: rank,
        reward: reward
      });
    } catch (e: any) {
      return err(e.message || "world_session_finish failed");
    }
  }

  export function rpcSessionAbandon(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = requireUser(ctx);
      var data = parsePayload(payload);
      if (!data.sessionId) return err("sessionId required");
      var now = nowMs();
      var session = mutateSession(nk, data.sessionId, function (s) {
        requireOwnedActive(s, userId);
        s.status = "abandoned";
        s.finishedAtMs = now;
        s.lastEventAtMs = now;
      });
      return ok({ sessionId: session.sessionId, status: session.status, score: session.score });
    } catch (e: any) {
      return err(e.message || "world_session_abandon failed");
    }
  }

  export function rpcLeaderboardGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      // Readable by players and s2s callers alike.
      var data = parsePayload(payload);
      if (!data.appId) return err("appId required");
      if (!data.templateId) return err("templateId required");
      var limit = data.limit ? Math.min(Number(data.limit), LEADERBOARD_SIZE) : LEADERBOARD_SIZE;

      var read = readSystemObject(nk, LEADERBOARDS_COLLECTION, leaderboardKey(data.appId, data.templateId));
      var entries: LeaderboardEntry[] = (read.value && read.value.entries) || [];
      return ok({
        appId: data.appId,
        templateId: data.templateId,
        entries: entries.slice(0, limit)
      });
    } catch (e: any) {
      return err(e.message || "world_leaderboard_get failed");
    }
  }

  // ---- leaderboard + wallet reward internals ----

  /**
   * Storage-object leaderboard per (app, template): top LEADERBOARD_SIZE by
   * score, ties broken by shorter duration. OCC-retried like sessions.
   * Returns the entry's 1-based rank, or null if it fell off the board.
   */
  function upsertLeaderboardEntry(nk: nkruntime.Nakama, appId: string, templateId: string, entry: LeaderboardEntry): number | null {
    var key = leaderboardKey(appId, templateId);
    var lastError: any = null;
    for (var attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
      var read = readSystemObject(nk, LEADERBOARDS_COLLECTION, key);
      var value = read.value || { appId: appId, templateId: templateId, entries: [] };
      var entries: LeaderboardEntry[] = value.entries || [];

      // Keyed by sessionId — a replayed finish (which finish's single-shot
      // status flip already prevents) could never duplicate a row.
      var filtered: LeaderboardEntry[] = [];
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].sessionId !== entry.sessionId) filtered.push(entries[i]);
      }
      filtered.push(entry);
      filtered.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.durationMs - b.durationMs;
      });
      value.entries = filtered.slice(0, LEADERBOARD_SIZE);

      try {
        writeSystemObject(nk, LEADERBOARDS_COLLECTION, key, value, read.storageVersion);
        for (var r = 0; r < value.entries.length; r++) {
          if (value.entries[r].sessionId === entry.sessionId) return r + 1;
        }
        return null;
      } catch (e: any) {
        lastError = e;
      }
    }
    throw new Error("Leaderboard write conflict after " + MAX_OCC_RETRIES + " retries: " + (lastError && lastError.message ? lastError.message : String(lastError)));
  }

  /**
   * Wallet reward hook: credits the app's router-wallet in-process through
   * the already-deployed RouterWallet module. Ref world_finish_{sessionId}
   * rides the wallet's conditional-create dedupe, so a replay can never
   * double-credit. Soft dependency: when RouterWallet isn't installed (or
   * the credit fails) the finish still succeeds and the reward is reported
   * as skipped — game completion must never be hostage to billing.
   */
  function creditFinishReward(nk: nkruntime.Nakama, logger: nkruntime.Logger, session: SessionValue, template: WorldTemplate): any {
    var amount = template.settings.finishRewardCredits;
    if (!amount || amount <= 0) {
      return { credited: false, skipped: true, reason: "no finishRewardCredits configured" };
    }
    var rw: any = typeof globalThis !== "undefined" ? (globalThis as any).RouterWallet : null;
    if (!rw || typeof rw.rpcCredit !== "function") {
      return { credited: false, skipped: true, reason: "router_wallet module not installed" };
    }
    try {
      var s2sCtx = { userId: "" } as any; // in-process s2s call
      var result = JSON.parse(rw.rpcCredit(s2sCtx, logger, nk, JSON.stringify({
        appId: session.appId,
        kind: "iv_credits",
        amount: amount,
        reason: "world_finish_reward",
        ref: "world_finish_" + session.sessionId
      })));
      if (!result.success) {
        return { credited: false, skipped: true, reason: result.error || "router_wallet_credit failed" };
      }
      return { credited: !result.data.deduped, deduped: !!result.data.deduped, kind: "iv_credits", amount: amount };
    } catch (e: any) {
      return { credited: false, skipped: true, reason: e.message || "router_wallet_credit threw" };
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    // authoring (s2s)
    initializer.registerRpc("world_template_upsert", rpcTemplateUpsert);
    initializer.registerRpc("world_trivia_pack_upsert", rpcPackUpsert);
    // gameplay (authenticated user)
    initializer.registerRpc("world_session_start", rpcSessionStart);
    initializer.registerRpc("world_session_get", rpcSessionGet);
    initializer.registerRpc("world_checkpoint_reach", rpcCheckpointReach);
    initializer.registerRpc("world_answer_submit", rpcAnswerSubmit);
    initializer.registerRpc("world_object_found", rpcObjectFound);
    initializer.registerRpc("world_session_finish", rpcSessionFinish);
    initializer.registerRpc("world_session_abandon", rpcSessionAbandon);
    initializer.registerRpc("world_leaderboard_get", rpcLeaderboardGet);
  }
}

// Expose the namespace for the standalone vitest harness. Inside Nakama's
// Goja runtime this is a harmless no-op guard (namespaces are already global
// in the kernel's outFile bundle).
if (typeof globalThis !== "undefined") {
  (globalThis as any).WorldTrivia = WorldTrivia;
}
