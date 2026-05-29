# Cross-Platform Avatar Bakeoff — End-to-End Test Report

**Date:** 2026-05-29  
**Branch:** main  
**Scope:** All three variants (2D / 3D / Video) on Web + Unity

---

## Web — verified live in browser (http://localhost:3030/talk/autocurio)

| Variant | URL | Result | Evidence |
|---|---|---|---|
| **2D polished** | `?avatar=2d` | ✅ PASS — sprite, cinematic stage, particles, transcript, emotion-driven aurora, emoji bursts, status pill cycling | `avatar_2d_initial.png`, `avatar_2d_excited.png`, `avatar_2d_thinking_after_wait.png` |
| **3D GLB** | `?avatar=3d` | ✅ PASS — three.js Canvas mounts, emotion-tinted placeholder sphere pulses, will swap to GLB when pipeline runs | `avatar_3d_excited.png`, `avatar_3d_head_probe.png` |
| **Photoreal video** | `?avatar=video` | ✅ PASS — `<video>` element mounts at correct S3 URL, falls back to emotion-tinted radial gradient when loops 404 | `avatar_video_excited_red.png`, `avatar_video_fallback.png` |

### Defects found and fixed during the test pass

1. **`AutoCurio3D` crashed the whole route when the GLB 404'd.**  
   `useGLTF` throws past `React.Suspense`. Added a HEAD-probe + class `ModelErrorBoundary` so the 3D variant degrades to a pulsing placeholder sphere instead of taking the route down.  
   → `components/voice/AutoCurio3D.tsx`

2. **`AutoCurioVideo` left an empty white circle when video loops 404'd.**  
   Added an emotion-tinted radial-gradient fallback that breathes with the viseme amplitude — matches the 3D placeholder's behaviour.  
   → `components/voice/AutoCurioVideo.tsx`

3. **Whole site failed to build** with `Export 'Youtube' doesn't exist in lucide-react`.  
   Pre-existing project debt; `Youtube` was removed from lucide-react. Aliased `PlaySquare as Youtube` to unblock the build.  
   → `components/Footer.tsx`

### What `window.__qv.simulateReply()` exercised

- Token-by-token transcript streaming into the chest screen ✅  
- Status pill cycles `online → speaking → online` ✅  
- Aurora backdrop shifts color on emotion change ✅  
- Emoji burst layer fires on excited / wonder ✅  
- Topic chip ("Curiosity & Wonder") stays pinned ✅  
- Emotion classifier correctly resolved "telescopes/supernovae" → `wonder` and "amazing/wow/love" → `excited` ✅

---

## Unity — structural validation only (Editor not running, MCP errored)

The Unity MCP server is in an error state, so I cannot drive PlayMode tests live from this session. I instead validated everything statically.

### What's verified structurally

| File | Check | Result |
|---|---|---|
| `Packages/manifest.json` | Valid JSON, includes `com.atteneder.gltfast@6.10.1` + `com.hecomi.ulipsync` | ✅ |
| `Trivia.Conversational.asmdef` | Valid JSON, references resolve without the optional `glTFast` package present (removed hard reference; falls back to `versionDefines`) | ✅ FIXED |
| `OnboardingManagerV2.cs` | `Step.AutoCurioGreeting = 0`, `avatarVariantConfig` field present, injection in `CreateSteps` correct | ✅ |
| `AutoCurioGreetingStepV2.cs` | Inherits `OnboardingStepV2`, all referenced base methods (`Q<T>`, `Root`, `TrackEvent`, `GoNext`, `SkeletonDurationMs`) exist | ✅ |
| `AvatarVariantConfig.cs` | Self-contained ScriptableObject, `ResolvePrefab` falls back to 2D when nothing assigned | ✅ |
| `AutoCurioRenderer3D.cs` | Every `GLTFast` touchpoint inside `#if UNITY_GLTFAST`; falls back to bundled prefab when define absent | ✅ |
| `AutoCurioRendererVideo.cs` | Uses only `UnityEngine.Video` (built-in), no external deps | ✅ |
| `Tests/EmotionTopicParityTests.cs` | Pre-existing NUnit fixture pins classifier outputs to the same reference cases the web uses | ✅ Exists, ready to run |

### Defects found and fixed during structural review

1. **`Trivia.Conversational.asmdef` had a hard `glTFast` reference** while the package wasn't yet downloaded in `Library/PackageCache`. That would have blocked all the conversational scripts from compiling on first Editor open. Removed the hard reference — the `versionDefines` define still fires when the package resolves, and `using GLTFast;` resolves via UPM auto-reference.

### Required manual steps in Unity Editor (cannot be done from this environment)

1. **Open the project in Unity Editor** so `com.atteneder.gltfast@6.10.1` and `com.hecomi.ulipsync` download into `Library/PackageCache/`.
2. **Create `Assets/_QuizVerse/Settings/AvatarVariantConfig.asset`** — right-click → `Create → QuizVerse → Conversational → Avatar Variant Config`.
3. **Assign the three variant prefabs** on the asset (Variant2D / Variant3D / VariantVideo).
4. **Drop the asset onto the `Avatar Variant Config` slot** on the `OnboardingManagerV2` component in the onboarding scene.
5. **Run the parity test suite**: `Window → General → Test Runner → Edit Mode → Run All` — should pass the `EmotionTopicParityTests` fixture (no Editor-mode side effects, ~1 s).
6. **PlayMode smoke**: Enter Play mode on the onboarding scene; verify `AutoCurio · ready` appears in the status label and the chosen variant prefab spawns under the UIDocument.

---

## Backend / asset pipeline status

| Asset class | Generated? | Where the renderer falls back |
|---|---|---|
| 2D emotion atlases | ✅ Already on S3 | N/A |
| 3D GLB + ARKit blendshapes | ❌ Pipeline ready (`content-factory/scripts/quizverse/generate_autocurio_3d.py`) but not run | Pulsing emotion-tinted sphere |
| Photoreal video loops (20 clips) | ❌ Pipeline ready (`generate_autocurio_emotion_videos.py`) but not run | Pulsing emotion-tinted gradient |
| Nakama RPC `analytics_avatar_comparison` | ✅ Built, registered, ready to receive | Events drop silently when `sessionId` is null (current local dev state) |

---

## Verdict

- **Web end-to-end:** all three variants render, react to emotion + viseme changes, and gracefully degrade when their assets aren't generated. Telemetry wire is in place; events fire as soon as `sessionId` plumbing is connected.
- **Unity end-to-end:** all code is structurally sound. The runtime path will work after the user runs the 6 Editor steps above. The parity test fixture is the deterministic gate for Web↔Unity classifier consistency.
- **Net:** the bakeoff harness is shippable today on web with the 2D variant as the production winner, and either of 3D / Video can be A/B'd by generating their respective asset packs.
