// ---------------------------------------------------------------------------
// Web onboarding analytics — dedicated event lake for onboarding.quizverse.world
//
// Separate from satori_events (no strict taxonomy). Browser sends batched
// ob_* events via Next.js /api/onboarding/analytics → onboarding_events_batch
// (http_key). Storage layout mirrors satori_events: inverted-time keys under
// SYSTEM_USER for efficient recent-first scans.
// ---------------------------------------------------------------------------
namespace OnboardingAnalytics {

  var PAGE_SIZE = 100;
  var MAX_SCAN_PAGES = 400;
  var MAX_BATCH = 50;
  var PROFILE_KEY = "profile";

  function isNakamaUuid(id: string): boolean {
    if (!id || id.length !== 36) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }

  function eventKey(tsMs: number, id: string): string {
    var inv = "" + (100000000000000 - tsMs);
    while (inv.length < 14) inv = "0" + inv;
    var safe = (id || "x").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    return "ev_0" + inv + "_" + safe;
  }

  function randomId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function toMs(ts: number): number {
    if (!ts) return Date.now();
    return ts < 100000000000 ? ts * 1000 : ts;
  }

  function sanitizeId(raw: string, maxLen: number): string {
    return (raw || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, maxLen);
  }

  function captureEvents(
    nk: nkruntime.Nakama,
    identityId: string,
    cognitoSub: string | null,
    nakamaUserId: string | null,
    events: any[]
  ): number {
    var writes: nkruntime.StorageWriteRequest[] = [];
    var captured = 0;
    var lastSnapshot: any = null;
    var lastScreen = "";
    var lastEvent = "";

    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e || !e.name) continue;
      var tsMs = toMs(e.timestamp);
      var eventId = (e.eventId || randomId()).toString();
      var recordCognito = cognitoSub || e.userId || null;
      var recordNakama = nakamaUserId || null;
      var key = eventKey(tsMs + i, eventId);
      var record = {
        identityId: identityId,
        userId: recordNakama || recordCognito,
        cognitoSub: recordCognito,
        nakamaUserId: recordNakama,
        name: e.name,
        timestamp: tsMs,
        screen: e.screen || "",
        sessionId: e.sessionId || "",
        dwellMs: e.dwellMs || 0,
        data: e.data || {},
        userSnapshot: e.userSnapshot || {},
        date: new Date(tsMs).toISOString().slice(0, 10)
      };
      writes.push({
        collection: Constants.QV_ONBOARDING_EVENTS_COLLECTION,
        key: key,
        userId: Constants.SYSTEM_USER_ID,
        value: record,
        permissionRead: 0 as nkruntime.ReadPermissionValues,
        permissionWrite: 0 as nkruntime.WritePermissionValues
      });
      if (recordNakama) {
        writes.push({
          collection: Constants.QV_ONBOARDING_EVENTS_COLLECTION,
          key: key,
          userId: recordNakama,
          value: record,
          permissionRead: 2 as nkruntime.ReadPermissionValues,
          permissionWrite: 0 as nkruntime.WritePermissionValues
        });
      }
      captured++;
      if (e.userSnapshot) lastSnapshot = e.userSnapshot;
      if (e.screen) lastScreen = e.screen;
      lastEvent = e.name;
    }

    if (writes.length > 0) {
      Storage.writeMultiple(nk, writes);
    }

    if (lastSnapshot) {
      var profilePayload = {
        identityId: identityId,
        userId: nakamaUserId || cognitoSub,
        cognitoSub: cognitoSub,
        nakamaUserId: nakamaUserId,
        updatedAt: Date.now(),
        lastScreen: lastScreen,
        lastEvent: lastEvent,
        snapshot: lastSnapshot
      };
      Storage.writeSystemJson(nk, Constants.QV_ONBOARDING_PROFILES_COLLECTION, "prof_" + sanitizeId(identityId, 64), profilePayload);
      if (nakamaUserId) {
        Storage.writeJson(
          nk,
          Constants.QV_ONBOARDING_PROFILES_COLLECTION,
          PROFILE_KEY,
          nakamaUserId,
          profilePayload,
          2 as nkruntime.ReadPermissionValues,
          0 as nkruntime.WritePermissionValues
        );
      }
    }

    return captured;
  }

  function rpcEventsBatch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var identityId = (data.identity_id || data.identityId || "").toString();
    if (!identityId) {
      return RpcHelpers.errorResponse("identity_id required");
    }
    if (!data.events || !Array.isArray(data.events)) {
      return RpcHelpers.errorResponse("events array required");
    }
    var events = data.events.slice(0, MAX_BATCH);
    var cognitoSub = (data.user_id || data.userId || "").toString() || null;
    var nakamaUserId = (data.nakama_user_id || data.nakamaUserId || "").toString() || null;
    if (nakamaUserId && !isNakamaUuid(nakamaUserId)) nakamaUserId = null;
    var captured = captureEvents(nk, identityId, cognitoSub, nakamaUserId, events);
    return RpcHelpers.successResponse({
      captured: captured,
      submitted: data.events.length,
      identity_id: identityId,
      nakama_user_id: nakamaUserId
    });
  }

  function rpcIdentityLink(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var anonId = (data.anon_id || data.anonId || "").toString();
    var cognitoSub = (data.user_id || data.userId || "").toString();
    var nakamaUserId = (data.nakama_user_id || data.nakamaUserId || "").toString() || null;
    if (nakamaUserId && !isNakamaUuid(nakamaUserId)) nakamaUserId = null;
    if (!anonId || !cognitoSub) {
      return RpcHelpers.errorResponse("anon_id and user_id required");
    }
    var linkKey = "link_" + sanitizeId(anonId, 80);
    var linkPayload = {
      anonId: anonId,
      userId: cognitoSub,
      cognitoSub: cognitoSub,
      nakamaUserId: nakamaUserId,
      linkedAt: Date.now()
    };
    var existing = Storage.readSystemJson<any>(nk, Constants.QV_ONBOARDING_IDENTITY_COLLECTION, linkKey);
    if (existing && existing.userId === cognitoSub && existing.nakamaUserId === nakamaUserId) {
      return RpcHelpers.successResponse({
        linked: true,
        idempotent: true,
        anon_id: anonId,
        user_id: cognitoSub,
        nakama_user_id: nakamaUserId
      });
    }
    Storage.writeSystemJson(nk, Constants.QV_ONBOARDING_IDENTITY_COLLECTION, linkKey, linkPayload);
    Storage.writeSystemJson(nk, Constants.QV_ONBOARDING_PROFILES_COLLECTION, "prof_" + sanitizeId(anonId, 64), linkPayload);
    if (nakamaUserId) {
      Storage.writeJson(
        nk,
        Constants.QV_ONBOARDING_PROFILES_COLLECTION,
        PROFILE_KEY,
        nakamaUserId,
        linkPayload,
        2 as nkruntime.ReadPermissionValues,
        0 as nkruntime.WritePermissionValues
      );
    }
    logger.info("[OnboardingAnalytics] linked anon=%s cognito=%s nakama=%s", anonId, cognitoSub, nakamaUserId || "none");
    return RpcHelpers.successResponse({
      linked: true,
      anon_id: anonId,
      user_id: cognitoSub,
      nakama_user_id: nakamaUserId
    });
  }

  function countKeys(obj: { [k: string]: boolean }): number {
    var n = 0;
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) n++;
    }
    return n;
  }

  function rpcFunnelScreens(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var sinceMs = data.since_ms || data.sinceMs || (Date.now() - 7 * 86400000);
    var untilMs = data.until_ms || data.untilMs || Date.now();
    var pathwayFilter = data.pathway ? ("" + data.pathway) : null;

    var screenUsers: { [screen: string]: { [uid: string]: boolean } } = {};
    var userState: { [uid: string]: { lastScreen: string; lastTs: number; completed: boolean } } = {};
    var cursor = "";
    var truncated = false;

    for (var p = 0; p < MAX_SCAN_PAGES; p++) {
      var page = nk.storageList(Constants.SYSTEM_USER_ID, Constants.QV_ONBOARDING_EVENTS_COLLECTION, PAGE_SIZE, cursor);
      var objects = (page && page.objects) || [];
      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (!obj.value) continue;
        var rec = obj.value as any;
        var ts = toMs(rec.timestamp);
        if (ts < sinceMs || ts > untilMs) continue;
        if (pathwayFilter && rec.userSnapshot && rec.userSnapshot.pathway !== pathwayFilter) continue;

        var uid = rec.userId || rec.identityId;
        if (!uid) continue;

        if (!userState[uid]) {
          userState[uid] = { lastScreen: "", lastTs: 0, completed: false };
        }

        if (rec.name === "ob_congrats_seen" || rec.name === "ob_unity_return" || rec.name === "ob_deeplink_fire") {
          userState[uid].completed = true;
        }

        if (rec.name === "ob_screen_seen" && rec.screen) {
          if (!screenUsers[rec.screen]) screenUsers[rec.screen] = {};
          screenUsers[rec.screen][uid] = true;
          if (ts >= userState[uid].lastTs) {
            userState[uid].lastScreen = rec.screen;
            userState[uid].lastTs = ts;
          }
        }
      }
      cursor = (page && page.cursor) || "";
      if (!cursor) break;
    }
    if (cursor) truncated = true;

    var screenReach: any[] = [];
    for (var sc in screenUsers) {
      if (!Object.prototype.hasOwnProperty.call(screenUsers, sc)) continue;
      screenReach.push({ screen: sc, users: countKeys(screenUsers[sc]) });
    }
    screenReach.sort(function (a, b) { return b.users - a.users; });

    var dropMap: { [screen: string]: number } = {};
    for (var uid2 in userState) {
      if (!Object.prototype.hasOwnProperty.call(userState, uid2)) continue;
      var st = userState[uid2];
      if (!st.completed && st.lastScreen) {
        dropMap[st.lastScreen] = (dropMap[st.lastScreen] || 0) + 1;
      }
    }
    var dropoffByLastScreen: any[] = [];
    for (var ds in dropMap) {
      if (!Object.prototype.hasOwnProperty.call(dropMap, ds)) continue;
      dropoffByLastScreen.push({ screen: ds, users: dropMap[ds] });
    }
    dropoffByLastScreen.sort(function (a, b) { return b.users - a.users; });

    return RpcHelpers.successResponse({
      sinceMs: sinceMs,
      untilMs: untilMs,
      pathway: pathwayFilter,
      truncated: truncated,
      screenReach: screenReach,
      dropoffByLastScreen: dropoffByLastScreen
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("onboarding_events_batch", rpcEventsBatch);
    initializer.registerRpc("onboarding_identity_link", rpcIdentityLink);
    initializer.registerRpc("onboarding_funnel_screens", rpcFunnelScreens);
  }
}
