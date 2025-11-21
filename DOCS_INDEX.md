# Nakama Server - Documentation Index

**Last Updated:** November 19, 2025  
**Status:** Consolidated & Production Ready

---

## 📚 Active Documentation (Read These)

### Core Server Documentation

| File | Purpose | Audience | Status |
|------|---------|----------|--------|
| **README.md** | Project overview, quick start, deployment | All contributors | ✅ Active |
| **NAKAMA_COMPLETE_DOCUMENTATION.md** | Master documentation index for all Nakama features | All developers | ✅ Active |
| **GAME_ONBOARDING_GUIDE.md** | How to add new games to the platform | Game integrators, backend devs | ✅ Active |
| **UNITY_DEVELOPER_COMPLETE_GUIDE.md** | Complete Unity integration guide (3360 lines) | Unity developers | ✅ Active |

### Feature-Specific Documentation

Located in `docs/`:

| File | Purpose | Audience | Status |
|------|---------|----------|--------|
| **COMPLETE_RPC_REFERENCE.md** | All 123+ RPC endpoints with examples | Backend developers | ✅ Active |
| **RPC_DOCUMENTATION.md** | RPC implementation patterns | Backend developers | ✅ Active |
| **DOCUMENTATION_SUMMARY.md** | Documentation organization overview | All contributors | ✅ Active |
| **identity.md** | Identity system and AWS Cognito integration | Backend developers | ✅ Active |
| **wallets.md** | Wallet system implementation details | Backend developers | ✅ Active |
| **leaderboards.md** | Leaderboard system implementation | Backend developers | ✅ Active |
| **unity/Unity-Quick-Start.md** | Unity quick start guide | Unity developers | ✅ Active |
| **api/README.md** | API structure overview | API consumers | ✅ Active |
| **sample-game/README.md** | Sample game integration example | Game developers | ✅ Active |

---

## 📦 Archived Documentation (Reference Only)

### Located in `_archived_docs/`

#### Unity Integration Archives
Located in `_archived_docs/unity_guides/`:
- **UNITY_DEVELOPER_QUICK_REFERENCE.md** - Old quick reference (now in UNITY_DEVELOPER_COMPLETE_GUIDE.md)
- **UNITY_GEOLOCATION_GUIDE.md** - Geolocation guide (now in NAKAMA_COMPLETE_DOCUMENTATION.md)

#### SDK Integration Archives
Located in `_archived_docs/sdk_guides/`:
- **INTELLIVERSEX_SDK_COMPLETE_GUIDE.md** - Old SDK guide (1291 lines, superseded by UNITY_DEVELOPER_COMPLETE_GUIDE.md)
- **INTELLIVERSEX_SDK_QUICK_REFERENCE.md** - Quick reference (consolidated)
- **NAKAMA_SDK_INTEGRATION_COMPLETE_ANALYSIS.md** - Integration analysis (historical)

#### Geolocation Implementation Archives
Located in `_archived_docs/geolocation_guides/`:
- **GEOLOCATION_QUICKSTART.md** - Quick start (now in NAKAMA_COMPLETE_DOCUMENTATION.md)
- **GEOLOCATION_RPC_REFERENCE.md** - RPC reference (now in COMPLETE_RPC_REFERENCE.md)
- **GEOLOCATION_IMPLEMENTATION_SUMMARY.md** - Implementation summary (historical)

#### ESM Migration Archives
Located in `_archived_docs/esm_guides/`:
- **ESM_MIGRATION_COMPLETE_GUIDE.md** - JavaScript ESM migration guide
- **NAKAMA_JAVASCRIPT_ESM_GUIDE.md** - ESM best practices
- **NAKAMA_TYPESCRIPT_ESM_BUILD.md** - TypeScript build guide
- **NAKAMA_DOCKER_ESM_DEPLOYMENT.md** - Docker deployment with ESM

#### Game Integration Archives
Located in `_archived_docs/game_guides/`:
- **SAMPLE_GAME_COMPLETE_INTEGRATION.md** - Sample integration (now in sample-game/README.md)
- **GAME_RPC_QUICK_REFERENCE.md** - RPC quick ref (consolidated into COMPLETE_RPC_REFERENCE.md)
- **MULTI_GAME_RPC_GUIDE.md** - Multi-game patterns (now in GAME_ONBOARDING_GUIDE.md)
- **WALLET_AND_GAME_REGISTRY.md** - Wallet registry (now in wallets.md)
- **GAME_ONBOARDING_COMPLETE_GUIDE.md** - Old onboarding guide (superseded)
- **integration-checklist.md** - Integration checklist (now in GAME_ONBOARDING_GUIDE.md)

#### Implementation History
Located in `_archived_docs/implementation_history/`:
- **IMPLEMENTATION_COMPLETE.md** - Implementation summary
- **IMPLEMENTATION_COMPLETE_MULTIGAME.md** - Multi-game implementation
- **IMPLEMENTATION_COMPLETE_SUMMARY.md** - Final implementation summary
- **IMPLEMENTATION_SUMMARY.md** - Historical summary
- **IMPLEMENTATION_VERIFICATION.md** - Verification docs
- **INTELLIVERSEX_SDK_IMPLEMENTATION_FINAL.md** - SDK implementation final
- **GAMEID_STANDARDIZATION_SUMMARY.md** - gameId standardization
- **REQUIREMENTS_VERIFICATION.md** - Requirements verification
- **SOLUTION_SUMMARY.md** - Solution summary
- **CODEX_IMPLEMENTATION_PROMPT.md** - Codex prompts (archived)
- **IMPLEMENTATION_MASTER_TEMPLATE.md** - Template (archived)
- **QUICK_START_IMPLEMENTATION.md** - Quick start (archived)

#### Feature Fixes & Bug Reports
Located in `_archived_docs/feature_fixes/`:
- **API_ENDPOINT_CORRECTIONS.md** - API corrections
- **CHAT_AND_STORAGE_FIX_DOCUMENTATION.md** - Chat/storage fixes
- **LEADERBOARD_FIX_DOCUMENTATION.md** - Leaderboard fixes
- **LEADERBOARD_BUG_FIX.md** - Bug fix documentation
- **SERVER_GAPS_ANALYSIS.md** - Server gaps analysis
- **SERVER_GAPS_CLEARED.md** - Gaps resolution
- **MISSING_RPCS_STATUS.md** - Missing RPCs tracking

---

## 🎯 Which Document to Read?

### I want to...

**Get started with Nakama:**
→ Read `README.md` → `NAKAMA_COMPLETE_DOCUMENTATION.md`

**Integrate a new game:**
→ Read `GAME_ONBOARDING_GUIDE.md`

**Develop Unity integration:**
→ Read `UNITY_DEVELOPER_COMPLETE_GUIDE.md`

**Find RPC endpoints:**
→ Read `docs/COMPLETE_RPC_REFERENCE.md`

**Understand wallet system:**
→ Read `docs/wallets.md`

**Understand leaderboards:**
→ Read `docs/leaderboards.md`

**Understand identity/auth:**
→ Read `docs/identity.md`

**Deploy Nakama server:**
→ Read `README.md` (Deployment section)

**Understand project history:**
→ Browse `_archived_docs/` folders

---

## 📝 Documentation Maintenance

### Active Docs (Keep Updated)
- README.md
- NAKAMA_COMPLETE_DOCUMENTATION.md
- GAME_ONBOARDING_GUIDE.md
- UNITY_DEVELOPER_COMPLETE_GUIDE.md
- docs/COMPLETE_RPC_REFERENCE.md
- docs/RPC_DOCUMENTATION.md
- docs/identity.md
- docs/wallets.md
- docs/leaderboards.md

### Archive Policy
1. **Implementation summaries** → archive after feature is stable
2. **Bug fix docs** → archive after fix is deployed and verified
3. **Migration guides** → archive 3 months after migration complete
4. **Feature gap docs** → archive after gaps are filled
5. **Quick references** → archive if consolidated into complete guides

### When to Archive
- Content is superseded by newer documentation
- Feature is fully implemented and stable for 30+ days
- Document serves only as historical reference
- Content has been merged into comprehensive guide

### When to Delete
⚠️ **NEVER delete without team approval**
- Keep archives indefinitely for audit trail
- Only delete true duplicates after 6+ months
- Get approval from 2+ team members before deletion

---

## 🔄 Recent Changes

### November 19, 2025 - Major Consolidation
- ✅ Archived 15 redundant documentation files
- ✅ Created organized archive structure (6 folders)
- ✅ Reduced active root-level docs from 21 → 4
- ✅ Kept docs/ folder focused (11 active files)
- ✅ All content preserved in `_archived_docs/`

**Archived Files:**
- Unity guides (2 files) → `_archived_docs/unity_guides/`
- SDK guides (3 files) → `_archived_docs/sdk_guides/`
- Geolocation guides (3 files) → `_archived_docs/geolocation_guides/`
- ESM guides (4 files) → `_archived_docs/esm_guides/`
- Game guides (6 files) → `_archived_docs/game_guides/`
- Implementation history (11 files) → `_archived_docs/implementation_history/`
- Feature fixes (7 files) → `_archived_docs/feature_fixes/`

### Previous Consolidation (November 18-19, 2025)
- Created NAKAMA_COMPLETE_DOCUMENTATION.md as master index
- Consolidated implementation histories
- Organized feature fix documentation

---

## 📂 Directory Structure

```
nakama/
├── README.md ✅
├── NAKAMA_COMPLETE_DOCUMENTATION.md ✅
├── GAME_ONBOARDING_GUIDE.md ✅
├── UNITY_DEVELOPER_COMPLETE_GUIDE.md ✅
├── docs/
│   ├── COMPLETE_RPC_REFERENCE.md ✅
│   ├── RPC_DOCUMENTATION.md ✅
│   ├── DOCUMENTATION_SUMMARY.md ✅
│   ├── identity.md ✅
│   ├── wallets.md ✅
│   ├── leaderboards.md ✅
│   ├── unity/
│   │   └── Unity-Quick-Start.md ✅
│   ├── api/
│   │   └── README.md ✅
│   └── sample-game/
│       └── README.md ✅
├── _archived_docs/
│   ├── unity_guides/ (2 files)
│   ├── sdk_guides/ (3 files)
│   ├── geolocation_guides/ (3 files)
│   ├── esm_guides/ (4 files)
│   ├── game_guides/ (6 files)
│   ├── implementation_history/ (11 files)
│   └── feature_fixes/ (7 files)
├── data/
│   └── modules/
│       └── index.js (10,383 lines - main server code)
└── examples/
    ├── esm-modules/
    └── typescript-esm/
```

---

## 🎓 Learning Path

### For New Developers
1. **Start:** README.md
2. **Understand:** NAKAMA_COMPLETE_DOCUMENTATION.md
3. **Integrate:** GAME_ONBOARDING_GUIDE.md
4. **Implement:** UNITY_DEVELOPER_COMPLETE_GUIDE.md
5. **Reference:** docs/COMPLETE_RPC_REFERENCE.md

### For Game Integrators
1. **Start:** GAME_ONBOARDING_GUIDE.md
2. **Unity:** UNITY_DEVELOPER_COMPLETE_GUIDE.md
3. **RPCs:** docs/COMPLETE_RPC_REFERENCE.md
4. **Examples:** docs/sample-game/README.md

### For Backend Contributors
1. **Start:** README.md
2. **Architecture:** NAKAMA_COMPLETE_DOCUMENTATION.md
3. **RPCs:** docs/RPC_DOCUMENTATION.md
4. **Systems:** docs/identity.md, docs/wallets.md, docs/leaderboards.md

---

## 📞 Questions?

- **Server Setup:** See README.md
- **Game Integration:** See GAME_ONBOARDING_GUIDE.md
- **Unity Development:** See UNITY_DEVELOPER_COMPLETE_GUIDE.md
- **RPC Reference:** See docs/COMPLETE_RPC_REFERENCE.md
- **Feature-Specific:** See docs/{feature}.md
- **Historical Context:** Browse _archived_docs/
