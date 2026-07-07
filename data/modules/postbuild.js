#!/usr/bin/env node
/**
 * postbuild.js v2 — Nakama Goja Runtime Compatibility Transform
 *
 * Nakama's AST walker (getRegisteredFnIdentifier in runtime_javascript_init.go)
 * ONLY finds registerRpc calls that are DIRECT statements inside InitModule's
 * body (or inside try/catch blocks within it). It does NOT follow calls to
 * helper functions like HiroEconomy.register(initializer).
 *
 * Strategy:
 *  1. Scan build/index.js AND legacy_runtime.js for all registerRpc calls
 *  2. Replace each registerRpc("id", handler) with __rpc_<id> = handler
 *     (build = unconditional, legacy = guarded to preserve TS precedence)
 *  3. Rename original InitModule → __OriginalInitModule
 *  4. Create a NEW InitModule wrapper with DIRECT registerRpc calls in its body
 *  5. Merge everything into a single index.js
 */

const fs = require('fs');
const path = require('path');

const BUILD_FILE  = path.join(__dirname, 'build', 'index.js');
const LEGACY_FILE = path.join(__dirname, 'legacy_runtime.js');
const OUTPUT_FILE = path.join(__dirname, 'index.js');
const MODULES_DIR = __dirname;
const VIDEO_CATALOG_FILE = path.join(__dirname, 'build', 'video_quiz_catalog.json');

const EXCLUDE_FILES = new Set([
  'index.js', 'postbuild.js', 'legacy_runtime.js',
  'package.json', 'package-lock.json', 'tsconfig.json'
]);
const EXCLUDE_DIRS = new Set(['node_modules', 'build', '.git', 'src']);

function isNakamaCompatible(content, relPath) {
  if (content.trimStart().startsWith('#!')) {
    console.log('[postbuild]   SKIP (shebang): ' + relPath);
    return false;
  }

  var nodeBuiltins = /\brequire\s*\(\s*['"](?:http|https|fs|path|os|child_process|crypto|net|url|stream|events|util|assert|cluster|dgram|dns|readline|tls|vm|zlib)['"]\s*\)/;
  if (nodeBuiltins.test(content)) {
    console.log('[postbuild]   SKIP (Node.js require): ' + relPath);
    return false;
  }

  if (/PASTE\s+THIS\s+CODE/i.test(content) || /REGISTRATION_CODE/i.test(path.basename(relPath))) {
    console.log('[postbuild]   SKIP (template/snippet): ' + relPath);
    return false;
  }

  var basename = path.basename(relPath);
  if (/^test_/i.test(basename)) {
    console.log('[postbuild]   SKIP (test file): ' + relPath);
    return false;
  }

  return true;
}

function stripNodePatterns(content) {
  content = content.replace(/\bprocess\.env\.(\w+)/g, '(typeof process!=="undefined"&&process.env?process.env.$1:undefined)');

  content = content.replace(/if\s*\(\s*typeof\s+module\s*!==?\s*['"]undefined['"]\s*(?:&&[^)]*)\)\s*\{[^}]*module\.exports[^}]*\}/g,
    '/* module.exports guard stripped by postbuild */');

  return content;
}

if (!fs.existsSync(BUILD_FILE)) {
  console.error('[postbuild] ERROR: build/index.js not found. Run tsc first.');
  process.exit(1);
}

let buildContent = fs.readFileSync(BUILD_FILE, 'utf8');

let legacyContent = '';
if (fs.existsSync(LEGACY_FILE)) {
  legacyContent = fs.readFileSync(LEGACY_FILE, 'utf8');
  console.log('[postbuild] Loaded legacy_runtime.js (' + legacyContent.length + ' bytes)');
} else {
  console.log('[postbuild] No legacy_runtime.js found — skipping merge');
}

// ── 0.2. Discover and load separate module files ─────────────────
//
// Many RPC handler implementations live in subdirectory modules like
// achievements/achievements.js, tournaments/tournaments.js, etc.
// These define `var rpcXxx = function(...){}` at the top level.
// We merge them BEFORE legacy_runtime so the handler variables are
// available when legacy's guarded stub assignments execute.

function discoverModuleFiles(dir, baseDir) {
  var files = [];
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return files; }
  // Sort entries alphabetically so module merge order is DETERMINISTIC across
  // platforms. macOS (APFS) returns readdir entries already sorted, but Linux
  // (ext4/overlayfs in CI) returns them in arbitrary hash order — which can
  // change the namespace eval order and break the goja JS runtime
  // ("Cannot read property 'Events' of undefined"). Sorting pins the order to
  // the alphabetical sequence that is verified to load cleanly.
  entries.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) {
        files = files.concat(discoverModuleFiles(fullPath, baseDir));
      }
    } else if (entry.isFile() && entry.name.endsWith('.js') && !EXCLUDE_FILES.has(entry.name)) {
      files.push({ path: fullPath, rel: path.relative(baseDir, fullPath) });
    }
  }
  return files;
}

var moduleFiles = discoverModuleFiles(MODULES_DIR, MODULES_DIR);
var modulesContent = '';
var moduleCount = 0;
// Modules whose own InitModule was renamed to __ModuleInit_<n>. Each of these
// MUST be invoked from the generated InitModule wrapper (section 5c) — RPC
// registration survives without them (stub scan handles that), but one-time
// side effects (storage seeding, leaderboard creation, alias handler setup)
// only exist inside these bodies. Root cause of the "badge system dead in
// production" outage: seedBadgesOnStartup() lived in badges/badges.js's
// InitModule, which was renamed but never called, so definitions_quizverse
// was never written and every badge RPC silently no-opped.
var moduleInits = [];

for (var mi = 0; mi < moduleFiles.length; mi++) {
  var mf = moduleFiles[mi];
  var mc = fs.readFileSync(mf.path, 'utf8');

  if (!isNakamaCompatible(mc, mf.rel)) continue;

  mc = mc.replace(/^"use strict";\r?\n?/, '');
  var hadInitModule = /function\s+InitModule\s*\(/.test(mc);
  mc = mc.replace(/function\s+InitModule\s*\(/g, 'function __ModuleInit_' + moduleCount + '(');
  if (hadInitModule) {
    moduleInits.push({ fn: '__ModuleInit_' + moduleCount, rel: mf.rel.replace(/\\/g, '/') });
  }
  mc = stripNodePatterns(mc);

  modulesContent += '\n// --- Module: ' + mf.rel + ' ---\n';
  modulesContent += mc;
  modulesContent += '\n';
  moduleCount++;
}
console.log('[postbuild] Loaded ' + moduleCount + ' separate module files (' + modulesContent.length + ' bytes), ' + moduleInits.length + ' with their own InitModule');
moduleFiles.forEach(function(mf) { console.log('[postbuild]   -> ' + mf.rel); });

// ── 0.4. Resolve top-level function-name collisions ──────────────
//
// JavaScript hoists function declarations to the top of the enclosing
// scope. In our concatenated index.js, both modulesContent (e.g.
// analytics/analytics.js) and legacyContent (legacy_runtime.js) have
// historically declared the SAME top-level functions — most notably
// rpcAnalyticsLogEvent. Whichever script appears LATER wins via hoisting
// (legacy wins in our current order), regardless of which copy contains
// the modern, dimensional-aware implementation. The guarded stub
// assignments don't help because the bare identifier `rpcAnalyticsLogEvent`
// resolves to the hoisted (legacy) definition by the time the right-hand
// side of the assignment is evaluated.
//
// Symptom in production: analytics_log_event stored events with `evt_`
// keys under SYSTEM_USER without gameId / dimensions, so every breakdown
// RPC returned total_events=0 with "unknown" dimensions.
//
// Fix: rename every top-level function declaration in legacyContent that
// also exists in modulesContent. The modules version keeps the original
// name (and wins at global scope); the legacy copy becomes
// `__legacy_<name>` and remains internally consistent because we rewrite
// every \b<name>\b occurrence inside legacyContent (declarations + call
// sites + registerRpc handler args).
function findTopLevelFunctionNames(content) {
  var names = new Set();
  // Anchor at column 0 to catch only true top-level declarations
  // (functions inside IIFEs / namespaces start indented after Babel/TS
  // transpiles, so they don't pollute the global scope and don't need
  // renaming).
  var re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  var m;
  while ((m = re.exec(content)) !== null) {
    names.add(m[1]);
  }
  return names;
}

if (modulesContent && legacyContent) {
  var moduleFns = findTopLevelFunctionNames(modulesContent);
  var legacyFns = findTopLevelFunctionNames(legacyContent);
  var collisions = [];
  legacyFns.forEach(function(name) {
    if (moduleFns.has(name)) collisions.push(name);
  });
  if (collisions.length > 0) {
    console.log('[postbuild] Detected ' + collisions.length +
      ' top-level function-name collision(s) between modules and legacy:');
    for (var ci = 0; ci < collisions.length; ci++) {
      var collName = collisions[ci];
      var newName = '__legacy_' + collName;
      var pattern = new RegExp('\\b' + collName + '\\b', 'g');
      var before = legacyContent.length;
      legacyContent = legacyContent.replace(pattern, newName);
      console.log('[postbuild]   renamed in legacy: ' + collName +
        ' -> ' + newName + ' (legacy size delta: ' +
        (legacyContent.length - before) + ' bytes)');
    }
  } else {
    console.log('[postbuild] No top-level function name collisions detected between modules and legacy');
  }
}

// ── 0.4b. Resolve var-EXPRESSION handler collisions (QVBF_216) ────
//
// The resolver above only sees `function NAME(){}` declarations. Handlers
// declared as `var NAME = function(...)` are INVISIBLE to it. Because legacy
// merges AFTER the module folders, a legacy `var NAME = ...` assignment runs
// later and silently overwrites the modern module copy at global scope — this
// is exactly what broke the Fortune Wheel (legacy V1 fortuneWheelGetState /
// fortuneWheelSpin clobbered the V2 handlers, so organicSpinDone was never set
// and ad-spins / get_state returned the stale V1 shape).
//
// Fix: rename ONLY the legacy *definition* to `__legacy_<name>` so the modern
// module's `var NAME` is the sole global. We intentionally do NOT rewrite
// legacy call/registration sites: a leftover `registerRpc('id', NAME)` in
// legacy then binds the MODERN global, which is correct whether the module
// self-registers (modules-first stub ordering wins anyway) or relies on the
// legacy registration (the Fortune Wheel anti-pattern). This mirrors the manual
// fix applied to legacy_runtime.js and prevents the whole class from recurring.
//
// NOTE: only var∩var collisions are handled here. "Mixed" cases (a name that is
// a function-declaration in one file and a var-expression in the other) are NOT
// auto-resolved — auto-renaming those would risk destabilizing core
// quizverse_*/lasttolive_* RPCs. They are reported as a WARN for manual review.
function findTopLevelVarFunctionNames(content) {
  var names = new Set();
  var re = /^(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*function\b/gm;
  var m;
  while ((m = re.exec(content)) !== null) names.add(m[1]);
  return names;
}

if (modulesContent && legacyContent) {
  var moduleVarFns = findTopLevelVarFunctionNames(modulesContent);
  var legacyVarFns = findTopLevelVarFunctionNames(legacyContent);
  var moduleFnDecls = findTopLevelFunctionNames(modulesContent);
  var legacyFnDecls = findTopLevelFunctionNames(legacyContent);

  var varCollisions = [];
  legacyVarFns.forEach(function (name) {
    if (moduleVarFns.has(name)) varCollisions.push(name);
  });

  if (varCollisions.length > 0) {
    console.log('[postbuild] Detected ' + varCollisions.length +
      ' var-expression handler collision(s) — renaming the LEGACY definition so the module copy wins:');
    for (var vci = 0; vci < varCollisions.length; vci++) {
      var vName = varCollisions[vci];
      var defRe = new RegExp('^((?:var|let|const)\\s+)' + vName + '(\\s*=\\s*function\\b)', 'm');
      if (defRe.test(legacyContent)) {
        legacyContent = legacyContent.replace(defRe, '$1__legacy_' + vName + '$2');
        console.log('[postbuild]   renamed legacy definition: ' + vName + ' -> __legacy_' + vName +
          ' (registration/call sites left bound to the modern global)');
      } else {
        console.log('[postbuild]   WARN: var-collision "' + vName +
          '" detected but legacy definition not locatable — left untouched');
      }
    }
  } else {
    console.log('[postbuild] No var-expression handler collisions detected between modules and legacy');
  }

  // Report (do NOT auto-fix) mixed-shape collisions so they stay on the radar.
  var mixedSet = {};
  legacyVarFns.forEach(function (n) { if (moduleFnDecls.has(n)) mixedSet[n] = true; });
  moduleVarFns.forEach(function (n) { if (legacyFnDecls.has(n)) mixedSet[n] = true; });
  var mixed = Object.keys(mixedSet).sort();
  if (mixed.length > 0) {
    console.log('[postbuild] WARN: ' + mixed.length + ' mixed-shape name collision(s) (function-decl vs var-expression) ' +
      'NOT auto-resolved — review if any of these RPCs misbehave: ' + mixed.join(', '));
  }
}

buildContent = buildContent.replace(/^"use strict";\r?\n?/, '');

// ── 0.5. Expand dynamic RPC registrations ────────────────────────
//
// registerGameRpcs(initializer, prefix, gameId) uses dynamic RPC IDs:
//   initializer.registerRpc(prefix + "suffix", gameRpcHandler(gameId, fn))
// The string-literal regex can't match those. We inline-expand each call
// site so every dynamic RPC becomes a concrete __rpc_ stub assignment.

function expandDynamicRpcs(content) {
  var funcRe = /function\s+registerGameRpcs\s*\(\s*initializer\s*,\s*prefix\s*,\s*gameId\s*\)\s*\{/;
  var funcMatch = content.match(funcRe);
  if (!funcMatch) {
    console.log('[postbuild] No registerGameRpcs found — skipping dynamic expansion');
    return { content: content, rpcs: [] };
  }

  var bodyStart = content.indexOf('{', funcMatch.index);
  var depth = 0, bodyEnd = -1;
  for (var i = bodyStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') { depth--; if (depth === 0) { bodyEnd = i; break; } }
  }
  if (bodyEnd === -1) return { content: content, rpcs: [] };

  var funcBody = content.substring(bodyStart + 1, bodyEnd);

  var dynRe = /initializer\.registerRpc\(\s*prefix\s*\+\s*["']([^"']+)["']\s*,\s*gameRpcHandler\(\s*gameId\s*,\s*(\w+)\s*\)\s*\)/g;
  var suffixes = [], dm;
  while ((dm = dynRe.exec(funcBody)) !== null) {
    suffixes.push({ suffix: dm[1], handlerFn: dm[2] });
  }
  console.log('[postbuild] Extracted ' + suffixes.length + ' dynamic RPC suffixes from registerGameRpcs');

  var callRe = /registerGameRpcs\s*\(\s*initializer\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
  var sites = [], cm;
  while ((cm = callRe.exec(content)) !== null) {
    sites.push({ full: cm[0], idx: cm.index, prefix: cm[1], gameId: cm[2] });
  }
  console.log('[postbuild] Found ' + sites.length + ' registerGameRpcs call sites');

  var expandedRpcs = [];
  for (var c = sites.length - 1; c >= 0; c--) {
    var site = sites[c];
    var lines = [];
    for (var s = 0; s < suffixes.length; s++) {
      var rpcId = site.prefix + suffixes[s].suffix;
      var stubVar = '__rpc_' + rpcId.replace(/[^a-zA-Z0-9_]/g, '_');
      var handler = 'gameRpcHandler("' + site.gameId + '", ' + suffixes[s].handlerFn + ')';
      lines.push('        ' + stubVar + ' = ' + handler + ';');
      expandedRpcs.push({ id: rpcId, varName: stubVar });
    }
    content = content.substring(0, site.idx) + lines.join('\n') + content.substring(site.idx + site.full.length);
  }

  funcMatch = content.match(funcRe);
  if (funcMatch) {
    bodyStart = content.indexOf('{', funcMatch.index);
    depth = 0; bodyEnd = -1;
    for (var j = bodyStart; j < content.length; j++) {
      if (content[j] === '{') depth++;
      else if (content[j] === '}') { depth--; if (depth === 0) { bodyEnd = j; break; } }
    }
    if (bodyEnd !== -1) {
      content = content.substring(0, bodyStart + 1) + ' /* expanded by postbuild */ ' + content.substring(bodyEnd);
    }
  }

  console.log('[postbuild] Expanded ' + expandedRpcs.length + ' dynamic RPCs across ' + sites.length + ' call sites');
  return { content: content, rpcs: expandedRpcs };
}

var dynamicResult = expandDynamicRpcs(buildContent);
buildContent = dynamicResult.content;

// ── 0.6. Auto-extract the set of TS-owned RPC IDs ───────────────
//
// The TS bridge in src/main.ts needs to know which RPC IDs are registered
// by the TypeScript code so it can skip those when bridging the legacy
// master initializer. Until 2026-04-22 this was a hand-maintained string
// literal that silently rotted whenever a TS RPC was added / renamed /
// removed (see the `quizverse_find_friends` stub-shadowing bug noted in
// legacy_runtime.js:23558 — and which the cbeacf6 merge re-introduced as
// a conflict hunk).
//
// We extract the IDs straight from the TypeScript compile output
// (build/index.js) which is what main.ts actually executes — so the set
// is by definition exactly what the TS layer registered, with no chance
// of drift. We also seed in the dynamically-expanded RPCs because those
// also originate from the TS side (registerGameRpcs in fantasy/*.ts).
//
// Emitted later as `var __TS_OWNED_RPCS = { id1: true, id2: true, ... };`
// at global scope, ahead of the TS runtime block.
var tsOwnedRpcIds = {};
(function scanBuildForTsRpcs() {
  // Require a real RPC id: at least one [a-zA-Z0-9_], no whitespace, and
  // reject the literal "..." which appears in our own docstring comment.
  // Scan a comment-stripped copy (offsets preserved) so registerRpc examples
  // inside doc comments can never produce phantom TS-owned ids.
  var re = /initializer\.registerRpc\(\s*["']([a-zA-Z0-9_][a-zA-Z0-9_\-]*)["']/g;
  var m;
  var scanSrc = stripCommentsPreserveOffsets(buildContent);
  while ((m = re.exec(scanSrc)) !== null) {
    tsOwnedRpcIds[m[1]] = true;
  }
})();
for (var _di = 0; _di < dynamicResult.rpcs.length; _di++) {
  tsOwnedRpcIds[dynamicResult.rpcs[_di].id] = true;
}
var tsOwnedCount = Object.keys(tsOwnedRpcIds).length;
console.log('[postbuild] TS-owned RPC IDs auto-extracted: ' + tsOwnedCount + ' (will populate __TS_OWNED_RPCS for the legacy bridge)');

// ── 1. Scan BOTH files for all registerRpc calls ─────────────────
var rpcPattern = /initializer\.registerRpc\(["']([^"']+)["']/g;
var rpcEntries = [];
var seenIds = new Set();

// Seed with expanded dynamic RPCs first
for (var di = 0; di < dynamicResult.rpcs.length; di++) {
  var drpc = dynamicResult.rpcs[di];
  if (!seenIds.has(drpc.id)) {
    seenIds.add(drpc.id);
    rpcEntries.push({ id: drpc.id, varName: drpc.varName });
  }
}
if (dynamicResult.rpcs.length > 0) {
  console.log('[postbuild] Seeded ' + dynamicResult.rpcs.length + ' dynamic RPCs into entries');
}

function scanForRpcs(content) {
  rpcPattern.lastIndex = 0;
  var m;
  // Scan comment-stripped copies so registerRpc examples inside doc comments
  // (e.g. `initializer.registerRpc("...", handler)` / `registerRpc("id", ...)`)
  // can't produce bogus entries like __rpc____ / __rpc_id. The replacement
  // step (section 3) still runs against the ORIGINAL content, so real code
  // is transformed exactly as before — comments simply stay comments.
  var scanSrc = stripCommentsPreserveOffsets(content);
  while ((m = rpcPattern.exec(scanSrc)) !== null) {
    var id = m[1];
    if (!seenIds.has(id)) {
      seenIds.add(id);
      var varName = '__rpc_' + id.replace(/[^a-zA-Z0-9_]/g, '_');
      rpcEntries.push({ id: id, varName: varName });
    }
  }
}

scanForRpcs(buildContent);
var buildRpcCount = rpcEntries.length;
scanForRpcs(legacyContent);
var legacyRpcCount = rpcEntries.length - buildRpcCount;
scanForRpcs(modulesContent);
var modulesRpcCount = rpcEntries.length - buildRpcCount - legacyRpcCount;
console.log('[postbuild] Found ' + rpcEntries.length + ' unique RPCs (' + buildRpcCount + ' build + ' + legacyRpcCount + ' legacy + ' + modulesRpcCount + ' modules)');

// ── 2. Generate top-level stub declarations ──────────────────────
var stubDecls = rpcEntries.map(function(e) { return 'var ' + e.varName + ';'; }).join('\n');

// ── 3. Replace registerRpc calls with stub assignments ───────────
//
// Build (TypeScript):  registerRpc("id", handler) → __rpc_id = handler
// Legacy:              registerRpc("id", handler) → __rpc_id = __rpc_id || handler
//   (guarded so TypeScript handlers take precedence over legacy for duplicate IDs)

function replaceRegisterRpcCalls(content, guarded) {
  for (var ei = 0; ei < rpcEntries.length; ei++) {
    var entry = rpcEntries[ei];
    var needles = [
      'initializer.registerRpc("' + entry.id + '", ',
      "initializer.registerRpc('" + entry.id + "', "
    ];

    for (var ni = 0; ni < needles.length; ni++) {
      var searchStr = needles[ni];
      var idx = content.indexOf(searchStr);

      while (idx !== -1) {
        var afterHandler = idx + searchStr.length;

        var depth = 1;
        var pos = afterHandler;
        while (pos < content.length && depth > 0) {
          var ch = content.charAt(pos);
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
          pos++;
        }

        var handlerExpr = content.substring(afterHandler, pos - 1).trim();

        var replacement;
        if (guarded) {
          replacement = entry.varName + ' = ' + entry.varName + ' || (' + handlerExpr + ')';
        } else {
          replacement = entry.varName + ' = ' + handlerExpr;
        }

        content = content.substring(0, idx) + replacement + content.substring(pos);
        idx = content.indexOf(searchStr, idx + replacement.length);
      }
    }
  }
  return content;
}

buildContent = replaceRegisterRpcCalls(buildContent, false);
console.log('[postbuild] Replaced registerRpc calls in build content');

if (legacyContent) {
  legacyContent = replaceRegisterRpcCalls(legacyContent, true);
  console.log('[postbuild] Replaced registerRpc calls in legacy content (guarded)');
}

if (modulesContent) {
  modulesContent = replaceRegisterRpcCalls(modulesContent, true);
  console.log('[postbuild] Replaced registerRpc calls in module content (guarded)');
}

// ── 3b. Auto-invoke register() at IIFE scope ────────────────────
//
// After postbuild transforms, register() functions contain ONLY __rpc_
// stub assignments (no initializer calls). By calling register() right
// after it's exported to its namespace, the stubs are populated when the
// IIFE executes — which happens on EVERY Goja VM instance, not just the
// initial VM that runs InitModule. This fixes the VM pooling issue where
// pooled VMs never call InitModule and thus never populate stubs.
//
// IMPORTANT: ONLY auto-invoke register() functions that take ZERO
// parameters. Some namespaces (e.g. QuizVersePlugin) define their
// register as `function register(initializer, nk, logger)` — invoking
// that with no args at IIFE-eval time crashes with "Cannot read property
// of undefined" the moment the body touches one of those args. Those
// real init helpers are already invoked correctly from src/main.ts with
// the proper arguments, so we just need to skip them here.
//
// Build #217 (commit 7056b499 — qv-insights-loop): without this guard,
// autoInvokeRegister wrapped QuizVersePlugin's parameterized register,
// which then crashed in QuizVerseGenerator.buildAll() because
// QuizVerseGame.Mode is declared in a sibling namespace IIFE that hadn't
// run yet at the time register() fired. The crash aborted ALL JavaScript
// runtime evaluation, so even nakama_js_health was never registered →
// pre-push smoke test got HTTP 404 → image never reached ECR.

// Replace every // line comment and every /* */ block comment with the same
// number of spaces / newlines as the original, so character offsets line up
// 1:1 with the source. We scan THIS scrubbed copy with the regex, then apply
// insertions back into the ORIGINAL content at the same offsets — which means
// the regex can't match comment text any more, but the rendered bundle still
// carries the original comments verbatim.
function stripCommentsPreserveOffsets(src) {
  var out = '';
  var i = 0;
  var n = src.length;
  while (i < n) {
    var c = src.charCodeAt(i);
    var c2 = i + 1 < n ? src.charCodeAt(i + 1) : 0;
    if (c === 0x2F /* / */ && c2 === 0x2F /* / */) {
      while (i < n && src.charCodeAt(i) !== 0x0A /* \n */) { out += ' '; i++; }
    } else if (c === 0x2F /* / */ && c2 === 0x2A /* * */) {
      out += '  '; i += 2;
      while (i < n) {
        if (src.charCodeAt(i) === 0x2A /* * */ && i + 1 < n && src.charCodeAt(i + 1) === 0x2F /* / */) {
          out += '  '; i += 2; break;
        }
        out += src.charCodeAt(i) === 0x0A ? '\n' : ' ';
        i++;
      }
    } else {
      out += src[i]; i++;
    }
  }
  return out;
}

function autoInvokeRegister(content) {
  var count = 0;
  var skipped = [];
  // Build #201 fix: scan a comment-stripped copy. The original `content` is
  // still the source-of-truth for the body / declaration / insertion offset,
  // but `scan` is what the regex sees so a literal `Namespace.register =
  // register;` written inside a doc comment can never trigger a false match
  // (which historically broke the bundle by injecting `register();` into
  // the middle of a // line comment, splitting it across statements).
  var scan = stripCommentsPreserveOffsets(content);
  // Capture the function declaration's parameter list so we can decide.
  // Pattern matches `Namespace.register = register;` and also captures
  // the corresponding `function register(<params>)` declaration's args.
  var re = /function\s+register\s*\(([^)]*)\)\s*\{[\s\S]*?\1\s*\.register\s*=\s*register\s*;/g;
  // Simpler approach: scan for the assignment, then look back for the
  // matching `function register(<params>)` within the same enclosing IIFE
  // (we use the namespace name captured in the assignment as a hint).
  var assignRe = /(\w+)\.register\s*=\s*register\s*;/g;
  var m;
  var insertions = [];
  while ((m = assignRe.exec(scan)) !== null) {
    var nsName = m[1];
    var assignIdx = m.index;
    var assignEnd = assignIdx + m[0].length;
    // Look back from the assignment for the most recent `function register(`
    // declaration AND its body so we can both inspect the param list and
    // scan the body for unsafe references. Limit search window to ~16KB.
    // Use `scan` (comment-stripped) so docstrings can't disturb the search.
    var windowStart = Math.max(0, assignIdx - 16384);
    var window = scan.substring(windowStart, assignIdx);
    var declRe = /function\s+register\s*\(([^)]*)\)\s*\{/g;
    var lastDecl = null;
    var dm;
    while ((dm = declRe.exec(window)) !== null) lastDecl = dm;
    var paramList = lastDecl ? lastDecl[1].trim() : '';
    // Auto-invoke is SAFE when:
    //   • The function takes no parameters at all, OR
    //   • The function takes ONLY `initializer` (single param, any name).
    //     This is the classic stub-populator shape: postbuild's earlier
    //     replacement step rewrites every `initializer.registerRpc(...)`
    //     inside the body into `__rpc_X = handler`, so `initializer` is
    //     never actually dereferenced — calling with `undefined` is fine.
    // Auto-invoke is UNSAFE when the function takes 2+ parameters
    // (e.g. `register(initializer, nk, logger)` in QuizVersePlugin):
    // the extra params (`nk`, `logger`, etc.) are real objects whose
    // members the body dereferences directly. Calling such a function
    // with no args throws `Cannot read property X of undefined` and
    // aborts the entire JS runtime evaluation. main.ts already invokes
    // these helpers later with the proper arguments.
    var paramCount = paramList.length === 0
      ? 0
      : paramList.split(',').filter(function(p){ return p.trim().length > 0; }).length;
    if (paramCount > 1) {
      skipped.push(nsName + '(' + paramList + ')');
      continue;
    }
    // Body scan (build #200 root-cause): even single-param register()
    // bodies are UNSAFE if they touch `initializer.<x>()` for any `<x>`
    // other than `registerRpc` — postbuild only rewrites registerRpc, so
    // anything like `initializer.registerMatch(...)`, `initializer.registerRtBefore(...)`,
    // `initializer.registerHook(...)`, etc. survives into the runtime
    // and would explode at IIFE auto-invoke time (initializer === undefined).
    // The fallout is silent: the throw escapes the IIFE, halting bundle
    // evaluation past it — every namespace declared LATER in the file
    // (including JsRuntimeHealth, ~15 KB further down) never runs.
    if (lastDecl) {
      var bodyStart = lastDecl.index + lastDecl[0].length;
      // Find the matching close brace (depth-tracked from `{` after params).
      var depth = 1;
      var i = bodyStart;
      var len = window.length;
      while (i < len && depth > 0) {
        var ch = window.charCodeAt(i);
        if (ch === 0x7B /* { */) depth++;
        else if (ch === 0x7D /* } */) depth--;
        i++;
      }
      var bodySrc = window.substring(bodyStart, i);
      // Param name (e.g. `initializer`, `init`, `i`) — the unsafe pattern
      // is `<param>.SOMETHING(` where SOMETHING is anything except
      // registerRpc (rewritten). Match the param name dynamically.
      var paramName = paramList.replace(/[^A-Za-z0-9_$]/g, '');
      if (paramName) {
        // Escape regex meta in the param name (it's already an identifier
        // but cheap defense). Look for `<paramName>.<word>(` where word
        // is NOT registerRpc.
        var escName = paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var bodyRe  = new RegExp('\\b' + escName + '\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(', 'g');
        var bm;
        var unsafeCall = null;
        while ((bm = bodyRe.exec(bodySrc)) !== null) {
          if (bm[1] !== 'registerRpc') { unsafeCall = bm[1]; break; }
        }
        if (unsafeCall) {
          skipped.push(nsName + '(' + paramList + ') [body calls ' +
                       paramName + '.' + unsafeCall + '() — auto-invoke unsafe]');
          continue;
        }
      }
    }
    insertions.push({ at: assignEnd, ns: nsName });
  }
  // Apply insertions back-to-front so earlier offsets stay valid.
  insertions.sort(function(a, b) { return b.at - a.at; });
  for (var i = 0; i < insertions.length; i++) {
    var ins = insertions[i];
    content = content.substring(0, ins.at) + '\n    register();' + content.substring(ins.at);
    count++;
  }
  if (skipped.length > 0) {
    console.log('[postbuild] Skipped auto-invoke for parameterized register(): ' + skipped.join(', '));
  }
  return { content: content, count: count };
}

var buildAutoResult = autoInvokeRegister(buildContent);
buildContent = buildAutoResult.content;

var legacyAutoCount = 0;
if (legacyContent) {
  var legacyAutoResult = autoInvokeRegister(legacyContent);
  legacyContent = legacyAutoResult.content;
  legacyAutoCount = legacyAutoResult.count;
}

var modulesAutoCount = 0;
if (modulesContent) {
  var modulesAutoResult = autoInvokeRegister(modulesContent);
  modulesContent = modulesAutoResult.content;
  modulesAutoCount = modulesAutoResult.count;
}
console.log('[postbuild] Auto-invoked register() at IIFE scope (' + buildAutoResult.count + ' build + ' + legacyAutoCount + ' legacy + ' + modulesAutoCount + ' modules)');

// ── 3c. Extract legacy __rpc_ assignments for global-scope replay ─
//
// LegacyInitModule contains guarded assignments like:
//   __rpc_X = __rpc_X || (handlerFn)
// These only run when InitModule is called (once per initial VM).
// Pooled VMs never re-run InitModule, so the stubs stay undefined.
// We extract them here and replay the assignments at global scope
// (after all module content) so they execute on EVERY Goja VM.

var legacyStubAssignments = [];
if (legacyContent) {
  var legacyStubRe = /__rpc_(\w+)\s*=\s*__rpc_\1\s*\|\|\s*\((\w+)\)/g;
  var lsm;
  while ((lsm = legacyStubRe.exec(legacyContent)) !== null) {
    legacyStubAssignments.push({ stubVar: '__rpc_' + lsm[1], handlerFn: lsm[2] });
  }
  console.log('[postbuild] Extracted ' + legacyStubAssignments.length + ' legacy __rpc_ assignments for global-scope replay');
}

var moduleStubAssignments = [];
if (modulesContent) {
  var moduleStubRe = /__rpc_(\w+)\s*=\s*__rpc_\1\s*\|\|\s*\((\w+)\)/g;
  var msm;
  while ((msm = moduleStubRe.exec(modulesContent)) !== null) {
    moduleStubAssignments.push({ stubVar: '__rpc_' + msm[1], handlerFn: msm[2] });
  }
  if (moduleStubAssignments.length > 0) {
    console.log('[postbuild] Extracted ' + moduleStubAssignments.length + ' module __rpc_ assignments for global-scope replay');
  }
}

// ── 3d. Rename legacy InitModule to avoid duplicate ──────────────
if (legacyContent) {
  var legacyRenamed = legacyContent.replace(
    /function InitModule\s*\(/g,
    'function _LegacyInitModule('
  );
  if (legacyRenamed !== legacyContent) {
    legacyContent = legacyRenamed;
    console.log('[postbuild] Renamed legacy InitModule → _LegacyInitModule');
  }
}

// ── 4. Rename original InitModule → __OriginalInitModule ─────────
var initModuleReplaced = false;
var renamed = buildContent.replace(
  /function InitModule\s*\(/,
  'function __OriginalInitModule('
);
if (renamed !== buildContent) {
  buildContent = renamed;
  initModuleReplaced = true;
  console.log('[postbuild] Renamed InitModule → __OriginalInitModule');
} else {
  console.warn('[postbuild] WARNING: Could not find "function InitModule(" in build content');
}

// ── 5. Generate new InitModule wrapper ───────────────────────────
//
// Each registerRpc call is wrapped in its own try/catch so:
//   a) The AST walker can descend into each try block to find the call
//   b) A failure in one registration doesn't skip the rest

// ─── RPC alias overrides ─────────────────────────────────────────
//
// Some legacy RPC names in src/hiro/base/admin.ts point at handlers that
// depend on Satori (not configured) or a Hiro-shaped admin context (ours
// uses analytics_admin.js). Their handlers throw at runtime → the dashboard
// sees HTTP 500. We can't redeploy the live dashboard HTML (it's served
// outside this repo), so we alias the legacy RPC ids to the working
// analytics_admin.js handlers here.
//
// These overrides MUST run AFTER __OriginalInitModule — that call
// re-populates the stubs from buildContent's register() IIFEs, so any
// global-scope override earlier in the file gets clobbered. Injecting
// them into the wrapper body between __OriginalInitModule and the
// registration loop is the only spot where our value survives.
//
// Each line uses `typeof X !== "undefined"` so a future rename/removal
// of the source handler function doesn't break the build — it just falls
// back to whatever the stub currently holds.
var RPC_ALIAS_OVERRIDES = [
  { from: 'admin_events_timeline', to: 'rpcDashboardEventsTimeline' },
  { from: 'admin_storage_list',    to: 'rpcDashboardStorageList' }
];
var aliasOverrideLines = RPC_ALIAS_OVERRIDES.map(function(o) {
  var stubVar = '__rpc_' + o.from.replace(/[^a-zA-Z0-9_]/g, '_');
  return '  try { if (typeof ' + o.to + ' !== "undefined") { ' + stubVar + ' = ' + o.to + '; } } catch(e) {}';
}).join('\n');

var registrationLines = rpcEntries.map(function(e) {
  return '  try { initializer.registerRpc("' + e.id + '", ' + e.varName + '); } catch(e) {}';
}).join('\n');

// ─── 5a-bis. Module init invocations ──────────────────────────────
//
// Section 0.2 renames every discovered module's `InitModule` to
// `__ModuleInit_<n>` so the concatenated bundle has no duplicate
// declarations — but until 2026-07 NOTHING ever invoked them. RPC
// registration happened to survive (the stub scan + global replay cover
// it), which masked the breakage: any module whose InitModule performed
// real one-time work (badge/collectable seeding, cricket leaderboard
// creation, offer-engine seeding, deprecated-alias handler binding) was
// silently inert in production. Badge symptom: seedBadgesOnStartup()
// never ran → `definitions_quizverse` storage record never written →
// badges_get_all / badges_check_event returned success with empty
// results for every user, forever, with zero errors logged.
//
// Each invocation is isolated in its own try/catch so one module's
// failure can neither abort the remaining inits nor the RPC/match
// registration below. Handlers inside these bodies were already
// rewritten to guarded `__rpc_X = __rpc_X || h` assignments, so
// re-running them after the global-scope replay is a no-op — only the
// genuine side effects execute.
var moduleInitInvocationLines = moduleInits.map(function(mi2) {
  return [
    '  try { ' + mi2.fn + '(ctx, logger, nk, initializer); } catch(__miErr) {',
    '    try { logger.error("[Postbuild] Module init failed (' + mi2.rel + '): " + (__miErr && __miErr.message ? __miErr.message : String(__miErr))); } catch(_) {}',
    '  }'
  ].join('\n');
}).join('\n');

// ─── 5b. Match handler registration ──────────────────────────────
//
// Nakama's Goja runtime walks InitModule's body AST for every
// `initializer.registerMatch(name, obj)` call. Three rules:
//   (1) the call must be a direct statement in the InitModule function
//       body (or in a try block within it) — nested helper functions
//       are invisible to the walker
//       (server/runtime_javascript_init.go @ getMatchHookFnIdentifier),
//   (2) each handler property value must be an *Identifier*; function
//       expressions are rejected with `errInlinedFunction`
//       (server/runtime_javascript_init.go @ line 1877),
//   (3) the identifier must resolve to a function on r.GlobalObject() —
//       declarations inside TS `namespace { ... }` IIFEs don't qualify
//       (server/runtime_javascript_init.go @ checkFnScope, line 1899).
//
// Builds #377/#378/#379 all violated rule (1) (nested call inside
// LegacyNotifScheduler.register) and tried various tweaks at the call
// site — but the walker can't see calls it can't reach. We fix it here
// by emitting the registration in the InitModule wrapper directly,
// pointing at the top-level wrapper functions declared in
// data/modules/zz_notif_scheduler_handlers.js.
//
// MATCH_HANDLERS is the source of truth for "which matches do we
// register here". Each entry lists the seven required handler names
// AND the globally-declared function each one delegates to. Adding a
// new match means:
//   1. Declare the 7 wrapper functions at file scope in a `.js` module
//      that postbuild's `discoverModuleFiles` picks up,
//   2. Append an entry to MATCH_HANDLERS below.
// The six non-init MpKernel hooks are shared across every template (they
// resolve the template back off kernel state); only matchInit is per-template
// (the match name == templateId, hard-coded in its init wrapper). Wrappers
// live in data/modules/zz_mp_kernel_handlers.js.
function mpKernelTemplate(matchName, initFn) {
  return {
    matchName: matchName,
    handlers: {
      matchInit:        initFn,
      matchJoinAttempt: 'mpKernelMatchJoinAttempt',
      matchJoin:        'mpKernelMatchJoin',
      matchLeave:       'mpKernelMatchLeave',
      matchLoop:        'mpKernelMatchLoop',
      matchSignal:      'mpKernelMatchSignal',
      matchTerminate:   'mpKernelMatchTerminate'
    }
  };
}

var MATCH_HANDLERS = [
  {
    matchName: 'notif_scheduler_v1',
    handlers: {
      matchInit:        'notifSchedulerMatchInit',
      matchJoinAttempt: 'notifSchedulerMatchJoinAttempt',
      matchJoin:        'notifSchedulerMatchJoin',
      matchLeave:       'notifSchedulerMatchLeave',
      matchLoop:        'notifSchedulerMatchLoop',
      matchSignal:      'notifSchedulerMatchSignal',
      matchTerminate:   'notifSchedulerMatchTerminate'
    }
  },
  // IVX Multiplayer Kernel templates. All seven handler functions are
  // top-level wrappers in zz_mp_kernel_handlers.js → MpKernelMatch.*Impl.
  mpKernelTemplate('sync-turn-v1',            'mpSyncTurnMatchInit'),
  mpKernelTemplate('async-turn-v1',           'mpAsyncTurnMatchInit'),
  mpKernelTemplate('lobby-handoff-v1',        'mpLobbyHandoffMatchInit'),
  mpKernelTemplate('tournament-v1',           'mpTournamentMatchInit'),
  mpKernelTemplate('live-event-v1',           'mpLiveEventMatchInit'),
  mpKernelTemplate('persistent-party-v1',     'mpPersistentPartyMatchInit'),
  mpKernelTemplate('conversational-party-v1', 'mpConversationalPartyMatchInit'),
  mpKernelTemplate('mixed-reality-anchor-v1', 'mpMrAnchorMatchInit')
];

var matchRegistrationLines = MATCH_HANDLERS.map(function(m) {
  var props = Object.keys(m.handlers).map(function(h) {
    return '      ' + h + ': ' + m.handlers[h];
  }).join(',\n');
  return [
    '  try {',
    '    initializer.registerMatch("' + m.matchName + '", {',
    props,
    '    });',
    '    logger.info("[Postbuild] Registered match handler: ' + m.matchName + '");',
    '  } catch(e) {',
    '    try { logger.error("[Postbuild] registerMatch ' + m.matchName + ' failed: " + (e && e.message ? e.message : String(e))); } catch(_) {}',
    '  }'
  ].join('\n');
}).join('\n');

var newInitModule = [
  '',
  '// --- RPC + Match Registration Bridge (Goja AST Compatible) ---',
  '// Nakama\'s AST walker only finds registerRpc / registerMatch calls that',
  '// are direct statements in InitModule\'s body. This wrapper satisfies',
  '// that requirement for both kinds of registration.',
  '//',
  '// CRITICAL: __OriginalInitModule is wrapped in try/catch so that any',
  '// exception from a subsystem that escapes its own try/catch cannot prevent',
  '// the __rpc_* variable assignments AND the registerRpc calls below from',
  '// running. Without this guard, a single unhandled throw in',
  '// __OriginalInitModule causes all 1020+ RPCs to return HTTP 404 even',
  '// though Nakama itself starts up and logs "JavaScript runtime modules',
  '// loaded" — the cbeacf6 class of silent outage. The nakama_js_health',
  '// smoke-test 404 (builds #367+) was the first symptom of this mode.',
  'function InitModule(ctx, logger, nk, initializer) {',
  '  try {',
  '    __OriginalInitModule(ctx, logger, nk, initializer);',
  '  } catch(__origErr) {',
  '    try { logger.error("[Postbuild] __OriginalInitModule threw — RPC registration will proceed from cached __rpc_* stubs. Error: " + (__origErr && __origErr.message ? __origErr.message : String(__origErr))); } catch(_) {}',
  '  }',
  '  // --- Module init invocations (see section 5a-bis in postbuild.js) ---',
  '  // Runs the renamed per-module InitModule bodies (__ModuleInit_N) so their',
  '  // one-time side effects (badge seeding etc.) actually execute. Guarded',
  '  // stub assignments inside them are idempotent no-ops at this point.',
  moduleInitInvocationLines,
  '  logger.info("[Postbuild] Invoked ' + moduleInits.length + ' module init functions (__ModuleInit_N)");',
  '  // --- RPC alias overrides (post-Hiro, pre-registration) ---',
  aliasOverrideLines,
  registrationLines,
  '  // --- Match handler registrations (see section 5b in postbuild.js) ---',
  matchRegistrationLines,
  '  logger.info("[Postbuild] Registered " + ' + rpcEntries.length + ' + " RPCs via AST-compatible wrapper (' + RPC_ALIAS_OVERRIDES.length + ' aliases applied, ' + MATCH_HANDLERS.length + ' match handlers)");',
  '}',
  ''
].join('\n');

// ── 6. Assemble final output ─────────────────────────────────────
var sections = [];

sections.push('// ============================================================');
sections.push('// Nakama Runtime Module — Merged by postbuild.js v2');
sections.push('// Generated: ' + new Date().toISOString());
sections.push('// RPC Count: ' + rpcEntries.length);
sections.push('// ============================================================');
sections.push('');

// --- Video Quiz catalog (build/video_quiz_catalog.json → Goja global) ---
// ensureVideoQuizCatalogSeeded reads globalThis.__QV_VIDEO_QUIZ_CATALOG__ at InitModule.
var videoCatalogEmbed = '';
if (fs.existsSync(VIDEO_CATALOG_FILE)) {
  try {
    var catalogRaw = fs.readFileSync(VIDEO_CATALOG_FILE, 'utf8');
    var catalogJson = JSON.parse(catalogRaw);
    videoCatalogEmbed = 'globalThis.__QV_VIDEO_QUIZ_CATALOG__ = ' + JSON.stringify(catalogJson) + ';';
    var enCatalogCount = (catalogJson.langs && catalogJson.langs.en) ? catalogJson.langs.en.length : 0;
    console.log('[postbuild] Embedded video quiz catalog (' + enCatalogCount + ' en questions, version ' + (catalogJson.version || '?') + ')');
  } catch (catalogErr) {
    console.warn('[postbuild] WARN: failed to embed video_quiz_catalog.json: ' + (catalogErr && catalogErr.message ? catalogErr.message : String(catalogErr)));
  }
} else {
  console.log('[postbuild] No build/video_quiz_catalog.json — skipping __QV_VIDEO_QUIZ_CATALOG__ embed');
}
if (videoCatalogEmbed) {
  sections.push('// --- Video Quiz catalog (seed-video-quiz-catalog.js) ---');
  sections.push(videoCatalogEmbed);
  sections.push('');
}
sections.push('// --- CommonJS Compatibility Shim (Goja runtime) ---');
sections.push('var module = typeof module !== "undefined" ? module : { exports: {} };');
sections.push('var exports = typeof exports !== "undefined" ? exports : module.exports;');
sections.push('');
sections.push('// --- RPC Stub Declarations (global scope) ---');
sections.push(stubDecls);
sections.push('');

// --- TS-owned RPC ID set (consumed by src/main.ts's legacy bridge) ---
// See postbuild.js section 0.6 for rationale. JSON.stringify produces
// valid JS object-literal syntax for { string: true, ... } maps.
sections.push('// --- TS-owned RPC IDs (auto-generated, replaces former hand-maintained _tsRpcList) ---');
sections.push('var __TS_OWNED_RPCS = ' + JSON.stringify(tsOwnedRpcIds) + ';');
sections.push('');

if (modulesContent) {
  sections.push('// --- Discovered Modules (' + moduleCount + ' files) ---');
  sections.push(modulesContent);
  sections.push('');
}

if (legacyContent) {
  sections.push('// --- Legacy Runtime (legacy_runtime.js) ---');
  sections.push(legacyContent);
  sections.push('');
}

sections.push('// --- TypeScript Runtime (build/index.js → __OriginalInitModule) ---');
sections.push(buildContent);
sections.push('');

// ── 6b. Global-scope legacy __rpc_ replay ────────────────────────
// These assignments must execute during initial script evaluation on
// EVERY Goja VM, not only inside InitModule (which only runs once on
// the first VM). This fixes "JavaScript runtime function invalid"
// errors caused by VM pooling.
// Module assignments MUST come before legacy assignments. The guarded
// pattern `__rpc_X = __rpc_X || handler` short-circuits once the variable
// is truthy, so whichever assignment runs first wins. Modules are the
// modern, aliased, dimension-enriched implementations and must take
// precedence over legacy_runtime.js fallbacks.
var allStubAssignments = moduleStubAssignments.concat(legacyStubAssignments);
if (allStubAssignments.length > 0) {
  var replayLines = ['', '// --- Global-scope __rpc_ assignments (VM-pool fix) ---'];
  replayLines.push('// Order: modules first (modern handlers win), then legacy fallbacks');
  for (var li = 0; li < allStubAssignments.length; li++) {
    var la = allStubAssignments[li];
    replayLines.push('try { ' + la.stubVar + ' = ' + la.stubVar + ' || (' + la.handlerFn + '); } catch(e) {}');
  }
  replayLines.push('');
  sections.push(replayLines.join('\n'));
  console.log('[postbuild] Injected ' + allStubAssignments.length + ' global-scope __rpc_ replay assignments (' + moduleStubAssignments.length + ' module + ' + legacyStubAssignments.length + ' legacy, modules-first ordering)');
}

sections.push(newInitModule);

var output = sections.join('\n');

// ── 6c. Self-check: every __ModuleInit_N defined must be invoked ──
//
// Guards against the exact regression fixed in 2026-07: module InitModule
// bodies being renamed but never called, silently killing their one-time
// side effects (badge seeding outage). Fails the build loudly on mismatch.
(function verifyModuleInitInvocations() {
  var defined = new Set();
  var invoked = new Set();
  var dm2;
  var defRe2 = /^function __ModuleInit_(\d+)\(/gm;
  while ((dm2 = defRe2.exec(output)) !== null) defined.add(dm2[1]);
  var invRe2 = /__ModuleInit_(\d+)\(ctx, logger, nk, initializer\);/g;
  while ((dm2 = invRe2.exec(output)) !== null) invoked.add(dm2[1]);
  var missing = [];
  defined.forEach(function(n) { if (!invoked.has(n)) missing.push('__ModuleInit_' + n); });
  if (missing.length > 0) {
    console.error('[postbuild] FATAL: ' + missing.length + ' module init function(s) defined but never invoked: ' + missing.join(', '));
    console.error('[postbuild] Their one-time side effects (seeding etc.) would be silently dead in production. Aborting build.');
    process.exit(1);
  }
  console.log('[postbuild] Self-check OK: all ' + defined.size + ' __ModuleInit_N functions are invoked from InitModule');
})();

fs.writeFileSync(OUTPUT_FILE, output, 'utf8');

// ── 7. Summary ───────────────────────────────────────────────────
console.log('[postbuild] ========================================');
console.log('[postbuild] Output:       ' + OUTPUT_FILE);
console.log('[postbuild] Size:         ' + output.length + ' bytes');
console.log('[postbuild] Total RPCs:   ' + rpcEntries.length);
console.log('[postbuild] Build RPCs:   ' + buildRpcCount);
console.log('[postbuild] Legacy RPCs:  ' + legacyRpcCount);
console.log('[postbuild] Module RPCs:  ' + modulesRpcCount);
console.log('[postbuild] Modules:      ' + moduleCount + ' files merged');
console.log('[postbuild] InitModule:   ' + (initModuleReplaced ? 'renamed → __OriginalInitModule' : 'NOT FOUND'));
console.log('[postbuild] Wrapper:      new InitModule with ' + rpcEntries.length + ' direct registerRpc calls');
console.log('[postbuild] ========================================');
