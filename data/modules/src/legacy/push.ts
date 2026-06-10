namespace LegacyPush {

  interface PushTokenData {
    tokens: {
      token: string;
      platform: string;
      updatedAt: number;
      endpointArn?: string;
      provider?: string;
      providerRegisteredAt?: number;
      providerError?: string;
      // Set to true when the Lambda registration has not yet completed
      // (e.g. client disconnected mid-flight → context canceled). The
      // scheduler calls flushPendingRegistrations every 30 min to retry
      // all rows where pendingRegistration=true.
      pendingRegistration?: boolean;
      // Retry bookkeeping for the scheduler flush loop.
      pendingRetries?: number;
      pendingLastAttempt?: number;
      // Stash original payload so scheduler can replay without client.
      pendingGameId?: string;
      pendingIsSandbox?: boolean;
      pendingFcmProjectId?: string;
    }[];
  }

  var DEFAULT_PUSH_NOTIFICATION_CODE = 7001;

  // ─── Production hardcoded Lambda Function URLs ──────────────────────────────
  // Single source of truth for the AWS Lambda Function URLs that back our push
  // pipeline. Hardcoded so the system works even when Nakama starts without the
  // PUSH_REGISTER_URL / PUSH_LAMBDA_URL / PUSH_SEND_URL env vars set (e.g. on
  // first deploy, or in a fresh K8s manifest). Env vars still take precedence
  // when present, so ops can rotate URLs without a Nakama rebuild.
  //
  // Update both values below if the Lambda URLs ever change.
  //   - REGISTER URL → push-register-endpoint Lambda (creates SNS endpoint ARN)
  //   - SEND URL     → push-send-notification Lambda (publishes to SNS endpoint)
  //
  // ⚠️ TODO(ops): paste the actual REGISTER URL between the quotes below.
  // The SEND URL is from the production push-notification documentation.
  var PUSH_REGISTER_URL_DEFAULT = "https://alwe7byu637jhiwnkyzlg2fphm0fxioh.lambda-url.us-east-1.on.aws/";
  var PUSH_SEND_URL_DEFAULT     = "https://dp3gdkvjst4dwlehmuk3o7l4zm0rjapm.lambda-url.us-east-1.on.aws/";

  function getPushTokens(nk: nkruntime.Nakama, userId: string): PushTokenData {
    var key = "token_" + userId;
    var data = Storage.readJson<PushTokenData>(nk, Constants.PUSH_TOKENS_COLLECTION, key, userId);
    return data || { tokens: [] };
  }

  function savePushTokens(nk: nkruntime.Nakama, userId: string, data: PushTokenData): void {
    var key = "token_" + userId;
    Storage.writeJson(nk, Constants.PUSH_TOKENS_COLLECTION, key, userId, data);
  }

  function env(ctx: nkruntime.Context, key: string): string {
    return (ctx.env && ctx.env[key]) || "";
  }

  function parseJsonSafe(raw: string): any {
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }

  function normalizePlatform(platform: string): string {
    var p = String(platform || "unknown").toLowerCase();
    if (p === "ios" || p === "apns" || p === "apple") return "ios";
    if (p === "android" || p === "fcm" || p === "gcm") return "android";
    if (p === "web") return "web";
    return p;
  }

  // ARN path is the source of truth for what platform an endpoint actually
  // reaches. Every SNS endpoint ARN looks like:
  //   arn:aws:sns:<region>:<acct>:endpoint/<TYPE>/<app-name>/<endpoint-id>
  // where <TYPE> ∈ { APNS, APNS_SANDBOX, GCM, FCM, ADM, MPNS, WNS, ... }.
  // A previous bug let "platform=ios" get stored alongside a /GCM/ endpoint,
  // which caused push_send_event to build APNs envelopes for Android targets,
  // which SNS then forwarded to FCM as a `default` string with no notification
  // block — accepted by SNS, silently dropped by FCM. We now correct platform
  // from the ARN every time, both at register and at send.
  function platformFromArn(arn: string): string {
    if (!arn || typeof arn !== "string") return "";
    var seg = arn.split(":endpoint/")[1];
    if (!seg) return "";
    var type = (seg.split("/")[0] || "").toUpperCase();
    if (type === "APNS" || type === "APNS_SANDBOX" || type === "APNS_VOIP" || type === "APNS_VOIP_SANDBOX") return "ios";
    if (type === "GCM" || type === "FCM") return "android";
    if (type === "ADM") return "android";
    if (type === "WNS" || type === "MPNS") return "windows";
    if (type === "BAIDU") return "android";
    return "";
  }

  // Strip token rows that have no SNS endpoint ARN. These are ghosts from
  // earlier failed registrations (Lambda accepted the call but SNS
  // CreatePlatformEndpoint rejected the token, e.g. when an Android FCM
  // token was sent at an APNs Platform App). They make push_send_event
  // produce noisy "endpointArn missing" rows in providerResults and skew
  // the recipientCount math. Idempotent — safe to call on every send.
  function pruneGhostTokens(tokensData: PushTokenData): { kept: any[], dropped: number } {
    if (!tokensData || !tokensData.tokens) return { kept: [], dropped: 0 };
    var kept: any[] = [];
    var dropped = 0;
    for (var i = 0; i < tokensData.tokens.length; i++) {
      var t = tokensData.tokens[i];
      if (t && typeof t.endpointArn === "string" && t.endpointArn.length > 0) {
        kept.push(t);
      } else {
        dropped++;
      }
    }
    return { kept: kept, dropped: dropped };
  }

  // Native APNs tokens are hex-encoded (64 or 160 chars). Anything else —
  // notably the `<id>:APA91b...`-shaped strings that Firebase Messaging
  // returns even on iOS — is an FCM token and MUST be routed to the GCM
  // Platform App, otherwise SNS will create a useless endpoint that never
  // delivers. The lambda makes the same call defensively, but doing it
  // here too keeps the platformType hint accurate in the wire payload.
  function detectTokenFormat(token: string): string {
    var t = String(token || "").trim();
    var hex = /^[0-9a-fA-F]+$/;
    if (hex.test(t) && (t.length === 64 || t.length === 160)) return "APNS";
    return "FCM";
  }

  function registerProviderEndpoint(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, userId: string, token: string, platform: string, gameId: string, isSandbox: boolean, fcmProjectId: string): any {
    var normalizedPlatform = normalizePlatform(platform);
    var registerUrl = env(ctx, "PUSH_REGISTER_URL") || env(ctx, "PUSH_LAMBDA_URL") || PUSH_REGISTER_URL_DEFAULT;
    if (!registerUrl) {
      logger.warn("[Push] registerProviderEndpoint: no register URL configured for platform=%s userId=%s", normalizedPlatform, userId);
      return { configured: false };
    }

    logger.info("[Push] Registering %s endpoint for userId=%s gameId=%s isSandbox=%s", normalizedPlatform, userId, gameId || "quizverse", String(!!isSandbox));

    try {
      var detectedFormat = detectTokenFormat(token);
      // Use the detected format as the canonical hint — this is what the
      // lambda will route on. The declared platform stays in the payload
      // for human-debug and Pinpoint user attribution only.
      var platformType = detectedFormat;
      if (detectedFormat === "APNS" && normalizedPlatform !== "ios") {
        logger.warn("[Push] Token shape says APNs but caller said platform=%s. Routing as APNs.", normalizedPlatform);
      } else if (detectedFormat === "FCM" && normalizedPlatform === "ios") {
        logger.info("[Push] iOS device shipped a Firebase token. Routing through GCM Platform App; iOS delivery will be handled by Firebase → APNs (.p8 must be uploaded to Firebase Console).");
      }
      // fcmProjectId is REQUIRED for FCM tokens going forward — it tells the
      // send-push Lambda which Firebase service-account JSON to authenticate
      // with when calling FCM v1. Without it the lambda falls back to the
      // DEFAULT_FCM_PROJECT_ID env var; if that's also unset, sends fail
      // with FCM_PROJECT_ID_MISSING.
      var resolvedFcmProjectId = fcmProjectId || env(ctx, "DEFAULT_FCM_PROJECT_ID") || "";
      if (detectedFormat === "FCM" && !resolvedFcmProjectId) {
        logger.warn("[Push] FCM token registered with no fcmProjectId and no DEFAULT_FCM_PROJECT_ID env var. " +
          "Sends to this endpoint will fail. Fix: have the client pass `fcmProjectId` from its " +
          "Firebase config (GoogleService-Info.plist PROJECT_ID / google-services.json project_id).");
      }
      var body = JSON.stringify({
        userId: userId,
        gameId: gameId || "quizverse",
        deviceToken: token,
        token: token,
        platform: normalizedPlatform,
        platformType: platformType,
        isSandbox: !!isSandbox,
        fcmProjectId: resolvedFcmProjectId
      });
      var resp: any = nk.httpRequest(registerUrl, "post", { "Content-Type": "application/json" }, body, 10000);
      var parsed = parseJsonSafe(resp && resp.body ? resp.body : "");
      var responseBody = parsed && parsed.body && typeof parsed.body === "string" ? parseJsonSafe(parsed.body) : parsed;
      var code = resp && resp.code ? resp.code : 0;
      if (code >= 200 && code < 300 && responseBody && responseBody.success !== false) {
        var arn = responseBody.endpointArn || responseBody.EndpointArn || "";
        // ARN is the truth. If the SDK said "ios" but SNS gave us a /GCM/ ARN
        // (e.g. ops misconfigured SNS_PLATFORM_APP_ARN_IOS, or an enum got
        // miscast at the client), the ARN tells us the real platform. We log
        // a warning so this is visible in deploy logs, but we don't fail —
        // the endpoint is real and reachable, just under a different platform.
        var arnPlatform = platformFromArn(arn);
        if (arn && arnPlatform && arnPlatform !== normalizedPlatform) {
          logger.warn("[Push] register: caller said platform=%s but ARN resolves to %s. " +
            "Trusting ARN. arn=%s | likely cause: SNS_PLATFORM_APP_ARN_%s misconfigured " +
            "OR client SDK sent the wrong platform string.",
            normalizedPlatform, arnPlatform, arn, normalizedPlatform.toUpperCase());
        }
        var resolvedPlatform = arnPlatform || normalizedPlatform;
        logger.info("[Push] %s endpoint registered successfully. endpointArn=%s resolvedPlatform=%s",
          normalizedPlatform, arn, resolvedPlatform);
        return {
          configured: true,
          success: true,
          provider: "sns",
          endpointArn: arn,
          platform: resolvedPlatform,
          raw: responseBody
        };
      }
      var errMsg = (responseBody && (responseBody.error || responseBody.message)) || ("HTTP " + code);
      logger.warn("[Push] %s endpoint registration failed: %s | HTTP %s | userId=%s | " +
        "Fix: check Lambda logs, verify APNs key in Firebase (iOS) or FCM sender ID (Android).",
        normalizedPlatform, errMsg, code, userId);
      return {
        configured: true,
        success: false,
        error: errMsg
      };
    } catch (e: any) {
      logger.error("[Push] registerProviderEndpoint exception: platform=%s userId=%s error=%s",
        normalizedPlatform, userId, e.message || String(e));
      return { configured: true, success: false, error: e.message || String(e) };
    }
  }

  function sendProviderPush(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, endpoint: any, payload: any): any {
    // ARN beats stored platform. If the row says "ios" but its ARN is /GCM/
    // (legacy mislabel pre-fix), we MUST send the FCM envelope, not the APNs
    // envelope. Otherwise SNS falls back to `default` plain string and FCM
    // delivers nothing to the device's system tray.
    var arnPlatform = platformFromArn(endpoint && endpoint.endpointArn);
    var normalizedPlatform = arnPlatform || normalizePlatform(endpoint && endpoint.platform);
    if (arnPlatform && endpoint && endpoint.platform &&
        normalizePlatform(endpoint.platform) !== arnPlatform) {
      logger.warn("[Push] send: stored platform=%s disagrees with ARN platform=%s. " +
        "Using ARN. arn=%s — this row was likely written by a buggy register call; " +
        "it will be auto-corrected next time push_register_token runs.",
        endpoint.platform, arnPlatform, endpoint.endpointArn);
    }
    var sendUrl = env(ctx, "PUSH_SEND_URL") || PUSH_SEND_URL_DEFAULT;
    if (!sendUrl) {
      logger.warn("[Push] sendProviderPush: no send URL configured for platform=%s", normalizedPlatform);
      return { configured: false };
    }
    if (!endpoint.endpointArn) {
      logger.warn("[Push] sendProviderPush: endpointArn missing for platform=%s — " +
        "device has no registered SNS endpoint. " +
        "Fix: re-run push_register_token from the device. " +
        "iOS: verify APNs Auth Key is uploaded in Firebase Console → Project Settings → Cloud Messaging. " +
        "Android: verify google-services.json sender ID matches Firebase project.",
        normalizedPlatform);
      return { configured: true, success: false, error: "endpointArn missing" };
    }

    try {
      var body = JSON.stringify({
        endpointArn: endpoint.endpointArn,
        platform: normalizedPlatform,
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        gameId: payload.gameId || "quizverse",
        eventType: payload.eventType || "push_event"
      });
      var resp: any = nk.httpRequest(sendUrl, "post", { "Content-Type": "application/json" }, body, 10000);
      var parsed = parseJsonSafe(resp && resp.body ? resp.body : "");
      var responseBody = parsed && parsed.body && typeof parsed.body === "string" ? parseJsonSafe(parsed.body) : parsed;
      var code = resp && resp.code ? resp.code : 0;
      if (code >= 200 && code < 300 && responseBody && responseBody.success !== false) {
        logger.info("[Push] Push sent to %s endpoint. eventType=%s messageId=%s",
          normalizedPlatform, payload.eventType || "push_event", responseBody.messageId || "");
        return { configured: true, success: true, messageId: responseBody.messageId, raw: responseBody };
      }
      var errMsg = (responseBody && (responseBody.error || responseBody.message)) || ("HTTP " + code);
      logger.warn("[Push] Push to %s failed: %s | HTTP %s | arn=%s",
        normalizedPlatform, errMsg, code, endpoint.endpointArn);
      return {
        configured: true,
        success: false,
        error: errMsg
      };
    } catch (e: any) {
      logger.error("[Push] sendProviderPush exception: platform=%s arn=%s error=%s",
        normalizedPlatform, endpoint.endpointArn || "none", e.message || String(e));
      return { configured: true, success: false, error: e.message || String(e) };
    }
  }

  function rpcPushRegisterToken(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var token = data.token;
      var platform = data.platform || "unknown";
      var gameId = data.gameId || data.game_id || "quizverse";
      // isSandbox flag — set true from Unity for development/debug iOS
      // builds. Routes the registration to the APNS_SANDBOX Platform App
      // so that pushes generated against a development provisioning
      // profile actually deliver. Production iOS (TestFlight + App Store)
      // builds must NOT set this flag — they need the APNS prod app.
      var isSandbox = data.isSandbox === true || data.isSandbox === "true" || data.is_sandbox === true || data.is_sandbox === "true";
      // Client passes its Firebase project ID (from GoogleService-Info.plist
      // PROJECT_ID on iOS, google-services.json project_id on Android, or
      // firebaseConfig.projectId on web). Required for FCM v1 auth at send
      // time so we know which service-account JSON to load.
      var fcmProjectId = data.fcmProjectId || data.fcm_project_id || data.firebaseProjectId || "";
      logger.info("[Push] push_register_token: userId=%s platform=%s gameId=%s tokenPrefix=%s isSandbox=%s fcmProjectId=%s",
        userId, platform, gameId, token ? token.substring(0, 10) + "..." : "MISSING", String(isSandbox), fcmProjectId || "(none)");
      if (!token) {
        logger.warn("[Push] push_register_token rejected: no token provided. userId=%s platform=%s", userId, platform);
        return RpcHelpers.errorResponse("token required");
      }

      var now = Math.floor(Date.now() / 1000);
      var normalizedPlatformEarly = normalizePlatform(platform);

      // ─────────────────────────────────────────────────────────────────────
      // CRITICAL: Write the token to storage BEFORE any Lambda/HTTP call.
      //
      // Root-cause of "context canceled" errors:
      //   Nakama's Goja runtime binds ALL operations (nk.httpRequest AND
      //   nk.storageWrite) to the RPC's HTTP context. When the mobile client
      //   disconnects mid-flight (app backgrounded, network switch, OS kills
      //   the socket), the context is canceled. If storageWrite runs AFTER
      //   nk.httpRequest, it also fails — producing:
      //     [Push] push_register_token exception: failed to write storage
      //     objects: context canceled
      //   and the token is lost entirely.
      //
      // Fix: write a "pending" row first (fast, local, completes before
      // the client can disconnect). Lambda call happens after. If Lambda
      // succeeds we update the row with the ARN. If Lambda fails (context
      // canceled), the pending row stays and the scheduler retries every
      // 30 min via flushPendingRegistrations.
      // ─────────────────────────────────────────────────────────────────────
      var tokensData = getPushTokens(nk, userId);

      // Ghost-row hygiene: drop any existing rows for this user that have no
      // endpointArn (stale failed registrations). They're never deliverable
      // and only confuse providerResults at send time. Idempotent.
      var pruned = pruneGhostTokens(tokensData);
      if (pruned.dropped > 0) {
        logger.info("[Push] push_register_token: pruned %s ghost token row(s) (no endpointArn) for userId=%s",
          pruned.dropped, userId);
      }
      tokensData.tokens = pruned.kept;

      // Upsert a pending row — guarantees the token is never lost regardless
      // of what happens to the Lambda call or the second storage write.
      var existingPendingIdx = -1;
      for (var i = 0; i < tokensData.tokens.length; i++) {
        if (tokensData.tokens[i].token === token) { existingPendingIdx = i; break; }
      }
      if (existingPendingIdx >= 0) {
        var ep = tokensData.tokens[existingPendingIdx];
        ep.platform = normalizedPlatformEarly;
        ep.updatedAt = now;
        ep.pendingRegistration = true;
        ep.pendingGameId = gameId;
        ep.pendingIsSandbox = isSandbox;
        ep.pendingFcmProjectId = fcmProjectId;
      } else {
        tokensData.tokens.push({
          token: token,
          platform: normalizedPlatformEarly,
          updatedAt: now,
          pendingRegistration: true,
          pendingRetries: 0,
          pendingLastAttempt: now,
          pendingGameId: gameId,
          pendingIsSandbox: isSandbox,
          pendingFcmProjectId: fcmProjectId,
        });
      }
      // This write MUST happen before any nk.httpRequest call. It is the
      // atomicity guarantee — token is safe even if context cancels later.
      savePushTokens(nk, userId, tokensData);
      // Register this user in the pending index so the scheduler can find
      // the row if the Lambda call below fails (context canceled).
      addToPendingIndex(nk, logger, userId);
      logger.info("[Push] push_register_token: pending row saved. Calling Lambda. userId=%s platform=%s",
        userId, normalizedPlatformEarly);

      // ─── Lambda call (context-cancel-safe: pending row already saved) ───
      var provider = registerProviderEndpoint(ctx, logger, nk, userId, token, platform, gameId, isSandbox, fcmProjectId);

      // Resolved platform: ARN-derived when SNS handed us back an endpoint,
      // else the caller's input.
      var resolvedPlatform: string = (provider && provider.platform) ||
        (provider && provider.endpointArn ? platformFromArn(provider.endpointArn) : "") ||
        normalizedPlatformEarly;

      // ─── Update storage with ARN (wrapped — may fail if context canceled) ──
      // If this write fails, the pending row from above is already saved.
      // The scheduler will retry and obtain the ARN on the next 30-min tick.
      try {
        var tokensData2 = getPushTokens(nk, userId);
        var targetIdx = -1;
        for (var j = 0; j < tokensData2.tokens.length; j++) {
          if (tokensData2.tokens[j].token === token) { targetIdx = j; break; }
        }
        if (targetIdx < 0) {
          // Pending row was somehow absent — re-add it (defensive)
          targetIdx = tokensData2.tokens.length;
          tokensData2.tokens.push({ token: token, platform: resolvedPlatform, updatedAt: now, pendingRegistration: true });
        }
        var row = tokensData2.tokens[targetIdx];
        row.platform = resolvedPlatform;
        row.updatedAt = now;
        if (provider && provider.success && provider.endpointArn) {
          row.endpointArn = provider.endpointArn;
          row.pendingRegistration = false;
          row.pendingRetries = 0;
          row.provider = provider.provider || "sns";
          row.providerRegisteredAt = now;
          row.providerError = undefined;
          // Clear scheduler stash fields after successful registration
          row.pendingGameId = undefined;
          row.pendingIsSandbox = undefined;
          row.pendingFcmProjectId = undefined;
        } else if (provider && provider.configured) {
          row.pendingRegistration = true;
          row.pendingRetries = (row.pendingRetries || 0) + 1;
          row.pendingLastAttempt = now;
          row.providerError = (provider && provider.error) || "Lambda registration failed";
        }
        savePushTokens(nk, userId, tokensData2);
      } catch (saveErr: any) {
        // Context was already canceled during or after the Lambda call.
        // The initial pending row (written BEFORE Lambda) is safe in storage.
        // The scheduler (flushPendingRegistrations, every 30 min) will retry.
        logger.warn("[Push] push_register_token: ARN-update write skipped (context canceled after Lambda) — " +
          "pending row already saved, scheduler will complete registration. userId=%s error=%s",
          userId, saveErr.message || String(saveErr));
      }

      var finalArn = (provider && provider.endpointArn) ? provider.endpointArn : "";
      if (finalArn) {
        logger.info("[Push] push_register_token SUCCESS: userId=%s requestedPlatform=%s resolvedPlatform=%s endpointArn=%s",
          userId, platform, resolvedPlatform, finalArn);
      } else {
        logger.warn("[Push] push_register_token PENDING: no ARN from Lambda — row saved as pending, scheduler will retry. " +
          "userId=%s requestedPlatform=%s providerError=%s",
          userId, platform, (provider && provider.error) || "none");
      }

      return JSON.stringify({
        success: !!finalArn,
        pending: !finalArn,
        userId: userId,
        gameId: gameId,
        platform: resolvedPlatform,
        requestedPlatform: platform,
        endpointArn: finalArn,
        registeredAt: new Date().toISOString(),
        provider: provider,
        error: finalArn ? undefined : ((provider && provider.error) || "Pending — scheduler will complete registration")
      });
    } catch (e: any) {
      logger.error("[Push] push_register_token exception: %s", e.message || String(e));
      return RpcHelpers.errorResponse(e.message || "Failed to register token");
    }
  }

  function rpcPushSendEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var targetUserId = data.userId || data.targetUserId;
      var subject = data.subject || data.eventType || "push_event";
      var content = data.content || {
        eventType: data.eventType || subject,
        title: data.title || subject,
        body: data.body || "",
        data: data.data || {}
      };
      var code = Number(data.code || DEFAULT_PUSH_NOTIFICATION_CODE);
      if (!targetUserId) {
        logger.warn("[Push] push_send_event rejected: no targetUserId in payload.");
        return RpcHelpers.errorResponse("userId required");
      }
      if (!code || code <= 0) code = DEFAULT_PUSH_NOTIFICATION_CODE;
      var title = content.title || subject;
      var body = content.body || "";
      var tokensData = getPushTokens(nk, targetUserId);

      // Self-heal: drop ghost token rows (no endpointArn). These are stale
      // failed registrations that pollute providerResults and confuse callers.
      // Persist the cleanup once so future sends and push_get_endpoints stay
      // clean too. Safe / idempotent.
      var prunedAtSend = pruneGhostTokens(tokensData);
      if (prunedAtSend.dropped > 0) {
        logger.info("[Push] push_send_event: pruning %s ghost row(s) (no endpointArn) for targetUserId=%s — " +
          "these came from earlier failed registrations and were never deliverable.",
          prunedAtSend.dropped, targetUserId);
        tokensData.tokens = prunedAtSend.kept;
        try { savePushTokens(nk, targetUserId, tokensData); } catch (_) {}
      }

      logger.info("[Push] push_send_event: eventType=%s targetUserId=%s deliverableTokens=%s",
        subject, targetUserId, tokensData.tokens ? tokensData.tokens.length : 0);
      if (!tokensData.tokens || tokensData.tokens.length === 0) {
        logger.warn("[Push] push_send_event: targetUserId=%s has NO deliverable push endpoints. " +
          "The user must launch the app on a real device at least once after granting notification permission " +
          "so push_register_token can run and create an SNS endpoint.", targetUserId);
      } else {
        var platforms: string[] = [];
        for (var pi = 0; pi < tokensData.tokens.length; pi++) {
          var arnPlat = platformFromArn(tokensData.tokens[pi].endpointArn || "");
          platforms.push((arnPlat || tokensData.tokens[pi].platform) + "(arn✓)");
        }
        logger.info("[Push] push_send_event: endpoints=[%s]", platforms.join(", "));
      }
      var providerResults: any[] = [];
      for (var i = 0; i < tokensData.tokens.length; i++) {
        var t: any = tokensData.tokens[i];
        var providerResult = sendProviderPush(ctx, logger, nk, t, {
          title: title,
          body: body,
          data: content.data || {},
          gameId: data.gameId || data.game_id || "quizverse",
          eventType: data.eventType || subject
        });
        // Report ARN-derived platform in the response so callers don't see
        // the legacy mislabel ("ios" for a /GCM/ endpoint). This is the
        // platform the Lambda was actually told to build the envelope for.
        var reportPlatform = platformFromArn(t.endpointArn || "") || t.platform;
        if (providerResult.configured) providerResults.push({
          platform: reportPlatform,
          endpointArn: t.endpointArn,
          success: providerResult.success === true,
          messageId: providerResult.messageId,
          error: providerResult.error
        });
      }
      nk.notificationsSend([{
        userId: targetUserId,
        subject: subject,
        content: content,
        code: code,
        persistent: data.persistent !== false
      }]);
      // Flat response shape — matches Unity's PushSendResponse {success, messageId,
      // eventType, recipientCount, sentAt, error}. No .data wrap.
      // recipientCount = number of provider endpoints that accepted the push.
      // The in-app inbox notification (notificationsSend above) is always
      // delivered for the user, but we report device-push delivery here.
      var successCount = 0;
      for (var pr = 0; pr < providerResults.length; pr++) {
        if (providerResults[pr] && providerResults[pr].success === true) successCount++;
      }
      if (successCount > 0) {
        logger.info("[Push] push_send_event DONE: eventType=%s sentToDevices=%s/%s targetUserId=%s",
          subject, successCount, providerResults.length, targetUserId);
      } else if (providerResults.length > 0) {
        logger.warn("[Push] push_send_event FAILED to reach any device: eventType=%s targetUserId=%s — " +
          "check providerResults in the response body for per-platform errors.", subject, targetUserId);
      }
      return JSON.stringify({
        success: true,
        messageId: "nakama_notification_" + Date.now(),
        eventType: data.eventType || subject,
        recipientCount: successCount,
        sentAt: new Date().toISOString(),
        providerConfigured: providerResults.length > 0,
        providerResults: providerResults
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to send event");
    }
  }

  function rpcPushGetEndpoints(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var targetUserId = data.userId || userId;
      var tokensData = getPushTokens(nk, targetUserId);
      // Self-heal ghost rows here too — many callers hit get_endpoints to
      // check device state without ever calling send_event, so we mustn't
      // rely on send_event being the only place that prunes.
      var prunedHere = pruneGhostTokens(tokensData);
      if (prunedHere.dropped > 0) {
        tokensData.tokens = prunedHere.kept;
        try { savePushTokens(nk, targetUserId, tokensData); } catch (_) {}
      }
      var endpoints = tokensData.tokens.map(function (t) {
        return {
          endpointArn: t.endpointArn,
          platform: platformFromArn(t.endpointArn || "") || t.platform,
          enabled: !t.providerError,
          createdAt: t.providerRegisteredAt ? new Date(t.providerRegisteredAt * 1000).toISOString() : "",
          lastUpdated: t.updatedAt ? new Date(t.updatedAt * 1000).toISOString() : ""
        };
      });
      // Flat response shape — matches Unity's PushEndpointsResponse {success, userId,
      // gameId, endpoints[], error}. No .data wrap.
      return JSON.stringify({
        success: true,
        userId: targetUserId,
        gameId: data.gameId || "quizverse",
        endpoints: endpoints
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to get endpoints");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //                       NOTIFICATION BROADCAST PIPELINE
  // ───────────────────────────────────────────────────────────────────────────
  // Server-driven engagement notifications. All 7 flows below run on Nakama
  // (called by K8s CronJob → admin RPC), respect quiet hours (22:00–08:00
  // user-local), respect once-per-day markers, and pick locale from the
  // user's account.langTag / player metadata. Unity does no local scheduling
  // when its `useRemoteOnlyNotifications` flag is on (see PushNotificationManager.cs).
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Localization (13 supported locales — matches Unity's LocaleConstants) ─
  // Placeholder syntax: {topic}, {type}, {streak}, {days}, {name}, {mode}.
  var NOTIF_STRINGS: { [messageKey: string]: { [locale: string]: string } } = {
    daily_quiz_title: {
      en: "🎯 New Daily Quiz!",       hi: "🎯 नया डेली क्विज़!",       es: "🎯 ¡Nuevo Quiz Diario!",   fr: "🎯 Nouveau Quiz Quotidien !",
      de: "🎯 Neues Tages-Quiz!",     pt: "🎯 Novo Quiz Diário!",      ru: "🎯 Новый ежедневный квиз!",  ja: "🎯 新しいデイリークイズ！",
      ko: "🎯 새로운 데일리 퀴즈!",    "zh-Hans": "🎯 每日新测验！",     ar: "🎯 اختبار يومي جديد!",      id: "🎯 Quiz Harian Baru!",       zu: "🎯 Imibuzo emisha yansuku zonke!"
    },
    daily_quiz_body: {
      en: "Today's topic: {topic}. Tap to play!",                   hi: "आज का विषय: {topic}. खेलने के लिए टैप करें!",
      es: "Tema de hoy: {topic}. ¡Toca para jugar!",                fr: "Sujet du jour : {topic}. Touchez pour jouer !",
      de: "Heutiges Thema: {topic}. Tippen zum Spielen!",           pt: "Tema de hoje: {topic}. Toque para jogar!",
      ru: "Тема дня: {topic}. Нажмите, чтобы играть!",              ja: "今日のトピック：{topic}。タップしてプレイ！",
      ko: "오늘의 주제: {topic}. 탭하여 플레이!",                    "zh-Hans": "今日主题：{topic}。点击开始游戏！",
      ar: "موضوع اليوم: {topic}. انقر للعب!",                       id: "Topik hari ini: {topic}. Ketuk untuk main!",
      zu: "Isihloko sanamuhla: {topic}. Thepha ukuze udlale!"
    },
    weekly_quiz_title: {
      en: "📚 Fresh Weekly Quiz!",    hi: "📚 नया साप्ताहिक क्विज़!",   es: "📚 ¡Nuevo Quiz Semanal!",  fr: "📚 Nouveau Quiz Hebdo !",
      de: "📚 Neues Wochen-Quiz!",    pt: "📚 Novo Quiz Semanal!",     ru: "📚 Новый еженедельный квиз!", ja: "📚 新しいウィークリークイズ！",
      ko: "📚 새로운 위클리 퀴즈!",    "zh-Hans": "📚 每周新测验！",     ar: "📚 اختبار أسبوعي جديد!",     id: "📚 Quiz Mingguan Baru!",      zu: "📚 Imibuzo emisha yamasonto!"
    },
    weekly_quiz_body: {
      en: "{type} quiz updated — fresh questions inside!",                hi: "{type} क्विज़ अपडेट हुआ — नए प्रश्न मौजूद हैं!",
      es: "El quiz de {type} se actualizó — ¡preguntas nuevas!",          fr: "Le quiz {type} a été mis à jour — nouvelles questions !",
      de: "Quiz {type} aktualisiert — neue Fragen warten!",               pt: "Quiz {type} atualizado — novas perguntas!",
      ru: "Квиз «{type}» обновлён — новые вопросы внутри!",              ja: "{type}クイズが更新されました — 新しい問題！",
      ko: "{type} 퀴즈 업데이트 — 새로운 문제 도착!",                     "zh-Hans": "{type}测验已更新 — 全新题目！",
      ar: "تم تحديث اختبار {type} — أسئلة جديدة!",                       id: "Quiz {type} diperbarui — soal baru!",
      zu: "Imibuzo ye-{type} ibuyekeziwe — imibuzo emisha!"
    },
    streak_warning_title: {
      en: "🔥 Streak Alert!",         hi: "🔥 स्ट्रीक अलर्ट!",        es: "🔥 ¡Alerta de Racha!",   fr: "🔥 Alerte série !",
      de: "🔥 Serien-Alarm!",         pt: "🔥 Alerta de Sequência!",   ru: "🔥 Серия в опасности!",  ja: "🔥 連続記録アラート！",
      ko: "🔥 연속 기록 경고!",        "zh-Hans": "🔥 连胜警报！",       ar: "🔥 تنبيه السلسلة!",      id: "🔥 Peringatan Streak!",       zu: "🔥 Isexwayiso sokuqhubeka!"
    },
    streak_warning_body: {
      en: "Don't lose your {streak}-day streak! Play now.",        hi: "अपनी {streak}-दिन की स्ट्रीक मत खोएं! अभी खेलें।",
      es: "¡No pierdas tu racha de {streak} días! Juega ya.",      fr: "Ne perdez pas vos {streak} jours de série ! Jouez maintenant.",
      de: "Verliere nicht deine {streak}-Tage-Serie! Jetzt spielen.", pt: "Não perca sua sequência de {streak} dias! Jogue agora.",
      ru: "Не теряй серию из {streak} дней! Играй сейчас.",        ja: "{streak}日連続記録を失わないで！今すぐプレイ。",
      ko: "{streak}일 연속 기록을 잃지 마세요! 지금 플레이.",        "zh-Hans": "别让 {streak} 天连胜中断！立即开玩。",
      ar: "لا تفقد سلسلة {streak} يوم! العب الآن.",                id: "Jangan hilangkan streak {streak} hari! Main sekarang.",
      zu: "Ungalahli ukuqhubeka kwakho kwezinsuku ezingu-{streak}! Dlala manje."
    },
    idle_winback_title: {
      en: "👋 We miss you!",          hi: "👋 हमें आपकी याद आती है!",  es: "👋 ¡Te extrañamos!",      fr: "👋 Tu nous manques !",
      de: "👋 Wir vermissen dich!",    pt: "👋 Sentimos sua falta!",    ru: "👋 Мы скучаем!",          ja: "👋 お待ちしています！",
      ko: "👋 그리워요!",              "zh-Hans": "👋 想你了！",          ar: "👋 افتقدناك!",            id: "👋 Kami merindukanmu!",       zu: "👋 Sikukhumbula!"
    },
    idle_winback_body: {
      en: "It's been {days} days. New quizzes are waiting — come back!",     hi: "{days} दिन हो गए। नए क्विज़ इंतज़ार कर रहे हैं — वापस आइए!",
      es: "Han pasado {days} días. Nuevos quizzes te esperan — ¡vuelve!",     fr: "Cela fait {days} jours. De nouveaux quiz t'attendent — reviens !",
      de: "Es ist {days} Tage her. Neue Quizze warten — komm zurück!",        pt: "Já se passaram {days} dias. Novos quizzes esperam — volte!",
      ru: "Прошло {days} дн. Новые квизы ждут — возвращайся!",                ja: "{days}日経ちました。新しいクイズが待っています — 戻ってきて！",
      ko: "{days}일이 지났어요. 새로운 퀴즈가 기다려요 — 돌아와요!",          "zh-Hans": "已过去 {days} 天。新测验在等你 — 回来吧！",
      ar: "مرّت {days} أيام. اختبارات جديدة بانتظارك — عُد!",                 id: "Sudah {days} hari. Quiz baru menunggu — kembali!",
      zu: "Sekuyizinsuku ezingu-{days}. Imibuzo emisha ikulindile — buyela!"
    },
    motivation_title: {
      en: "💪 You've got this!",      hi: "💪 आप कर सकते हैं!",        es: "💪 ¡Tú puedes!",          fr: "💪 Tu peux le faire !",
      de: "💪 Du schaffst das!",       pt: "💪 Você consegue!",         ru: "💪 У тебя получится!",    ja: "💪 君ならできる！",
      ko: "💪 할 수 있어요!",          "zh-Hans": "💪 你行的！",          ar: "💪 تستطيع ذلك!",          id: "💪 Kamu pasti bisa!",         zu: "💪 Uyakwazi!"
    },
    motivation_body: {
      en: "One quiz a day keeps your brain sharp. Open QuizVerse now.",       hi: "रोज़ एक क्विज़ दिमाग को तेज़ रखता है। अभी QuizVerse खोलें।",
      es: "Un quiz al día mantiene tu mente afilada. Abre QuizVerse.",         fr: "Un quiz par jour garde l'esprit affûté. Ouvre QuizVerse.",
      de: "Ein Quiz pro Tag hält den Kopf scharf. Öffne QuizVerse.",          pt: "Um quiz por dia deixa sua mente afiada. Abra o QuizVerse.",
      ru: "Один квиз в день — и ум острый. Открой QuizVerse.",                ja: "1日1クイズで頭脳明晰。QuizVerseを開こう。",
      ko: "하루 한 퀴즈로 두뇌를 깨우세요. 지금 QuizVerse를 열어요.",         "zh-Hans": "每天一题，思维敏捷。打开 QuizVerse。",
      ar: "اختبار يومي يبقي عقلك حاداً. افتح QuizVerse الآن.",                id: "Satu quiz sehari menjaga otak tajam. Buka QuizVerse.",
      zu: "Umbuzo owodwa ngosuku ugcina ingqondo iqwasha. Vula i-QuizVerse."
    },
    friend_request_title: {
      en: "👋 New Friend Request",    hi: "👋 नया फ्रेंड रिक्वेस्ट",   es: "👋 Nueva solicitud",      fr: "👋 Nouvelle demande d'ami",
      de: "👋 Neue Freundschaftsanfrage", pt: "👋 Novo pedido de amizade", ru: "👋 Запрос в друзья",  ja: "👋 新しい友達リクエスト",
      ko: "👋 새로운 친구 요청",        "zh-Hans": "👋 新好友请求",        ar: "👋 طلب صداقة جديد",       id: "👋 Permintaan Teman Baru",     zu: "👋 Isicelo somngane esisha"
    },
    friend_request_body: {
      en: "{name} sent you a friend request. Tap to accept.",        hi: "{name} ने आपको फ्रेंड रिक्वेस्ट भेजी है। स्वीकार करने के लिए टैप करें।",
      es: "{name} te envió una solicitud. Toca para aceptar.",       fr: "{name} t'a envoyé une demande. Touche pour accepter.",
      de: "{name} hat dir eine Anfrage geschickt. Tippe zum Annehmen.", pt: "{name} enviou um pedido. Toque para aceitar.",
      ru: "{name} отправил(а) запрос. Нажми, чтобы принять.",         ja: "{name}さんから友達リクエスト。タップで承認。",
      ko: "{name}님이 친구 요청을 보냈어요. 탭하여 수락.",            "zh-Hans": "{name} 发来好友请求。点击接受。",
      ar: "{name} أرسل طلب صداقة. انقر للقبول.",                      id: "{name} mengirim permintaan teman. Ketuk untuk terima.",
      zu: "U-{name} ukuthumelele isicelo somngane. Thepha ukwamukela."
    },
    friend_challenge_title: {
      en: "⚔️ Challenge Received!",   hi: "⚔️ चैलेंज मिला!",            es: "⚔️ ¡Reto recibido!",     fr: "⚔️ Défi reçu !",
      de: "⚔️ Herausforderung!",       pt: "⚔️ Desafio recebido!",       ru: "⚔️ Вызов!",              ja: "⚔️ 挑戦を受けた！",
      ko: "⚔️ 도전장 도착!",           "zh-Hans": "⚔️ 收到挑战！",        ar: "⚔️ تم استلام تحدٍ!",      id: "⚔️ Tantangan diterima!",      zu: "⚔️ Inselelo ifikile!"
    },
    friend_challenge_body: {
      en: "{name} challenged you to {mode}. Show them what you've got!",      hi: "{name} ने आपको {mode} में चैलेंज किया है। दिखाइए अपना दम!",
      es: "{name} te retó a {mode}. ¡Muéstrales lo que tienes!",              fr: "{name} t'a défié à {mode}. Montre-leur de quoi tu es capable !",
      de: "{name} fordert dich zu {mode} heraus. Zeig was du kannst!",        pt: "{name} desafiou você no {mode}. Mostre do que é capaz!",
      ru: "{name} бросил(а) вызов в {mode}. Покажи себя!",                    ja: "{name}さんが{mode}で挑戦してきた！実力を見せつけよう！",
      ko: "{name}님이 {mode}에 도전했어요. 실력을 보여주세요!",                "zh-Hans": "{name} 在 {mode} 中向你挑战。亮出实力！",
      ar: "{name} تحداك في {mode}. أرِهم ما لديك!",                            id: "{name} menantangmu di {mode}. Tunjukkan kehebatanmu!",
      zu: "U-{name} ukuphonsele inselelo ku-{mode}. Mbonise ukuthi unamandla!"
    },
    // ── Study reminders (user-scheduled; body is the learner's own text via {text}) ──
    reminder_title: {
      en: "⏰ Study reminder",        hi: "⏰ अध्ययन रिमाइंडर",        es: "⏰ Recordatorio de estudio", fr: "⏰ Rappel d'étude",
      de: "⏰ Lern-Erinnerung",        pt: "⏰ Lembrete de estudo",      ru: "⏰ Напоминание об учёбе",    ja: "⏰ 学習リマインダー",
      ko: "⏰ 학습 알림",              "zh-Hans": "⏰ 学习提醒",          ar: "⏰ تذكير بالدراسة",          id: "⏰ Pengingat belajar",        zu: "⏰ Isikhumbuzi sokufunda"
    },
    reminder_body: {
      en: "{text}", hi: "{text}", es: "{text}", fr: "{text}", de: "{text}", pt: "{text}",
      ru: "{text}", ja: "{text}", ko: "{text}", "zh-Hans": "{text}", ar: "{text}", id: "{text}", zu: "{text}"
    },
    // ── Spaced-repetition review nudge (server-scheduled; {count} = due concepts) ──
    review_due_title: {
      en: "🧠 Time to review",          hi: "🧠 रिवीज़न का समय",          es: "🧠 Hora de repasar",       fr: "🧠 C'est l'heure de réviser",
      de: "🧠 Zeit zu wiederholen",      pt: "🧠 Hora de revisar",          ru: "🧠 Пора повторить",         ja: "🧠 復習の時間です",
      ko: "🧠 복습할 시간이에요",        "zh-Hans": "🧠 该复习了",           ar: "🧠 حان وقت المراجعة",       id: "🧠 Waktunya mengulang",       zu: "🧠 Isikhathi sokubuyekeza"
    },
    review_due_body: {
      en: "{count} concepts are ready — lock them into long-term memory.",
      hi: "{count} कॉन्सेप्ट तैयार हैं — इन्हें लंबी याददाश्त में बसा लें।",
      es: "{count} conceptos listos: fíjalos en tu memoria a largo plazo.",
      fr: "{count} notions à revoir — ancre-les dans ta mémoire.",
      de: "{count} Konzepte sind fällig — präge sie dir dauerhaft ein.",
      pt: "{count} conceitos prontos — fixe-os na memória de longo prazo.",
      ru: "{count} понятий готовы к повторению — закрепите их надолго.",
      ja: "{count}個の概念が復習待ちです。長期記憶に定着させましょう。",
      ko: "복습할 개념 {count}개가 준비됐어요 — 장기 기억으로 굳혀요.",
      "zh-Hans": "有 {count} 个概念待复习——把它们刻进长期记忆。",
      ar: "{count} مفاهيم جاهزة — رسّخها في ذاكرتك بعيدة المدى.",
      id: "{count} konsep siap diulang — tanamkan ke memori jangka panjang.",
      zu: "Ama-concept angu-{count} akulindele — wagxilise enkumbulweni yesikhathi eside."
    }
  };

  function localize(locale: string, key: string, vars?: any): string {
    var entry = NOTIF_STRINGS[key];
    if (!entry) return key;
    var template = entry[locale] || entry["en"] || key;
    if (vars) {
      for (var k in vars) {
        template = template.split("{" + k + "}").join(String(vars[k]));
      }
    }
    return template;
  }

  // ─── Locale resolution (account.langTag → metadata.language → 'en') ────────
  function normalizeLocale(tag: string): string {
    if (!tag) return "en";
    var t = String(tag).trim();
    if (t.toLowerCase().indexOf("zh") === 0) return "zh-Hans";
    if (t.indexOf("-") > 0) t = t.split("-")[0];
    var supported = ["en", "ar", "de", "es", "fr", "hi", "id", "ja", "ko", "pt", "ru", "zh-Hans", "zu"];
    var lc = t.toLowerCase();
    for (var i = 0; i < supported.length; i++) {
      if (supported[i].toLowerCase() === lc) return supported[i];
    }
    return "en";
  }

  function getUserLocale(nk: nkruntime.Nakama, userId: string): string {
    try {
      var account: any = nk.accountGetId(userId);
      if (account && account.user && account.user.langTag) return normalizeLocale(account.user.langTag);
    } catch (_) {}
    try {
      var meta: any = Storage.readJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId);
      if (meta && meta.language) return normalizeLocale(meta.language);
    } catch (_) {}
    return "en";
  }

  // ─── Quiet hours: 22:00 – 08:00 in the user's local time ───────────────────
  // Fallback offset (minutes) for users whose client never sent a PARSEABLE
  // timezone. The Unity client historically sent `TimeZoneInfo.Local.Id`,
  // which on many Android/IL2CPP devices resolves to the literal string
  // "Local" (and sometimes empty/"Unknown") — none of which we can parse.
  // The OLD code defaulted those to 0 (UTC), which silently collapsed the
  // per-user "09:00–13:00 local" daily-push window to 09:00–13:00 *UTC*.
  // For the India-majority user base that meant the daily quiz fired at
  // 2:30–6:30 PM IST instead of the morning (and at 2–9 AM for US users).
  // Since the base is India-first, fall back to IST (+330) so the bulk of
  // users get a sensible morning window. The permanent fix is the client
  // sending a numeric offset ("+05:30"), which the parser below honours
  // exactly for every region.
  var NOTIF_DEFAULT_TZ_OFFSET_MIN = 330; // IST (Asia/Kolkata)
  function getUserTimezoneOffsetMinutes(nk: nkruntime.Nakama, userId: string): number {
    try {
      var account: any = nk.accountGetId(userId);
      var tz = account && account.user ? account.user.timezone : "";
      if (!tz) {
        var meta: any = Storage.readJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId);
        tz = meta && meta.timezone ? meta.timezone : "";
      }
      // Explicit UTC/GMT → offset 0 (a real, parseable answer; not the
      // "unknown" fallback).
      var tzLower = String(tz || "").trim().toLowerCase();
      if (tzLower === "z" || tzLower === "utc" || tzLower === "gmt") return 0;
      // Unparseable sentinels the client is known to emit → use default.
      if (!tz || tzLower === "local" || tzLower === "unknown") {
        return NOTIF_DEFAULT_TZ_OFFSET_MIN;
      }
      // Numeric offset, the canonical correct form the client should send:
      //   "+05:30", "-04:00", "+0530", "+9".
      var m = /^([+-])(\d{1,2}):?(\d{2})?$/.exec(String(tz).trim());
      if (m) {
        var sign = m[1] === "-" ? -1 : 1;
        return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || "0", 10));
      }
      // Common IANA fallbacks (cheap built-in lookup; no tz lib in Goja)
      var iana: { [k: string]: number } = {
        "Asia/Kolkata": 330, "Asia/Calcutta": 330, "Asia/Karachi": 300, "Asia/Dhaka": 360,
        "Asia/Kathmandu": 345, "Asia/Colombo": 330, "Asia/Tokyo": 540, "Asia/Seoul": 540,
        "Asia/Shanghai": 480, "Asia/Singapore": 480, "Asia/Hong_Kong": 480, "Asia/Dubai": 240,
        "Asia/Jakarta": 420, "Asia/Bangkok": 420, "Asia/Manila": 480, "Asia/Tehran": 210,
        "Europe/London": 0, "Europe/Dublin": 0, "Europe/Berlin": 60, "Europe/Paris": 60,
        "Europe/Madrid": 60, "Europe/Rome": 60, "Europe/Moscow": 180, "Europe/Istanbul": 180,
        "America/New_York": -300, "America/Toronto": -300, "America/Chicago": -360,
        "America/Denver": -420, "America/Los_Angeles": -480, "America/Sao_Paulo": -180,
        "America/Mexico_City": -360, "Africa/Cairo": 120, "Africa/Johannesburg": 120,
        "Africa/Lagos": 60, "Australia/Sydney": 600, "Pacific/Auckland": 720
      };
      if (iana[String(tz)] !== undefined) return iana[String(tz)];
    } catch (_) {}
    return NOTIF_DEFAULT_TZ_OFFSET_MIN;
  }

  function getUserLocalHour(nk: nkruntime.Nakama, userId: string): number {
    var offsetMin = getUserTimezoneOffsetMinutes(nk, userId);
    return new Date(Date.now() + offsetMin * 60000).getUTCHours();
  }

  function isInQuietHours(nk: nkruntime.Nakama, userId: string): boolean {
    var h = getUserLocalHour(nk, userId);
    return h >= 22 || h < 8;
  }

  // ─── Once-per-day / once-per-week markers (storage-backed, no race) ────────
  var NOTIF_MARKER_COLLECTION = "notif_send_markers";

  function readMarkers(nk: nkruntime.Nakama, userId: string): any {
    try {
      var records: any = nk.storageRead([{ collection: NOTIF_MARKER_COLLECTION, key: "markers", userId: userId }]);
      if (records && records.length > 0 && records[0].value) return records[0].value;
    } catch (_) {}
    return {};
  }

  function writeMarkers(nk: nkruntime.Nakama, userId: string, markers: any): void {
    try {
      nk.storageWrite([{
        collection: NOTIF_MARKER_COLLECTION, key: "markers", userId: userId,
        value: markers, permissionRead: 0, permissionWrite: 0
      }]);
    } catch (_) {}
  }

  function recordMarker(nk: nkruntime.Nakama, userId: string, key: string, value: string): void {
    var markers = readMarkers(nk, userId);
    markers[key] = value;
    writeMarkers(nk, userId, markers);
  }

  function hasMarker(nk: nkruntime.Nakama, userId: string, key: string, expected: string): boolean {
    var markers = readMarkers(nk, userId);
    return markers && markers[key] === expected;
  }

  function todayDateKey(): string {
    var d = new Date();
    var mm = d.getUTCMonth() + 1;
    var dd = d.getUTCDate();
    return d.getUTCFullYear() + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd;
  }

  // ─── List opted-in users (those with at least one push token) ──────────────
  // Uses Nakama's SQL pass-through (Goja runtime supports nk.sqlQuery).
  function listOptedInUsers(nk: nkruntime.Nakama, limit: number, offset: number): string[] {
    try {
      var rows: any = nk.sqlQuery(
        "SELECT user_id::text FROM storage WHERE collection = $1 AND user_id <> '00000000-0000-0000-0000-000000000000' ORDER BY user_id LIMIT $2 OFFSET $3",
        [Constants.PUSH_TOKENS_COLLECTION, limit, offset]
      );
      var ids: string[] = [];
      if (rows && rows.length) {
        for (var i = 0; i < rows.length; i++) {
          // nk.sqlQuery returns each row as an OBJECT keyed by column name
          // (SqlQueryResult = {[column]: any}[]), NOT a positional array.
          // The old `rows[i][0]` always read undefined, so these crons
          // silently scanned 0 users and never sent a single push.
          var __row: any = rows[i];
          var __uid: any = __row ? (__row.user_id != null ? __row.user_id : (__row.length > 0 ? __row[0] : null)) : null;
          if (__uid != null && String(__uid) !== "") ids.push(String(__uid));
        }
      }
      return ids;
    } catch (_) {
      return [];
    }
  }

  // ─── Send a localized push to one user (respects tokens, quiet hours, gates) ─
  // Exported so sibling modules (e.g. Hermes morning brief) can deliver real
  // device push (APNs/FCM) instead of an inbox-only notificationsSend. titleKey/
  // bodyKey fall back to the literal string when absent from NOTIF_STRINGS
  // (localize returns the key verbatim), so callers may pass composed copy.
  export function sendLocalizedPushToUser(
    ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama,
    userId: string, eventType: string, titleKey: string, bodyKey: string,
    vars: any, opts?: { skipQuietHours?: boolean; gameId?: string; data?: any }
  ): boolean {
    opts = opts || {};
    if (!opts.skipQuietHours && isInQuietHours(nk, userId)) return false;
    var locale = getUserLocale(nk, userId);
    var title = localize(locale, titleKey, vars);
    var body = localize(locale, bodyKey, vars);
    var tokensData = getPushTokens(nk, userId);
    if (!tokensData.tokens || tokensData.tokens.length === 0) return false;

    // CRITICAL for client-side deep-link routing: every FCM/APNS data dict that
    // reaches the device MUST contain `eventType` so Unity's FCMManager can route
    // it to the correct screen (HandleNotificationType switches on this key).
    // Defensive merge — if a buggy/old Lambda fails to forward our top-level
    // eventType into the FCM data field, this guarantees the client still sees it.
    var mergedData: { [k: string]: any } = { eventType: eventType };
    if (opts.data) {
      for (var k in opts.data) {
        if (k !== "eventType") mergedData[k] = opts.data[k];
      }
    }

    var sent = 0;
    for (var i = 0; i < tokensData.tokens.length; i++) {
      var t: any = tokensData.tokens[i];
      var providerResult = sendProviderPush(ctx, logger, nk, t, {
        title: title, body: body, data: mergedData,
        gameId: opts.gameId || "quizverse", eventType: eventType
      });
      if (providerResult.success === true) sent++;
    }

    try {
      nk.notificationsSend([{
        userId: userId, subject: eventType,
        content: { eventType: eventType, title: title, body: body, data: mergedData },
        code: DEFAULT_PUSH_NOTIFICATION_CODE, persistent: true
      }]);
    } catch (_) {}

    return sent > 0;
  }

  // ─── S3 fetchers (mirror the URL shapes Unity already uses) ─────────────────
  var S3_BASE = "https://intelli-verse-x-media.s3.us-east-1.amazonaws.com";

  function fetchDailyQuizForToday(nk: nkruntime.Nakama, logger: nkruntime.Logger): any {
    var dateStr = todayDateKey();
    // S3 path must match where Intelliverse-X-AI's DailyQuizStorageService writes
    // (S3_KEY_PREFIX = "quiz-verse/daily/"). The old "/daily-quiz/" path was stale
    // and 404'd for every date after 2026-06-01, silently skipping all daily-quiz
    // push notifications. Weekly already uses the "/quiz-verse/weekly/" prefix.
    var url = S3_BASE + "/quiz-verse/daily/dailyquiz-" + dateStr + ".json";
    try {
      var resp: any = nk.httpRequest(url, "get", {}, "", 10000);
      if (resp && resp.code >= 200 && resp.code < 300) {
        try { return JSON.parse(resp.body); } catch (_) { return null; }
      }
    } catch (e: any) {
      logger.warn("[NotifCron] daily fetch failed: %s", e && e.message ? e.message : String(e));
    }
    return null;
  }

  function getISOWeekDate(d: Date): { year: number; week: number; day: number } {
    var u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var isoDay = u.getUTCDay() === 0 ? 7 : u.getUTCDay();
    u.setUTCDate(u.getUTCDate() + 4 - isoDay);
    var year = u.getUTCFullYear();
    var jan4 = new Date(Date.UTC(year, 0, 4));
    var jan4Day = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
    var w1Start = new Date(Date.UTC(year, 0, 4 - jan4Day + 1));
    var weekNum = Math.floor((u.getTime() - w1Start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    return { year: year, week: weekNum, day: isoDay };
  }

  function fetchWeeklyQuizForType(nk: nkruntime.Nakama, logger: nkruntime.Logger, type: string, lang: string): any {
    var iso = getISOWeekDate(new Date());
    // Try today's day-of-week first, then walk backward 6 days within current week
    for (var offset = 0; offset < 7; offset++) {
      var altDay = iso.day - offset;
      if (altDay < 1) altDay += 7;
      var url = S3_BASE + "/quiz-verse/weekly/" + iso.year + "-" + iso.week + "-" + altDay + "-" + type + "_" + lang + ".json";
      try {
        var resp: any = nk.httpRequest(url, "get", {}, "", offset === 0 ? 10000 : 5000);
        if (resp && resp.code >= 200 && resp.code < 300 && resp.body && resp.body.length > 100) {
          try { return JSON.parse(resp.body); } catch (_) { continue; }
        }
      } catch (_) {}
    }
    return null;
  }

  // ─── Weekly diff cache: collection holds last (weekId, themeId) per (type, lang) ─
  var WEEKLY_DIFF_COLLECTION = "notif_weekly_diff";
  function readWeeklyMarker(nk: nkruntime.Nakama, type: string, lang: string): string {
    try {
      var key = type + "_" + lang;
      var rec: any = nk.storageRead([{ collection: WEEKLY_DIFF_COLLECTION, key: key, userId: Constants.SYSTEM_USER_ID }]);
      if (rec && rec.length > 0 && rec[0].value) return String(rec[0].value.signature || "");
    } catch (_) {}
    return "";
  }
  function writeWeeklyMarker(nk: nkruntime.Nakama, type: string, lang: string, signature: string): void {
    try {
      var key = type + "_" + lang;
      nk.storageWrite([{
        collection: WEEKLY_DIFF_COLLECTION, key: key, userId: Constants.SYSTEM_USER_ID,
        value: { signature: signature, updatedAt: new Date().toISOString() },
        permissionRead: 0, permissionWrite: 0
      }]);
    } catch (_) {}
  }

  // Resolve the daily-quiz topic for a given locale. The daily-quiz JSON
  // (written by Intelliverse-X-AI) ships `topic` as a localized OBJECT
  // ({ en, hi, ar, "pt-BR", "zh-Hans", ... }) — NOT the flat
  // title/category/theme the old code assumed, which is why every push
  // fell back to the literal "today's quiz". We prefer the exact locale,
  // then a base-language match (e.g. user "pt" → JSON "pt-BR"), then
  // English, then any available value. Legacy flat fields are still
  // honoured for backward compatibility.
  function pickQuizTopic(quiz: any, locale: string): string {
    if (!quiz) return "today's quiz";
    var field: any = quiz.topic || quiz.title || quiz.category || quiz.theme;
    if (!field) return "today's quiz";
    if (typeof field === "string") return field;
    if (typeof field === "object") {
      if (field[locale]) return String(field[locale]);
      var base = String(locale).split("-")[0].toLowerCase();
      for (var k in field) {
        if (field[k] && String(k).split("-")[0].toLowerCase() === base) return String(field[k]);
      }
      if (field["en"]) return String(field["en"]);
      for (var kk in field) { if (field[kk]) return String(field[kk]); }
    }
    return "today's quiz";
  }

  // ─── 1. Daily quiz cron (broadcast localized "new daily quiz" with topic) ─
  function rpcNotifCronDailyQuiz(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (ctx.userId) return RpcHelpers.errorResponse("Admin only");
    var quiz = fetchDailyQuizForToday(nk, logger);
    if (!quiz) return RpcHelpers.successResponse({ skipped: "no_daily_quiz" });
    var todayKey = todayDateKey();
    var sent = 0, gated = 0, scanned = 0;
    var batch = 100, offset = 0;
    while (true) {
      var users = listOptedInUsers(nk, batch, offset);
      if (!users || users.length === 0) break;
      for (var i = 0; i < users.length; i++) {
        scanned++;
        var u = users[i];
        var h = getUserLocalHour(nk, u);
        if (h < 9 || h >= 13) { gated++; continue; }            // outside daily push window
        if (hasMarker(nk, u, "daily_quiz", todayKey)) { gated++; continue; }
        // Localize the topic to each user's language (the push templates are
        // already localized; the topic value must be too).
        var topic = pickQuizTopic(quiz, getUserLocale(nk, u));
        var ok = sendLocalizedPushToUser(ctx, logger, nk, u, "daily_quiz",
          "daily_quiz_title", "daily_quiz_body", { topic: topic },
          { data: { screen: "daily_quiz" } });
        if (ok) { recordMarker(nk, u, "daily_quiz", todayKey); sent++; } else { gated++; }
      }
      offset += batch;
      if (users.length < batch) break;
    }
    return RpcHelpers.successResponse({ sent: sent, gated: gated, scanned: scanned, dateKey: todayKey, topic: pickQuizTopic(quiz, "en") });
  }

  // ─── 2. Weekly quiz cron (read 5 types × 13 langs daily, push only on diff) ─
  function rpcNotifCronWeeklyQuiz(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (ctx.userId) return RpcHelpers.errorResponse("Admin only");
    // COMPATIBILITY EXCLUDED per product spec — only the 5 mainline weekly types.
    var types = ["fortune", "emoji", "prediction", "health", "personal_finance"];
    var langs = ["en", "ar", "de", "es", "fr", "hi", "id", "ja", "ko", "pt", "ru", "zh-Hans", "zu"];
    // Per-(type,lang) signature = weekId|themeId; skip pushing when unchanged.
    var changedByType: { [type: string]: { [lang: string]: string } } = {};
    for (var ti = 0; ti < types.length; ti++) {
      var t = types[ti];
      for (var li = 0; li < langs.length; li++) {
        var l = langs[li];
        var quiz = fetchWeeklyQuizForType(nk, logger, t, l);
        if (!quiz) continue;
        var sig = (quiz.weekId || quiz.quiz_id || "") + "|" + (quiz.themeId || "");
        if (!sig || sig === "|") continue;
        var prev = readWeeklyMarker(nk, t, l);
        if (prev === sig) continue;       // no change → skip push for this (type,lang)
        writeWeeklyMarker(nk, t, l, sig);
        if (!changedByType[t]) changedByType[t] = {};
        changedByType[t][l] = quiz.title || quiz.category || t;
      }
    }
    var changedTypes: string[] = [];
    for (var k in changedByType) changedTypes.push(k);
    if (changedTypes.length === 0) return RpcHelpers.successResponse({ skipped: "no_weekly_changes" });

    var todayKey = todayDateKey();
    var sent = 0, gated = 0, scanned = 0;
    var batch = 100, offset = 0;
    while (true) {
      var users = listOptedInUsers(nk, batch, offset);
      if (!users || users.length === 0) break;
      for (var i = 0; i < users.length; i++) {
        scanned++;
        var u = users[i];
        var h = getUserLocalHour(nk, u);
        if (h < 10 || h >= 20) { gated++; continue; }           // weekly window 10:00–20:00 local
        var dayMarkerKey = "weekly_quiz_" + changedTypes.join("_");
        if (hasMarker(nk, u, dayMarkerKey, todayKey)) { gated++; continue; }
        var locale = getUserLocale(nk, u);
        // Push one notification mentioning whichever changed type has copy in user's locale (first match).
        var pushedForType: string | null = null;
        for (var c = 0; c < changedTypes.length; c++) {
          var ct = changedTypes[c];
          if (changedByType[ct][locale] !== undefined) { pushedForType = ct; break; }
        }
        if (!pushedForType) pushedForType = changedTypes[0];
        var typeLabel = changedByType[pushedForType][locale] || changedByType[pushedForType]["en"] || pushedForType;
        var ok = sendLocalizedPushToUser(ctx, logger, nk, u, "weekly_quiz",
          "weekly_quiz_title", "weekly_quiz_body", { type: typeLabel },
          { data: { screen: "weekly_quiz", type: pushedForType } });
        if (ok) { recordMarker(nk, u, dayMarkerKey, todayKey); sent++; } else { gated++; }
      }
      offset += batch;
      if (users.length < batch) break;
    }
    return RpcHelpers.successResponse({ sent: sent, gated: gated, scanned: scanned, changedTypes: changedTypes });
  }

  // ─── 3. Idle win-back cron (24–48 h since last session) ────────────────────
  function rpcNotifCronIdleWinback(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (ctx.userId) return RpcHelpers.errorResponse("Admin only");
    var todayKey = todayDateKey();
    var sent = 0, gated = 0, scanned = 0;
    var nowMs = Date.now();
    var minIdleMs = 24 * 3600 * 1000;
    var maxIdleMs = 48 * 3600 * 1000;
    var batch = 100, offset = 0;
    while (true) {
      var users = listOptedInUsers(nk, batch, offset);
      if (!users || users.length === 0) break;
      for (var i = 0; i < users.length; i++) {
        scanned++;
        var u = users[i];
        if (hasMarker(nk, u, "idle_winback", todayKey)) { gated++; continue; }
        var h = getUserLocalHour(nk, u);
        if (h < 11 || h >= 19) { gated++; continue; }            // mid-day window only
        // Read last session from existing winback collection (winback_session)
        var lastMs = 0;
        try {
          var rec: any = nk.storageRead([{ collection: "winback_session", key: "session_quizverse", userId: u }]);
          if (rec && rec.length > 0 && rec[0].value && rec[0].value.lastSessionTime) {
            lastMs = Date.parse(rec[0].value.lastSessionTime);
          }
        } catch (_) {}
        if (!lastMs) { gated++; continue; }
        var idle = nowMs - lastMs;
        if (idle < minIdleMs || idle > maxIdleMs) { gated++; continue; }
        var days = Math.floor(idle / (24 * 3600 * 1000)) || 1;
        var ok = sendLocalizedPushToUser(ctx, logger, nk, u, "idle_winback",
          "idle_winback_title", "idle_winback_body", { days: days },
          { data: { screen: "home" } });
        if (ok) { recordMarker(nk, u, "idle_winback", todayKey); sent++; } else { gated++; }
      }
      offset += batch;
      if (users.length < batch) break;
    }
    return RpcHelpers.successResponse({ sent: sent, gated: gated, scanned: scanned });
  }

  // ─── 4. Streak warning cron (18:00–21:00 local; user has streak ≥ 2) ────────
  function rpcNotifCronStreakWarning(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (ctx.userId) return RpcHelpers.errorResponse("Admin only");
    var todayKey = todayDateKey();
    var sent = 0, gated = 0, scanned = 0;
    var batch = 100, offset = 0;
    while (true) {
      var users = listOptedInUsers(nk, batch, offset);
      if (!users || users.length === 0) break;
      for (var i = 0; i < users.length; i++) {
        scanned++;
        var u = users[i];
        if (hasMarker(nk, u, "streak_warning", todayKey)) { gated++; continue; }
        var h = getUserLocalHour(nk, u);
        if (h < 18 || h >= 22) { gated++; continue; }
        // Best-effort streak read: try player metadata first, then weekly_goals progress
        var streak = 0;
        try {
          var meta: any = Storage.readJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", u);
          if (meta && typeof meta.currentStreak === "number") streak = meta.currentStreak;
          else if (meta && meta.customData && typeof meta.customData.currentStreak === "number") streak = meta.customData.currentStreak;
        } catch (_) {}
        if (streak < 2) { gated++; continue; }
        // Skip if user already played today (last session within UTC today)
        try {
          var rec: any = nk.storageRead([{ collection: "winback_session", key: "session_quizverse", userId: u }]);
          if (rec && rec.length > 0 && rec[0].value && rec[0].value.lastSessionTime) {
            var lastDay = String(rec[0].value.lastSessionTime).slice(0, 10);
            if (lastDay === todayKey) { gated++; continue; }
          }
        } catch (_) {}
        var ok = sendLocalizedPushToUser(ctx, logger, nk, u, "streak_warning",
          "streak_warning_title", "streak_warning_body", { streak: streak },
          { data: { screen: "daily_quiz" } });
        if (ok) { recordMarker(nk, u, "streak_warning", todayKey); sent++; } else { gated++; }
      }
      offset += batch;
      if (users.length < batch) break;
    }
    return RpcHelpers.successResponse({ sent: sent, gated: gated, scanned: scanned });
  }

  // ─── 5. Motivation cron (idle 3–7 days, once every 3 days) ─────────────────
  function rpcNotifCronMotivation(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (ctx.userId) return RpcHelpers.errorResponse("Admin only");
    var todayKey = todayDateKey();
    var sent = 0, gated = 0, scanned = 0;
    var nowMs = Date.now();
    var minIdleMs = 3 * 24 * 3600 * 1000;
    var maxIdleMs = 7 * 24 * 3600 * 1000;
    var batch = 100, offset = 0;
    while (true) {
      var users = listOptedInUsers(nk, batch, offset);
      if (!users || users.length === 0) break;
      for (var i = 0; i < users.length; i++) {
        scanned++;
        var u = users[i];
        var h = getUserLocalHour(nk, u);
        if (h < 12 || h >= 18) { gated++; continue; }
        // throttle: at most one motivation push per 3 calendar days
        var markers = readMarkers(nk, u);
        if (markers && markers.motivation_last_at) {
          var lastDays = (nowMs - Date.parse(markers.motivation_last_at)) / (24 * 3600 * 1000);
          if (lastDays < 3) { gated++; continue; }
        }
        var lastMs = 0;
        try {
          var rec: any = nk.storageRead([{ collection: "winback_session", key: "session_quizverse", userId: u }]);
          if (rec && rec.length > 0 && rec[0].value && rec[0].value.lastSessionTime) {
            lastMs = Date.parse(rec[0].value.lastSessionTime);
          }
        } catch (_) {}
        if (!lastMs) { gated++; continue; }
        var idle = nowMs - lastMs;
        if (idle < minIdleMs || idle > maxIdleMs) { gated++; continue; }
        var ok = sendLocalizedPushToUser(ctx, logger, nk, u, "motivation",
          "motivation_title", "motivation_body", {},
          { data: { screen: "home" } });
        if (ok) {
          recordMarker(nk, u, "motivation_last_at", new Date().toISOString());
          sent++;
        } else { gated++; }
      }
      offset += batch;
      if (users.length < batch) break;
    }
    return RpcHelpers.successResponse({ sent: sent, gated: gated, scanned: scanned });
  }

  // ─── 6. Friend request push (event-driven; called inline from invite RPC) ──
  // Payload: { fromUserId, toUserId, fromName }   (admin/server-key only)
  function rpcNotifFriendRequestSent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var d = RpcHelpers.parseRpcPayload(payload);
    var to = d.toUserId || d.targetUserId;
    var name = d.fromName || d.name || "Someone";
    if (!to) return RpcHelpers.errorResponse("toUserId required");
    var pushData: Record<string, string> = {
      screen: "friends",
      fromUserId: String(d.fromUserId || ""),
    };
    if (d.inviteId) pushData.inviteId = String(d.inviteId);
    if (d.targetUserId) pushData.targetUserId = String(d.targetUserId);
    if (d.fromDisplayName) pushData.fromDisplayName = String(d.fromDisplayName);
    if (d.fromUsername) pushData.fromUsername = String(d.fromUsername);

    var ok = sendLocalizedPushToUser(ctx, logger, nk, to, "friend_request",
      "friend_request_title", "friend_request_body", { name: name },
      { skipQuietHours: true, data: pushData });
    return RpcHelpers.successResponse({ sent: ok });
  }

  // ─── 7. Friend challenge push (event-driven) ───────────────────────────────
  // Payload: { fromUserId, toUserId, fromName, mode }
  function rpcNotifFriendChallenge(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var d = RpcHelpers.parseRpcPayload(payload);
    var to = d.toUserId || d.targetUserId;
    var name = d.fromName || d.name || "A friend";
    var mode = d.mode || d.gameMode || "QuizVerse";
    if (!to) return RpcHelpers.errorResponse("toUserId required");
    var ok = sendLocalizedPushToUser(ctx, logger, nk, to, "friend_challenge",
      "friend_challenge_title", "friend_challenge_body", { name: name, mode: mode },
      { skipQuietHours: true, data: { screen: "challenges", fromUserId: d.fromUserId || "", mode: mode } });
    return RpcHelpers.successResponse({ sent: ok });
  }

  // ─── 8. Study reminders cron (user-scheduled local-time push) ──────────────
  // Delivers REAL OS push (APNs/FCM) for the per-user reminders created via
  // the lt_reminders_* RPCs (collection "qv_reminders"). Runs every few minutes
  // and fires each reminder once on the day it's due, in the user's LOCAL time,
  // de-duplicated via the notif_send_markers store. Quiet hours are skipped on
  // purpose — the learner chose the time. Users with no push token are no-ops
  // (sendLocalizedPushToUser returns false), so the in-app reminder list still
  // covers web/WebView surfaces.
  var REM_STORE_COLLECTION = "qv_reminders";
  var REM_STORE_KEY = "list_v1";
  var REMINDER_WINDOW_MIN = 15;   // grace window so a delayed tick never misses

  function listUsersWithReminders(nk: nkruntime.Nakama, limit: number, offset: number): string[] {
    try {
      var rows: any = nk.sqlQuery(
        "SELECT user_id::text FROM storage WHERE collection = $1 AND user_id <> '00000000-0000-0000-0000-000000000000' ORDER BY user_id LIMIT $2 OFFSET $3",
        [REM_STORE_COLLECTION, limit, offset]
      );
      var ids: string[] = [];
      if (rows && rows.length) {
        for (var i = 0; i < rows.length; i++) {
          // nk.sqlQuery returns each row as an OBJECT keyed by column name
          // (SqlQueryResult = {[column]: any}[]), NOT a positional array.
          // The old `rows[i][0]` always read undefined, so these crons
          // silently scanned 0 users and never sent a single push.
          var __row: any = rows[i];
          var __uid: any = __row ? (__row.user_id != null ? __row.user_id : (__row.length > 0 ? __row[0] : null)) : null;
          if (__uid != null && String(__uid) !== "") ids.push(String(__uid));
        }
      }
      return ids;
    } catch (_) { return []; }
  }

  function getUserLocalParts(nk: nkruntime.Nakama, userId: string): { minuteOfDay: number; weekday: number; dateKey: string } {
    var offsetMin = getUserTimezoneOffsetMinutes(nk, userId);
    var local = new Date(Date.now() + offsetMin * 60000);
    var mm = local.getUTCMonth() + 1, dd = local.getUTCDate();
    return {
      minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
      weekday: local.getUTCDay(),   // 0 = Sunday
      dateKey: local.getUTCFullYear() + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd
    };
  }

  function reminderDueNow(rem: any, parts: { minuteOfDay: number; weekday: number; dateKey: string }): boolean {
    if (!rem || !rem.time) return false;
    var m = /^([0-9]{2}):([0-9]{2})$/.exec(String(rem.time));
    if (!m) return false;
    var target = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    var delta = parts.minuteOfDay - target;
    if (delta < 0 || delta >= REMINDER_WINDOW_MIN) return false;   // not in this tick window
    var rep = rem.repeat || "daily";
    if (rep === "once") {
      if (rem.done === true) return false;
      return rem.date === parts.dateKey;
    }
    if (rep === "weekdays") return parts.weekday >= 1 && parts.weekday <= 5;
    if (rep === "weekly") return Number(rem.weekday) === parts.weekday;
    return true;   // daily
  }

  function rpcNotifCronReminders(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (ctx.userId) return RpcHelpers.errorResponse("Admin only");
    var sent = 0, gated = 0, dueScanned = 0, usersScanned = 0;
    var batch = 100, offset = 0;
    while (true) {
      var users = listUsersWithReminders(nk, batch, offset);
      if (!users || users.length === 0) break;
      for (var i = 0; i < users.length; i++) {
        usersScanned++;
        var u = users[i];
        var parts = getUserLocalParts(nk, u);
        var recs: any;
        try { recs = nk.storageRead([{ collection: REM_STORE_COLLECTION, key: REM_STORE_KEY, userId: u }]); }
        catch (_) { continue; }
        if (!recs || recs.length === 0 || !recs[0].value || !recs[0].value.reminders) continue;
        var list = recs[0].value.reminders;
        for (var j = 0; j < list.length; j++) {
          var rem = list[j];
          dueScanned++;
          if (!reminderDueNow(rem, parts)) continue;
          var markerKey = "rem_" + (rem.id || ("idx" + j));
          if (hasMarker(nk, u, markerKey, parts.dateKey)) { gated++; continue; }
          var ok = sendLocalizedPushToUser(ctx, logger, nk, u, "study_reminder",
            "reminder_title", "reminder_body", { text: rem.text || "Time to study" },
            { skipQuietHours: true, data: { screen: "reminders", reminderId: String(rem.id || "") } });
          if (ok) { recordMarker(nk, u, markerKey, parts.dateKey); sent++; } else { gated++; }
        }
      }
      offset += batch;
      if (users.length < batch) break;
    }
    return RpcHelpers.successResponse({ sent: sent, gated: gated, due_scanned: dueScanned, users_scanned: usersScanned });
  }

  // ─── 9. Spaced-repetition review nudge cron (server-scheduled) ─────────────
  // Sends ONE consolidated daily OS push when a learner has saved review
  // concepts that are now DUE (dueTs <= now), fired inside their LOCAL
  // early-evening window. The schedule itself is owned by the lt_review_*
  // module (Leitner dueTs, recomputed on every grade); this cron is the
  // server-side backstop for devices that haven't pre-registered exact-time
  // local notifications. De-duplicated once-per-day via notif_send_markers.
  // Users with no push token are no-ops (the in-app review card still covers
  // web/WebView surfaces).
  var REVIEW_STORE_COLLECTION = "qv_review";
  var REVIEW_STORE_KEY = "list_v1";
  var REVIEW_WINDOW_START_MIN = 17 * 60;   // 17:00 local
  var REVIEW_WINDOW_END_MIN = 21 * 60;     // 21:00 local

  function listUsersWithReview(nk: nkruntime.Nakama, limit: number, offset: number): string[] {
    try {
      var rows: any = nk.sqlQuery(
        "SELECT user_id::text FROM storage WHERE collection = $1 AND user_id <> '00000000-0000-0000-0000-000000000000' ORDER BY user_id LIMIT $2 OFFSET $3",
        [REVIEW_STORE_COLLECTION, limit, offset]
      );
      var ids: string[] = [];
      if (rows && rows.length) {
        for (var i = 0; i < rows.length; i++) {
          // nk.sqlQuery returns each row as an OBJECT keyed by column name
          // (SqlQueryResult = {[column]: any}[]), NOT a positional array.
          // The old `rows[i][0]` always read undefined, so these crons
          // silently scanned 0 users and never sent a single push.
          var __row: any = rows[i];
          var __uid: any = __row ? (__row.user_id != null ? __row.user_id : (__row.length > 0 ? __row[0] : null)) : null;
          if (__uid != null && String(__uid) !== "") ids.push(String(__uid));
        }
      }
      return ids;
    } catch (_) { return []; }
  }

  function rpcNotifCronReview(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (ctx.userId) return RpcHelpers.errorResponse("Admin only");
    var sent = 0, gated = 0, usersScanned = 0;
    var nowMs = Date.now();
    var batch = 100, offset = 0;
    while (true) {
      var users = listUsersWithReview(nk, batch, offset);
      if (!users || users.length === 0) break;
      for (var i = 0; i < users.length; i++) {
        usersScanned++;
        var u = users[i];
        var parts = getUserLocalParts(nk, u);
        // Only nudge inside the learner's local early-evening window.
        if (parts.minuteOfDay < REVIEW_WINDOW_START_MIN || parts.minuteOfDay >= REVIEW_WINDOW_END_MIN) continue;
        if (hasMarker(nk, u, "review_due", parts.dateKey)) { gated++; continue; }
        var recs: any;
        try { recs = nk.storageRead([{ collection: REVIEW_STORE_COLLECTION, key: REVIEW_STORE_KEY, userId: u }]); }
        catch (_) { continue; }
        if (!recs || recs.length === 0 || !recs[0].value || !recs[0].value.items) continue;
        var items = recs[0].value.items;
        var due = 0;
        for (var j = 0; j < items.length; j++) {
          if (items[j] && (items[j].dueTs || 0) <= nowMs) due++;
        }
        if (due <= 0) { gated++; continue; }
        var ok = sendLocalizedPushToUser(ctx, logger, nk, u, "review_due",
          "review_due_title", "review_due_body", { count: due },
          { skipQuietHours: true, data: { screen: "review", due: String(due) } });
        if (ok) { recordMarker(nk, u, "review_due", parts.dateKey); sent++; } else { gated++; }
      }
      offset += batch;
      if (users.length < batch) break;
    }
    return RpcHelpers.successResponse({ sent: sent, gated: gated, users_scanned: usersScanned });
  }

  // Internal aliases so the in-process scheduler match can invoke each cron
  // handler directly without an HTTP round-trip. The RPC versions remain
  // registered for ops use (manual fire / external trigger / curl).
  export var runDailyQuizCron     = rpcNotifCronDailyQuiz;
  export var runWeeklyQuizCron    = rpcNotifCronWeeklyQuiz;
  export var runIdleWinbackCron   = rpcNotifCronIdleWinback;
  export var runStreakWarningCron = rpcNotifCronStreakWarning;
  export var runMotivationCron    = rpcNotifCronMotivation;
  export var runRemindersCron     = rpcNotifCronReminders;
  export var runReviewCron        = rpcNotifCronReview;

  // ─── Pending-registration flush ──────────────────────────────────────────
  // Called by the scheduler (LegacyNotifScheduler.matchLoop) every 30 min
  // and available as an admin RPC (push_flush_pending).
  //
  // Scans the push_tokens_pending collection (token rows with
  // pendingRegistration=true) and retries the Lambda call with a FRESH
  // context (the scheduler match context, not bound to any client connection).
  // This is the production fix for "context canceled" errors: the pending row
  // is already in storage (written before the Lambda call in rpcPushRegisterToken),
  // and this function completes the registration asynchronously.
  //
  // Max 3 retries per token row (pendingRetries) to avoid hammering Lambda with
  // permanently invalid tokens (revoked by OS, wiped on uninstall, etc.).
  // ─────────────────────────────────────────────────────────────────────────
  var PENDING_MAX_RETRIES = 3;
  var PENDING_RETRY_INTERVAL_SEC = 30 * 60; // 30 min — matches scheduler dispatch period

  export function flushPendingRegistrations(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): void {
    try {
      // List all records in the push_tokens collection across all users.
      // Nakama's storageList with empty userId iterates global-scope objects;
      // our tokens are user-scoped, so we use a sentinel index key.
      // Strategy: read the pending_index — a small JSON array of userIds that
      // have pending tokens, maintained by rpcPushRegisterToken.
      var PENDING_INDEX_COLLECTION = "push_pending_index";
      var PENDING_INDEX_KEY        = "index";
      var SYSTEM_USER_ID           = "00000000-0000-0000-0000-000000000000";

      var indexObjs = nk.storageRead([{ collection: PENDING_INDEX_COLLECTION, key: PENDING_INDEX_KEY, userId: SYSTEM_USER_ID }]);
      var pendingUserIds: string[] = [];
      if (indexObjs && indexObjs.length > 0 && indexObjs[0].value && indexObjs[0].value.userIds) {
        pendingUserIds = indexObjs[0].value.userIds as string[];
      }
      if (!pendingUserIds || pendingUserIds.length === 0) {
        logger.info("[Push] flushPendingRegistrations: no pending registrations.");
        return;
      }
      logger.info("[Push] flushPendingRegistrations: retrying pending registrations for %s user(s).", pendingUserIds.length);

      var now = Math.floor(Date.now() / 1000);
      var remainingUserIds: string[] = [];

      for (var u = 0; u < pendingUserIds.length; u++) {
        var uid = pendingUserIds[u];
        try {
          var td = getPushTokens(nk, uid);
          var hasPending = false;
          for (var k = 0; k < td.tokens.length; k++) {
            var row = td.tokens[k];
            if (!row.pendingRegistration) continue;

            // Skip tokens that hit max retries — they're permanently invalid.
            if ((row.pendingRetries || 0) >= PENDING_MAX_RETRIES) {
              logger.warn("[Push] flushPending: token maxed out retries (%s) — marking dead. userId=%s platform=%s tokenPrefix=%s",
                PENDING_MAX_RETRIES, uid, row.platform, row.token ? row.token.substring(0, 10) : "?");
              row.pendingRegistration = false;
              row.providerError = "max_retries_exceeded";
              continue;
            }

            // Throttle: don't retry more often than PENDING_RETRY_INTERVAL_SEC.
            if (row.pendingLastAttempt && (now - row.pendingLastAttempt) < PENDING_RETRY_INTERVAL_SEC) {
              hasPending = true;
              continue;
            }

            var pGameId      = row.pendingGameId      || "quizverse";
            var pIsSandbox   = row.pendingIsSandbox   || false;
            var pFcmProjId   = row.pendingFcmProjectId || env(ctx, "DEFAULT_FCM_PROJECT_ID") || "";

            logger.info("[Push] flushPending: retrying Lambda registration. userId=%s platform=%s attempt=%s tokenPrefix=%s",
              uid, row.platform, (row.pendingRetries || 0) + 1, row.token ? row.token.substring(0, 10) : "?");

            var pResult = registerProviderEndpoint(ctx, logger, nk, uid, row.token, row.platform, pGameId, pIsSandbox, pFcmProjId);
            row.pendingRetries = (row.pendingRetries || 0) + 1;
            row.pendingLastAttempt = now;

            if (pResult && pResult.success && pResult.endpointArn) {
              var arnP = platformFromArn(pResult.endpointArn);
              row.endpointArn         = pResult.endpointArn;
              row.platform            = arnP || row.platform;
              row.provider            = pResult.provider || "sns";
              row.providerRegisteredAt = now;
              row.providerError       = undefined;
              row.pendingRegistration = false;
              row.pendingGameId       = undefined;
              row.pendingIsSandbox    = undefined;
              row.pendingFcmProjectId = undefined;
              logger.info("[Push] flushPending: SUCCESS userId=%s endpointArn=%s resolvedPlatform=%s",
                uid, pResult.endpointArn, row.platform);
            } else {
              row.providerError = (pResult && pResult.error) || "Lambda registration failed";
              hasPending = true;
              logger.warn("[Push] flushPending: retry failed. userId=%s attempt=%s error=%s",
                uid, row.pendingRetries, row.providerError);
            }
          }
          savePushTokens(nk, uid, td);
          if (hasPending) remainingUserIds.push(uid);
        } catch (ue: any) {
          // Storage read error or unexpected failure for this specific user —
          // demoted to warn since it's per-user, not a system-level failure.
          // The userId stays in remainingUserIds so the next scheduler tick retries.
          logger.warn("[Push] flushPending: error processing userId=%s (will retry): %s", uid, ue.message || String(ue));
          remainingUserIds.push(uid); // keep in index so next tick retries
        }
      }

      // Update the pending index with only the users that still have pending tokens.
      nk.storageWrite([{
        collection: PENDING_INDEX_COLLECTION,
        key: PENDING_INDEX_KEY,
        userId: SYSTEM_USER_ID,
        value: { userIds: remainingUserIds },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
      logger.info("[Push] flushPendingRegistrations: done. remaining pending users: %s", remainingUserIds.length);
    } catch (e: any) {
      logger.error("[Push] flushPendingRegistrations exception: %s", e.message || String(e));
    }
  }

  // Adds a userId to the pending_index so the scheduler can find it.
  // Called automatically from rpcPushRegisterToken when a pending row is written.
  function addToPendingIndex(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string): void {
    try {
      var PENDING_INDEX_COLLECTION = "push_pending_index";
      var PENDING_INDEX_KEY        = "index";
      var SYSTEM_USER_ID           = "00000000-0000-0000-0000-000000000000";
      var objs = nk.storageRead([{ collection: PENDING_INDEX_COLLECTION, key: PENDING_INDEX_KEY, userId: SYSTEM_USER_ID }]);
      var ids: string[] = (objs && objs.length > 0 && objs[0].value && objs[0].value.userIds)
        ? (objs[0].value.userIds as string[])
        : [];
      if (ids.indexOf(userId) < 0) ids.push(userId);
      nk.storageWrite([{
        collection: PENDING_INDEX_COLLECTION,
        key: PENDING_INDEX_KEY,
        userId: SYSTEM_USER_ID,
        value: { userIds: ids },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (_) { /* non-fatal — flush will just skip this user this tick */ }
  }

  function rpcPushFlushPending(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    flushPendingRegistrations(ctx, logger, nk);
    return JSON.stringify({ success: true });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("push_register_token", rpcPushRegisterToken);
    initializer.registerRpc("push_send_event", rpcPushSendEvent);
    initializer.registerRpc("push_get_endpoints", rpcPushGetEndpoints);
    initializer.registerRpc("push_flush_pending", rpcPushFlushPending);
    // Notification broadcaster — admin/server-key callers only (no userId in ctx).
    initializer.registerRpc("notif_cron_daily_quiz", rpcNotifCronDailyQuiz);
    initializer.registerRpc("notif_cron_weekly_quiz", rpcNotifCronWeeklyQuiz);
    initializer.registerRpc("notif_cron_idle_winback", rpcNotifCronIdleWinback);
    initializer.registerRpc("notif_cron_streak_warning", rpcNotifCronStreakWarning);
    initializer.registerRpc("notif_cron_motivation", rpcNotifCronMotivation);
    initializer.registerRpc("notif_cron_reminders", rpcNotifCronReminders);
    initializer.registerRpc("notif_cron_review", rpcNotifCronReview);
    initializer.registerRpc("notif_friend_request_sent", rpcNotifFriendRequestSent);
    initializer.registerRpc("notif_friend_challenge", rpcNotifFriendChallenge);
  }
}
