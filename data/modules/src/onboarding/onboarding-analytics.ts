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

  var SCREEN_LABELS: { [screen: string]: string } = {
    "/onboarding": "Start",
    "/onboarding/welcome": "Welcome",
    "/onboarding/world": "Pick Your World",
    "/onboarding/intent": "Your Goal",
    "/onboarding/source": "How You Found Us",
    "/onboarding/name": "Your Name",
    "/onboarding/age": "Age",
    "/onboarding/subject": "Subject",
    "/onboarding/brain-type": "Brain Type",
    "/onboarding/quiz": "Quick Quiz",
    "/onboarding/plan": "Choose Plan",
    "/onboarding/paywall": "Subscription Paywall",
    "/onboarding/pro": "Pro Upgrade",
    "/onboarding/pro/closing": "Closing Offer",
    "/onboarding/congrats": "All Done!",
    "/onboarding/signup": "Sign Up",
    "/onboarding/signin": "Sign In",
    "/onboarding/register": "Register",
    "/onboarding/newsletter": "Newsletter",
    "/onboarding/phone": "Phone Verify",
    "/onboarding/challenge": "Challenge a Friend"
  };

  var COMPLETION_EVENTS: { [name: string]: boolean } = {
    "ob_complete": true,
    "ob_congrats_seen": true,
    "ob_deeplink_fire": true,
    "ob_unity_return": true,
    "ob_app_launch_success": true,
    "ob_return_seen": true
  };

  /** Intentional exit to native Unity — success for existing users, not funnel drop-off. */
  var UNITY_HANDOFF_EVENTS: { [name: string]: boolean } = {
    "ob_welcome_return_to_app": true,
    "ob_signin_handoff_native": true
  };

  function screenLabel(screen: string): string {
    if (!screen) return "Unknown";
    if (SCREEN_LABELS[screen]) return SCREEN_LABELS[screen];
    var tail = screen.replace(/^\/onboarding\/?/, "");
    if (!tail) return "Start";
    return tail.split("/").map(function (part) {
      return part.replace(/-/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }).join(" \u203a ");
  }

  function isCompletionEvent(name: string): boolean {
    return !!COMPLETION_EVENTS[name];
  }

  function isUnityHandoffEvent(name: string): boolean {
    return !!UNITY_HANDOFF_EVENTS[name];
  }

  function applyUnityHandoffFromEvent(u: any, rec: any): void {
    if (!isUnityHandoffEvent(rec.name)) return;
    u.unityHandoff = true;
    if (rec.name === "ob_welcome_return_to_app") u.welcomeReturnToApp = true;
    if (rec.name === "ob_signin_handoff_native") u.signinHandoffNative = true;
    var data = rec.data || {};
    if (data.surface) u.handoffSurface = data.surface;
    if (data.provider) u.handoffProvider = data.provider;
  }

  function eventCategory(name: string): string {
    if (isCompletionEvent(name)) return "completion";
    if (isUnityHandoffEvent(name)) return "handoff";
    if (name === "ob_identity_linked" || name === "ob_register_complete" || name === "ob_verify_complete" || name === "ob_register_start") return "identity";
    if (name.indexOf("paywall") >= 0 || name.indexOf("closing_offer") >= 0) return "paywall";
    if (name === "ob_d1_return" || name === "ob_d7_return" || name === "ob_welcome_bonus_claimed" || name === "ob_streak_shield_activated") return "retention";
    if (name === "ob_pathway_confirmed" || name === "ob_name_set" || name === "ob_quiz_first_answer_time" || name === "ob_review_prompt_shown" || name === "ob_newsletter_skip") return "quality";
    if (name === "ob_screen_seen" || name === "ob_screen_exit") return "screen";
    return "other";
  }

  function deriveUserStatus(u: any): string {
    if (u.completed) return "completed";
    if (u.unityHandoff) return "returned_to_app";
    if (u.paywallSubscribe || u.paywallTrialStart || u.subscribed) return "subscribed";
    if (u.paywallSeen && !u.completed && !u.paywallSubscribe && !u.paywallTrialStart) return "at_paywall";
    if (!u.identityLinked && !u.nakamaUserId) return "pre_register";
    return "dropped";
  }

  function matchesPlatformFilter(platform: string, filter: string | null): boolean {
    if (!filter) return true;
    var p = (platform || "").toLowerCase();
    if (filter === "unity_webview") return p.indexOf("unity") >= 0;
    if (filter === "ios_web") return p.indexOf("ios") >= 0;
    if (filter === "android_web") return p.indexOf("android") >= 0;
    if (filter === "desktop_web") return p === "web" || p.indexOf("desktop") >= 0;
    return p.indexOf(filter) >= 0;
  }

  function parseTimeMs(value: any): number {
    if (!value) return 0;
    if (typeof value === "number") return toMs(value);
    var parsed = Date.parse("" + value);
    return isNaN(parsed) ? 0 : parsed;
  }

  function snapshotHasProfile(snap: any): boolean {
    if (!snap || typeof snap !== "object") return false;
    if (snap.elapsedMs > 0) return true;
    if (snap.startedAt) return true;
    if (snap.pathway) return true;
    if (snap.currentStep) return true;
    if (snap.country) return true;
    return Object.keys(snap).length > 0;
  }

  /** Best-effort funnel duration — prefers snapshot elapsedMs over event span.
   * NOTE: snap.elapsedMs is already in milliseconds — do NOT pass through toMs(). */
  function resolveUserDurationMs(u: any): number {
    if (u.maxElapsedMs > 0) return u.maxElapsedMs;
    var snap = u.snapshot || {};
    if (snap.elapsedMs > 0) return snap.elapsedMs;
    var started = parseTimeMs(snap.startedAt);
    var completed = parseTimeMs(snap.completedAt);
    if (started > 0 && completed > started) return completed - started;
    if (u.lastTs > 0 && u.firstTs > 0 && u.lastTs > u.firstTs) return u.lastTs - u.firstTs;
    return 0;
  }

  function absorbSnapshotMetrics(u: any, snap: any, ts: number): void {
    if (!snap || typeof snap !== "object") return;
    if (snap.elapsedMs > 0) {
      var elapsed = snap.elapsedMs;
      if (!u.maxElapsedMs || elapsed > u.maxElapsedMs) u.maxElapsedMs = elapsed;
    }
    if (ts >= u.lastTs && snapshotHasProfile(snap)) {
      u.snapshot = snap;
    }
  }

  function sanitizeSnapshot(snap: any): any {
    if (!snap || typeof snap !== "object") return {};
    return {
      pathway: snap.pathway,
      country: snap.country,
      platform: snap.platform,
      age: snap.age,
      brainCode: snap.brainCode,
      brainType: snap.brainType,
      quizScore: snap.quizScore,
      quizQuestions: snap.quizQuestions,
      avgAnswerTime: snap.avgAnswerTime,
      nameSet: snap.nameSet,
      gamerTag: snap.gamerTag,
      authProvider: snap.authProvider,
      signinStatus: snap.signinStatus,
      verified: snap.verified,
      phoneVerified: snap.phoneVerified,
      newsletterOptIn: snap.newsletterOptIn,
      subscribed: snap.subscribed,
      selectedPlan: snap.selectedPlan,
      paywallVariant: snap.paywallVariant,
      attributionSource: snap.attributionSource,
      acquisitionCreative: snap.acquisitionCreative,
      utm_source: snap.utm_source,
      utm_medium: snap.utm_medium,
      utm_campaign: snap.utm_campaign,
      emailDomain: snap.emailDomain,
      phoneTail: snap.phoneTail,
      startedAt: snap.startedAt,
      completedAt: snap.completedAt,
      elapsedMs: snap.elapsedMs,
      currentStep: snap.currentStep,
      intent: snap.intent,
      motivation: snap.motivation,
      subject: snap.subject,
      arena: snap.arena,
      tier: snap.tier,
      education: snap.education,
      dailyGoal: snap.dailyGoal,
      interests: snap.interests,
      xp: snap.xp,
      coins: snap.coins,
      streak: snap.streak,
      creatorGoal: snap.creatorGoal,
      creatorPublished: snap.creatorPublished,
      closingOfferSeen: snap.closingOfferSeen,
      closingOfferClaimed: snap.closingOfferClaimed,
      reviewGiven: snap.reviewGiven
    };
  }

  function pushEventFromRecord(rec: any, seen: { [k: string]: boolean }, events: any[]): void {
    var dedupeKey = (rec.name || "") + "_" + toMs(rec.timestamp) + "_" + (rec.screen || "");
    if (seen[dedupeKey]) return;
    seen[dedupeKey] = true;
    events.push({
      name: rec.name,
      screen: rec.screen || "",
      screenLabel: screenLabel(rec.screen || ""),
      timestamp: toMs(rec.timestamp),
      dwellMs: rec.dwellMs || 0,
      data: rec.data || {},
      category: eventCategory(rec.name)
    });
  }

  function loadEventsFromStorageUser(
    nk: nkruntime.Nakama,
    storageUserId: string,
    seen: { [k: string]: boolean },
    events: any[]
  ): void {
    var cursor = "";
    for (var p = 0; p < MAX_SCAN_PAGES; p++) {
      var page = nk.storageList(storageUserId, Constants.QV_ONBOARDING_EVENTS_COLLECTION, PAGE_SIZE, cursor);
      var objects = (page && page.objects) || [];
      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (!obj.value) continue;
        pushEventFromRecord(obj.value as any, seen, events);
      }
      cursor = (page && page.cursor) || "";
      if (!cursor) break;
    }
  }

  function loadEventsFromSystemFilter(
    nk: nkruntime.Nakama,
    nakamaUserId: string,
    guestId: string,
    seen: { [k: string]: boolean },
    events: any[],
    maxPages: number
  ): void {
    var cursor = "";
    for (var p = 0; p < maxPages; p++) {
      var page = nk.storageList(Constants.SYSTEM_USER_ID, Constants.QV_ONBOARDING_EVENTS_COLLECTION, PAGE_SIZE, cursor);
      var objects = (page && page.objects) || [];
      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (!obj.value) continue;
        var rec = obj.value as any;
        var match = false;
        if (nakamaUserId && rec.nakamaUserId === nakamaUserId) match = true;
        if (!match && guestId && (rec.identityId === guestId || rec.userId === guestId)) match = true;
        if (!match) continue;
        pushEventFromRecord(rec, seen, events);
      }
      cursor = (page && page.cursor) || "";
      if (!cursor) break;
    }
  }

  function resolveUserKey(rec: any): string {
    return (rec.nakamaUserId || rec.identityId || rec.userId || "").toString();
  }

  function loadIdentityLinks(nk: nkruntime.Nakama): { links: any[]; truncated: boolean } {
    var links: any[] = [];
    var cursor = "";
    var truncated = false;
    for (var p = 0; p < MAX_SCAN_PAGES; p++) {
      var page = nk.storageList(Constants.SYSTEM_USER_ID, Constants.QV_ONBOARDING_IDENTITY_COLLECTION, PAGE_SIZE, cursor);
      var objects = (page && page.objects) || [];
      for (var i = 0; i < objects.length; i++) {
        if (objects[i].value) links.push(objects[i].value);
      }
      cursor = (page && page.cursor) || "";
      if (!cursor) break;
    }
    if (cursor) truncated = true;
    return { links: links, truncated: truncated };
  }

  function readIdentityLink(nk: nkruntime.Nakama, anonId: string): any | null {
    if (!anonId) return null;
    return Storage.readSystemJson<any>(nk, Constants.QV_ONBOARDING_IDENTITY_COLLECTION, "link_" + sanitizeId(anonId, 80));
  }

  function mergeUserBuckets(target: any, source: any): void {
    target.eventCount = (target.eventCount || 0) + (source.eventCount || 0);
    var srcNames = source.eventNames || {};
    for (var en in srcNames) {
      if (!Object.prototype.hasOwnProperty.call(srcNames, en)) continue;
      target.eventNames[en] = (target.eventNames[en] || 0) + srcNames[en];
    }
    var srcScreens = source.screens || {};
    for (var sc in srcScreens) {
      if (!Object.prototype.hasOwnProperty.call(srcScreens, sc)) continue;
      if (!target.screens[sc]) {
        target.screens[sc] = {
          seen: srcScreens[sc].seen || 0,
          dwellMs: srcScreens[sc].dwellMs || 0,
          firstTs: srcScreens[sc].firstTs || 0
        };
      } else {
        target.screens[sc].seen += srcScreens[sc].seen || 0;
        target.screens[sc].dwellMs += srcScreens[sc].dwellMs || 0;
        if (srcScreens[sc].firstTs && srcScreens[sc].firstTs < target.screens[sc].firstTs) {
          target.screens[sc].firstTs = srcScreens[sc].firstTs;
        }
      }
    }
    if (source.completed) target.completed = true;
    if (source.paywallSeen) target.paywallSeen = true;
    if (source.paywallSubscribe) target.paywallSubscribe = true;
    if (source.paywallTrialStart) target.paywallTrialStart = true;
    if (source.paywallDismiss) target.paywallDismiss = true;
    if (source.paywallSkip) target.paywallSkip = true;
    if (source.closingOfferSeen) target.closingOfferSeen = true;
    if (source.closingOfferClaimed) target.closingOfferClaimed = true;
    if (source.registerStart) target.registerStart = true;
    if (source.appLaunchSuccess) target.appLaunchSuccess = true;
    if (source.obComplete) target.obComplete = true;
    if (source.pathwayConfirmed) target.pathwayConfirmed = true;
    if (source.nameSetEvent) target.nameSetEvent = true;
    if (source.quizFirstAnswer) target.quizFirstAnswer = true;
    if (source.reviewPromptShown) target.reviewPromptShown = true;
    if (source.newsletterSkip) target.newsletterSkip = true;
    if (source.planViewed) target.planViewed = true;
    if (source.d1Return) target.d1Return = true;
    if (source.d7Return) target.d7Return = true;
    if (source.welcomeBonusClaimed) target.welcomeBonusClaimed = true;
    if (source.streakShieldActivated) target.streakShieldActivated = true;
    if (source.subscribed) target.subscribed = true;
    if (source.identityLinked) target.identityLinked = true;
    if (source.started) target.started = true;
    if (source.unityHandoff) target.unityHandoff = true;
    if (source.welcomeReturnToApp) target.welcomeReturnToApp = true;
    if (source.signinHandoffNative) target.signinHandoffNative = true;
    if (source.handoffSurface && !target.handoffSurface) target.handoffSurface = source.handoffSurface;
    if (source.handoffProvider && !target.handoffProvider) target.handoffProvider = source.handoffProvider;
    if (source.welcomeTheme && !target.welcomeTheme) target.welcomeTheme = source.welcomeTheme;
    if (source.returnSeenEvent) target.returnSeenEvent = true;
    if (source.quizFirstAnswerMs > 0 && (!target.quizFirstAnswerMs || source.quizFirstAnswerMs < target.quizFirstAnswerMs)) {
      target.quizFirstAnswerMs = source.quizFirstAnswerMs;
    }
    if (!isValidPathway(target.pathway) && isValidPathway(source.pathway)) target.pathway = source.pathway;
    if (!target.country && source.country) target.country = source.country;
    if (!target.platform && source.platform) target.platform = source.platform;
    if (source.nakamaUserId && !target.nakamaUserId) target.nakamaUserId = source.nakamaUserId;
    if (source.identityId && !target.identityId) target.identityId = source.identityId;
    if (source.cognitoSub && !target.cognitoSub) target.cognitoSub = source.cognitoSub;
    if (source.firstTs && source.firstTs < target.firstTs) target.firstTs = source.firstTs;
    if (source.maxElapsedMs > (target.maxElapsedMs || 0)) target.maxElapsedMs = source.maxElapsedMs;
    if (source.lastTs >= target.lastTs) {
      target.lastTs = source.lastTs;
      if (source.lastScreen) target.lastScreen = source.lastScreen;
      if (source.lastEvent) target.lastEvent = source.lastEvent;
      if (source.snapshot && snapshotHasProfile(source.snapshot)) target.snapshot = source.snapshot;
    } else if ((!target.snapshot || !snapshotHasProfile(target.snapshot)) && source.snapshot && snapshotHasProfile(source.snapshot)) {
      target.snapshot = source.snapshot;
    }
  }

  /**
   * Merge guest / cognito buckets into canonical Nakama user using qv_onboarding_identity.
   */
  function mergeUsersByIdentityLinks(
    usersMap: { [uid: string]: any },
    links: any[]
  ): { users: { [uid: string]: any }; merges: number } {
    var merges = 0;
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var anonId = (link.anonId || "").toString();
      var nakamaId = (link.nakamaUserId || "").toString();
      var cognitoSub = (link.cognitoSub || link.userId || "").toString();
      if (!anonId || !nakamaId || !isNakamaUuid(nakamaId)) continue;

      var guestBucket = usersMap[anonId];
      var nakamaBucket = usersMap[nakamaId];
      var cognitoBucket = cognitoSub && cognitoSub !== nakamaId && cognitoSub !== anonId ? usersMap[cognitoSub] : null;

      if (!guestBucket && !nakamaBucket && !cognitoBucket) continue;

      if (!nakamaBucket) {
        nakamaBucket = guestBucket || cognitoBucket;
        usersMap[nakamaId] = nakamaBucket;
        nakamaBucket.userId = nakamaId;
        if (guestBucket && usersMap[anonId]) delete usersMap[anonId];
        if (cognitoBucket && cognitoSub && usersMap[cognitoSub]) delete usersMap[cognitoSub];
        merges++;
      } else {
        if (guestBucket && anonId !== nakamaId) {
          mergeUserBuckets(nakamaBucket, guestBucket);
          delete usersMap[anonId];
          merges++;
        }
        if (cognitoBucket && cognitoSub && usersMap[cognitoSub]) {
          mergeUserBuckets(nakamaBucket, cognitoBucket);
          delete usersMap[cognitoSub];
          merges++;
        }
      }

      nakamaBucket = usersMap[nakamaId];
      if (nakamaBucket) {
        nakamaBucket.nakamaUserId = nakamaId;
        nakamaBucket.identityLinked = true;
        if (!nakamaBucket.identityId) nakamaBucket.identityId = anonId;
        if (cognitoSub && !nakamaBucket.cognitoSub) nakamaBucket.cognitoSub = cognitoSub;
      }
    }
    return { users: usersMap, merges: merges };
  }

  var VALID_PATHWAYS: { [pathway: string]: boolean } = {
    scholar: true,
    warrior: true,
    explorer: true,
    creator: true
  };

  var PATHWAY_ORDER: string[] = ["scholar", "warrior", "explorer", "creator"];

  function isValidPathway(pathway: string): boolean {
    return !!pathway && !!VALID_PATHWAYS[pathway];
  }

  /** Resolve pathway from screen URL (/onboarding/scholar/...) or currentStep (scholar/details). */
  function pathwayFromScreenOrStep(screenOrStep: string): string {
    if (!screenOrStep) return "";
    var s = screenOrStep;
    var m = s.match(/\/onboarding\/(scholar|warrior|explorer|creator)(?:\/|$|\?)/);
    if (m) return m[1];
    var step = s.replace(/^\/onboarding\/?/, "").split("/")[0];
    if (step && VALID_PATHWAYS[step]) return step;
    return "";
  }

  /**
   * Production pathway resolution — snapshot, event data, screen, and currentStep.
   * Replaces bare userSnapshot.pathway so pathway breakdown is not polluted with "unknown".
   */
  function applyPathwayHints(u: any, rec: any): void {
    if (isValidPathway(u.pathway)) return;
    var snap = rec.userSnapshot || {};
    if (isValidPathway(snap.pathway)) {
      u.pathway = snap.pathway;
      return;
    }
    var data = rec.data || {};
    if (isValidPathway(data.pathway)) {
      u.pathway = data.pathway;
      return;
    }
    var fromScreen = pathwayFromScreenOrStep(rec.screen || "");
    if (fromScreen) {
      u.pathway = fromScreen;
      return;
    }
    if (snap.currentStep) {
      fromScreen = pathwayFromScreenOrStep(snap.currentStep);
      if (fromScreen) u.pathway = fromScreen;
    }
  }

  function pathwayDisplayLabel(pathway: string): string {
    if (!pathway) return "";
    return pathway.charAt(0).toUpperCase() + pathway.slice(1);
  }

  function scanOnboardingEvents(
    nk: nkruntime.Nakama,
    sinceMs: number,
    untilMs: number,
    pathwayFilter: string | null,
    platformFilter: string | null
  ): { users: { [uid: string]: any }; truncated: boolean } {
    var users: { [uid: string]: any } = {};
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

        var snap = rec.userSnapshot || {};
        var plat = snap.platform || rec.platform || "";
        if (platformFilter && !matchesPlatformFilter(plat, platformFilter)) continue;

        var uid = resolveUserKey(rec);
        if (!uid) continue;

        if (!users[uid]) {
          users[uid] = {
            userId: uid,
            nakamaUserId: rec.nakamaUserId || "",
            identityId: rec.identityId || "",
            cognitoSub: rec.cognitoSub || "",
            pathway: snap.pathway || "",
            country: snap.country || "",
            platform: snap.platform || "",
            identityLinked: false,
            started: false,
            screens: {},
            eventNames: {},
            completed: false,
            paywallSeen: false,
            paywallSubscribe: false,
            paywallTrialStart: false,
            paywallDismiss: false,
            paywallSkip: false,
            closingOfferSeen: false,
            closingOfferClaimed: false,
            registerStart: false,
            appLaunchSuccess: false,
            obComplete: false,
            pathwayConfirmed: false,
            nameSetEvent: false,
            quizFirstAnswer: false,
            quizFirstAnswerMs: 0,
            reviewPromptShown: false,
            newsletterSkip: false,
            planViewed: false,
            d1Return: false,
            d7Return: false,
            welcomeBonusClaimed: false,
            streakShieldActivated: false,
            unityHandoff: false,
            welcomeReturnToApp: false,
            signinHandoffNative: false,
            handoffSurface: "",
            handoffProvider: "",
            welcomeTheme: "",
            returnSeenEvent: false,
            subscribed: !!snap.subscribed,
            lastScreen: "",
            lastTs: 0,
            lastEvent: "",
            firstTs: ts,
            eventCount: 0,
            maxElapsedMs: 0,
            snapshot: snap
          };
        }

        var u = users[uid];
        u.eventCount++;
        u.eventNames[rec.name] = (u.eventNames[rec.name] || 0) + 1;
        applyPathwayHints(u, rec);
        if (snap.country && !u.country) u.country = snap.country;
        if (snap.platform && !u.platform) u.platform = snap.platform;
        if (ts < u.firstTs) u.firstTs = ts;
        absorbSnapshotMetrics(u, rec.userSnapshot, ts);

        if (rec.nakamaUserId && !u.nakamaUserId) u.nakamaUserId = rec.nakamaUserId;
        if (rec.identityId && !u.identityId) u.identityId = rec.identityId;
        if (rec.cognitoSub && !u.cognitoSub) u.cognitoSub = rec.cognitoSub;

        if (isCompletionEvent(rec.name)) u.completed = true;
        if (rec.name === "ob_identity_linked" || rec.cognitoSub) u.identityLinked = true;
        if (rec.name === "ob_start" || rec.name === "ob_launch") u.started = true;
        if (rec.name === "ob_paywall_seen") u.paywallSeen = true;
        if (rec.name === "ob_paywall_subscribe") { u.paywallSubscribe = true; u.subscribed = true; }
        if (rec.name === "ob_paywall_trial_start") { u.paywallTrialStart = true; u.subscribed = true; }
        if (rec.name === "ob_paywall_dismiss") u.paywallDismiss = true;
        if (rec.name === "ob_paywall_skip") u.paywallSkip = true;
        if (rec.name === "ob_closing_offer_seen") u.closingOfferSeen = true;
        if (rec.name === "ob_closing_offer_claim") u.closingOfferClaimed = true;
        if (rec.name === "ob_register_start") u.registerStart = true;
        if (rec.name === "ob_app_launch_success") u.appLaunchSuccess = true;
        if (rec.name === "ob_complete") u.obComplete = true;
        if (rec.name === "ob_pathway_confirmed") {
          u.pathwayConfirmed = true;
          if (rec.data && isValidPathway(rec.data.pathway)) u.pathway = rec.data.pathway;
        }
        if (rec.name === "ob_world_picked" && rec.data && isValidPathway(rec.data.pathway)) {
          u.pathway = rec.data.pathway;
        }
        if (rec.name === "ob_name_set") u.nameSetEvent = true;
        if (rec.name === "ob_quiz_first_answer_time") {
          u.quizFirstAnswer = true;
          if (rec.data && rec.data.timeMs) u.quizFirstAnswerMs = rec.data.timeMs;
        }
        if (rec.name === "ob_review_prompt_shown") u.reviewPromptShown = true;
        if (rec.name === "ob_newsletter_skip") u.newsletterSkip = true;
        if (rec.name === "ob_paywall_plan_viewed") u.planViewed = true;
        if (rec.name === "ob_d1_return") u.d1Return = true;
        if (rec.name === "ob_d7_return") u.d7Return = true;
        if (rec.name === "ob_welcome_bonus_claimed") u.welcomeBonusClaimed = true;
        if (rec.name === "ob_streak_shield_activated") u.streakShieldActivated = true;
        applyUnityHandoffFromEvent(u, rec);

        if (!u.welcomeTheme && rec.data && rec.data.welcome_theme) {
          var wt = ("" + rec.data.welcome_theme).toLowerCase();
          u.welcomeTheme = (wt === "lavender") ? "lavender" : "v1";
        }
        if (rec.name === "ob_return_seen") u.returnSeenEvent = true;

        if (rec.name === "ob_screen_seen" && rec.screen) {
          if (!u.screens[rec.screen]) {
            u.screens[rec.screen] = { seen: 0, dwellMs: 0, firstTs: ts };
          }
          u.screens[rec.screen].seen++;
          u.screens[rec.screen].dwellMs += (rec.dwellMs || 0);
          if (ts < u.screens[rec.screen].firstTs) u.screens[rec.screen].firstTs = ts;
        }
        if (rec.name === "ob_screen_exit" && rec.screen) {
          if (!u.screens[rec.screen]) {
            u.screens[rec.screen] = { seen: 0, dwellMs: 0, firstTs: ts };
          }
          u.screens[rec.screen].dwellMs += (rec.dwellMs || 0);
        }

        if (ts >= u.lastTs) {
          u.lastTs = ts;
          u.lastEvent = rec.name;
          if (rec.screen) u.lastScreen = rec.screen;
        }
      }
      cursor = (page && page.cursor) || "";
      if (!cursor) break;
    }
    if (cursor) truncated = true;
    return { users: users, truncated: truncated };
  }

  function median(values: number[]): number {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function buildScreenOrder(users: { [uid: string]: any }): string[] {
    var rankSum: { [screen: string]: { total: number; count: number } } = {};
    for (var uid in users) {
      if (!Object.prototype.hasOwnProperty.call(users, uid)) continue;
      var screens = users[uid].screens || {};
      var ordered: { screen: string; firstTs: number }[] = [];
      for (var sc in screens) {
        if (!Object.prototype.hasOwnProperty.call(screens, sc)) continue;
        ordered.push({ screen: sc, firstTs: screens[sc].firstTs });
      }
      ordered.sort(function (a, b) { return a.firstTs - b.firstTs; });
      for (var j = 0; j < ordered.length; j++) {
        var sname = ordered[j].screen;
        if (!rankSum[sname]) rankSum[sname] = { total: 0, count: 0 };
        rankSum[sname].total += j;
        rankSum[sname].count++;
      }
    }
    var screenRanks: { screen: string; avgRank: number }[] = [];
    for (var s in rankSum) {
      if (!Object.prototype.hasOwnProperty.call(rankSum, s)) continue;
      screenRanks.push({ screen: s, avgRank: rankSum[s].total / rankSum[s].count });
    }
    screenRanks.sort(function (a, b) { return a.avgRank - b.avgRank; });
    return screenRanks.map(function (x) { return x.screen; });
  }

  function rpcOnboardingFunnelAnalytics(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var days = data.days ? parseInt("" + data.days, 10) : 30;
    if (isNaN(days) || days < 1) days = 30;
    if (days > 365) days = 365;
    var sinceMs = data.since_ms || data.sinceMs || (Date.now() - days * 86400000);
    var untilMs = data.until_ms || data.untilMs || Date.now();
    var pathwayFilter = data.pathway ? ("" + data.pathway) : null;
    var platformFilter = data.platform ? ("" + data.platform) : null;
    var statusFilter = data.status ? ("" + data.status) : null;
    var welcomeThemeFilter = data.welcome_theme ? ("" + data.welcome_theme).toLowerCase() : null;
    if (welcomeThemeFilter && welcomeThemeFilter !== "lavender" && welcomeThemeFilter !== "v1") welcomeThemeFilter = null;
    var userLimit = data.user_limit || data.userLimit || 500;
    if (userLimit > 1000) userLimit = 1000;

    var scan = scanOnboardingEvents(nk, sinceMs, untilMs, pathwayFilter, platformFilter);
    var identityLoad = loadIdentityLinks(nk);
    var mergeResult = mergeUsersByIdentityLinks(scan.users, identityLoad.links);
    var usersMap = mergeResult.users;
    var identityMerges = mergeResult.merges;
    var identityLinksTotal = identityLoad.links.length;

    if (pathwayFilter) {
      var filteredUsers: { [uid: string]: any } = {};
      for (var fuid in usersMap) {
        if (!Object.prototype.hasOwnProperty.call(usersMap, fuid)) continue;
        if (usersMap[fuid].pathway === pathwayFilter) filteredUsers[fuid] = usersMap[fuid];
      }
      usersMap = filteredUsers;
    }

    if (welcomeThemeFilter) {
      var themeFiltered: { [uid: string]: any } = {};
      for (var tfuid in usersMap) {
        if (!Object.prototype.hasOwnProperty.call(usersMap, tfuid)) continue;
        var tfu = usersMap[tfuid];
        var uTheme = tfu.welcomeTheme || "v1";
        if (uTheme === welcomeThemeFilter) themeFiltered[tfuid] = tfu;
      }
      usersMap = themeFiltered;
    }

    var screenOrder = buildScreenOrder(usersMap);

    var totalUsers = countKeys(usersMap);
    var completedCount = 0;
    var returnedToAppCount = 0;
    var paywallSeen = 0;
    var paywallSubscribe = 0;
    var paywallTrialStart = 0;
    var paywallDismiss = 0;
    var paywallSkip = 0;
    var paywallDrop = 0;
    var closingOfferSeenCount = 0;
    var closingOfferClaimedCount = 0;
    var abHardSeen = 0;
    var abHardSubscribed = 0;
    var abSoftSeen = 0;
    var abSoftSubscribed = 0;
    var abV1Users = 0; var abV1Completed = 0; var abV1PaywallSeen = 0; var abV1Subscribed = 0;
    var abLavenderUsers = 0; var abLavenderCompleted = 0; var abLavenderPaywallSeen = 0; var abLavenderSubscribed = 0;
    var abThemeUnknown = 0;
    var durationSamples: number[] = [];
    var quizFirstAnswerSamples: number[] = [];
    var sigRegisterStart = 0;
    var sigAppLaunch = 0;
    var sigObComplete = 0;
    var sigPathwayConfirmed = 0;
    var sigNameSet = 0;
    var sigQuizFirstAnswer = 0;
    var sigReviewPrompt = 0;
    var sigNewsletterSkip = 0;
    var sigPlanViewed = 0;
    var sigD1Return = 0;
    var sigD7Return = 0;
    var sigWelcomeBonus = 0;
    var sigStreakShield = 0;
    var sigWelcomeReturn = 0;
    var sigSigninHandoff = 0;
    var pathwayCounts: { [pathway: string]: { users: number; completed: number } } = {};
    var prePathwayUsers = 0;
    var prePathwayCompleted = 0;

    var screenAgg: { [screen: string]: { users: { [uid: string]: boolean }; dwellMs: number; dwellCount: number; exits: number } } = {};
    var dropMap: { [screen: string]: number } = {};

    for (var uid2 in usersMap) {
      if (!Object.prototype.hasOwnProperty.call(usersMap, uid2)) continue;
      var u = usersMap[uid2];
      if (u.completed) completedCount++;
      if (u.unityHandoff) returnedToAppCount++;
      if (u.paywallSeen) paywallSeen++;
      if (u.paywallSubscribe) paywallSubscribe++;
      if (u.paywallTrialStart) paywallTrialStart++;
      if (u.paywallDismiss) paywallDismiss++;
      if (u.paywallSkip) paywallSkip++;
      if (u.paywallSeen && !u.paywallSubscribe && !u.paywallTrialStart && !u.completed && !u.paywallSkip && !u.paywallDismiss) paywallDrop++;
      if (u.closingOfferSeen) closingOfferSeenCount++;
      if (u.closingOfferClaimed) closingOfferClaimedCount++;

      var variant = (u.snapshot && u.snapshot.paywallVariant) ? ("" + u.snapshot.paywallVariant).toLowerCase() : "";
      if (u.paywallSeen) {
        if (variant === "hard") {
          abHardSeen++;
          if (u.paywallSubscribe || u.paywallTrialStart) abHardSubscribed++;
        } else {
          abSoftSeen++;
          if (u.paywallSubscribe || u.paywallTrialStart) abSoftSubscribed++;
        }
      }

      var uWelcomeTheme = u.welcomeTheme || "v1";
      if (uWelcomeTheme === "lavender") {
        abLavenderUsers++;
        if (u.completed) abLavenderCompleted++;
        if (u.paywallSeen) abLavenderPaywallSeen++;
        if (u.paywallSubscribe || u.paywallTrialStart) abLavenderSubscribed++;
      } else if (uWelcomeTheme === "v1") {
        abV1Users++;
        if (u.completed) abV1Completed++;
        if (u.paywallSeen) abV1PaywallSeen++;
        if (u.paywallSubscribe || u.paywallTrialStart) abV1Subscribed++;
      } else {
        abThemeUnknown++;
      }

      if (u.registerStart) sigRegisterStart++;
      if (u.appLaunchSuccess) sigAppLaunch++;
      if (u.obComplete) sigObComplete++;
      if (u.pathwayConfirmed) sigPathwayConfirmed++;
      if (u.nameSetEvent) sigNameSet++;
      if (u.quizFirstAnswer) {
        sigQuizFirstAnswer++;
        if (u.quizFirstAnswerMs > 0) quizFirstAnswerSamples.push(u.quizFirstAnswerMs);
      }
      if (u.reviewPromptShown) sigReviewPrompt++;
      if (u.newsletterSkip) sigNewsletterSkip++;
      if (u.planViewed) sigPlanViewed++;
      if (u.d1Return) sigD1Return++;
      if (u.d7Return) sigD7Return++;
      if (u.welcomeBonusClaimed) sigWelcomeBonus++;
      if (u.streakShieldActivated) sigStreakShield++;
      if (u.welcomeReturnToApp) sigWelcomeReturn++;
      if (u.signinHandoffNative) sigSigninHandoff++;

      var elapsed = resolveUserDurationMs(u);
      if (elapsed > 0) durationSamples.push(elapsed);

      if (!isValidPathway(u.pathway)) {
        if (!u.unityHandoff) {
          prePathwayUsers++;
          if (u.completed) prePathwayCompleted++;
        }
      } else {
        var pw = u.pathway;
        if (!pathwayCounts[pw]) pathwayCounts[pw] = { users: 0, completed: 0 };
        pathwayCounts[pw].users++;
        if (u.completed) pathwayCounts[pw].completed++;
      }

      for (var sc2 in u.screens) {
        if (!Object.prototype.hasOwnProperty.call(u.screens, sc2)) continue;
        if (!screenAgg[sc2]) screenAgg[sc2] = { users: {}, dwellMs: 0, dwellCount: 0, exits: 0 };
        screenAgg[sc2].users[uid2] = true;
        var sd = u.screens[sc2];
        if (sd.dwellMs > 0) {
          screenAgg[sc2].dwellMs += sd.dwellMs;
          screenAgg[sc2].dwellCount++;
        }
      }

      if (!u.completed && !u.unityHandoff && u.lastScreen) {
        dropMap[u.lastScreen] = (dropMap[u.lastScreen] || 0) + 1;
        if (screenAgg[u.lastScreen]) screenAgg[u.lastScreen].exits++;
      }
    }

    var incompletePool = totalUsers - completedCount - returnedToAppCount;
    if (incompletePool < 0) incompletePool = 0;

    var screenFunnel: any[] = [];
    var seenInOrder: { [screen: string]: boolean } = {};
    var orderList = screenOrder.slice();
    for (var sc3 in screenAgg) {
      if (!Object.prototype.hasOwnProperty.call(screenAgg, sc3)) continue;
      if (orderList.indexOf(sc3) < 0) orderList.push(sc3);
    }
    for (var oi = 0; oi < orderList.length; oi++) {
      var screen = orderList[oi];
      if (!screenAgg[screen]) continue;
      seenInOrder[screen] = true;
      var agg = screenAgg[screen];
      var userCount = countKeys(agg.users);
      screenFunnel.push({
        screen: screen,
        label: screenLabel(screen),
        users: userCount,
        pctOfStart: totalUsers > 0 ? Math.round((userCount / totalUsers) * 1000) / 10 : 0,
        avgDwellSec: agg.dwellCount > 0 ? Math.round((agg.dwellMs / agg.dwellCount) / 100) / 10 : 0,
        exits: agg.exits || 0,
        dropCount: dropMap[screen] || 0
      });
    }

    var dropoffHotspots: any[] = [];
    for (var ds in dropMap) {
      if (!Object.prototype.hasOwnProperty.call(dropMap, ds)) continue;
      dropoffHotspots.push({
        screen: ds,
        label: screenLabel(ds),
        users: dropMap[ds],
        pctOfIncomplete: incompletePool > 0
          ? Math.round((dropMap[ds] / incompletePool) * 1000) / 10
          : 0
      });
    }
    dropoffHotspots.sort(function (a, b) { return b.users - a.users; });
    var topDropScreens: { [screen: string]: number } = {};
    for (var td = 0; td < dropoffHotspots.length && td < 3; td++) {
      topDropScreens[dropoffHotspots[td].screen] = td + 1;
    }
    for (var sf = 0; sf < screenFunnel.length; sf++) {
      var rank = topDropScreens[screenFunnel[sf].screen];
      if (rank) screenFunnel[sf].topDropRank = rank;
    }

    var pathways: any[] = [];
    for (var oi2 = 0; oi2 < PATHWAY_ORDER.length; oi2++) {
      var pkOrdered = PATHWAY_ORDER[oi2];
      if (!pathwayCounts[pkOrdered]) continue;
      var pcOrdered = pathwayCounts[pkOrdered];
      pathways.push({
        pathway: pkOrdered,
        label: pathwayDisplayLabel(pkOrdered),
        users: pcOrdered.users,
        completed: pcOrdered.completed,
        completionRatePct: pcOrdered.users > 0 ? Math.round((pcOrdered.completed / pcOrdered.users) * 1000) / 10 : 0
      });
    }
    for (var pk in pathwayCounts) {
      if (!Object.prototype.hasOwnProperty.call(pathwayCounts, pk)) continue;
      if (PATHWAY_ORDER.indexOf(pk) >= 0) continue;
      var pcExtra = pathwayCounts[pk];
      pathways.push({
        pathway: pk,
        label: pathwayDisplayLabel(pk),
        users: pcExtra.users,
        completed: pcExtra.completed,
        completionRatePct: pcExtra.users > 0 ? Math.round((pcExtra.completed / pcExtra.users) * 1000) / 10 : 0
      });
    }

    var prePathway = {
      users: prePathwayUsers,
      completed: prePathwayCompleted,
      completionRatePct: prePathwayUsers > 0 ? Math.round((prePathwayCompleted / prePathwayUsers) * 1000) / 10 : 0,
      pctOfStart: totalUsers > 0 ? Math.round((prePathwayUsers / totalUsers) * 1000) / 10 : 0
    };

    var userRows: any[] = [];
    for (var uid3 in usersMap) {
      if (!Object.prototype.hasOwnProperty.call(usersMap, uid3)) continue;
      var ur = usersMap[uid3];
      var status = deriveUserStatus(ur);
      if (statusFilter && status !== statusFilter) continue;
      var startedAt = (ur.snapshot && ur.snapshot.startedAt) ? ur.snapshot.startedAt : null;
      userRows.push({
        nakamaUserId: ur.nakamaUserId || "",
        guestId: ur.identityId || "",
        cognitoSub: ur.cognitoSub || "",
        pathway: ur.pathway || "",
        country: ur.country || "",
        platform: ur.platform || "",
        lastScreen: ur.lastScreen,
        lastScreenLabel: screenLabel(ur.lastScreen),
        lastEvent: ur.lastEvent,
        status: status,
        completed: ur.completed,
        subscribed: ur.subscribed,
        paywallSeen: ur.paywallSeen,
        paywallSubscribe: ur.paywallSubscribe,
        paywallTrialStart: ur.paywallTrialStart,
        paywallDismiss: ur.paywallDismiss,
        paywallSkip: ur.paywallSkip,
        registerStart: ur.registerStart,
        appLaunchSuccess: ur.appLaunchSuccess,
        obComplete: ur.obComplete,
        pathwayConfirmed: ur.pathwayConfirmed,
        nameSetEvent: ur.nameSetEvent,
        quizFirstAnswer: ur.quizFirstAnswer,
        d1Return: ur.d1Return,
        d7Return: ur.d7Return,
        welcomeBonusClaimed: ur.welcomeBonusClaimed,
        streakShieldActivated: ur.streakShieldActivated,
        identityLinked: ur.identityLinked,
        unityHandoff: ur.unityHandoff,
        welcomeReturnToApp: ur.welcomeReturnToApp,
        signinHandoffNative: ur.signinHandoffNative,
        handoffSurface: ur.handoffSurface || "",
        handoffProvider: ur.handoffProvider || "",
        welcomeTheme: ur.welcomeTheme || "v1",
        returnSeenEvent: ur.returnSeenEvent || false,
        eventCount: ur.eventCount,
        firstTs: ur.firstTs,
        lastTs: ur.lastTs,
        startedAt: startedAt,
        durationMs: resolveUserDurationMs(ur)
      });
    }
    userRows.sort(function (a, b) { return (b.lastTs || 0) - (a.lastTs || 0); });
    var totalUsersFiltered = userRows.length;
    userRows = userRows.slice(0, userLimit);

    return RpcHelpers.successResponse({
      sinceMs: sinceMs,
      untilMs: untilMs,
      days: days,
      pathway: pathwayFilter,
      platform: platformFilter,
      status: statusFilter,
      welcomeTheme: welcomeThemeFilter,
      truncated: scan.truncated,
      summary: {
        totalUsers: totalUsers,
        started: totalUsers,
        completed: completedCount,
        completionRatePct: totalUsers > 0 ? Math.round((completedCount / totalUsers) * 1000) / 10 : 0,
        returnedToApp: returnedToAppCount,
        returnedToAppPct: totalUsers > 0 ? Math.round((returnedToAppCount / totalUsers) * 1000) / 10 : 0,
        trueDropCount: incompletePool,
        medianDurationMin: durationSamples.length > 0
          ? Math.round((median(durationSamples) / 60000) * 10) / 10
          : 0,
        identityLinksTotal: identityLinksTotal,
        identityMergesApplied: identityMerges,
        linkedUsersInFunnel: (function () {
          var n = 0;
          for (var lid in usersMap) {
            if (!Object.prototype.hasOwnProperty.call(usersMap, lid)) continue;
            if (usersMap[lid].identityLinked || usersMap[lid].nakamaUserId) n++;
          }
          return n;
        })()
      },
      paywall: {
        seen: paywallSeen,
        seenPctOfStart: totalUsers > 0 ? Math.round((paywallSeen / totalUsers) * 1000) / 10 : 0,
        subscribed: paywallSubscribe,
        trialStarts: paywallTrialStart,
        dismissed: paywallDismiss,
        skipped: paywallSkip,
        dropOff: paywallDrop,
        closingOfferSeen: closingOfferSeenCount,
        closingOfferClaimed: closingOfferClaimedCount,
        closingOfferClaimRatePct: closingOfferSeenCount > 0 ? Math.round((closingOfferClaimedCount / closingOfferSeenCount) * 1000) / 10 : 0,
        subscribeRatePct: paywallSeen > 0 ? Math.round((paywallSubscribe / paywallSeen) * 1000) / 10 : 0,
        trialRatePct: paywallSeen > 0 ? Math.round((paywallTrialStart / paywallSeen) * 1000) / 10 : 0,
        skipRatePct: paywallSeen > 0 ? Math.round((paywallSkip / paywallSeen) * 1000) / 10 : 0,
        dismissRatePct: paywallSeen > 0 ? Math.round((paywallDismiss / paywallSeen) * 1000) / 10 : 0,
        abBreakdown: {
          hard: {
            seen: abHardSeen,
            converted: abHardSubscribed,
            conversionRatePct: abHardSeen > 0 ? Math.round((abHardSubscribed / abHardSeen) * 1000) / 10 : 0
          },
          soft: {
            seen: abSoftSeen,
            converted: abSoftSubscribed,
            conversionRatePct: abSoftSeen > 0 ? Math.round((abSoftSubscribed / abSoftSeen) * 1000) / 10 : 0
          }
        }
      },
      welcomeThemeAB: {
        v1: {
          users: abV1Users,
          completed: abV1Completed,
          completionRatePct: abV1Users > 0 ? Math.round((abV1Completed / abV1Users) * 1000) / 10 : 0,
          paywallSeen: abV1PaywallSeen,
          paywallReachPct: abV1Users > 0 ? Math.round((abV1PaywallSeen / abV1Users) * 1000) / 10 : 0,
          subscribed: abV1Subscribed,
          subscribeRatePct: abV1PaywallSeen > 0 ? Math.round((abV1Subscribed / abV1PaywallSeen) * 1000) / 10 : 0
        },
        lavender: {
          users: abLavenderUsers,
          completed: abLavenderCompleted,
          completionRatePct: abLavenderUsers > 0 ? Math.round((abLavenderCompleted / abLavenderUsers) * 1000) / 10 : 0,
          paywallSeen: abLavenderPaywallSeen,
          paywallReachPct: abLavenderUsers > 0 ? Math.round((abLavenderPaywallSeen / abLavenderUsers) * 1000) / 10 : 0,
          subscribed: abLavenderSubscribed,
          subscribeRatePct: abLavenderPaywallSeen > 0 ? Math.round((abLavenderSubscribed / abLavenderPaywallSeen) * 1000) / 10 : 0
        },
        unknown: abThemeUnknown
      },
      eventSignals: {
        funnel: {
          registerStart: sigRegisterStart,
          registerStartPct: totalUsers > 0 ? Math.round((sigRegisterStart / totalUsers) * 1000) / 10 : 0,
          obComplete: sigObComplete,
          obCompletePct: totalUsers > 0 ? Math.round((sigObComplete / totalUsers) * 1000) / 10 : 0,
          appLaunchSuccess: sigAppLaunch,
          appLaunchSuccessPct: completedCount > 0 ? Math.round((sigAppLaunch / completedCount) * 1000) / 10 : 0
        },
        quality: {
          pathwayConfirmed: sigPathwayConfirmed,
          pathwayConfirmedPct: totalUsers > 0 ? Math.round((sigPathwayConfirmed / totalUsers) * 1000) / 10 : 0,
          nameSet: sigNameSet,
          nameSetPct: totalUsers > 0 ? Math.round((sigNameSet / totalUsers) * 1000) / 10 : 0,
          quizFirstAnswer: sigQuizFirstAnswer,
          quizFirstAnswerPct: totalUsers > 0 ? Math.round((sigQuizFirstAnswer / totalUsers) * 1000) / 10 : 0,
          medianQuizFirstAnswerSec: quizFirstAnswerSamples.length > 0
            ? Math.round((median(quizFirstAnswerSamples) / 1000) * 10) / 10
            : 0,
          reviewPromptShown: sigReviewPrompt,
          reviewPromptShownPct: totalUsers > 0 ? Math.round((sigReviewPrompt / totalUsers) * 1000) / 10 : 0,
          newsletterSkip: sigNewsletterSkip,
          newsletterSkipPct: totalUsers > 0 ? Math.round((sigNewsletterSkip / totalUsers) * 1000) / 10 : 0,
          planViewed: sigPlanViewed,
          planViewedPct: paywallSeen > 0 ? Math.round((sigPlanViewed / paywallSeen) * 1000) / 10 : 0
        },
        retention: {
          d1Return: sigD1Return,
          d1ReturnPct: completedCount > 0 ? Math.round((sigD1Return / completedCount) * 1000) / 10 : 0,
          d7Return: sigD7Return,
          d7ReturnPct: completedCount > 0 ? Math.round((sigD7Return / completedCount) * 1000) / 10 : 0,
          welcomeBonusClaimed: sigWelcomeBonus,
          welcomeBonusClaimedPct: completedCount > 0 ? Math.round((sigWelcomeBonus / completedCount) * 1000) / 10 : 0,
          streakShieldActivated: sigStreakShield,
          streakShieldActivatedPct: completedCount > 0 ? Math.round((sigStreakShield / completedCount) * 1000) / 10 : 0
        },
        handoff: {
          welcomeReturnToApp: sigWelcomeReturn,
          welcomeReturnPct: totalUsers > 0 ? Math.round((sigWelcomeReturn / totalUsers) * 1000) / 10 : 0,
          signinHandoffNative: sigSigninHandoff,
          signinHandoffPct: totalUsers > 0 ? Math.round((sigSigninHandoff / totalUsers) * 1000) / 10 : 0,
          returnedToAppTotal: returnedToAppCount,
          returnedToAppPct: totalUsers > 0 ? Math.round((returnedToAppCount / totalUsers) * 1000) / 10 : 0
        }
      },
      screenFunnel: screenFunnel,
      dropoffHotspots: dropoffHotspots.slice(0, 15),
      pathways: pathways,
      prePathway: prePathway,
      users: userRows,
      usersTotal: totalUsersFiltered
    });
  }

  function loadEventsForUser(nk: nkruntime.Nakama, nakamaUserId: string, guestId: string): any[] {
    var events: any[] = [];
    var seen: { [k: string]: boolean } = {};

    // Fast path: all post-register events live under the player's storage user (see Nakama console)
    if (nakamaUserId) {
      loadEventsFromStorageUser(nk, nakamaUserId, seen, events);
    }

    // Pre-register / guest-only events are only in the system lake — merge by identityId
    if (guestId) {
      loadEventsFromSystemFilter(nk, nakamaUserId, guestId, seen, events, 80);
    } else if (!nakamaUserId) {
      loadEventsFromSystemFilter(nk, "", guestId, seen, events, MAX_SCAN_PAGES);
    }

    events.sort(function (a, b) { return a.timestamp - b.timestamp; });
    return events;
  }

  function rpcOnboardingUserJourney(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var nakamaUserId = (data.nakama_user_id || data.nakamaUserId || "").toString();
    var guestId = (data.guest_id || data.guestId || data.identity_id || data.identityId || "").toString();
    if (!nakamaUserId && !guestId) {
      return RpcHelpers.errorResponse("nakama_user_id or guest_id required");
    }

    var eventLimit = data.event_limit || data.limit || 40;
    eventLimit = parseInt("" + eventLimit, 10);
    if (isNaN(eventLimit) || eventLimit < 1) eventLimit = 40;
    if (eventLimit > 200) eventLimit = 200;
    var eventOffset = 0;
    var eventCursor = data.event_cursor || data.cursor || "";
    if (eventCursor) {
      var parsedOffset = parseInt("" + eventCursor, 10);
      if (!isNaN(parsedOffset) && parsedOffset >= 0) eventOffset = parsedOffset;
    }

    if (!nakamaUserId && guestId) {
      var guestLink = readIdentityLink(nk, guestId);
      if (guestLink && guestLink.nakamaUserId && isNakamaUuid(guestLink.nakamaUserId)) {
        nakamaUserId = guestLink.nakamaUserId;
      }
    }
    if (nakamaUserId && !guestId) {
      var identityLoad = loadIdentityLinks(nk);
      for (var li = 0; li < identityLoad.links.length; li++) {
        var lk = identityLoad.links[li];
        if (lk.nakamaUserId === nakamaUserId && lk.anonId) {
          guestId = lk.anonId;
          break;
        }
      }
    }

    var profile: any = null;
    if (nakamaUserId) {
      try {
        var profReads = nk.storageRead([{
          collection: Constants.QV_ONBOARDING_PROFILES_COLLECTION,
          key: PROFILE_KEY,
          userId: nakamaUserId
        }]);
        if (profReads && profReads.length > 0) profile = profReads[0].value;
      } catch (e) { /* ignore */ }
    }
    if (!profile && guestId) {
      try {
        var sysProf = Storage.readSystemJson<any>(nk, Constants.QV_ONBOARDING_PROFILES_COLLECTION, "prof_" + sanitizeId(guestId, 64));
        if (sysProf) profile = sysProf;
      } catch (e2) { /* ignore */ }
    }

    var resolvedGuestId = guestId || (profile && profile.identityId) || "";
    var events = loadEventsForUser(nk, nakamaUserId, resolvedGuestId);

    var snap = profile && profile.snapshot ? sanitizeSnapshot(profile.snapshot) : {};
    var startedAt = snap.startedAt || (events.length ? events[0].timestamp : null);
    var lastTs = events.length ? events[events.length - 1].timestamp : (profile && profile.updatedAt ? profile.updatedAt : null);
    var journeyUser = {
      completed: false,
      paywallSeen: false,
      paywallSubscribe: false,
      paywallTrialStart: false,
      paywallDismiss: false,
      paywallSkip: false,
      subscribed: !!snap.subscribed,
      identityLinked: !!profile && !!(profile.cognitoSub || profile.nakamaUserId),
      nakamaUserId: nakamaUserId || (profile && profile.nakamaUserId) || ""
    };
    for (var ei = 0; ei < events.length; ei++) {
      var en = events[ei].name;
      if (isCompletionEvent(en)) journeyUser.completed = true;
      if (en === "ob_paywall_seen") journeyUser.paywallSeen = true;
      if (en === "ob_paywall_subscribe") { journeyUser.paywallSubscribe = true; journeyUser.subscribed = true; }
      if (en === "ob_paywall_trial_start") { journeyUser.paywallTrialStart = true; journeyUser.subscribed = true; }
      if (en === "ob_paywall_dismiss") journeyUser.paywallDismiss = true;
      if (en === "ob_paywall_skip") journeyUser.paywallSkip = true;
      if (en === "ob_identity_linked") journeyUser.identityLinked = true;
      applyUnityHandoffFromEvent(journeyUser, { name: en, data: events[ei].data || {} });
    }
    var guestLinkMeta = guestId ? readIdentityLink(nk, guestId) : null;
    if (guestLinkMeta && guestLinkMeta.nakamaUserId) journeyUser.identityLinked = true;
    if (!journeyUser.identityLinked && nakamaUserId) journeyUser.identityLinked = true;

    var totalEvents = events.length;
    var pageEvents = events.slice(eventOffset, eventOffset + eventLimit);
    var nextOffset = eventOffset + pageEvents.length;
    var hasMoreEvents = nextOffset < totalEvents;

    return RpcHelpers.successResponse({
      nakamaUserId: nakamaUserId || null,
      guestId: guestId || (profile && profile.identityId) || null,
      cognitoSub: (profile && profile.cognitoSub) || null,
      status: deriveUserStatus(journeyUser),
      eventCount: totalEvents,
      events: pageEvents,
      eventPagination: {
        total: totalEvents,
        offset: eventOffset,
        limit: eventLimit,
        returned: pageEvents.length,
        nextCursor: hasMoreEvents ? ("" + nextOffset) : null,
        hasMore: hasMoreEvents
      },
      profile: profile ? {
        lastScreen: profile.lastScreen || "",
        lastEvent: profile.lastEvent || "",
        pathway: snap.pathway || "",
        platform: snap.platform || "",
        country: snap.country || "",
        identityId: profile.identityId || resolvedGuestId || "",
        updatedAt: profile.updatedAt || null,
        snapshot: snap
      } : null,
      startedAt: startedAt,
      lastSeenAt: lastTs,
      durationMs: snap.elapsedMs || (startedAt && lastTs ? Math.max(0, lastTs - toMs(startedAt)) : 0),
      playerScopedEvents: !!nakamaUserId && events.length > 0
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

        if (rec.name === "ob_congrats_seen" || rec.name === "ob_unity_return" || rec.name === "ob_deeplink_fire" || rec.name === "ob_complete" || rec.name === "ob_app_launch_success") {
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
    initializer.registerRpc("onboarding_funnel_analytics", rpcOnboardingFunnelAnalytics);
    initializer.registerRpc("onboarding_user_journey", rpcOnboardingUserJourney);
  }
}
