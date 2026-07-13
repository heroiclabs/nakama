'use strict';

/**
 * Full local E2E simulation of an LTI 1.3 launch WITHOUT Moodle:
 *   1. hosts a fake platform on :9877 (JWKS, token endpoint, AGS scores sink)
 *   2. registers it with the tool (ltijs + Nakama lms_platform_upsert)
 *   3. runs the OIDC login init against /lti/login, captures state+nonce
 *   4. signs a real RS256 id_token (fake platform key) and POSTs /lti/launch
 *   5. asserts the player HTML renders, extracts ltik
 *   6. submits an attempt via /api/attempt/submit
 *   7. asserts the AGS score arrived at the fake platform's /scores endpoint
 *   8. also verifies a tampered id_token is rejected (401)
 *
 * Prereq: the tool is running on :8090 (npm start).
 * Run: node scripts/simulate-launch.js
 */

const crypto = require('crypto');
const express = require('express');

const TOOL = process.env.LMS_TOOL_URL || 'http://localhost:8090';
const FAKE_PORT = 9877;
const FAKE = `http://localhost:${FAKE_PORT}`;
const ISSUER = FAKE; // issuer == platform URL keeps ltijs lookup simple
const CLIENT_ID = 'SIMCLIENT1';
const DEPLOYMENT_ID = 'sim-dep-1';
const KID = 'sim-platform-key-1';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(payload, privateKey, kid) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey);
  return `${header}.${body}.${b64url(sig)}`;
}

async function main() {
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  };

  // 1. fake platform
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
  const received = { scores: [] };

  const app = express();
  app.use(express.urlencoded({ extended: false })); // token endpoint (client_credentials form)
  app.use(express.json({ type: ['application/json', 'application/vnd.ims.lis.v1.score+json'] }));
  app.get('/jwks', (req, res) => res.json({ keys: [jwk] }));
  app.post('/token', (req, res) => res.json({ access_token: 'sim-access-token', token_type: 'Bearer', expires_in: 3600 }));
  // ltijs POSTs the AGS score to <lineitem>/scores
  app.post('/lineitems/1/lineitem/scores', (req, res) => { received.scores.push(req.body); res.status(200).json({}); });
  const fakeSrv = await new Promise((resolve) => { const s = app.listen(FAKE_PORT, () => resolve(s)); });

  try {
    // 2. register with the tool
    const reg = await (await fetch(`${TOOL}/admin/register-platform`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: ISSUER, name: 'Simulated Platform', clientId: CLIENT_ID,
        authenticationEndpoint: `${FAKE}/auth`, accesstokenEndpoint: `${FAKE}/token`,
        authConfigMethod: 'JWK_SET', authConfigKey: `${FAKE}/jwks`,
        deploymentIds: DEPLOYMENT_ID, kind: 'moodle',
      }),
    })).json();
    check('platform registration', reg.ok === true, `nakama_sync=${reg.nakama_sync}`);

    // 3. OIDC login init
    const loginRes = await fetch(`${TOOL}/lti/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({
        iss: ISSUER, client_id: CLIENT_ID, login_hint: 'sim-user-1',
        target_link_uri: `${TOOL}/lti/launch`, lti_message_hint: 'sim',
      }),
    });
    const loc = loginRes.headers.get('location') || '';
    const authUrl = new URL(loc, FAKE);
    const state = authUrl.searchParams.get('state');
    const nonce = authUrl.searchParams.get('nonce');
    check('OIDC login redirect', loginRes.status === 302 && loc.startsWith(`${FAKE}/auth`) && !!state && !!nonce,
      `status=${loginRes.status}`);

    // 4. craft + sign id_token
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: ISSUER, aud: CLIENT_ID, sub: 'sim-student-1', nonce,
      iat: now, exp: now + 300,
      name: 'Sim Student', email: 'sim@student.test',
      'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiResourceLinkRequest',
      'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0',
      'https://purl.imsglobal.org/spec/lti/claim/deployment_id': DEPLOYMENT_ID,
      'https://purl.imsglobal.org/spec/lti/claim/target_link_uri': `${TOOL}/lti/launch`,
      'https://purl.imsglobal.org/spec/lti/claim/resource_link': { id: 'sim-rl-1', title: 'Simulated Quiz' },
      'https://purl.imsglobal.org/spec/lti/claim/roles': ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
      'https://purl.imsglobal.org/spec/lti/claim/context': { id: 'sim-course-1', title: 'Sim Course', label: 'SIM101' },
      'https://purl.imsglobal.org/spec/lti/claim/custom': { pack_id: 'pack_demo_solar', score_maximum: '10' },
      'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint': {
        scope: [
          'https://purl.imsglobal.org/spec/lti-ags/scope/score',
          'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
        ],
        lineitems: `${FAKE}/lineitems`,
        lineitem: `${FAKE}/lineitems/1/lineitem`,
      },
      'https://purl.imsglobal.org/spec/lti/claim/launch_presentation': { return_url: `${FAKE}/course` },
    };
    const idToken = signJwt(claims, privateKey, KID);

    // 5. launch
    const launchRes = await fetch(`${TOOL}/lti/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({ id_token: idToken, state }),
    });
    // ltijs validates the id_token then 302-redirects to the app route with ?ltik=
    let html = '';
    let ltik = '';
    let launchStatus = launchRes.status;
    if (launchStatus === 302) {
      const redirect = new URL(launchRes.headers.get('location'), TOOL);
      ltik = redirect.searchParams.get('ltik') || '';
      if (process.env.PRINT_LAUNCH_URL) console.log('LAUNCH_URL:', `${TOOL}${redirect.pathname}${redirect.search}`);
      const followRes = await fetch(`${TOOL}${redirect.pathname}${redirect.search}`);
      launchStatus = followRes.status;
      html = await followRes.text();
    } else {
      html = await launchRes.text();
      const m = html.match(/"ltik":"([^"]+)"/);
      ltik = m ? m[1] : '';
    }
    check('launch renders player', launchStatus === 200 && html.includes('screen-question') && !!ltik,
      `status=${launchStatus}, ltik=${ltik ? 'present' : 'MISSING'}`);
    // answer keys must not ship to the client: inspect the embedded config JSON
    const cfgMatch = html.match(/window\.__QV_CONFIG__ = (\{.*?\});\n/s);
    const cfgJson = cfgMatch ? cfgMatch[1] : '';
    check('player config has no answer keys', Boolean(cfgJson) && !cfgJson.includes('correct_index'), '');

    // 6. submit attempt (2 of 3 correct)
    if (ltik) {
      const submit = await (await fetch(`${TOOL}/api/attempt/submit?ltik=${encodeURIComponent(ltik)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pack_id: 'pack_demo_solar',
          answers: [
            { question_id: 'q_red_planet', selected_index: 1 },
            { question_id: 'q_largest', selected_index: 2 },
            { question_id: 'q_sun', selected_index: 3 },
          ],
        }),
      })).json();
      check('attempt graded', submit.score_given !== undefined && submit.score_maximum === 10,
        `score=${submit.score_given}/${submit.score_maximum} via ${submit.grading_source}`);
      check('breakdown returned', Array.isArray(submit.breakdown) && submit.breakdown.length === 3, '');

      // 7. AGS score arrived at fake platform
      await new Promise((r) => setTimeout(r, 300));
      const score = received.scores[0];
      check('AGS score received by platform', Boolean(score) && score.scoreGiven === submit.score_given
        && score.gradingProgress === 'FullyGraded' && score.userId === 'sim-student-1',
        score ? `scoreGiven=${score.scoreGiven} userId=${score.userId}` : 'no score POST received');
      check('grade sync chip state', submit.grade_sync && submit.grade_sync.status === 'synced',
        JSON.stringify(submit.grade_sync));
    }

    // 8. tampered id_token must be rejected
    const parts = idToken.split('.');
    const tamperedPayload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    tamperedPayload.sub = 'attacker';
    const tampered = `${parts[0]}.${b64url(JSON.stringify(tamperedPayload))}.${parts[2]}`;
    // fresh login for a fresh state
    const login2 = await fetch(`${TOOL}/lti/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({ iss: ISSUER, client_id: CLIENT_ID, login_hint: 'x', target_link_uri: `${TOOL}/lti/launch` }),
    });
    const state2 = new URL(login2.headers.get('location'), FAKE).searchParams.get('state');
    const badRes = await fetch(`${TOOL}/lti/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({ id_token: tampered, state: state2 }),
    });
    check('tampered id_token rejected', badRes.status === 401, `status=${badRes.status}`);

    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} simulation checks passed`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    fakeSrv.close();
  }
}

main().catch((err) => { console.error('simulation crashed:', err); process.exit(1); });
