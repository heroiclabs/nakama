#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * check-rpc-literals.js
 *
 * Static linter that fails the build if any call to a Nakama
 * registration API uses a non-string-literal as its identifier
 * argument.
 *
 * Why this exists
 * ---------------
 * Nakama's JS runtime is the Goja engine wrapped by an AST walker
 * that statically extracts RPC / match handler IDs. Goja can't follow
 * variable references, imports, or member-expressions —
 * `initializer.registerRpc(MY_CONST, fn)` compiles cleanly but the
 * runtime never sees a registered handler, and clients calling that
 * RPC get "function not found" with no log on the server side.
 *
 * The 2026-05-27 EKS audit caught three live regressions of this
 * pattern (cricket InitModule, quizverse_create_match,
 * notif_scheduler_v1) that together broke 971+ RPC calls in 24h
 * and blocked every Quizverse multiplayer match-create. The matching
 * fixes are in nakama#94 and nakama#95.
 *
 * This script is the prevention layer: it scans src/**\/*.ts at
 * build time and refuses to compile if it finds a non-literal first
 * arg to any of the BANNED_CALLS APIs below. It only inspects
 * source-level call sites — generated code in build/ and
 * node_modules/ are not walked.
 *
 * Usage
 * -----
 *   npm run check:rpc-literals          # exits non-zero on violations
 *   npm run build                       # runs the check before tsc
 *
 * False-positive escape hatch
 * ---------------------------
 * If you have a genuinely dynamic registration site (extremely rare),
 * add `// nakama-allow-dynamic-rpc-id` on the same line as the call.
 * The linter respects that comment and skips the assertion. Use
 * sparingly — it is an explicit acknowledgement that you have
 * verified the AST walker handles this case.
 *
 * Implementation note
 * -------------------
 * Plain JS (not TS) so the prebuild hook has zero extra deps —
 * `typescript` is already a devDependency for tsc itself, so we
 * just import its compiler API at runtime.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

/** @type {Array<{methodName:string, literalArgIndex:number, receiverHint?:string, rationale:string}>} */
const BANNED_CALLS = [
  {
    methodName: 'registerRpc',
    literalArgIndex: 0,
    rationale:
      "Nakama's Goja AST walker only extracts RPC ids from string-literal " +
      'arguments. A constant or variable reference compiles but mounts as ' +
      'an unregistered RPC at runtime → clients get "function not found".',
  },
  {
    methodName: 'registerMatch',
    literalArgIndex: 0,
    rationale:
      "Nakama's match-handler registry stores handlers by the literal name " +
      'passed at registration time. Variable references break match ' +
      'creation across the cluster.',
  },
  {
    methodName: 'registerMatchmakerMatched',
    literalArgIndex: 0,
    rationale:
      "Same Goja AST constraint as registerRpc — only literal handler names " +
      'survive the static extractor.',
  },
  {
    methodName: 'registerLeaderboardReset',
    literalArgIndex: 0,
    rationale:
      'Goja AST walker constraint — leaderboard reset hooks must be ' +
      'registered with a literal id.',
  },
  {
    methodName: 'registerTournamentReset',
    literalArgIndex: 0,
    rationale:
      'Goja AST walker constraint — tournament reset hooks must be ' +
      'registered with a literal id.',
  },
  {
    methodName: 'registerTournamentEnd',
    literalArgIndex: 0,
    rationale:
      'Goja AST walker constraint — tournament end hooks must be ' +
      'registered with a literal id.',
  },
];

const ALLOW_DYNAMIC_PRAGMA = 'nakama-allow-dynamic-rpc-id';

function walk(dir, out) {
  out = out || [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'build' ||
        entry.name === 'dist' ||
        entry.name.startsWith('.')
      ) {
        continue;
      }
      walk(full, out);
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function hasAllowPragma(sf, node) {
  // Accepts the pragma on the same line as the call OR on the
  // immediately preceding line (so it can ride alongside an
  // explanatory block comment instead of cluttering the call site).
  const fullText = sf.getFullText();
  const start = node.getStart(sf);
  const lineStart = fullText.lastIndexOf('\n', start) + 1;
  const lineEnd = fullText.indexOf('\n', start);
  const sameLine = fullText.slice(
    lineStart,
    lineEnd === -1 ? undefined : lineEnd,
  );
  if (sameLine.includes(ALLOW_DYNAMIC_PRAGMA)) return true;
  const prevLineEnd = lineStart - 1;
  if (prevLineEnd <= 0) return false;
  const prevLineStart = fullText.lastIndexOf('\n', prevLineEnd - 1) + 1;
  const prevLine = fullText.slice(prevLineStart, prevLineEnd);
  return prevLine.includes(ALLOW_DYNAMIC_PRAGMA);
}

function describeArgKind(arg) {
  switch (arg.kind) {
    case ts.SyntaxKind.StringLiteral:
      return 'string literal (OK)';
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return 'untagged template literal (OK)';
    case ts.SyntaxKind.TemplateExpression:
      return 'template literal with substitutions (NOT OK — contains ${...})';
    case ts.SyntaxKind.Identifier:
      return `Identifier "${arg.text}" (NOT OK)`;
    case ts.SyntaxKind.PropertyAccessExpression:
      return `member expression "${arg.getText()}" (NOT OK)`;
    case ts.SyntaxKind.CallExpression:
      return 'function call result (NOT OK)';
    case ts.SyntaxKind.BinaryExpression:
      return 'binary expression (NOT OK — string concatenation)';
    default:
      return `${ts.SyntaxKind[arg.kind]} (NOT OK)`;
  }
}

function isAcceptableLiteral(arg) {
  return (
    arg.kind === ts.SyntaxKind.StringLiteral ||
    arg.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
  );
}

function checkFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  // File-level escape hatch: a pragma anywhere in the file's top-of-file
  // comment region (first 80 lines) silences the linter for that whole
  // file. Use this when you have a legitimate, postbuild-rewritten or
  // generator-emitted pattern (e.g. legacy/multi-game.ts which is
  // expanded into literal-string registrations by postbuild.js).
  const headHunk = text.split('\n').slice(0, 80).join('\n');
  if (headHunk.includes(ALLOW_DYNAMIC_PRAGMA + ':file')) {
    return [];
  }
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.ES2020,
    /* setParentNodes */ true,
  );
  const violations = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let methodName;
      let receiverText;
      if (ts.isPropertyAccessExpression(callee)) {
        methodName = callee.name.text;
        receiverText = callee.expression.getText(sf);
      } else if (ts.isIdentifier(callee)) {
        methodName = callee.text;
      }
      if (methodName) {
        for (const banned of BANNED_CALLS) {
          if (banned.methodName !== methodName) continue;
          if (
            banned.receiverHint &&
            (!receiverText || !receiverText.endsWith(banned.receiverHint))
          ) {
            continue;
          }
          const arg = node.arguments[banned.literalArgIndex];
          if (!arg) continue;
          if (isAcceptableLiteral(arg)) continue;
          if (hasAllowPragma(sf, node)) continue;
          const pos = sf.getLineAndCharacterOfPosition(arg.getStart(sf));
          violations.push({
            file,
            line: pos.line + 1,
            column: pos.character + 1,
            snippet: node.getText(sf).split('\n')[0].trim().slice(0, 160),
            call: banned,
            argKind: describeArgKind(arg),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return violations;
}

function main() {
  const root = path.resolve(__dirname, '..', 'src');
  if (!fs.existsSync(root)) {
    console.error(`[check-rpc-literals] expected ${root} to exist`);
    process.exit(2);
  }

  const files = walk(root);
  const allViolations = [];
  for (const f of files) {
    Array.prototype.push.apply(allViolations, checkFile(f));
  }

  if (allViolations.length === 0) {
    console.log(
      `[check-rpc-literals] OK — scanned ${files.length} .ts files, ` +
        'no non-literal Nakama registrations found.',
    );
    process.exit(0);
  }

  console.error(
    `[check-rpc-literals] FAIL — ${allViolations.length} non-literal ` +
      'registration(s) found. Goja\'s AST walker will not extract these ' +
      'and the runtime will silently fail to mount them:\n',
  );
  for (const v of allViolations) {
    const rel = path.relative(process.cwd(), v.file);
    console.error(`  ${rel}:${v.line}:${v.column}`);
    console.error(`    ${v.snippet}`);
    console.error(
      `    ↳ ${v.call.methodName} arg#${v.call.literalArgIndex}: ${v.argKind}`,
    );
    console.error(`    ↳ why: ${v.call.rationale}`);
    console.error('');
  }
  console.error(
    'Fix: pass the id as a quoted string literal at the call site. ' +
      'If you have a genuinely dynamic case (rare), add ' +
      `\`// ${ALLOW_DYNAMIC_PRAGMA}\` on the same line.`,
  );
  process.exit(1);
}

main();
