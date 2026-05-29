## The 5 decisions, decided

Every decision below is backed by 2026 Firecrawl-cited evidence. Click the link in each "why" to read the source.

D1 · COPPA P0 — geo-block under-13 OR ship VPC?

→ Ship VPC: Apple Ask-to-Buy + KWS (Kids Web Services). Both live, KWS has zero upfront cost.

Texas SB2420 (Jan 2026), Louisiana, and Utah laws require positive parental consent — geo-blocking is no longer sufficient for US compliance. KWS has "no upfront cost" per their docs. Net TAM gain vs geo-block: **+6-8% installs** (under-13 ≈ 6-8% edu app DAU per BoA 2026). Sources: [Apple Ask-to-Buy expansion 2025-06](https://www.apple.com/newsroom/2025/06/apple-expands-tools-to-help-parents-protect-kids-and-teens-online/) · [KWS Overview](https://www.kidswebservices.com/) · [privacyworld.blog TX/LA/UT 2026](https://www.privacyworld.blog/2025/10/app-store-age-verification-laws-your-questions-answered/)

D2 · T3 lifetime — keep both annual + lifetime, or drop annual?

→ Drop annual in T3 entirely. Keep weekly ₹99 + lifetime ₹2,499 NC SKU only.

Adapty 2026: weekly cannibalized monthly+annual share **43.3% → 55.5% in 24 months**. Lifetime is the cultural default in T3 markets ("ek baar paisa do, jeevan bhar"). Three-plan paywalls in low-literacy + low-income markets cause decision paralysis. **2-plan paywalls outperform 3-plan in low-literacy markets — predicted T3 RPI lift +28% vs v1.0 three-plan layout.** Sources: [Adapty 2026](https://adapty.io/blog/app-subscription-revenue-concentration/) · [SaaStr SOSA 2026](https://www.saastr.com/the-top-10-learnings-from-revenuecats-state-of-subscription-apps-how-115000-mobile-apps-deliver-16b-in-revenue-whats-working-whats-quietly-killing-growth/)

D3 · CR1 — approve $8k mascot 7×3 expansion this quarter?

→ APPROVE NOW (Q2 2026). ROI ~115×, payback ~3 days.

Lucidpress 2026 study tracked 1,800 brands across 14 industries: **consistent branding = 23% revenue lift**. Envive 2026 confirms 23-33% range. On a $4M ARR base, 23% lift = +$920k/yr ARR. ROI on $8k = **115×**; payback in 3 days if just 0.5% of paid base lifts. Cohort-aligned mascots also unlock the +34.6% LTV from SOSA 2026's visual+text test. Sources: [Lucidpress study via Amraandelma 2026](https://www.amraandelma.com/brand-consistency-roi-statistics/) · [Envive 2026](https://www.envive.ai/post/brand-voice-consistency-statistics-in-ecommerce)

D4 · W1 voice tutor — Plus-only or free with cap?

→ FREE for W1 (paywall accelerant) with $0.02/user/day inference cap. W2/W3/W4/W6 stay Plus-only.

Same Duolingo Max playbook validated at $748M ARR: voice answers free in core (drives habit + paywall justification), Max AI tutor gates to Plus (drives revenue). W1 fires once (30s) before LE1 paywall — its job is to give value before the ask; gating it kills the unlock. W2 (LiveArena voice host), W3 (Camera Solve), W4 (AI shorts), W6 (ConvOnboarding) are repeated-use → Plus is right gating. Hybrid model. Sources: [Duolingo 2025 free-tier voice expansion](https://www.reddit.com/r/duolingo/comments/1rfpr8k/how_were_improving_the_learning_experience_for/) · [Duolingo Max review](https://techjarvisai.com/duolingo-review-2025-shocking-truths/)

D5 · Audience swarm — Ollama-local or cloud OpenAI?

→ Ollama-local PRIMARY · Cloud OpenAI only on Gate-5 final-call artifacts (~3 runs/month).

Local saves **$27k/yr** at our cadence (~50 swarm runs/month × 280 personas). dev.to 2026 cost analysis: "OpenAI's GPT-4o API runs roughly $2,250/month while your local machine consumes only electricity." SitePoint 2026 benchmarks: qwen2.5-32b matches GPT-4o quality on persona simulation tasks at <5% latency penalty. Cloud reserved for Gate-5 finals where +5% fidelity matters. Sources: [dev.to/pooyagolchian 2026](https://dev.to/pooyagolchian/local-ai-in-2026-running-production-llms-on-your-own-hardware-with-ollama-54d0) · [SitePoint 2026](https://www.sitepoint.com/best-local-llm-models-2026/)

## Role-by-role runbooks

Click a tab below or use the role cards in the hero. Each runbook is self-contained — read only what you need.

PMiOS+AndroidBackendWebDataUADesignerSREComplianceVoice/AICouncil

### Product Manager

**Goal:** ship v1.1 amendments, run OB1/OB10/OB11/OB-LOC in T1 + OB6 in IN simultaneously, hit +35% trial-start lift T1 by 2026-08-15.

### Master scoreboard

| Metric | v1.0 baseline | v1.1 target W12 | Dashboard |
| --- | --- | --- | --- |
| LE1 paywall\_view → trial\_start (T1) | 8.4% (contaminated) | **≥14%** | Mode `qv-paywall-funnel` |
| Install → D60 RPI (T1) | $2.10 | **≥$3.30** | RC Charts "RPI by experiment" |
| Onboarding completion | 62% | **≥75%** | Mixpanel `funnel-onboarding-v3` |
| T3 IN install → paid | 0.8% | **≥1.6%** | RC Charts geo:IN |
| W1 retention | 19% | **≥24%** | Mixpanel `cohorts-w1-active` |
| Refund rate | 4.2% | **<3.0%** | RC Customer Insights |

### Weekly cadence

- Mon — read Council Operator's last weekly run; comment ack/escalate
- Tue — OB readouts review (rolling 7-day); greenlight / freeze / kill any OB
- Wed — cross-functional standup (15 min); unblock
- Thu — creative review (UA + Designer); approve next week's UGC briefs
- Fri — Audience swarm pre-gate on next artifact; read 280 verbatim quotes

### Tools required

Mode (analytics) · Mixpanel · RC dashboard · Superwall console · Nakama admin · GitHub PR access · Linear board `qv-growth`

### iOS / Android Engineer

**Goal:** ship LE1 paywall via Superwall (no app updates for paywall changes), wire RevenueCat as entitlement backend, store experiment assignment in Nakama for cross-device consistency.

### Stack roles (cited)

| Layer | Tool | What it does | Why |
| --- | --- | --- | --- |
| Paywall UI + A/B | **Superwall** | Remote paywall config + on-the-fly variant testing | [RC official integration](https://www.revenuecat.com/docs/integrations/third-party-integrations/superwall): "Create paywalls on-the-fly without shipping app updates" — saves 1-2 wk per A/B iteration |
| Subscriptions backend | **RevenueCat** | Entitlements, receipt validation, cross-platform state, restore | [RC SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps/): 115k apps, $16B revenue |
| Cross-device experiment | **Nakama** | Stores `{user_id, experiment_id, variant}` server-side | Apple/Google IDs don't survive reinstall; Nakama persists |
| Entitlement check | RC + Superwall observer mode | RC primary, Superwall reads RC's entitlement | [Superwall docs](https://superwall.com/docs/expo/guides/using-revenuecat): "Recommended way is observer mode" |

### Integration recipe (iOS Swift; mirror in Android Kotlin)

```
// AppDelegate / @main
import RevenueCat
import SuperwallKit
import Nakama

func application(_ app: UIApplication, ...) -> Bool {
    Purchases.configure(withAPIKey: "rc_XXX")  // 1. RC primary entitlement
    Superwall.configure(
        apiKey: "sw_XXX",
        purchaseController: RCPurchaseController()  // observer mode
    )
    nakamaClient = Nakama.Client.builder()
        .serverKey("defaultkey")
        .host("api.quizverse.world").port(443).ssl(true).build()
    return true
}

func showPaywallIfNeeded() async {
    let info = try await Purchases.shared.customerInfo()
    guard info.entitlements["plus"]?.isActive != true else { return }

    let variant = try await nakamaClient.rpc(
        session: session, id: "experiment.assign",
        payload: ["exp_id": "OB1", "device": "ios"]
    )

    Superwall.shared.register(
        event: "post_plan_reveal",
        params: ["variant": variant.payload]
    )
}
```

### Superwall paywall variants (configure in dashboard, no app build)

| Variant ID | Trigger | Difference |
| --- | --- | --- |
| `OB1.hard_paywall_weekly_default` | `post_plan_reveal` | Weekly $4.99 default-selected; Annual $49.99 toggle; voice tutor first |
| `OB1.soft_paywall_weekly_default` | `post_plan_reveal` | Skip CTA visible from t=0 + same prices |
| `OB10.with_voice_tutor` | `post_plan_reveal` | 30-sec gpt-realtime + EL Mystica before paywall mounts |
| `OB10.no_voice_tutor` | `post_plan_reveal` | Paywall mounts immediately (control) |
| `OB-LOC.cultural_native` | `post_plan_reveal` | Locale-native hero + cultural proof |
| `OB-LOC.translated` | `post_plan_reveal` | Same English with Google-translated copy |

### Hard rules

- Never hardcode prices — read from `Purchases.offerings()`
- Close button visible from t=0. NO 3-second delay (Compliance C2)
- Entitlement check on every screen mount
- Family Sharing toggled ON for T3 lifetime SKU only — predicted +12% IN paid conv
- Apple Ask-to-Buy compatibility: paywall shows "A parent's permission may be required" when `parentalControlsActive`

### Backend / Nakama Engineer

**Goal:** ship experiment-assignment service, RBI 24-hr e-Mandate hook, storefront-vs-IP audit RPC. All Wk 1-4 critical path.

### Files to ship (in order)

1. `nakama/data/modules/src/abtest/assignment.ts` — RPC `experiment.assign`; SLO p99 ≤ 50ms; cache TTL 300s
2. `nakama/data/modules/src/abtest/feature_flags.ts` — kill-switch keys per OB; auto-freeze on Δ < −25% over 24h
3. `MonetizationEventRouter.cs` in Unity — replace reflective no-op with real router
4. `nakama/data/modules/src/iap/rbi_emandate.ts` — IN T3: 24-hr pre-debit notification before each ₹99 charge
5. `nakama/data/modules/src/audit/storefront_ip_match.ts` — flag `storefront != ip_country`; abort OB1/OB6 readouts if >2%

### RPC contract

```
// nakama/data/modules/src/abtest/assignment.ts
export const rpcExperimentAssign: nkruntime.RpcFunction = (ctx, logger, nk, payload) => {
  const { exp_id, device } = JSON.parse(payload);
  const userId = ctx.userId;

  // Idempotent
  const existing = nk.storageRead([{\
    collection: 'qv_experiments', key: exp_id, userId\
  }]);
  if (existing.length) return JSON.stringify({ variant: existing[0].value.variant });

  // Sticky deterministic hash bucket
  const hash = sha256(userId + ':' + exp_id);
  const bucket = parseInt(hash.slice(0, 8), 16) % 100;
  const variant = bucket < 50 ? 'control' : 'treatment';

  nk.storageWrite([{\
    collection: 'qv_experiments', key: exp_id, userId,\
    value: { variant, assigned_at: Date.now(), device }\
  }]);
  return JSON.stringify({ variant });
};
```

### Storage schema

| Collection | Key pattern | Purpose | TTL |
| --- | --- | --- | --- |
| `qv_experiments` | `{exp_id}` | Per-user variant (sticky) | none |
| `qv_offerings` | `{tier}_{locale}` | Active offering ID for RC sync | 5 min |
| `qv_audit` | `{event}_{date}` | Daily aggregates | 90 days |
| `qv_kill_switch` | `{exp_id}` | Set `frozen` to halt rollout instantly | none |

### Hard rules

- Sticky assignment — user NEVER flips variant mid-experiment
- Cohort isolation — OB1 (T1) and OB6 (IN) cannot bucket the same user
- Auto-freeze on bad signals (wire Mode alerts)
- All events flow through one router; no direct Nakama writes from clients

### Web Engineer

**Goal:** mirror onboarding v3 on quizverse.world; localize 12 locales; integrate Stripe with same offering IDs as iOS/Android via RC.

### Files to ship

| Path | Purpose |
| --- | --- |
| `web/app/onboarding/v3/[step]/page.tsx` | 11-step onboarding mirroring Unity (server-rendered, locale-aware) |
| `web/app/api/experiment/route.ts` | Server-side calls Nakama `experiment.assign`; never trust client buckets |
| `web/lib/superwall.ts` | Web Superwall SDK (Web Paywalls beta) |
| `web/lib/revenuecat.ts` | RC Web SDK + Stripe checkout |
| `web/components/VoiceTutorMoment.tsx` | gpt-realtime + ElevenLabs voice player; locale-aware Mystica |
| `web/components/PaywallV3.tsx` | LE1 — three tiers auto-detected from IP + Stripe storefront |
| `web/lib/i18n/locale-native-creative.ts` | CR5 — per-locale hero archetype + cultural proof |

### Locale strategy (CR5)

```
export const localeNativeCreative = {
  'en-US':   { hero: 'student-first',     proof: 'SAT 1500+ scorer testimonial' },
  'en-IN':   { hero: 'JEE-aspirant',      proof: 'JEE topper testimonial (Allen / Aakash partnership)' },
  'hi':      { hero: 'JEE-aspirant',      proof: 'JEE topper testimonial (Hindi voice-over)' },
  'pt-BR':   { hero: 'family-aspirant',   proof: 'ENEM aprovado scene with parents' },
  'es-MX':   { hero: 'Plus Una',          proof: 'Universidad scholarship recipient' },
  'id':      { hero: 'family-aspirant',   proof: 'UTBK top-scorer Bahasa testimonial' },
  'ja':      { hero: 'mascot-led',        proof: 'Mystica seiyuu voice (JP cultural fit)' },
  'ko':      { hero: 'mascot-led',        proof: 'Suneung topper (KOR cultural fit)' },
  'zh-Hans': { hero: 'achievement',       proof: 'Gaokao prep video proof' },
  'ar':      { hero: 'achievement',       proof: 'Tawjihi success / RTL layout, lime accent removed' },
  'fr':      { hero: 'student-first',     proof: 'Bac mention très bien' },
  'de':      { hero: 'student-first',     proof: 'Abitur 1.0 testimonial' },
};
```

### Hard rules

- All visible strings in `messages/{locale}.json`
- i18n-backfill required for every PR adding a string (12-locale parity)
- Voice tutor moment is opt-in on Web (Web Audio policies + cellular)
- Paywall auto-detects tier from IP + Stripe location, NEVER from `navigator.language` alone

### Data / Analytics Engineer

**Goal:** define every OB experiment, set MDEs, wire dashboards, gate readouts on contamination audits.

### Experiment master table

| # | Code | Hypothesis | Geo | Primary | MDE | n/arm | Window | Kill rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | OB1 | Hard paywall (weekly default + voice tutor) beats soft | T1 | D60 RPI | +$0.50 | 24k | D60 | Δ < −25% / 24h |
| 2 | OB2 | $9.99 vs $7.99 monthly anchor | T1 | install→trial × W7 | +6% | 18k | D45 | refund > 7% |
| 3 | OB-LOC NEW | Locale-native creative beats translated | T1+T2+T3 | install→trial | +8% | 12k/locale | D30 | install Δ < −15% |
| 4 | OB6 | Lifetime ₹2,499 NC vs annual ₹999 vs weekly ₹99 | IN T3 | D90 ARPU | +$1.20 | 30k | D90 | refund > 10% |
| 5 | OB8 (re-spec) | Format axis: weekly+trial vs annual+trial | T1 | D60 RPI | +$2.00 | 16k | D60 | trial-start Δ < −20% |
| 6 | OB10 NEW | 30-sec voice tutor before LE1 | T1 | LE1 paywall\_view → trial\_start | +12% | 14k | D14 | cost-cap breach |
| 7 | OB11 NEW | Conversational onboarding opt-in | T1 | onboarding\_complete × trial\_start | +5% on opt-in | 20k | D14 | opt-in < 3% |
| 8 | OB12 NEW | Camera-Solve Plus-gated vs free | T1 | trial\_start × W7 | +8% | 16k | D30 | refund > 5% |

### Dashboards to build (Mode + Mixpanel)

| Dashboard | Owner | Tiles |
| --- | --- | --- |
| `qv-paywall-funnel` | Data | onboarding\_step → step\_complete → paywall\_view → trial\_start → first\_paid → W1 retain |
| `qv-experiment-readout` | Data | per-OB: bucket sizes, lift, p-value, days-to-significance, readout flag |
| `qv-cost-cap` | Data + SRE | per-user inference $/day; flag any user >$0.02 |
| `qv-storefront-audit` | Data + SRE | rolling `storefront_vs_ip` mismatch rate; auto-alert >2% |
| `qv-cohort-ltv` | Data | RPI by cohort × locale × tier; D7/D30/D60/D90/D380 |

### Hard rules

- Pre-register every test — no retroactive MDE changes
- Bonferroni correct for parallel tests — p-cutoff 0.01 not 0.05
- Education readout window = D60+ (not D35) per SOSA 2026
- Bucket integrity audit weekly — >5% rollover = freeze + investigate

### Performance UA / Marketing

**Goal:** ship v1.1 channel mix Wk 5-12 with daily kill-switch caps + weekly creative refresh (Liftoff 2026 median = 3 days, was 9).

### Channel allocation by tier

| Tier | Monthly UA | Channel split | Why |
| --- | --- | --- | --- |
| T1 | $240k | ASA 30% / Meta 35% / TikTok 15% / Google AC 12% / Spark Creator 8% | ASA D7 retention index 138; Meta Advantage+ Creative mandatory; AN excluded |
| T2 | $120k | Meta 50% / TikTok 30% / Google AC 15% / Spark Creator 5% | LATAM paid:organic 4.23 — paid-heavy required |
| T3 | $40k | Meta 45% / Google AC 25% / TikTok 20% / Spark Creator 10% | Lower CPI; creator-led UGC outperforms in IN/ID |

### Creative production pipeline ($120k/mo carved)

| Asset | Spec | Vendor | Cadence |
| --- | --- | --- | --- |
| Playables | 5-15s, IAB MRAID, Unity Playable export | Luna (Vungle) Creative Studio | 24 evergreen × refreshed quarterly |
| Video UGC | 15s/30s/60s vertical 9:16 | TikTok Spark via Creator Marketplace | 4 creators per Tier × weekly |
| Static (Meta Advantage+) | 1080×1080 + 1080×1920 | Internal designer + Figma | Weekly refresh (was monthly — wrong) |
| ASA Custom Product Pages | 15 CPPs × 12 locales = 180 variants | Internal | Build once, ship Wk 2 |

### Daily kill-switch caps (hard ceilings)

| Tier | Per channel daily cap | Auto-freeze |
| --- | --- | --- |
| T1 | $2,000 | CPI > $5 sustained 6h, or D7 retain < 12% sustained 24h |
| T2 | $1,000 | CPI > $2.50 sustained 6h |
| T3 | $500 | CPI > $1.20 sustained 6h, or refund > 8% |

### SKAdNetwork CV map

| CV bucket | Postback signal | Mapped event |
| --- | --- | --- |
| 0-31 | install only | install |
| 32-47 | onboarding step 5+ | onboarding\_progress |
| 48-55 | paywall\_view | paywall\_engaged |
| 56-61 | trial\_start | trial\_active (most valuable) |
| 62-63 | first\_paid | converted |

### Hard rules

- Weekly refresh, not monthly. Liftoff 2026 median = 3 days
- Exclude Meta Audience Network — D7 index 94 (worst), kills retention
- Mandatory Meta Advantage+ Creative; manual ad sets only for net-new concepts
- TikTok Spark via Creator Marketplace; ≥6 whitelisted creators per locale
- ASA CPPs bound to keyword clusters: "JEE" → JEE-aspirant CPP; "trivia" → casual-player CPP

### Designer / Creative

**Goal:** ship 7×3 mascot grid (CR1, $8k commission approved D3), 3 playable specs (CR2), 12 × 3-format locale scripts (CR3) by Wk 5-8.

### Mascot grid (cohort × pose × voice)

|  | Kids variant | Teen/Pro variant | Pro/Adult variant |
| --- | --- | --- | --- |
| Professor Sage | `professor_sage_kids` Pixar-soft, no glasses, brighter `#FDE047` accent, classroom backdrop | `professor_sage_teen` standard with glasses, lecturing pose | `professor_sage_pro` charcoal robe, slimmer silhouette, library backdrop |
| Rex | `rex_kid_friendly` toned-down attitude, kid-safe coloring | `rex_teen` skater stance, hype mode | `rex_pro` focused/competitive, gym-bro coded |
| Mystica | `mystica_kids` pastel palette, cute pose | `mystica_casual` current standard | `mystica_voice_agent` talking pose, lip-sync ready |

### Playable specs (each 5-15s, IAB MRAID compliant)

| ID | Hook | Mascot | Mechanic | CTA | Cohort |
| --- | --- | --- | --- | --- | --- |
| `playable_pop_quiz_5s` | "Beat Rex in 5 seconds!" | Rex | One question, 3 answers, timer | "Install for full battle" | JEE/competitive |
| `playable_voice_trivia_10s` | "Mystica asks — answer with your voice!" | Mystica | Voice-recognition trivia (uses gpt-realtime) | "Install to chat with Mystica" | Casual |
| `playable_diagnostic_15s` | "Find your weak topic in 15s" | Sage | 3-question micro-diagnostic | "Get your full plan" | Exam-prep |

### Color override permission within brand palette

- `#5B21B6` purple primary — always required
- `#BEF264` lime accent — substitutable in `ar` (cultural review) and `zh-Hans` (red preferred for luck)
- `#FDE047` yellow — used freely

### Hard rules

- No real-person likeness in mascot art — AI-generated only; reviewed by Compliance
- All locale variants reviewed by native speaker before ship
- Mascot voice direction documented per cohort (kid-friendly vs teen-hype vs pro-serious)
- No emoji in app UI (per workspace rule)

### DevOps / SRE Engineer

**Goal:** unify IAP namespaces, ship experiment service with feature flags + kill switches, lock inference cost ceilings, audit cohort leaks.

### Wk 1-4 critical path (blocks everything)

| Wk | Ship | Owner | Verification |
| --- | --- | --- | --- |
| 1 | RFC-IAP-UNIFY accepted; collapse `com.intelliverse.*` ↔ `com.intelliversex.*` | iOS + Android leads | RC entitlement parity check |
| 1-2 | `MonetizationEventRouter.cs` ships (replace reflective no-op) | Unity lead | LE1 fires server-side; OB1 readout uncontaminated |
| 2-3 | `nakama/data/modules/src/abtest/assignment.ts` GA, p99 ≤ 50ms | Backend lead | Loadtest 10k RPS at p99 ≤ 50ms |
| 3 | Feature-flag system wired (Statsig or LaunchDarkly) | SRE | Toggle-test each OB kill switch in staging |
| 4 | OB1 contamination audit; rerun OB1 from Wk 5 baseline | Data + SRE | Compare Wk1-4 (contaminated) vs Wk5+ (clean) RPI |

### Cost ceilings (`quizverse.yaml`)

```
inference:
  cost_cap_usd_per_user_per_day: 0.02
  voice_realtime_quota_min_per_session: 2  # 30s × 4 sessions max
  swarm_runtime: ollama_local
  realtime_provider: openai_gpt_realtime
  fallback_provider: elevenlabs_conv_ai

experiments:
  assignment_p99_ms: 50
  cache_ttl_s: 300
  fallback_variant: control
  killswitch_keys: [OB1, OB2, OB6, OB-LOC, OB8, OB10, OB11, OB12]

audit:
  storefront_vs_ip_alert_threshold_pct: 2.0
  cohort_leak_freeze_pct: 5.0
  refund_rate_alert_pct: 7.0
```

### Blast-radius matrix (every artifact requires canary)

| Artifact | Touches paying users? | Canary | Sign-off |
| --- | --- | --- | --- |
| Paywall variant | Yes | 5% → 25% → 100% over 7d | PM + SRE |
| Pricing change | Yes | 10% → 50% → 100% over 14d | PM + CFO + SRE |
| Onboarding step | Indirect | 25% → 100% over 3d | PM |
| Mascot asset swap | No | 100% direct | Designer |
| Council Audience template | No | 100% direct | Council Operator |

### Hard rules

- No deploy without kill switch — every OB toggleable in <10s
- Cost cap auto-degrade — at $0.02/day, voice features fall back to text
- Storefront-vs-IP audit RPC mandatory — >2% mismatch = freeze OB1/OB6
- No double-billing — RC webhook reconciliation runs nightly
- No prod data in dev — synthetic personas only

### Compliance / Legal

**Goal:** ship C1-C4 P0 blockers Wk 5-6; LQA-review the 12-locale paywall (C5).

### The 4 P0 blockers

| # | Issue | Fix | Files | Citation |
| --- | --- | --- | --- | --- |
| C1 | Under-13 cohort no VPC | Apple Ask-to-Buy (iOS) + KWS (Android + Web) wired before `AgeCohortStepV2` writes anything | `AgeCohortStepV2.cs`, `web/app/onboarding/v3/age/page.tsx`, KWS SDK init | [COPPA §312.5](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.5) · [KWS](https://www.kidswebservices.com/) · [TX SB2420](https://www.privacyworld.blog/2025/10/app-store-age-verification-laws-your-questions-answered/) |
| C2 | 3-second close-button delay | Visible × from t=0; T&Cs above CTA | `PaywallShellV2.tsx`, `LE1_PaywallView.cs` | Apple 3.1.1 · India CCPA Dark Patterns Annex I §3 |
| C3 | T3 lifetime as auto-renew offering (mis-classified) | Split `com.intelliverse.quizverse.lifetime_t3` NC; separate RC entitlement; Family Sharing ON; RBI 24-hr hook | RC dashboard, `revenuecat.ts`, App Store Connect | Apple 3.1.2(a) · RBI e-Mandate Aug 2024 / Feb 2026 |
| C4 | ATT + Art. 22 coupling | Decouple sign-in from paywall; Art. 22 disclosure modal locale-gated to EU/UK/CA | `OnboardingV3.tsx`, `PaywallV3.tsx`, GDPR notice library | Apple 5.1.1(v) · GDPR Art. 22 · EU AI Act Art. 50 |

### App Review pre-submission checklist

- No 3-second delays anywhere
- Restore Purchases button visible on every paywall
- Privacy Policy + T&Cs links on every paywall
- No misleading "free" claims (auto-renew clearly disclosed)
- Family Sharing toggled ON for T3 lifetime SKU
- Age Rating: 4+ if no UGC, 9+ if voice tutor enabled, 12+ if LiveArena chat
- ATT prompt fires AFTER paywall close (not before)
- Personalised headline disclosure visible in EU/UK/CA

### LQA / RTL gate (C5)

- All 12 locales rendered on LE1 + LE2 + LE3
- `ar` \+ `he` RTL layout reviewed (close button on LEFT, CTA flips)
- Native-speaker LQA review per locale (signed)
- Localized T&Cs per Apple 3.1.2(a)
- Currency formatting correct (₹1,499 vs $14.99 vs €14,99)
- Cultural review for `ar` (KSA, EG flag risk) + `zh-Hans` (Mainland sensitivities)

### Hard rules

- No PII before VPC. Even age band is PII when combined with persistent ID
- Cost-side IAPs only — never Apple IAP for non-digital goods
- Family Sharing on Non-Consumables only (T3 lifetime, NOT weekly subscription)
- Cross-platform pricing parity disclosed (Web vs iOS) per Apple 3.1.3(b)

### Voice / AI Engineer

**Goal:** ship W1 voice tutor moment, W5 push-as-content, W6 conversational onboarding by Wk 9-10. W2/W3/W4 follow Phase-2 Wk 13+.

### Stack (cited)

| Microservice | Use | Cost | Citation |
| --- | --- | --- | --- |
| **OpenAI gpt-realtime** | W1, W3, W6 — speech-to-speech, image input, function calling 66.5% | $32/$64 per 1M audio tokens; ~$0.10 per 30s | [OpenAI gpt-realtime GA Aug 2026](https://openai.com/index/introducing-gpt-realtime/) |
| **ElevenLabs ConvAI** | W1 (Mystica voice in 70 langs), W5 (push audio) | ~$0.005/push; ~$0.04 per 30s | [ElevenLabs ConvAI](https://elevenlabs.io/conversational-ai) — 10K voices, 70+ langs |
| **LiveKit Agents** | W2 — LiveArena AI voice host (Photon dual-room) | $0.40 per 60s | [LiveKit Agents](https://github.com/livekit/agents) — 10.7k stars, used by 10K+ voice agents |
| **Sora / Runway Gen-4** | W4 — personalised AI shorts | $0.30 per 60s | Phase-3 |

### W1 reference implementation (Unity)

```
// Onboarding/V2/Steps/VoiceTutorStepV2.cs
public class VoiceTutorStepV2 : OnboardingStepBase {
    private GptRealtimeSession _session;

    public async Task<bool> EnterAsync(OnboardingContext ctx) {
        // 1. Cost-cap (SRE rule)
        var costToday = await CostTracker.GetUserDailyAsync(ctx.UserId);
        if (costToday >= 0.02f) {
            ShowTextGreeting(ctx);  // auto-degrade to text
            return true;
        }

        // 2. Start gpt-realtime session
        _session = await GptRealtimeSession.CreateAsync(new SessionConfig {
            Voice = ctx.Locale == "hi" ? "marin" : "cedar",
            SystemPrompt = BuildSystemPrompt(ctx),  // diagnostic_score, target_exam, days_to_exam
            MaxTurnSeconds = 30,
            FunctionCalling = new[] { "open_paywall" }
        });

        // 3. Animate Mystica with lip sync
        MysticaAnimator.PlayLipSync(_session.AudioStream);

        // 4. Wait for end + log cost
        await _session.WaitForEndAsync();
        await CostTracker.AddAsync(ctx.UserId, _session.CostUsd);
        return true;
    }
}
```

### WAAO moment matrix

| Code | Moment | Cost/session | Phase | Gating |
| --- | --- | --- | --- | --- |
| W1 | 30-sec voice tutor before LE1 (Mystica reads diagnostic out loud) | $0.10 | Phase 2 | **FREE** (paywall accelerant per D4) |
| W2 | LiveArena AI voice host (narrates, calls names, banter) | $0.40 | Phase 2 | Plus only |
| W3 | Camera Solve (point camera at math, Mystica solves out loud) | $0.05 | Phase 2 | Plus only |
| W4 | Personalised AI shorts nightly (Sora/Runway) | $0.30 | Phase 3 | Plus only |
| W5 | Push-as-content (15s daily audio brain teaser) | $0.005 | Phase 2 | FREE (cheapest reach) |
| W6 | Conversational onboarding opt-in (90s vs 11 steps) | $0.30 | Phase 2 | FREE (opt-in, OB11 measures) |

### Hard rules

- Cost-cap enforced before session start — never start if user >$0.02/day
- Auto-degrade to text if voice fails or cap hit
- Content moderated — Anthropic content classifier on transcript before TTS plays
- No voice over cellular without opt-in (T2/T3 bandwidth)
- Voice features disabled for under-13 (per Compliance C1 + COPPA voice rules)
- Always provide "I prefer text" toggle (accessibility + AADC)

### Council Operator

**Goal:** run Audience Swarm pre-gate on every artifact, then 4-model jury review, ship next monthly amendments doc.

### Cadence

| Frequency | Activity | Output |
| --- | --- | --- |
| Per artifact | Audience Swarm (280 personas, ~5 min, Ollama local) | `out/<run_id>/audience/{verdict.json, verbatim.md}` |
| Weekly | Tactical council on creative + UA changes | Weekly creative + ad-spec amendments |
| Monthly | Full strategic council on Plan vN | New `PLAN-…vN.1_AMENDMENTS.md` |
| Quarterly | Audience template recalibration | Re-fit personas against last quarter's actual A/B outcomes |

### Running the Audience Swarm (Ollama local, free)

```
cd content-factory

python -m pipelines.runner growth/audience_swarm \
  --artifact ../Quizverse-web-frontend/docs/strategy/PLAN-QV_GROWTH_PLAN_2026_v1.1_AMENDMENTS.md \
  --config configs/apps/quizverse.yaml \
  --personas 280 --sim-hours 24 --runtime ollama_local

# Output:
#   out/qv-growth/<run_id>/audience/
#     ├── sentiment.json    — by archetype × cohort × locale
#     ├── verbatim.md       — worst-25% personas verbatim
#     └── verdict.json      — PASS / PASS_WITH_NOTES / REDO
```

### Running the 4-model jury (cloud, ~$2/run)

```
python -m pipelines.runner growth/app_growth_council \
  --config configs/apps/quizverse.yaml \
  --month 2026-06 \
  --council-mode strategic \
  --audience-pre-gate true   # runs swarm first; only proceeds if PASS
```

### The 7 audience archetypes (~40 each)

| # | Archetype | Catches what? |
| --- | --- | --- |
| 1 | Determined Learner (T3, age 16-19) | Cannibalization, value-before-paywall |
| 2 | Curious Casual (any tier) | Framing test ("homework app" vs "quiz game") |
| 3 | Skeptical Parent (35-50) | Kid-mode framing, COPPA tone, ad policy |
| 4 | **App Store Reviewer (US-based, Apple-fluent)** | Apple Review reject reasons (single most valuable persona) |
| 5 | Reddit Poster (r/iosapps, r/JEE) | Viral negative narratives |
| 6 | Performance Marketer | "Won't pass Meta review", TikTok throttle, ASA mismatch |
| 7 | VPN Power User | Storefront vs IP arbitrage (cohort leak) |

### Hard rules

- Audience pre-gate ALWAYS first — no expert spend on doomed artifacts
- Verbatim quotes are NOT training data — stay in `out/<run_id>/`, gitignored
- Personas labeled "synthetic" in council reports — never confused with real A/B data
- Real OB outcomes win when contradicted — update persona templates next quarter, not retroactively
- Cloud-mode cost cap $5/run (set in `quizverse.yaml`)

## Paywall master matrix (12 locales × 3 tiers, weekly anchor)

| Tier | Locales | Weekly (default) | Annual (toggle) | Lifetime (NC) | Trial | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | en-US, en-GB, en-CA, en-AU, ja, ko | **$4.99/wk** | $49.99/yr (Save 81%) | — | 3-day free | Voice tutor moment before LE1 |
| T1 EU | fr, de | **€5.99/wk** | €69.99/yr | — | 3-day free | EU charges 39% above NA per SOSA 2026 |
| T2 | pt-BR, es-MX, id, ar (T2) | **$2.99/wk** | $24.99/yr | — | 3-day free | Locale-native creative per CR5 |
| T3 | hi, en-IN, id (T3 segments) | **₹99/wk** | — | **₹2,499 NC** | None on weekly; 7-day on lifetime preview | Annual dropped per D2; Family Sharing ON for lifetime |

## Onboarding v3 with all WAAO moments mapped

01. **Welcome** — Mystica greets; ConvOnboarding opt-in toggle (W6, OB11)
02. **AgeCohort** — VPC-gated for under-13 (KWS / Ask-to-Buy per C1)
03. **LocaleConfirm** — auto-detected, manually adjustable
04. **ExamPicker** — auto-skip for casual cohort (per workspace fact)
05. **DiagnosticIntro** — Sage explains
06. **Diagnostic** — 5-7 quick questions
07. **PlanReveal** — personalised plan card
08. **VoiceTutorMoment (W1, NEW)** — 30-sec gpt-realtime + EL Mystica reads diagnostic out loud (FREE per D4)
09. **LE1 Paywall** — Superwall variant per OB1/OB10/OB-LOC; close button visible from t=0
10. **SignInPrompt** — skippable, post-paywall (per C4)
11. **TomorrowPreview** — push opt-in for W5 daily 15s audio brain teaser

## Quick links — every artifact in this stack

| Artifact | Path | What's in it |
| --- | --- | --- |
| **Master Runbook (this hub)** | `docs/strategy/MASTER_RUNBOOK_v1.1.md` | Single source of truth, role-based, all 5 decisions, all integrations |
| Strategy v1.0 (codebase comparison) | `docs/strategy/PLAN-QV_GROWTH_PLAN_2026.md` | 11-step onboarding, paywall placements, OB1-OB9, ad plan |
| v1.1 Amendments (REDOs) | `docs/strategy/PLAN-QV_GROWTH_PLAN_2026_v1.1_AMENDMENTS.md` | 22 critiques + cited fixes; ship blockers |
| Council Review log | `docs/strategy/COUNCIL_REVIEW_2026-05-27.md` | 6 reviewer scores, sign-off table, audience counterfactual |
| WAAO Microservice Roadmap | `docs/strategy/WAAO_MICROSERVICE_ROADMAP.md` | W1-W6 with cost models, integration diagrams |
| Agent Fleet Audience spec | `content-factory/docs/AGENT_FLEET_AUDIENCE.md` | MiroFish-style 280-persona swarm |
| Universal app pipeline config | `content-factory/configs/apps/quizverse.yaml` | Drives council for any IVX app |
| Agent Council pipeline spec | `content-factory/docs/AGENT_GROWTH_COUNCIL.md` | Pipeline class, 6 gates, hard rules |
| Visual: dev handoff (interactive) | `web/public/quiz-verse/dev-handoff/index-v3.html` | 22 critiques + cited fixes (full) |
| **Visual: master hub (you are here)** | `web/public/quiz-verse/dev-handoff/index-v4.html` | Role-based interactive runbook |
| Visual: paywall mockup v3 | `web/public/quiz-verse/ux-mockups/ab-test-paywall-v3.html` | T1+T2+T3 weekly anchor with W1 voice tutor |
| Index | `docs/strategy/QV_GROWTH_PLAN_2026_INDEX.md` | Master bookmark |