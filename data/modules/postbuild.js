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

for (var mi = 0; mi < moduleFiles.length; mi++) {
  var mf = moduleFiles[mi];
  var mc = fs.readFileSync(mf.path, 'utf8');

  if (!isNakamaCompatible(mc, mf.rel)) continue;

  mc = mc.replace(/^"use strict";\r?\n?/, '');
  mc = mc.replace(/function\s+InitModule\s*\(/g, 'function __ModuleInit_' + moduleCount + '(');
  mc = stripNodePatterns(mc);

  modulesContent += '\n// --- Module: ' + mf.rel + ' ---\n';
  modulesContent += mc;
  modulesContent += '\n';
  moduleCount++;
}
console.log('[postbuild] Loaded ' + moduleCount + ' separate module files (' + modulesContent.length + ' bytes)');
moduleFiles.forEach(function(mf) { console.log('[postbuild]   -> ' + mf.rel); });

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
  while ((m = rpcPattern.exec(content)) !== null) {
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

function autoInvokeRegister(content) {
  var count = 0;
  var result = content.replace(
    /(\w+\.register\s*=\s*register\s*;)/g,
    function(match) { count++; return match + '\n    register();'; }
  );
  return { content: result, count: count };
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

var registrationLines = rpcEntries.map(function(e) {
  return '  try { initializer.registerRpc("' + e.id + '", ' + e.varName + '); } catch(e) {}';
}).join('\n');

var newInitModule = [
  '',
  '// --- RPC Registration Bridge (Goja AST Compatible) ---',
  '// Nakama\'s AST walker only finds registerRpc calls that are direct',
  '// statements in InitModule\'s body. This wrapper satisfies that requirement.',
  'function InitModule(ctx, logger, nk, initializer) {',
  '  __OriginalInitModule(ctx, logger, nk, initializer);',
  registrationLines,
  '  logger.info("[Postbuild] Registered " + ' + rpcEntries.length + ' + " RPCs via AST-compatible wrapper");',
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
sections.push('// --- CommonJS Compatibility Shim (Goja runtime) ---');
sections.push('var module = typeof module !== "undefined" ? module : { exports: {} };');
sections.push('var exports = typeof exports !== "undefined" ? exports : module.exports;');
sections.push('');
sections.push('// --- RPC Stub Declarations (global scope) ---');
sections.push(stubDecls);
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
var allStubAssignments = legacyStubAssignments.concat(moduleStubAssignments);
if (allStubAssignments.length > 0) {
  var replayLines = ['', '// --- Global-scope __rpc_ assignments (VM-pool fix) ---'];
  for (var li = 0; li < allStubAssignments.length; li++) {
    var la = allStubAssignments[li];
    replayLines.push('try { ' + la.stubVar + ' = ' + la.stubVar + ' || (' + la.handlerFn + '); } catch(e) {}');
  }
  replayLines.push('');
  sections.push(replayLines.join('\n'));
  console.log('[postbuild] Injected ' + allStubAssignments.length + ' global-scope __rpc_ replay assignments (' + legacyStubAssignments.length + ' legacy + ' + moduleStubAssignments.length + ' module)');
}

sections.push(newInitModule);

var output = sections.join('\n');
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
