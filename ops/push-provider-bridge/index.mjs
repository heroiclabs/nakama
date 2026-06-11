import { SNSClient, CreatePlatformEndpointCommand, PublishCommand, SetEndpointAttributesCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({});

const appArns = {
  android: process.env.SNS_PLATFORM_APP_ARN_ANDROID || process.env.SNS_PLATFORM_APPLICATION_ARN_ANDROID || "arn:aws:sns:us-east-1:970547373533:app/GCM/IntelliVerseX-Android",
  web: process.env.SNS_PLATFORM_APP_ARN_WEB || "",
  ios: process.env.SNS_PLATFORM_APP_ARN_IOS || process.env.SNS_PLATFORM_APPLICATION_ARN_IOS || "arn:aws:sns:us-east-1:970547373533:app/APNS/intelliverse-ios",
  ios_sandbox: process.env.SNS_PLATFORM_APP_ARN_IOS_SANDBOX || "arn:aws:sns:us-east-1:970547373533:app/APNS_SANDBOX/intelliverse-ios-sandbox",
};

// Native APNs tokens are hex-encoded (64 or 160 chars). Anything else is
// almost certainly an FCM/Firebase token. We trust this shape over the
// caller-declared platform — Unity on iOS often registers via Firebase
// Messaging and ships an FCM token even when platform="ios".
const HEX_TOKEN_RE = /^[0-9a-fA-F]+$/;
function detectTokenFormat(token) {
  const t = String(token || "").trim();
  if (HEX_TOKEN_RE.test(t) && (t.length === 64 || t.length === 160)) return "APNS";
  return "FCM";
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event?.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

function normalizePlatform(platform) {
  const value = String(platform || "").toLowerCase();
  if (value === "ios" || value === "apns" || value === "apple") return "ios";
  if (value === "android" || value === "fcm" || value === "gcm") return "android";
  if (value === "web") return "web";
  return value || "android";
}

// ARN-derived platform — single source of truth for which envelope shape SNS
// will deliver. Always prefer this over the caller-supplied `platform` field.
// Callers (especially the Nakama RPC and old SDK builds) have shipped wrong
// values here in the past, which silently broke Android delivery.
function platformFromArn(arn) {
  if (!arn || typeof arn !== "string") return "";
  const seg = arn.split(":endpoint/")[1];
  if (!seg) return "";
  const type = (seg.split("/")[0] || "").toUpperCase();
  if (type === "APNS" || type === "APNS_SANDBOX" || type === "APNS_VOIP" || type === "APNS_VOIP_SANDBOX") return "ios";
  if (type === "GCM" || type === "FCM" || type === "ADM" || type === "BAIDU") return "android";
  if (type === "WNS" || type === "MPNS") return "windows";
  return "";
}

function mobileMessage(platform, title, body, data) {
  const customData = data && typeof data === "object" ? data : {};
  // FCM data fields must be string-valued. Coerce here so a stray number/bool
  // in `data` doesn't cause FCM to reject the whole message.
  const dataStringified = Object.fromEntries(
    Object.entries(customData).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
  );

  if (platform === "ios") {
    return JSON.stringify({
      default: body || title,
      APNS: JSON.stringify({
        aps: {
          alert: { title, body },
          sound: "default",
        },
        ...customData,
      }),
      APNS_SANDBOX: JSON.stringify({
        aps: {
          alert: { title, body },
          sound: "default",
        },
        ...customData,
      }),
    });
  }

  // Android (and web FCM). MUST include the top-level `notification` block —
  // without it, Android does not display a system-tray notification when the
  // app is backgrounded/killed; the message is silently delivered to the data
  // handler that only runs while the app is alive.
  const fcmPayload = {
    notification: { title, body },
    data: dataStringified,
    priority: "high",
    time_to_live: 3600,
  };
  return JSON.stringify({
    default: body || title,
    GCM: JSON.stringify(fcmPayload),
  });
}

async function registerEndpoint(body) {
  const declaredPlatform = normalizePlatform(body.platform);
  const token = body.deviceToken || body.token;

  if (!token) return json(400, { success: false, error: "device token required" });

  // Trust the token shape over the caller's `platform`. An FCM-shaped
  // token MUST go to the GCM Platform App regardless of platform=ios,
  // otherwise SNS produces an endpoint that will never deliver.
  const detectedFormat = detectTokenFormat(token);
  const wantSandbox = body.isSandbox === true || body.isSandbox === "true";

  let appArn;
  let resolvedPlatform;
  if (detectedFormat === "APNS") {
    appArn = wantSandbox ? appArns.ios_sandbox : appArns.ios;
    resolvedPlatform = wantSandbox ? "ios_sandbox" : "ios";
  } else {
    appArn = declaredPlatform === "web" && appArns.web ? appArns.web : appArns.android;
    resolvedPlatform = declaredPlatform === "web" && appArns.web ? "web" : "android";
  }

  if (!appArn) return json(400, { success: false, error: `SNS platform app ARN missing for ${resolvedPlatform}` });

  const customUserData = JSON.stringify({
    userId: body.userId || "",
    gameId: body.gameId || "",
    declaredPlatform,
    detectedFormat,
    isSandbox: !!wantSandbox,
  });

  let endpointArn;
  try {
    const result = await sns.send(new CreatePlatformEndpointCommand({
      PlatformApplicationArn: appArn,
      Token: token,
      CustomUserData: customUserData,
    }));
    endpointArn = result.EndpointArn;
  } catch (createError) {
    // Token already registered against a different endpoint → SNS throws
    // "Invalid parameter: Token Reason: Endpoint <arn> already exists with
    // the same Token, but different attributes." Recover by parsing the
    // existing endpoint ARN out of the message and re-enabling it, same as
    // lambda-functions/register-endpoint/index.mjs. SDK v3 surfaces the
    // error name as 'InvalidParameter' (sometimes only .Code).
    const errName = createError.name || createError.Code || "";
    const isAlreadyExists =
      /InvalidParameter/i.test(errName) &&
      /already exists/i.test(createError.message || "");
    if (!isAlreadyExists) throw createError;

    const arnMatch = (createError.message || "").match(/arn:aws:sns:[a-z0-9-]+:\d+:[^\s"',]+/i);
    if (!arnMatch) {
      console.error(`[push-provider-bridge] SNS reported "already exists" but ARN could not be parsed. Raw: ${createError.message}`);
      throw createError;
    }
    endpointArn = arnMatch[0];
    console.warn(`[push-provider-bridge] endpoint collision — reusing existing arn=${endpointArn}`);
  }

  if (endpointArn) {
    await sns.send(new SetEndpointAttributesCommand({
      EndpointArn: endpointArn,
      Attributes: { Enabled: "true", Token: token, CustomUserData: customUserData },
    }));
  }

  return json(200, {
    success: true,
    provider: "sns",
    platform: resolvedPlatform,
    declaredPlatform,
    detectedFormat,
    isSandbox: !!wantSandbox,
    endpointArn,
  });
}

async function sendPush(body) {
  if (!body.endpointArn) return json(400, { success: false, error: "endpointArn required" });

  // Trust the ARN over the caller's `platform`. A request that says
  // platform=ios but targets a /GCM/ endpoint must still build an FCM
  // envelope (otherwise SNS sends `default` to FCM and the device tray
  // shows nothing). When they disagree, log loudly so the upstream
  // mislabel stays diagnosable.
  const arnPlatform = platformFromArn(body.endpointArn);
  const requested = normalizePlatform(body.platform);
  const platform = arnPlatform || requested;
  if (arnPlatform && requested && arnPlatform !== requested) {
    console.warn(
      `[push-provider-bridge] caller said platform=${requested} but ARN resolves to ${arnPlatform}. ` +
      `Trusting ARN. arn=${body.endpointArn}`
    );
  }
  const title = body.title || body.eventType || "QuizVerse";
  const messageBody = body.body || "";
  // Always inject eventType into the FCM/APNs data dict so the Unity client
  // can route the deep-link on tap (FCMManager.HandleNotificationType
  // switches on this key).
  const enrichedData = Object.assign({}, body.data || {}, body.eventType ? { eventType: body.eventType } : {});
  const result = await sns.send(new PublishCommand({
    TargetArn: body.endpointArn,
    MessageStructure: "json",
    Message: mobileMessage(platform, title, messageBody, enrichedData),
  }));

  return json(200, {
    success: true,
    provider: "sns",
    platform,
    requestedPlatform: requested || undefined,
    messageId: result.MessageId,
  });
}

export async function handler(event) {
  try {
    const body = parseBody(event);
    if (body.endpointArn) return await sendPush(body);
    return await registerEndpoint(body);
  } catch (error) {
    console.error("[ivx-push-provider-bridge]", error);
    return json(500, {
      success: false,
      error: error?.message || "push provider bridge failed",
    });
  }
}
