// One-shot: generate admin credentials for the in-house analytics dashboard.
// Run once with `node scripts/generate-admin-creds.mjs`. Copies values into
// .env automatically and prints the password for you to save in 1Password.
//
// Why bcrypt and not just sha256 / plaintext:
//   analytics_admin.js falls back through bcrypt → sha256 → plaintext. bcrypt
//   is the only one safe against offline brute-force if .env ever leaks.
//   We use bcryptjs (pure JS, no native compile) so this runs on any Node
//   installation without build tools.

import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const ENV_PATH = join(REPO_ROOT, '.env');

// ── 1. Ensure bcryptjs is available (auto-install if needed) ──────────
let bcrypt;
try {
  bcrypt = (await import('bcryptjs')).default;
} catch (e) {
  console.log('[generate-admin-creds] bcryptjs not found — installing locally...');
  // --no-save so we don't pollute package.json. Falls into a temp folder
  // adjacent to the script. If npm isn't on PATH this will throw a clear
  // error that the user can act on.
  execSync('npm install bcryptjs --no-save --prefix .', {
    stdio: 'inherit',
    cwd: __dirname
  });
  // ESM requires file:// URLs for absolute paths on Windows; pathToFileURL
  // handles the conversion portably.
  const bcryptPath = join(__dirname, 'node_modules', 'bcryptjs', 'index.js');
  bcrypt = (await import(pathToFileURL(bcryptPath).href)).default;
}

// ── 2. Generate values ────────────────────────────────────────────────
const ADMIN_USERNAME = 'ivx-admin';
// 16 chars, base64url alphabet. Strong enough for an admin login behind
// rate limiting, short enough to type if you ever need to manually log in.
const passwordRaw = randomBytes(12).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const passwordHash = bcrypt.hashSync(passwordRaw, 12); // cost 12 = ~250ms/check, recommended for 2026
const dashboardSecret = randomBytes(32).toString('hex'); // 64 hex chars = 256 bits

// ── 3. Patch .env (or create a new block if vars don't exist yet) ─────
if (!existsSync(ENV_PATH)) {
  console.error('[generate-admin-creds] .env not found at ' + ENV_PATH);
  process.exit(1);
}
let env = readFileSync(ENV_PATH, 'utf8');

function upsert(envText, key, value) {
  // Match `KEY=` or `KEY=anything-not-newline` at line start. Replace; or
  // append a new line at the end if the key is absent.
  const re = new RegExp('^' + key + '=.*$', 'm');
  if (re.test(envText)) {
    return envText.replace(re, key + '=' + value);
  }
  return envText.replace(/\s*$/, '\n' + key + '=' + value + '\n');
}

env = upsert(env, 'ADMIN_USERNAME', ADMIN_USERNAME);
env = upsert(env, 'ADMIN_PASSWORD_HASH', passwordHash);
env = upsert(env, 'DASHBOARD_SECRET', dashboardSecret);

writeFileSync(ENV_PATH, env, 'utf8');

// ── 4. Print credentials (only place the password is ever logged) ─────
console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  ADMIN CREDENTIALS GENERATED — SAVE THE PASSWORD NOW');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  URL:               https://nakama.intelli-verse-x.ai/analytics.html');
console.log('  Username:          ' + ADMIN_USERNAME);
console.log('  Password:          ' + passwordRaw);
console.log('');
console.log('  Bcrypt hash (in .env):    ' + passwordHash);
console.log('  Dashboard secret (.env):  ' + dashboardSecret.slice(0, 12) + '...' + dashboardSecret.slice(-8));
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log('Next steps:');
console.log('  1. Copy the password to 1Password / your secrets vault NOW.');
console.log('  2. The password is NOT recoverable from the bcrypt hash.');
console.log('  3. Mirror these THREE values into your prod k8s secret:');
console.log('       ADMIN_USERNAME, ADMIN_PASSWORD_HASH, DASHBOARD_SECRET');
console.log('  4. Re-run this script anytime to rotate the password.');
console.log('');
