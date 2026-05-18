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

  function registerProviderEndpoint(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, userId: string, token: string, platform: string, gameId: string): any {
    var normalizedPlatform = normalizePlatform(platform);
    var registerUrl = env(ctx, "PUSH_REGISTER_URL") || env(ctx, "PUSH_LAMBDA_URL") || PUSH_REGISTER_URL_DEFAULT;
    if (!registerUrl) {
      logger.warn("[Push] registerProviderEndpoint: no register URL configured for platform=%s userId=%s", normalizedPlatform, userId);
      return { configured: false };
    }

    logger.info("[Push] Registering %s endpoint for userId=%s gameId=%s", normalizedPlatform, userId, gameId || "quizverse");

    try {
      var platformType = normalizedPlatform === "ios" ? "APNS" : "FCM";
      var body = JSON.stringify({
        userId: userId,
        gameId: gameId || "quizverse",
        deviceToken: token,
        token: token,
        platform: normalizedPlatform,
        platformType: platformType
      });
      var resp: any = nk.httpRequest(registerUrl, "post", { "Content-Type": "application/json" }, body, 10000);
      var parsed = parseJsonSafe(resp && resp.body ? resp.body : "");
      var responseBody = parsed && parsed.body && typeof parsed.body === "string" ? parseJsonSafe(parsed.body) : parsed;
      var code = resp && resp.code ? resp.code : 0;
      if (code >= 200 && code < 300 && responseBody && responseBody.success !== false) {
        var arn = responseBody.endpointArn || responseBody.EndpointArn || "";
        logger.info("[Push] %s endpoint registered successfully. endpointArn=%s", normalizedPlatform, arn);
        return {
          configured: true,
          success: true,
          provider: "sns",
          endpointArn: arn,
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
    var normalizedPlatform = normalizePlatform(endpoint.platform);
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
      logger.info("[Push] push_register_token: userId=%s platform=%s gameId=%s tokenPrefix=%s",
        userId, platform, gameId, token ? token.substring(0, 10) + "..." : "MISSING");
      if (!token) {
        logger.warn("[Push] push_register_token rejected: no token provided. userId=%s platform=%s", userId, platform);
        return RpcHelpers.errorResponse("token required");
      }
      var tokensData = getPushTokens(nk, userId);
      var now = Math.floor(Date.now() / 1000);
      var provider = registerProviderEndpoint(ctx, logger, nk, userId, token, platform, gameId);
      var existing = tokensData.tokens.find(function (t) { return t.token === token; });
      if (existing) {
        existing.platform = platform;
        existing.updatedAt = now;
        if (provider.endpointArn) existing.endpointArn = provider.endpointArn;
        if (provider.success) {
          existing.provider = provider.provider || "sns";
          existing.providerRegisteredAt = now;
          existing.providerError = undefined;
        } else if (provider.configured) {
          existing.providerError = provider.error || "Provider registration failed";
        }
      } else {
        tokensData.tokens.push({
          token: token,
          platform: platform,
          updatedAt: now,
          endpointArn: provider.endpointArn,
          provider: provider.success ? (provider.provider || "sns") : undefined,
          providerRegisteredAt: provider.success ? now : undefined,
          providerError: provider.configured && !provider.success ? (provider.error || "Provider registration failed") : undefined
        });
      }
      savePushTokens(nk, userId, tokensData);
      var finalArn = provider && provider.endpointArn ? provider.endpointArn : "";
      if (finalArn) {
        logger.info("[Push] push_register_token SUCCESS: userId=%s platform=%s endpointArn=%s",
          userId, platform, finalArn);
      } else {
        logger.warn("[Push] push_register_token INCOMPLETE: token stored but no endpointArn. " +
          "userId=%s platform=%s providerError=%s | " +
          "iOS fix: upload APNs Auth Key in Firebase Console → Project Settings → Cloud Messaging. " +
          "Android fix: verify google-services.json is correct and Lambda has FCM server key.",
          userId, platform, (provider && provider.error) || "none");
      }
      // Flat response shape — matches Unity's PushRegisterResponse fields exactly so
      // JsonConvert.DeserializeObject reads endpointArn/platform/userId/gameId without
      // an extra .data unwrap step. Do NOT wrap in RpcHelpers.successResponse here.
      return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        platform: platform,
        endpointArn: finalArn,
        registeredAt: new Date().toISOString(),
        provider: provider
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
      logger.info("[Push] push_send_event: eventType=%s targetUserId=%s registeredTokens=%s",
        subject, targetUserId, tokensData.tokens ? tokensData.tokens.length : 0);
      if (!tokensData.tokens || tokensData.tokens.length === 0) {
        logger.warn("[Push] push_send_event: targetUserId=%s has NO registered push tokens. " +
          "The user must launch the app on a real device at least once after granting notification permission " +
          "so push_register_token can run and create an SNS endpoint.", targetUserId);
      } else {
        var platforms: string[] = [];
        for (var pi = 0; pi < tokensData.tokens.length; pi++) {
          platforms.push(tokensData.tokens[pi].platform + (tokensData.tokens[pi].endpointArn ? "(arn✓)" : "(no-arn)"));
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
        if (providerResult.configured) providerResults.push({
          platform: t.platform,
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
      var endpoints = tokensData.tokens.map(function (t) {
        return {
          endpointArn: t.endpointArn,
          platform: t.platform,
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
  function getUserTimezoneOffsetMinutes(nk: nkruntime.Nakama, userId: string): number {
    try {
      var account: any = nk.accountGetId(userId);
      var tz = account && account.user ? account.user.timezone : "";
      if (!tz) {
        var meta: any = Storage.readJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId);
        tz = meta && meta.timezone ? meta.timezone : "";
      }
      if (!tz) return 0;
      var m = /^([+-])(\d{1,2}):?(\d{2})?$/.exec(String(tz));
      if (m) {
        var sign = m[1] === "-" ? -1 : 1;
        return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || "0", 10));
      }
      // Common IANA fallbacks (cheap built-in lookup; no tz lib in Goja)
      var iana: { [k: string]: number } = {
        "Asia/Kolkata": 330, "Asia/Karachi": 300, "Asia/Tokyo": 540, "Asia/Seoul": 540,
        "Asia/Shanghai": 480, "Asia/Singapore": 480, "Asia/Dubai": 240, "Asia/Jakarta": 420,
        "Europe/London": 0, "Europe/Berlin": 60, "Europe/Paris": 60, "Europe/Moscow": 180,
        "America/New_York": -300, "America/Chicago": -360, "America/Los_Angeles": -480, "America/Sao_Paulo": -180,
        "Africa/Johannesburg": 120, "Australia/Sydney": 600
      };
      if (iana[String(tz)] !== undefined) return iana[String(tz)];
    } catch (_) {}
    return 0;
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
          if (rows[i] && rows[i].length > 0) ids.push(String(rows[i][0]));
        }
      }
      return ids;
    } catch (_) {
      return [];
    }
  }

  // ─── Send a localized push to one user (respects tokens, quiet hours, gates) ─
  function sendLocalizedPushToUser(
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
    var url = S3_BASE + "/daily-quiz/dailyquiz-" + dateStr + ".json";
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

  // ─── 1. Daily quiz cron (broadcast localized "new daily quiz" with topic) ─
  function rpcNotifCronDailyQuiz(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (ctx.userId) return RpcHelpers.errorResponse("Admin only");
    var quiz = fetchDailyQuizForToday(nk, logger);
    if (!quiz) return RpcHelpers.successResponse({ skipped: "no_daily_quiz" });
    var topic: string = quiz.title || quiz.category || quiz.theme || "today's quiz";
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
        var ok = sendLocalizedPushToUser(ctx, logger, nk, u, "daily_quiz",
          "daily_quiz_title", "daily_quiz_body", { topic: topic },
          { data: { screen: "daily_quiz" } });
        if (ok) { recordMarker(nk, u, "daily_quiz", todayKey); sent++; } else { gated++; }
      }
      offset += batch;
      if (users.length < batch) break;
    }
    return RpcHelpers.successResponse({ sent: sent, gated: gated, scanned: scanned, dateKey: todayKey, topic: topic });
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
    var ok = sendLocalizedPushToUser(ctx, logger, nk, to, "friend_request",
      "friend_request_title", "friend_request_body", { name: name },
      { skipQuietHours: true, data: { screen: "friends", fromUserId: d.fromUserId || "" } });
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

  // Internal aliases so the in-process scheduler match can invoke each cron
  // handler directly without an HTTP round-trip. The RPC versions remain
  // registered for ops use (manual fire / external trigger / curl).
  export var runDailyQuizCron     = rpcNotifCronDailyQuiz;
  export var runWeeklyQuizCron    = rpcNotifCronWeeklyQuiz;
  export var runIdleWinbackCron   = rpcNotifCronIdleWinback;
  export var runStreakWarningCron = rpcNotifCronStreakWarning;
  export var runMotivationCron    = rpcNotifCronMotivation;

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("push_register_token", rpcPushRegisterToken);
    initializer.registerRpc("push_send_event", rpcPushSendEvent);
    initializer.registerRpc("push_get_endpoints", rpcPushGetEndpoints);
    // Notification broadcaster — admin/server-key callers only (no userId in ctx).
    initializer.registerRpc("notif_cron_daily_quiz", rpcNotifCronDailyQuiz);
    initializer.registerRpc("notif_cron_weekly_quiz", rpcNotifCronWeeklyQuiz);
    initializer.registerRpc("notif_cron_idle_winback", rpcNotifCronIdleWinback);
    initializer.registerRpc("notif_cron_streak_warning", rpcNotifCronStreakWarning);
    initializer.registerRpc("notif_cron_motivation", rpcNotifCronMotivation);
    initializer.registerRpc("notif_friend_request_sent", rpcNotifFriendRequestSent);
    initializer.registerRpc("notif_friend_challenge", rpcNotifFriendChallenge);
  }
}
