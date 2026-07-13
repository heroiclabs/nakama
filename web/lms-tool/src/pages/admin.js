'use strict';

const { page, escapeHtml } = require('./layout');

const ADMIN_JS = `
(function () {
  'use strict';
  document.getElementById('reg-form').onsubmit = function (e) {
    e.preventDefault();
    var f = e.target;
    var body = {
      url: f.url.value.trim(),
      name: f.name_.value.trim(),
      clientId: f.clientId.value.trim(),
      authenticationEndpoint: f.authenticationEndpoint.value.trim(),
      accesstokenEndpoint: f.accesstokenEndpoint.value.trim(),
      authConfigMethod: f.authConfigMethod.value,
      authConfigKey: f.authConfigKey.value.trim(),
      deploymentIds: f.deploymentIds.value.trim(),
      kind: f.kind.value
    };
    var out = document.getElementById('reg-result');
    out.textContent = 'Registering\\u2026';
    fetch('/admin/register-platform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        out.textContent = res.ok
          ? 'Registered ' + res.body.platform_id + ' (Nakama sync: ' + res.body.nakama_sync + ')'
          : 'Failed: ' + (res.body.message || JSON.stringify(res.body));
      })
      .catch(function (err) { out.textContent = 'Failed: ' + err.message; });
  };
})();
`;

function renderAdmin({ config, nakamaStatus }) {
  const t = config.TOOL_URL;
  const r = config.ROUTES;
  const moodle = config.MOODLE_URL;

  const body = `
<div class="card">
  <h1>QuizVerse LMS Tool — registration helper</h1>

  <h2>Tool URLs (give these to the LMS admin)</h2>
  <table>
    <tr><th>Dynamic registration URL</th><td><code>${t}${r.dynReg}</code></td></tr>
    <tr><th>OIDC login (initiate login URL)</th><td><code>${t}${r.login}</code></td></tr>
    <tr><th>Launch / redirect URI (target link URI)</th><td><code>${t}${r.launch}</code></td></tr>
    <tr><th>JWKS (ltijs message-signing keys)</th><td><code>${t}${r.keys}</code></td></tr>
    <tr><th>Canonical tool JWKS (Nakama AGS path)</th><td><code>${t}${r.toolJwks}</code></td></tr>
  </table>

  <h2 style="margin-top:20px">Moodle quick path (dynamic registration)</h2>
  <ol style="font-size:.9rem">
    <li>As Moodle admin: <em>Site administration → Plugins → Activity modules → External tool → Manage tools</em></li>
    <li>Paste <code>${t}${r.dynReg}</code> into “Tool URL” and click <strong>Add LTI Advantage</strong></li>
    <li>Click <strong>Activate</strong> on the new tool card (tool auto-activates on this side)</li>
    <li>In a course: <em>Add an activity → External tool</em> → choose the tool → “Select content” opens the QuizVerse picker</li>
  </ol>
  <p class="muted" style="font-size:.85rem">Local Moodle (Workstream A): <code>${moodle}</code>. Note the Moodle 4.3+ quirk: with deep linking enabled, content selection is mandatory when adding the activity.</p>

  <h2 style="margin-top:20px">Manual platform registration</h2>
  <p class="muted" style="font-size:.85rem">Registers the platform in ltijs AND calls Nakama <code>lms_platform_upsert</code> to keep both sides in sync.
  Moodle defaults: auth = <code>{moodle}/mod/lti/auth.php</code>, token = <code>{moodle}/mod/lti/token.php</code>, JWKS = <code>{moodle}/mod/lti/certs.php</code>.</p>
  <form id="reg-form">
    <label>Platform URL (issuer)</label>
    <input type="url" name="url" placeholder="${escapeHtml(moodle)}" required>
    <label>Display name</label>
    <input type="text" name="name_" placeholder="Local Moodle">
    <label>Client ID (from the LMS tool registration)</label>
    <input type="text" name="clientId" required>
    <label>Authentication endpoint</label>
    <input type="url" name="authenticationEndpoint" placeholder="${escapeHtml(moodle)}/mod/lti/auth.php" required>
    <label>Access token endpoint</label>
    <input type="url" name="accesstokenEndpoint" placeholder="${escapeHtml(moodle)}/mod/lti/token.php" required>
    <label>Platform key method</label>
    <select name="authConfigMethod"><option value="JWK_SET" selected>JWK_SET (keyset URL)</option><option value="JWK_KEY">JWK_KEY</option><option value="RSA_KEY">RSA_KEY</option></select>
    <label>Platform keyset URL / key</label>
    <input type="text" name="authConfigKey" placeholder="${escapeHtml(moodle)}/mod/lti/certs.php" required>
    <label>Deployment IDs (comma-separated — Nakama rejects launches from unlisted deployments)</label>
    <input type="text" name="deploymentIds" placeholder="1">
    <label>LMS kind</label>
    <select name="kind"><option value="moodle" selected>moodle</option><option value="canvas">canvas</option></select>
    <p style="margin-top:16px"><button class="primary" type="submit">Register platform</button></p>
  </form>
  <p id="reg-result" class="muted"></p>

  <h2 style="margin-top:20px">Backend status</h2>
  <table>
    <tr><th>Nakama base</th><td><code>${escapeHtml(nakamaStatus.baseUrl)}</code></td></tr>
    <tr><th>Service token configured</th><td>${nakamaStatus.serviceTokenConfigured ? 'yes' : 'no — set LMS_BRIDGE_SERVICE_TOKEN in repo .env'}</td></tr>
    <tr><th>Signing keys</th><td>${escapeHtml(config.keys.source)} (kid <code>${escapeHtml(config.keys.kid)}</code>)</td></tr>
  </table>
</div>`;

  return page('Registration — QuizVerse LMS Tool', body, '', ADMIN_JS);
}

module.exports = { renderAdmin };
