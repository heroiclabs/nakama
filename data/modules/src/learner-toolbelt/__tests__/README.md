# learner-toolbelt — smoke checks

Quick offline verification of the Wave 4-5 algorithms (no Nakama runtime needed).
Run from `data/modules/`:

```bash
node -e '
var fs = require("fs"), vm = require("vm");
var src = fs.readFileSync("build/index.js","utf8");
var sandbox = { Date, Math, Object, JSON, Array, parseInt, parseFloat, isNaN, Infinity, RegExp, console };
vm.createContext(sandbox);
src = src.replace(/function InitModule\([\s\S]*?^}/m, "function InitModule(){}");
vm.runInContext(src, sandbox);
var lt = sandbox.LearnerToolbelt;

// 1. GPA — spec acceptance: A + B+ @ 3.0 credits each → 3.65
console.log("gpa(A,B+):", lt.computeGpa("us-4.0-unweighted",
  [{grade:"A",credits:3.0},{grade:"B+",credits:3.0}]).native_gpa);
// expected: 3.65

// 2. School search — DPS RKP acronym path
console.log("school(DPS RKP):", lt.searchSchools("DPS RKP","IN",1)[0].display_name);
// expected: Delhi Public School, R.K. Puram

// 3. Calendar — US 2026 entry count
console.log("calendar(US,2026) count:", lt.getCalendarEntries("US",2026).length);
// expected: 8 (4 SAT + 3 ACT + 1 AP)

// 4. Predictor — 10 quizzes @ 70% on SAT track
var hist = []; for (var i=0;i<10;i++) hist.push({timestamp:Math.floor(Date.now()/1000)-i*86400,correctAnswers:7,totalQuestions:10,category:"sat"});
var p = lt.predictFromHistory({exam_id:"sat",locale:"en",recent_quiz_window_days:60}, hist, Math.floor(Date.now()/1000));
console.log("predict(SAT 70%):", p.predicted.scaled_score, "tier=" + p.predictor_tier);
// expected: ~1235, tier=l0_diagnostic
'
```

Live smoke (against deployed Nakama, anonymous-OK RPCs):

```bash
# GPA spec test
curl -sX POST 'https://nakama-rest.intelli-verse-x.ai/v2/rpc/lt_gpa_compute?http_key=defaulthttpkey&unwrap' \
  -H 'Content-Type: application/json' \
  -d '{"system":"us-4.0-unweighted","courses":[{"grade":"A","credits":3.0},{"grade":"B+","credits":3.0}]}'
# Expected: { ok:true, status:"ok", native_gpa:3.65, wes_4_0:3.65, ... }

# School search
curl -sX POST 'https://nakama-rest.intelli-verse-x.ai/v2/rpc/lt_school_search?http_key=defaulthttpkey&unwrap' \
  -H 'Content-Type: application/json' \
  -d '{"query":"DPS RKP","country_code":"IN","limit":3}'

# Exam calendar
curl -sX POST 'https://nakama-rest.intelli-verse-x.ai/v2/rpc/lt_exam_calendar_get?http_key=defaulthttpkey&unwrap' \
  -H 'Content-Type: application/json' \
  -d '{"country":"US","year":2026}'
```

Service-only RPCs (predictor / countdown / school set/get) require either a
Nakama session token OR `service_token` + `user_id` in the payload matching
`LT_SERVICE_TOKEN` (env var, mirrored across the AI gateway).
