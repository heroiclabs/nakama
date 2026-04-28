import { SNSClient, CreatePlatformEndpointCommand, PublishCommand, SetEndpointAttributesCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({});

const appArns = {
  android: process.env.SNS_PLATFORM_APP_ARN_ANDROID || process.env.SNS_PLATFORM_APPLICATION_ARN_ANDROID || "",
  web: process.env.SNS_PLATFORM_APP_ARN_WEB || "",
  ios: process.env.SNS_PLATFORM_APP_ARN_IOS || process.env.SNS_PLATFORM_APPLICATION_ARN_IOS || "",
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

function mobileMessage(platform, title, body, data) {
  const customData = data && typeof data === "object" ? data : {};
  const defaultPayload = JSON.stringify({
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(customData).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
    ),
  });

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

  return JSON.stringify({
    default: body || title,
    GCM: defaultPayload,
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

  const platform = normalizePlatform(body.platform);
  const title = body.title || body.eventType || "QuizVerse";
  const messageBody = body.body || "";
  const result = await sns.send(new PublishCommand({
    TargetArn: body.endpointArn,
    MessageStructure: "json",
    Message: mobileMessage(platform, title, messageBody, body.data || {}),
  }));

  return json(200, {
    success: true,
    provider: "sns",
    platform,
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
