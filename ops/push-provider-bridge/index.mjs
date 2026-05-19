import { SNSClient, CreatePlatformEndpointCommand, PublishCommand, SetEndpointAttributesCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({});

const appArns = {
  android: process.env.SNS_PLATFORM_APP_ARN_ANDROID || process.env.SNS_PLATFORM_APPLICATION_ARN_ANDROID || "arn:aws:sns:us-east-1:970547373533:app/GCM/IntelliVerseX-Android",
  web: process.env.SNS_PLATFORM_APP_ARN_WEB || "",
  ios: process.env.SNS_PLATFORM_APP_ARN_IOS || process.env.SNS_PLATFORM_APPLICATION_ARN_IOS || "arn:aws:sns:us-east-1:970547373533:app/APNS/intelliverse-ios",
};

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
  const platform = normalizePlatform(body.platform);
  const appArn = appArns[platform];
  const token = body.deviceToken || body.token;

  if (!token) return json(400, { success: false, error: "device token required" });
  if (!appArn) return json(400, { success: false, error: `SNS platform app ARN missing for ${platform}` });

  const attributes = {};
  if (body.userId || body.gameId) {
    attributes.CustomUserData = JSON.stringify({
      userId: body.userId || "",
      gameId: body.gameId || "",
    });
  }

  const result = await sns.send(new CreatePlatformEndpointCommand({
    PlatformApplicationArn: appArn,
    Token: token,
    CustomUserData: attributes.CustomUserData,
  }));

  if (result.EndpointArn) {
    await sns.send(new SetEndpointAttributesCommand({
      EndpointArn: result.EndpointArn,
      Attributes: { Enabled: "true" },
    }));
  }

  return json(200, {
    success: true,
    provider: "sns",
    platform,
    endpointArn: result.EndpointArn,
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
