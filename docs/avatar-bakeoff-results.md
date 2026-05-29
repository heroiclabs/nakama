# Avatar Bakeoff — Results Dashboard

**Status:** RPCs live, asset pipelines wired, runners written. Awaiting first 7-day cohort.

This doc captures the bakeoff design + the queries the on-call analyst runs each week to decide which AutoCurio renderer becomes canonical onboarding.

---

## What we're measuring

| Variant | Web component | Unity renderer | Cost / month (S3 + compute) |
|---|---|---|---|
| **2D Polished** | `AutocurioKeyframePlayer` inside `CinematicStage` | `AutoCurioRenderer2D.cs` | $5 — atlases only |
| **3D GLB** | `AutoCurio3D.tsx` (React-three-fiber) | `AutoCurioRenderer3D.cs` (GLTFast) | $25 — 8 MB GLB cached at edge |
| **Photoreal Video** | `AutoCurioVideo.tsx` (`<video>` + SVG mouth) | `AutoCurioRendererVideo.cs` (VideoPlayer → RT) | $180 — 20×4 MB loops × CDN egress |

All three variants consume the same `AvatarFrame` substrate (`useAvatarSession` on web, `AvatarSession.cs` on Unity), so a difference in funnel metrics is **only** explained by the renderer.

---

## Telemetry pipeline

```
Web (LiveTalk → AvatarRouter)  ────►  Intelliverse-X-AI ai-voice/avatar-event ────►  CloudWatch log group
                          │
                          └─► (parallel) Nakama RPC `analytics_avatar_comparison` ───► storage collection `qv_avatar_bakeoff`

Unity (AutoCurioGreetingStepV2 + AvatarSession) ────►  same two endpoints
```

Both endpoints accept the same `AvatarEvent` shape (see `web/lib/avatar-telemetry.ts` ↔ `data/modules/src/analytics/avatar-comparison-rpc.ts` ↔ `Intelliverse-X-AI/src/quiz/ai-voice/dto/ai-voice.dto.ts`). The Nakama path is the source of truth for **dashboard queries**; the ai-voice path is the source of truth for **structured logs** and CloudWatch alarms.

---

## Event types

| Event | When it fires | Used by |
|---|---|---|
| `greeting_shown` | One-shot on mount | Cohort sizing |
| `first_speaking_frame` | First frame where status === Speaking | Time-to-wow |
| `emotion_transition` | Every emotion classifier change | Engagement intensity |
| `topic_spotlight` | Topic extractor surfaces a new topic | Curiosity intensity |
| `interrupted` | User taps mic / sends a text while speaking | Conversation barge-in rate |
| `completed` | User reaches the next onboarding step | Conversion |
| `dropped` | Renderer load error OR user backs out | Reliability |

---

## Dashboard queries

The analyst runs these weekly. Replace `:start` / `:end` with the rolling 7-day window.

### Q1 — Cohort sizes per variant

Read via the admin-only RPC `analytics_avatar_comparison_recent` for a sanity check:

```bash
# from any host with a Nakama admin session token
curl -sX POST "$NAKAMA_URL/v2/rpc/analytics_avatar_comparison_recent" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"limit": 200, "variant": "2d"}' | jq '.payload | fromjson | .count'
```

For the actual cohort numbers, query the CockroachDB storage table directly:

```sql
SELECT
  value->>'variant'   AS variant,
  COUNT(*)            AS shown
FROM storage
WHERE collection = 'qv_avatar_bakeoff'
  AND value->>'eventType' = 'greeting_shown'
  AND create_time BETWEEN :start AND :end
GROUP BY 1
ORDER BY 1;
```

### Q2 — Median time-to-first-speaking-frame per variant

The "wow moment" metric — how long the user waits before AutoCurio starts speaking.

```sql
SELECT
  value->>'variant'                              AS variant,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY (value->>'elapsedMs')::int
  )                                              AS p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (
    ORDER BY (value->>'elapsedMs')::int
  )                                              AS p95_ms,
  COUNT(*)                                       AS n
FROM storage
WHERE collection = 'qv_avatar_bakeoff'
  AND value->>'eventType' = 'first_speaking_frame'
  AND create_time BETWEEN :start AND :end
GROUP BY 1
ORDER BY 1;
```

**Pass bar:** p50 < 1200 ms, p95 < 2800 ms. Above p95 = 4 s → variant fails the bakeoff regardless of conversion.

### Q3 — Conversion (greeting → next step)

```sql
WITH shown AS (
  SELECT value->>'variant' AS variant, COUNT(*) n_shown
  FROM storage WHERE collection='qv_avatar_bakeoff'
    AND value->>'eventType'='greeting_shown'
    AND create_time BETWEEN :start AND :end
  GROUP BY 1
),
completed AS (
  SELECT value->>'variant' AS variant, COUNT(*) n_completed
  FROM storage WHERE collection='qv_avatar_bakeoff'
    AND value->>'eventType'='completed'
    AND create_time BETWEEN :start AND :end
  GROUP BY 1
)
SELECT s.variant, s.n_shown, COALESCE(c.n_completed,0) AS n_completed,
       COALESCE(c.n_completed,0)::float / s.n_shown    AS conversion
FROM shown s LEFT JOIN completed c USING (variant)
ORDER BY conversion DESC;
```

**Pass bar:** absolute conversion per variant ≥ 0.55. The winner is the variant with the **highest conversion** within ±5 pp of the runner-up — ties go to the cheaper variant (2D > 3D > Video).

### Q4 — Drop / error rate per variant + platform

```sql
SELECT
  value->>'platform'  AS platform,
  value->>'variant'   AS variant,
  COUNT(*)            AS drops
FROM storage
WHERE collection = 'qv_avatar_bakeoff'
  AND value->>'eventType' = 'dropped'
  AND create_time BETWEEN :start AND :end
GROUP BY 1,2
ORDER BY drops DESC;
```

**Pass bar:** drop_rate < 2% per (platform, variant). Above that = ship a fix, not a winner.

### Q5 — Engagement intensity (emotion transitions per greeting)

```sql
SELECT
  value->>'variant'                AS variant,
  AVG(emotion_count)               AS avg_emotions_per_greeting
FROM (
  SELECT value->>'variant' AS variant,
         value->>'sessionId' AS session_id,
         COUNT(*) AS emotion_count
  FROM storage
  WHERE collection='qv_avatar_bakeoff'
    AND value->>'eventType'='emotion_transition'
    AND create_time BETWEEN :start AND :end
  GROUP BY 1,2
) per_session
GROUP BY 1
ORDER BY 1;
```

**Reading:** higher = AutoCurio is reaching the user emotionally. If 3D wins this but loses Q3, it usually means uncanny — the user is reacting *strongly* to seeing it, but bouncing.

---

## Decision rule (one-pass, no committee)

```
IF any variant's drop_rate > 0.02:
   FIX before declaring a winner.

IF cheapest passing variant's conversion ≥ runner-up - 5pp:
   PROMOTE cheapest passing variant. Done.

IF most-engaging variant (Q5) ALSO has highest conversion:
   PROMOTE it. Done.

ELSE:
   Extend the bakeoff by another 7 days; the cohorts are too small.
```

---

## Operational runbook

- **Asset health checks:** `aws s3 ls s3://intelli-verse-x-media/agent-assets/games/quiz-verse/v2/AUTOcurio/sprites/expressions/` should show 6 atlases. `videos/emotions/` should show 20 MP4s. `3d/autocurio.glb` should be > 50 KB.
- **Telemetry health:** if `analytics_avatar_comparison_recent` returns 0 rows for a variant after 24 h of traffic on that variant, check the corresponding renderer's error logs (browser console + Unity Player.log).
- **Variant swap:** flip `AvatarVariantConfig.variant` in the Unity editor + redeploy, OR set `?avatar=3d|video` on a web staging URL for one-off testing.
- **Cohort rotation:** the Satori experiment `avatar_bakeoff_v1` controls the % split. Default split is 60% 2d / 25% 3d / 15% video. Adjust in the Satori console.
