# Avatar Bakeoff — Operator Runbook

**Audience:** the human / on-call who has AWS credentials and access to the
conversational stack.  
**Purpose:** finish what the avatar-bakeoff harness can't finish without
credentials / a GPU / a Unity Editor.

Everything in this file maps 1-to-1 to an item from
`docs/avatar-bakeoff-e2e-test-2026-05-29.md` that was left as `⚠` or `❌`
because the automation context could not satisfy it.

---

## ① Generate the 3D GLB (`?avatar=3d`)

**Why deferred:** Trellis2 SDK ships ~1.5 GB of dependencies, needs a
reachable inference endpoint, and each run costs $2-5. The pipeline has
a `risk_gate` (`round_head`, `antenna`, `glowing_eyes`, `chest_screen`)
that aborts an off-brand output, so blind unattended runs are unsafe.

```bash
cd content-factory
uv sync                            # or: pip install -r requirements.txt
export AWS_ACCESS_KEY_ID=…
export AWS_SECRET_ACCESS_KEY=…
export TRELLIS_API_URL=…           # inference endpoint
make bakeoff.autocurio.3d.dry      # verify wiring (no spend)
make bakeoff.autocurio.3d.mesh     # mesh-only, ~$2 (review first!)
# Look at .working_dir/.../characters/autocurio/preview.glb in any GLB viewer
make bakeoff.autocurio.3d          # full run with rig + ARKit blendshapes
```

**Verification:** after the script reports `status=ok`, the web
`?avatar=3d` route should render the real model on next reload —
`AutoCurio3D` does a HEAD-probe before mounting the `useGLTF` path.

If `RISK_GATE_FAILED.md` lands in the working dir, do NOT push the
output to S3. Re-run with a tighter prompt or escalate.

---

## ② Generate the 20 emotion video loops (`?avatar=video`)

**Why deferred:** Veo / equivalent T2V costs ~$0.50 per 4-s loop ($10
for all 20) and needs `GOOGLE_GENAI_API_KEY` or similar.

```bash
cd content-factory
make bakeoff.autocurio.videos.dry                       # safe
make bakeoff.autocurio.videos.one EMOTION=neutral       # 1 loop, ~$2
make bakeoff.autocurio.videos                           # all 20, ~$10
```

**Verification:** `web/lib/autocurio-video-loops.ts` declares the
canonical loop URLs; the `<video>` element will switch from the
emotion-tinted gradient backstop to the real video as soon as the loops
land at the expected S3 paths.

---

## ③ Sessionid-bearing telemetry → already wired

Resolved in this PR set: `useAvatarSession` now exposes a `sessionId`
captured from `AIVoiceClient.onSession`, and `LiveTalk.tsx` passes it
into `AvatarRouter`. The web telemetry already flows; no further
operator action required.

---

## ④ Start the self-hosted conversational backend

**Why deferred:** the gateway needs ANTHROPIC_API_KEY + OPENAI_API_KEY
+ AWS S3 creds + a Kokoro TTS server (GPU-bound) + optionally a
LiveKit Agent worker. None of these are checked in.

```bash
# Step 1 — Redis (needed by the gateway)
cd Intelliverse-X-AI
docker compose up -d redis

# Step 2 — populate .env (copy .env.example, fill the secret keys)
cp .env.example .env
$EDITOR .env                       # fill ANTHROPIC_API_KEY, OPENAI_API_KEY,
                                   # AWS_*, KOKORO_URL, etc.

# Step 3 — boot the gateway
npm install
npm run start:dev                  # → http://localhost:5001

# Step 4 (optional) — Kokoro TTS (separate process / GPU node)
# Follow Kokoro upstream README; expose at $KOKORO_URL in .env

# Step 5 (optional) — LiveKit Agent worker
# Required only if you want WebRTC transport; HTTP polling works today.
```

**Note on bakeoff validity without the backend:** the variant
comparison measures the *rendering reaction* to a known input stream.
The synthesised `simulateReply` driver is intentionally deterministic
and identical across all three renderers, so the bakeoff signal
(time-to-first-speaking-frame, emotion-transition latency, perceptual
fidelity) remains valid even when the real LLM/TTS stack is down.

---

## ⑤ Unity Editor 6-step handoff

**Why deferred:** can't drive Unity from a headless agent context.

Open the project in Unity Editor 6000.3.6f1 and run these six steps in
order. Each is 30-90 s of click-work.

1. **Wait for the UPM resolver** to pull
   `com.atteneder.gltfast@6.10.1` and `com.hecomi.ulipsync` into
   `Library/PackageCache/`. Visible in `Window → Package Manager`.
   On first import you may see `gltfast` log a "samples available"
   notice — that's normal; you don't need the samples.
2. **Create the variant config.** Right-click in
   `Assets/_QuizVerse/Settings/` → `Create → QuizVerse →
   Conversational → Avatar Variant Config`. Name it
   `AvatarVariantConfig.asset`.
3. **Create one prefab per variant** (parent = empty GameObject):
   - `Variant2D_AutoCurioPrefab.prefab` — drop `AutoCurioRenderer2D`
     onto it, wire the `UIDocument` reference, attach uLipSync mouth.
   - `Variant3D_AutoCurioPrefab.prefab` — drop `AutoCurioRenderer3D`,
     leave the GLB URL as the S3 default (will fall back to bundled
     prefab if the GLB hasn't been produced yet — see ①).
   - `VariantVideo_AutoCurioPrefab.prefab` — drop
     `AutoCurioRendererVideo`, leave manifest URL as the S3 default.
4. **Assign the three prefabs** onto the `AvatarVariantConfig.asset`
   inspector slots.
5. **Drop the asset onto `OnboardingManagerV2`** → the new
   `Avatar Variant Config` slot in the inspector (added in this PR).
6. **Run the parity tests.** `Window → General → Test Runner →
   Edit Mode → Run All`. The `EmotionTopicParityTests` fixture
   (~1 s) must pass — that's the gate that keeps the C# classifier
   in lockstep with the web one.

**PlayMode smoke** (optional but recommended): enter Play mode on
`Assets/_QuizVerse/Scenes/Onboarding/OnboardingV2.unity`, watch for
`AutoCurio · ready` in the status label, confirm the chosen variant
prefab spawns under the UIDocument.

To switch the active variant for a single device build, change
`AvatarVariantConfig.variant` in the inspector. To shift % of users
between variants at runtime, populate the `remoteConfigKey` field
(`avatar_variant`) in your remote config service with `"2d"`, `"3d"`,
or `"video"` — the config will apply on next session start.

---

## Status matrix

| Concern | Auto-resolvable from agent context | Status after this PR set |
|---|---|---|
| Web 2D | ✅ | Shipping |
| Web 3D | ❌ (creds + GPU) | Pipeline + Make target ready, awaits ① |
| Web Video | ❌ (creds + T2V budget) | Pipeline + Make target ready, awaits ② |
| Web telemetry sessionId | ✅ | DONE in this PR |
| Backend stack | ❌ (secrets) | Runbook ready, awaits ④ |
| Unity onboarding step | ❌ (Editor) | Code ships, awaits ⑤ |

**Net:** the bakeoff is shippable today on 2D web. 3D + Video unlock as
their asset packs are produced. Unity unlocks after the 6 Editor steps.
None of the remaining steps require new code — only operator action
with the right credentials.
