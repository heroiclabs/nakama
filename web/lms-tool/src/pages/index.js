'use strict';

const { page, escapeHtml } = require('./layout');

function renderIndex({ config, nakamaStatus }) {
  const t = config.TOOL_URL;
  const r = config.ROUTES;
  const rpcRows = Object.entries(nakamaStatus.rpcs)
    .map(([id, st]) => `<tr><td><code>${id}</code></td><td>${st}</td></tr>`)
    .join('');

  const body = `
<div class="card">
  <h1>QuizVerse LMS Tool</h1>
  <p class="muted">LTI 1.3 Tool for Canvas/Moodle: OIDC launch, deep linking, AGS grade-back, student quiz player, QTI/Moodle-XML converters.</p>
  <table>
    <tr><th>OIDC login</th><td><code>${t}${r.login}</code></td></tr>
    <tr><th>Launch</th><td><code>${t}${r.launch}</code></td></tr>
    <tr><th>JWKS</th><td><code>${t}${r.keys}</code></td></tr>
    <tr><th>Dynamic registration</th><td><code>${t}${r.dynReg}</code></td></tr>
    <tr><th>Registration helper</th><td><a href="/admin/register">/admin/register</a></td></tr>
    <tr><th>Health</th><td><a href="/health">/health</a></td></tr>
  </table>
  <h2 style="margin-top:20px">Nakama lms-bridge RPC status</h2>
  <p class="muted" style="font-size:.85rem">"unknown" = not called yet this run; "mocked" = fell back to the local stub (integration pending).</p>
  <table><tr><th>RPC</th><th>Status</th></tr>${rpcRows}</table>
  <p class="muted" style="font-size:.85rem">Signing keys: ${escapeHtml(config.keys.source)}</p>
</div>`;

  return page('QuizVerse LMS Tool', body);
}

module.exports = { renderIndex };
