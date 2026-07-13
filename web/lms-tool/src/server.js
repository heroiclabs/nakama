'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const lti = require('ltijs').Provider;
const Database = require('ltijs-sequelize');

const config = require('./config');
const nakama = require('./nakama-client');
const packStore = require('./pack-store');
const { createMediaStore } = require('./media-store');
const { parseMoodleXml, generateMoodleXml } = require('./converters/moodle-xml');
const { parseQtiZip, generateQtiZip } = require('./converters/qti');
const { assertFidelityReport, buildProvenance } = require('./converters/canonical');
const { setupCanvasRoutes } = require('./routes/canvas');
const { setupConverterRoutes } = require('./routes/converter');
const { renderPlayer } = require('./pages/player');
const { renderPicker } = require('./pages/picker');
const { renderAdmin } = require('./pages/admin');
const { renderIndex } = require('./pages/index');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const mediaStore = createMediaStore(config.MEDIA_STORE_PATH);

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

const db = new Database('ltijs', '', '', {
  dialect: 'sqlite',
  storage: config.DB_PATH,
  logging: false,
});

lti.setup(
  config.LTI_ENCRYPTION_KEY,
  { plugin: db },
  {
    appRoute: config.ROUTES.launch,
    loginRoute: config.ROUTES.login,
    keysetRoute: config.ROUTES.keys,
    dynRegRoute: config.ROUTES.dynReg,
    // Local dev runs over plain http inside an iframe; devMode makes ltijs
    // validate by ltik alone instead of requiring secure cross-site cookies.
    devMode: config.DEV_MODE,
    dynReg: {
      url: config.TOOL_URL,
      name: 'QuizVerse LMS Bridge',
      logo: 'https://quizverse.world/favicon.ico',
      description: 'QuizVerse quiz player with LTI 1.3 launch, deep linking and AGS grade-back',
      redirectUris: [config.TOOL_URL + config.ROUTES.launch],
      customParameters: {},
      autoActivate: config.AUTO_ACTIVATE,
    },
    cookies: config.DEV_MODE
      ? { secure: false, sameSite: '' }
      : { secure: true, sameSite: 'None' },
  }
);

// ---------------------------------------------------------------------------
// Launch context helpers
// ---------------------------------------------------------------------------

function launchClaims(token) {
  const ctx = token.platformContext || {};
  return {
    issuer: token.iss,
    client_id: token.clientId,
    deployment_id: token.deploymentId,
    sub: token.user, // absent on anonymous launches (LTI §5.3.6.1) → ungraded preview
    name: (token.userInfo && token.userInfo.name) || '',
    email: (token.userInfo && token.userInfo.email) || '',
    roles: ctx.roles || [],
    context: ctx.context || {},
    resource_link: ctx.resource || {},
    custom: ctx.custom || {},
    endpoint: ctx.endpoint || {}, // AGS claim: { scope[], lineitems, lineitem? }
    return_url: (ctx.launchPresentation && ctx.launchPresentation.return_url) || '',
  };
}

/**
 * Resolve the pack bound to this launch:
 *   1. lms_launch_session (Nakama binding row wins) — live RPC validates the
 *      platform/deployment allowlist; a rejected launch degrades to local mode.
 *   2. deep-link custom.pack_id → lazy lms_deeplink_bind (the platform only
 *      assigns resource_link_id after the deep-link response, so first launch
 *      is the earliest moment the binding can be persisted).
 *   3. local demo pack as last resort (plain "external tool" registrations).
 */
async function resolvePack(claims) {
  let session = null;
  let integrationNote = '';
  const platformId = await nakama.resolvePlatformId(claims.issuer);

  if (claims.sub) {
    try {
      session = await nakama.launchSession({
        platform_id: platformId,
        deployment_id: claims.deployment_id,
        sub: claims.sub,
        name: claims.name,
        email: claims.email,
        roles: claims.roles,
        context: claims.context,
        resource_link: claims.resource_link,
        line_item_url: claims.endpoint.lineitem || '',
        score_maximum: parseFloat(claims.custom.score_maximum || '') || undefined,
      });
    } catch (err) {
      integrationNote = `lms_launch_session rejected: ${err.message}`;
      console.warn('[lms-tool]', integrationNote,
        '— continuing in local mode. If this is a new platform/deployment, register it (with deployment_ids) via /admin/register or lms_platform_upsert.');
    }
  }

  let packId = (session && session.pack_id) || null;

  if (!packId && claims.custom.pack_id) {
    packId = claims.custom.pack_id;
    try {
      await nakama.deeplinkBind({
        platform_id: platformId,
        deployment_id: claims.deployment_id,
        resource_link_id: claims.resource_link.id,
        pack_id: packId,
        score_maximum: parseFloat(claims.custom.score_maximum || '') || undefined,
        line_item_url: claims.endpoint.lineitem || '',
        title: claims.resource_link.title || '',
        context: claims.context,
      });
    } catch (err) {
      console.warn('[lms-tool] lazy deeplink_bind failed:', err.message);
    }
  }

  const pack = (packId && packStore.getPack(packId)) || packStore.getPack(packStore.DEMO_PACK.pack_id);
  return { session, pack, platformId, integrationNote };
}

function sanitizeQuestions(pack, ltik) {
  const media = new Map((pack.media || []).map((asset) => [asset.media_id, asset]));
  return pack.questions.map((q) => ({
    question_id: q.question_id,
    text: q.text,
    options: q.options,
    images: (q.image_ids || []).map((id) => media.get(id)).filter(Boolean)
      .map((asset) => ({ url: `/media/${asset.media_id}?ltik=${encodeURIComponent(ltik)}`, alt: asset.filename })),
  }));
}

// ---------------------------------------------------------------------------
// LTI message handlers
// ---------------------------------------------------------------------------

// LtiResourceLinkRequest → student quiz player
lti.onConnect(async (token, req, res) => {
  try {
    const claims = launchClaims(token);
    const { pack } = await resolvePack(claims);
    const scoreMaximum = parseFloat(claims.custom.score_maximum || '') || pack.questions.length;

    return res.send(renderPlayer({
      ltik: res.locals.ltik,
      studentName: claims.name,
      packId: pack.pack_id,
      title: pack.title,
      questions: sanitizeQuestions(pack, res.locals.ltik),
      scoreMaximum,
      hasLineItem: Boolean(claims.sub) && Boolean(claims.endpoint.lineitem || (claims.endpoint.scope || []).length),
      returnUrl: claims.return_url,
      nakamaStatus: nakama.getIntegrationStatus(),
    }));
  } catch (err) {
    console.error('[lms-tool] launch failed:', err);
    return res.status(500).send('Launch failed: ' + err.message);
  }
});

// LtiDeepLinkingRequest → teacher pack picker
lti.onDeepLinking(async (token, req, res) => {
  try {
    return res.send(renderPicker({
      ltik: res.locals.ltik,
      packs: packStore.listPacks(),
      nakamaStatus: nakama.getIntegrationStatus(),
      canvasEnabled: config.CANVAS.enabled,
    }));
  } catch (err) {
    console.error('[lms-tool] deep linking failed:', err);
    return res.status(500).send('Deep linking failed: ' + err.message);
  }
});

lti.onInvalidToken(async (req, res) => res.status(401).send('Invalid LTI token: launch could not be validated.'));
lti.onUnregisteredPlatform((req, res) => res.status(400).send('Unregistered platform. Register it at /admin/register or via dynamic registration.'));

// Dynamic registration: run ltijs's flow, then mirror the platform into
// Nakama (lms_platform_upsert) so both registries stay in sync.
lti.onDynamicRegistration(async (req, res) => {
  try {
    if (!req.query.openid_configuration) {
      return res.status(400).send({ status: 400, error: 'Bad Request', details: { message: 'Missing parameter: "openid_configuration".' } });
    }
    const message = await lti.DynamicRegistration.register(req.query.openid_configuration, req.query.registration_token);

    try {
      await syncDynamicallyRegisteredPlatform(req.query.openid_configuration);
    } catch (err) {
      console.warn('[lms-tool] Nakama sync after dynamic registration failed:', err.message);
    }

    res.setHeader('Content-type', 'text/html');
    return res.send(message);
  } catch (err) {
    if (err.message === 'PLATFORM_ALREADY_REGISTERED') {
      return res.status(403).send({ status: 403, error: 'Forbidden', details: { message: 'Platform already registered.' } });
    }
    console.error('[lms-tool] dynamic registration failed:', err);
    return res.status(500).send({ status: 500, error: 'Internal Server Error', details: { message: err.message } });
  }
});

async function syncDynamicallyRegisteredPlatform(openidConfigUrl) {
  const openidConfig = await (await fetch(openidConfigUrl, { signal: AbortSignal.timeout(8000) })).json();
  const issuer = openidConfig.issuer;
  const platformCfg = openidConfig['https://purl.imsglobal.org/spec/lti-platform-configuration'] || {};
  const family = String(platformCfg.product_family_code || '').toLowerCase();
  const kind = family.includes('canvas') ? 'canvas' : 'moodle';
  const platforms = await lti.getAllPlatforms();
  for (const p of platforms) {
    const url = await p.platformUrl();
    if (url !== issuer) continue;
    await nakama.platformUpsert({
      platform_id: 'dynreg_' + Buffer.from(issuer).toString('hex').slice(0, 24),
      issuer,
      client_id: await p.platformClientId(),
      auth_url: openidConfig.authorization_endpoint,
      token_url: openidConfig.token_endpoint,
      jwks_url: openidConfig.jwks_uri,
      kind,
    });
    nakama.invalidatePlatformCache();
    console.log('[lms-tool] platform mirrored to Nakama after dynamic registration:', issuer);
    return;
  }
  console.warn('[lms-tool] dynamic registration sync: platform not found in ltijs store for', issuer);
}

// ---------------------------------------------------------------------------
// ltik-protected APIs (ltijs validates the token before these run)
// ---------------------------------------------------------------------------

function setupRoutes() {
  const app = lti.app; // ltijs already mounts body-parser (json/urlencoded)

  // Student submits the attempt → grade (Nakama lms_attempt_complete, mock
  // fallback) → tool-side AGS push via ltijs → report sync chip state.
  app.post('/api/attempt/submit', async (req, res) => {
    const token = res.locals.token;
    const claims = launchClaims(token);
    const packId = req.body.pack_id;
    const answers = (Array.isArray(req.body.answers) ? req.body.answers : [])
      .map((a) => ({ question_id: a.question_id, selected_index: a.selected_index }));
    const platformId = await nakama.resolvePlatformId(claims.issuer);

    const gradePayload = {
      platform_id: platformId,
      deployment_id: claims.deployment_id,
      resource_link_id: claims.resource_link.id,
      sub: claims.sub,
      pack_id: packId,
      answers,
    };

    let graded;
    let gradingSource = 'nakama';
    try {
      graded = await nakama.attemptComplete(gradePayload);
    } catch (err) {
      // Live Nakama rejected the attempt (e.g. platform/deployment not
      // allowlisted, pack not imported there). Grade against the local pack
      // mirror so the E2E flow still completes; flagged in the response.
      console.warn('[lms-tool] lms_attempt_complete rejected, grading locally:', err.message);
      try {
        graded = await require('../mock-nakama/handlers').handle('lms_attempt_complete', gradePayload);
        gradingSource = 'local_fallback';
      } catch (mockErr) {
        return res.status(400).json({ error: 'grading_failed', message: mockErr.message });
      }
    }

    const breakdown = normalizeBreakdown(graded, packId);

    // Grade push: tool-side AGS via ltijs is primary (it owns the platform
    // registration + message-signing keys). Nakama's lms_grade_push queue
    // remains the production path once the canonical key is registered with
    // the platform; we deliberately do NOT trigger it after a successful
    // tool-side push to avoid double-posting.
    let gradeSync = { status: 'skipped', detail: 'no AGS line item in launch (ungraded preview)' };
    try {
      // Use the CLAIMED lineitem URL verbatim (AGS §3.2 / charter LTI-12):
      // Moodle only accepts score POSTs on the exact id URL it advertises
      // (path + type_id query param). Only fall back to the lineitems
      // collection when the launch carried no per-link lineitem claim.
      let lineItemUrl = claims.endpoint.lineitem;
      if (!lineItemUrl && (claims.endpoint.scope || []).length) {
        const li = await lti.Grade.getLineItems(token, { resourceLinkId: true });
        const items = (li && li.lineItems) || [];
        if (items.length > 0) lineItemUrl = items[0].id;
      }
      if (lineItemUrl && claims.sub) {
        await lti.Grade.submitScore(token, lineItemUrl, {
          userId: claims.sub,
          scoreGiven: graded.score_given,
          scoreMaximum: graded.score_maximum,
          activityProgress: 'Completed',
          gradingProgress: 'FullyGraded',
          timestamp: new Date().toISOString(),
        });
        gradeSync = { status: 'synced', via: 'tool_ags' };
      }
    } catch (err) {
      // Surface the platform's response body when available — a bare
      // "Response code 404" hides whether the failure was the token grant or
      // the scores endpoint (the Moodle E2E 404 was actually the token step:
      // token.php could not fetch our JWKS through Moodle's curl blocklist).
      const platformBody = err.response && err.response.body
        ? String(err.response.body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
        : '';
      console.error('[lms-tool] tool-side AGS push failed:', err.message, platformBody ? `| platform said: ${platformBody}` : '');
      gradeSync = { status: 'failed', detail: err.message + (platformBody ? ` | ${platformBody}` : '') };
      // Backup: ask Nakama's worker to drive its own queue (only lands if the
      // canonical key is registered with the platform — production path).
      try {
        const push = await nakama.callRpc('lms_grade_push', { limit: 5 });
        if (push && push.sent > 0) gradeSync = { status: 'synced', via: 'nakama_grade_push' };
      } catch (pushErr) {
        console.warn('[lms-tool] lms_grade_push backup also failed:', pushErr.message);
      }
    }

    // Record the sync outcome in Nakama so lms_link_status reflects reality
    // (and a tool-side success retires the pending grade-queue row instead of
    // letting the Nakama worker double-post).
    if (claims.sub && gradingSource === 'nakama') {
      try {
        await nakama.linkStatus({
          platform_id: platformId,
          deployment_id: claims.deployment_id,
          resource_link_id: claims.resource_link.id,
          sub: claims.sub,
          grade_sync: gradeSync.status === 'synced' ? 'synced' : 'failed',
          status_patch: { via: gradeSync.via || null, detail: gradeSync.detail || null },
        });
      } catch (err) {
        console.warn('[lms-tool] recording sync outcome to lms_link_status failed:', err.message);
      }
    }

    res.json({
      score_given: graded.score_given,
      score_maximum: graded.score_maximum,
      breakdown,
      grade_sync: gradeSync,
      grading_source: gradingSource,
      // Echo the launch identifiers so callers (E2E, teacher view) can query
      // lms_link_status for this exact attempt.
      lti: { sub: claims.sub || null, resource_link_id: claims.resource_link.id || null, deployment_id: claims.deployment_id },
    });
  });

  // Teacher picked a pack → deep linking response (auto-submitting form)
  app.post('/api/deeplink/respond', async (req, res) => {
    const token = res.locals.token;
    const packId = req.body.pack_id;
    const scoreMaximum = Math.max(1, parseFloat(req.body.score_maximum) || 10);
    const pack = packStore.getPack(packId);
    if (!pack) return res.status(404).send('Unknown pack: ' + packId);

    const item = {
      type: 'ltiResourceLink',
      title: pack.title,
      text: `QuizVerse quiz: ${pack.title} (${pack.questions.length} questions)`,
      url: config.TOOL_URL + config.ROUTES.launch,
      custom: { pack_id: pack.pack_id, score_maximum: String(scoreMaximum) },
      lineItem: { scoreMaximum, label: pack.title, resourceId: pack.pack_id },
    };

    const form = await lti.DeepLinking.createDeepLinkingForm(token, [item], { message: 'QuizVerse quiz linked successfully' });
    res.send(form);
  });

  // Upload Moodle XML / QTI zip in the picker → convert → lms_import_pack
  app.post('/api/import', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    const name = req.file.originalname || 'upload';
    try {
      let parsed;
      let sourcePlatform;
      if (/\.zip$/i.test(name)) {
        parsed = parseQtiZip(req.file.buffer, { source: { filename: name } });
        sourcePlatform = 'canvas';
      } else if (/\.xml$/i.test(name)) {
        parsed = parseMoodleXml(req.file.buffer.toString('utf8'), { source: { filename: name } });
        sourcePlatform = 'moodle';
      }
      else return res.status(400).json({ error: 'unsupported_type', message: 'Upload a Moodle XML (.xml) or QTI 1.2 package (.zip)' });
      assertFidelityReport(parsed.fidelity);

      if (parsed.questions.length === 0) {
        return res.status(422).json({ error: 'nothing_importable', fidelity: parsed.fidelity });
      }

      const packId = 'pack_lms_' + Date.now().toString(36);
      const pack = {
        pack_id: packId,
        title: parsed.title,
        questions: parsed.questions,
        media: mediaStore.persist(parsed.media || []),
        source: buildProvenance(sourcePlatform, parsed.fidelity.source_format, { filename: name }),
        fidelity: parsed.fidelity,
      };
      packStore.upsertPack(pack); // local mirror for picker/player/fallback grading

      let importResult = null;
      try {
        const data = await nakama.importPack({
          pack_id: packId,
          title: pack.title,
          questions: pack.questions,
          source: pack.source,
          fidelity: pack.fidelity,
        });
        importResult = data.report || data;
      } catch (err) {
        console.warn('[lms-tool] lms_import_pack failed (kept local copy):', err.message);
        importResult = { error: err.message };
      }

      res.json({
        pack_id: packId,
        title: pack.title,
        question_count: pack.questions.length,
        fidelity: parsed.fidelity,
        nakama_import: importResult,
      });
    } catch (err) {
      res.status(400).json({ error: 'convert_failed', message: err.message });
    }
  });

  // Pack export (reverse converters) — the Canvas↔Moodle bridge
  app.get('/api/export/:packId.:format', async (req, res) => {
    const pack = packStore.getPack(req.params.packId);
    if (!pack) return res.status(404).send('Unknown pack');
    const exportPack = { ...pack, media: (pack.media || []).map(mediaStore.hydrate) };
    if (req.params.format === 'xml') {
      res.type('application/xml').attachment(`${pack.pack_id}.moodle.xml`).send(generateMoodleXml(exportPack));
    } else if (req.params.format === 'zip') {
      res.type('application/zip').attachment(`${pack.pack_id}.qti.zip`).send(generateQtiZip(exportPack));
    } else {
      res.status(400).send('format must be xml (Moodle) or zip (QTI 1.2)');
    }
  });

  // ---------- whitelisted (non-LTI) routes ----------

  app.get('/', (req, res) => res.send(renderIndex({ config, nakamaStatus: nakama.getIntegrationStatus() })));

  app.get('/health', async (req, res) => res.json({
    ok: true,
    service: 'quizverse-lms-tool',
    key_source: config.keys.source,
    // probeHealth() exercises RPCs still marked 'unknown' (benign payloads)
    // so lms_link_status / lms_deeplink_bind report 'live', not 'unknown'.
    nakama: await nakama.probeHealth(),
  }));

  // Canonical-key JWKS (for Nakama's production lms_grade_push path).
  // Note: /lti/keys serves the ltijs-managed platform keys — the ones that
  // actually sign this tool's LTI messages.
  app.get(config.ROUTES.toolJwks, (req, res) => res.json({ keys: [config.canonicalPublicJwk()] }));

  app.get('/admin/register', (req, res) => res.send(renderAdmin({ config, nakamaStatus: nakama.getIntegrationStatus() })));

  app.post('/admin/register-platform', async (req, res) => {
    const p = req.body || {};
    const required = ['url', 'clientId', 'authenticationEndpoint', 'accesstokenEndpoint', 'authConfigKey'];
    const missing = required.filter((k) => !p[k]);
    if (missing.length) return res.status(400).json({ error: 'missing_fields', missing });

    try {
      const platform = await lti.registerPlatform({
        url: p.url,
        name: p.name || p.url,
        clientId: p.clientId,
        authenticationEndpoint: p.authenticationEndpoint,
        accesstokenEndpoint: p.accesstokenEndpoint,
        authConfig: { method: p.authConfigMethod || 'JWK_SET', key: p.authConfigKey },
      });
      await platform.platformActive(true);

      let nakamaSync = 'ok';
      try {
        await nakama.platformUpsert({
          platform_id: p.platformId || 'manual_' + Buffer.from(p.url).toString('hex').slice(0, 24),
          issuer: p.url,
          client_id: p.clientId,
          auth_url: p.authenticationEndpoint,
          token_url: p.accesstokenEndpoint,
          jwks_url: (p.authConfigMethod || 'JWK_SET') === 'JWK_SET' ? p.authConfigKey : '',
          deployment_ids: String(p.deploymentIds || '').split(',').map((s) => s.trim()).filter(Boolean),
          kind: p.kind || 'moodle',
        });
        nakama.invalidatePlatformCache();
      } catch (err) {
        nakamaSync = 'failed: ' + err.message;
      }

      res.json({ ok: true, platform_id: p.url, client_id: p.clientId, nakama_sync: nakamaSync });
    } catch (err) {
      res.status(400).json({ error: 'register_failed', message: err.message });
    }
  });

  app.get('/media/:mediaId', mediaStore.serve);
  setupConverterRoutes(app);
  setupCanvasRoutes({ app, config, packStore, mediaStore, nakama });
}

/** Live Nakama returns per_question (no explanations); enrich from the local pack mirror. */
function normalizeBreakdown(graded, packId) {
  const rows = graded.breakdown || graded.per_question || [];
  const pack = packStore.getPack(packId);
  const byId = {};
  if (pack) for (const q of pack.questions) byId[q.question_id] = q;
  return rows.map((r) => ({
    question_id: r.question_id,
    selected_index: r.selected_index,
    correct_index: r.correct_index,
    correct: r.correct,
    explanation: r.explanation || (byId[r.question_id] && byId[r.question_id].explanation) || null,
  }));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function start() {
  lti.whitelist(
    '/',
    '/health',
    config.ROUTES.toolJwks,
    { route: '/admin/register', method: 'GET' },
    { route: '/admin/register-platform', method: 'POST' },
    { route: '/converter', method: 'GET' },
    { route: '/api/converter/convert', method: 'POST' },
    { route: '/api/canvas/oauth/callback', method: 'GET' }
  );

  await lti.deploy({ port: config.PORT, serverless: false, silent: true });
  setupRoutes();

  // Seed the demo pack into Nakama so deep-link binds against it succeed
  // (idempotent; harmless if lms_import_pack is not live yet).
  try {
    await nakama.importPack({
      pack_id: packStore.DEMO_PACK.pack_id,
      title: packStore.DEMO_PACK.title,
      questions: packStore.DEMO_PACK.questions,
      source: { platform: 'quizverse', format: 'builtin' },
    });
  } catch (err) {
    console.warn('[lms-tool] demo pack seed to Nakama failed (non-fatal):', err.message);
  }

  console.log(`[lms-tool] QuizVerse LMS Tool listening on :${config.PORT}`);
  console.log(`[lms-tool]   OIDC login:     ${config.TOOL_URL}${config.ROUTES.login}`);
  console.log(`[lms-tool]   Launch:         ${config.TOOL_URL}${config.ROUTES.launch}`);
  console.log(`[lms-tool]   JWKS (ltijs):   ${config.TOOL_URL}${config.ROUTES.keys}`);
  console.log(`[lms-tool]   Dynamic reg:    ${config.TOOL_URL}${config.ROUTES.dynReg}`);
  console.log(`[lms-tool]   Canonical JWKS: ${config.TOOL_URL}${config.ROUTES.toolJwks}`);
  console.log(`[lms-tool]   Admin helper:   ${config.TOOL_URL}/admin/register`);
  console.log(`[lms-tool]   Signing keys:   ${config.keys.source} (kid=${config.keys.kid})`);
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[lms-tool] failed to start:', err);
    process.exit(1);
  });
}

module.exports = { start, lti };
