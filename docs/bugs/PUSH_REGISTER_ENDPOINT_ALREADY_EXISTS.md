# Push Registration Bug — SNS "Endpoint already exists with different attributes" (HTTP 500)

**Status:** OPEN — needs backend (Lambda) fix + redeploy
**Severity:** High — affected users silently receive **no** push notifications
**Area:** `register-endpoint` Lambda (AWS SNS) behind Nakama `push_register_token`
**Investigated:** 2026-06-03 (live production probe)

---

## 1. Symptom (what the client sees)

On device (iOS, second launch / after login), push token registration fails:

```
[Push:RegisterToken] FAILED error='Invalid parameter: Token Reason: Endpoint
arn:aws:sns:us-east-1:970547373533:endpoint/GCM/IntelliVerseX-Android/3d539a0a-f29e-3e95-a5ca-19c4e7aeb68a
already exists with the same Token, but different attributes.'
```

Nakama then returns this raw error to the client and stores the token row as
*pending* with `providerError`, so the device ends up with **no usable SNS
endpoint** → no push delivery.

---

## 2. What was confirmed (live production probe)

Probed the production register Lambda URL directly
(`https://alwe7byu637jhiwnkyzlg2fphm0fxioh.lambda-url.us-east-1.on.aws/`,
the hardcoded `PUSH_REGISTER_URL_DEFAULT` in `data/modules/src/legacy/push.ts`;
`PUSH_REGISTER_URL` env is empty in `.env` / docker-compose).

### Probe 1 — which Lambda build is live?
Payload (`platformType` deliberately invalid):
```json
{"userId":"version-probe-test","gameId":"probe","platform":"android","platformType":"BOGUS_PROBE","deviceToken":"probe-token-ignore"}
```
Response (HTTP 200):
```json
{"success":true,"endpointArn":"arn:aws:sns:us-east-1:970547373533:endpoint/GCM/IntelliVerseX-Android/f01bb567-6b2d-3cae-bc9a-769a50142390","snsEndpointArn":"...","userId":"version-probe-test","gameId":"probe","platform":"android","platformType":"BOGUS_PROBE","effectiveFormat":"FCM","isSandbox":false,"fcmProjectId":"","routedTo":"GCM/IntelliVerseX-Android"}
```
The fields `effectiveFormat`, `routedTo`, `endpointArn`, `isSandbox`,
`fcmProjectId` **only exist in the `.mjs` build**. The old `index.js` would have
returned `400 Unsupported platform type`.
→ **The deployed Lambda is already an `.mjs` build with token-shape routing.**
(So this is NOT a "stale index.js is deployed" problem.)

### Probe 2 — does it recover from the collision?
Payload: **same `deviceToken`, different `userId`** (forces "already exists with
different attributes"):
```json
{"userId":"version-probe-DIFFERENT-user","gameId":"probe","platform":"android","platformType":"FCM","deviceToken":"probe-token-ignore"}
```
Response (HTTP 500):
```json
{"success":false,"error":"Invalid parameter: Token Reason: Endpoint arn:aws:sns:us-east-1:970547373533:endpoint/GCM/IntelliVerseX-Android/f01bb567-6b2d-3cae-bc9a-769a50142390 already exists with the same Token, but different attributes."}
```
→ **The deployed Lambda does NOT recover from the collision.** It throws the raw
SNS error and returns 500. This reproduces the production bug exactly.

---

## 3. Root cause

`SNS CreatePlatformEndpoint` is idempotent **only** when both `Token` **and**
`CustomUserData` match an existing endpoint. Any change to `CustomUserData`
(most importantly `userId`) makes SNS throw:

> `InvalidParameter: ... already exists with the same Token, but different attributes.`

This is **expected** AWS behaviour. The Lambda must catch it, extract the
existing endpoint ARN from the message, and call `SetEndpointAttributes` to
re-point the endpoint (update `Token` / `Enabled` / `CustomUserData`).

The repo file `lambda-functions/register-endpoint/index.mjs` **does** contain
this recovery block, but the **deployed** build does not behave that way. Two
possibilities (please confirm against the deployed artifact):

1. **The deployed `.mjs` predates the recovery block** (an older build with
   routing but without the "already exists" handler), **or**
2. **The recovery guard's error-name check doesn't match.** The current guard is:
   ```js
   const isAlreadyExists =
       createError.name === 'InvalidParameterException' &&
       /already exists/i.test(createError.message || '');
   ```
   For SNS, the SDK v3 error may surface as name `InvalidParameter` (no
   `Exception` suffix) or only via `createError.Code`. If `name` doesn't equal
   `InvalidParameterException`, `isAlreadyExists` is `false` → it falls through
   to `throw createError` → HTTP 500 with the raw message (matches Probe 2).

---

## 4. Why it triggers in production

The same physical device token gets registered under **two different Nakama
userIds**:

- Boot / guest session registers the token under the **guest** userId.
- After the user logs in, the same token re-registers under the **real** userId
  → different `CustomUserData.userId` → collision.

Also triggered by: app reinstall, account switch, or any guest→real upgrade.

> **Client-side mitigation already shipped** (Unity `FCMManager`): the client now
> only registers the token once a **real, non-guest** Nakama userId is present
> (hard gate + server-userId verification + main-scene fallback). This greatly
> reduces collisions, **but does not eliminate them** (reinstall, account switch,
> the guest→real upgrade window). **The Lambda must still recover gracefully.**

---

## 5. Recommended backend fix

In `lambda-functions/register-endpoint/index.mjs`, harden the collision recovery,
then **redeploy** (and confirm the deployed artifact matches the repo):

```js
} catch (createError) {
    const msg = createError.message || '';
    const isAlreadyExists =
        /already exists/i.test(msg) && (
            createError.name === 'InvalidParameterException' ||
            createError.name === 'InvalidParameter' ||
            createError.Code === 'InvalidParameter' ||
            createError.__type === 'InvalidParameterException'
        );

    if (isAlreadyExists) {
        // 5-colon SNS endpoint ARN; resource part contains '/', not ':'
        const arnMatch = msg.match(/arn:aws:sns:[a-z0-9-]+:\d+:[^\s"',]+/i);
        if (arnMatch) {
            endpointArn = arnMatch[0];
            await sns.send(new SetEndpointAttributesCommand({
                EndpointArn: endpointArn,
                Attributes: { Token: deviceToken, Enabled: 'true', CustomUserData: customUserData }
            }));
        } else {
            // ARN not parseable — 502 so Nakama keeps the row pending for retry
            return response(502, { success: false, error: 'already exists but ARN unparseable', rawMessage: msg });
        }
    } else {
        throw createError;
    }
}
```

Key points:
- The ARN regex `/arn:aws:sns:[a-z0-9-]+:\d+:[^\s"',]+/i` is correct (5 colons).
  Do **not** use the legacy 8-colon regex.
- Broaden the error-name guard (item 2 above) — this is the most likely gap.
- After deploy, the "different attributes" case must return **HTTP 200 success**
  with the recovered `endpointArn`.

---

## 6. Verification after deploy

Re-run both probes (use `curl --data @file` to avoid shell quote mangling).
**Probe 2 must now return HTTP 200 + `success:true`**, not 500.

```bash
# Probe 1 — version check (expect routedTo/effectiveFormat in response)
curl -s -X POST "$REGISTER_URL" -H "Content-Type: application/json" \
  -d '{"userId":"probe-a","gameId":"probe","platform":"android","platformType":"FCM","deviceToken":"verify-token-001"}'

# Probe 2 — collision recovery (SAME token, DIFFERENT userId → must succeed)
curl -s -X POST "$REGISTER_URL" -H "Content-Type: application/json" \
  -d '{"userId":"probe-b","gameId":"probe","platform":"android","platformType":"FCM","deviceToken":"verify-token-001"}'
```

---

## 7. Cleanup (test artifact created during investigation)

A junk SNS endpoint was created for token `probe-token-ignore` during Probe 1/2:

```
arn:aws:sns:us-east-1:970547373533:endpoint/GCM/IntelliVerseX-Android/f01bb567-6b2d-3cae-bc9a-769a50142390
```

Delete it:
```bash
aws sns delete-endpoint --endpoint-arn \
  arn:aws:sns:us-east-1:970547373533:endpoint/GCM/IntelliVerseX-Android/f01bb567-6b2d-3cae-bc9a-769a50142390
```

---

## 8. Follow-ups / also check

- **`send-push` Lambda:** repo has both `index.js` (old, aws-sdk v2, SNS-only) and
  `index.mjs` (FCM HTTP v1 + APNs). Confirm which build is deployed and that the
  FCM v1 path (`index.mjs` + `fcm-direct.mjs`) is live.
- **Dual handler files:** both lambda folders contain `index.js` **and**
  `index.mjs`. With handler `index.handler` and no `"type":"module"`, Node
  defaults to `index.js`. The probe shows `.mjs` is live today (so deploy config
  points at it correctly), but consider removing the stale `index.js` from the
  deploy artifact to prevent a future accidental regression.
- **`fcmProjectId`:** Probe responses show `fcmProjectId:""`. Ensure the client
  passes it (or `DEFAULT_FCM_PROJECT_ID` env is set) or FCM v1 sends will fail
  even after registration is fixed.
```
