'use strict';

const crypto = require('crypto');
const {
  createPkce,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  createCanvasClient,
} = require('../canvas-client');
const { createCanvasTokenStore } = require('../canvas-token-store');

const OAUTH_TTL_MS = 10 * 60 * 1000;

function isTeacher(token) {
  const roles = (token && token.platformContext && token.platformContext.roles) || [];
  return roles.some((role) => /Instructor|TeachingAssistant|Administrator/i.test(String(role)));
}

function setupCanvasRoutes(deps) {
  const { app, config, packStore, mediaStore, nakama } = deps;
  if (!config.CANVAS.enabled) return { enabled: false, publicRoutes: [] };
  const tokenStore = createCanvasTokenStore(config.CANVAS.tokenStorePath, config.CANVAS.tokenEncryptionKey);
  const pending = new Map();

  function teacherId(res) {
    const token = res.locals.token;
    if (!token || !token.user || !isTeacher(token)) throw new Error('Teacher role required');
    return `${token.iss}|${token.user}`;
  }

  function connectedClient(res) {
    const id = teacherId(res);
    const saved = tokenStore.get(id);
    if (!saved || !saved.access_token) throw new Error('Canvas teacher OAuth connection required');
    return createCanvasClient({
      baseUrl: config.CANVAS.baseUrl,
      accessToken: saved.access_token,
    });
  }

  app.get('/api/canvas/oauth/start', (req, res) => {
    let id;
    try { id = teacherId(res); } catch (err) { return res.status(403).json({ error: 'teacher_required', message: err.message }); }
    const state = crypto.randomBytes(32).toString('base64url');
    const pkce = createPkce();
    pending.set(state, { id, verifier: pkce.verifier, createdAt: Date.now() });
    for (const [key, value] of pending) if (Date.now() - value.createdAt > OAUTH_TTL_MS) pending.delete(key);
    return res.redirect(buildAuthorizationUrl({
      baseUrl: config.CANVAS.baseUrl,
      clientId: config.CANVAS.clientId,
      redirectUri: config.CANVAS.redirectUri,
      state,
      codeChallenge: pkce.challenge,
    }));
  });

  app.get('/api/canvas/oauth/callback', async (req, res) => {
    const record = pending.get(String(req.query.state || ''));
    pending.delete(String(req.query.state || ''));
    if (!record || Date.now() - record.createdAt > OAUTH_TTL_MS) return res.status(400).send('Canvas OAuth state is invalid or expired.');
    if (!req.query.code) return res.status(400).send('Canvas OAuth callback did not include a code.');
    try {
      const token = await exchangeAuthorizationCode({
        baseUrl: config.CANVAS.baseUrl,
        clientId: config.CANVAS.clientId,
        clientSecret: config.CANVAS.clientSecret,
        redirectUri: config.CANVAS.redirectUri,
        code: String(req.query.code),
        codeVerifier: record.verifier,
      });
      tokenStore.put(record.id, token);
      return res.type('html').send('<!doctype html><title>Canvas connected</title><h1>Canvas connected</h1><p>You can close this window and return to QuizVerse.</p>');
    } catch (err) {
      return res.status(502).send(`Canvas OAuth failed: ${err.message}`);
    }
  });

  app.get('/api/canvas/courses', async (req, res) => {
    try { return res.json({ courses: await connectedClient(res).listCourses() }); }
    catch (err) { return res.status(400).json({ error: 'canvas_request_failed', message: err.message }); }
  });

  app.post('/api/canvas/courses/:courseId/pull', async (req, res) => {
    try {
      const packs = await connectedClient(res).pullCourse(req.params.courseId);
      const imported = [];
      for (const sourcePack of packs) {
        const storedMedia = mediaStore.persist(sourcePack.media || []);
        const pack = { ...sourcePack, media: storedMedia };
        packStore.upsertPack(pack);
        let nakamaImport = null;
        try {
          nakamaImport = await nakama.importPack({
            pack_id: pack.pack_id,
            title: pack.title,
            questions: pack.questions,
            source: pack.source,
            fidelity: pack.fidelity,
          });
        } catch (err) {
          nakamaImport = { error: err.message };
        }
        imported.push({ pack_id: pack.pack_id, title: pack.title, fidelity: pack.fidelity, nakama_import: nakamaImport });
      }
      return res.json({ course_id: req.params.courseId, imported });
    } catch (err) {
      return res.status(400).json({ error: 'canvas_pull_failed', message: err.message });
    }
  });

  app.post('/api/canvas/courses/:courseId/push/:packId', async (req, res) => {
    try {
      const pack = packStore.getPack(req.params.packId);
      if (!pack) return res.status(404).json({ error: 'pack_not_found' });
      const hydrated = { ...pack, media: (pack.media || []).map(mediaStore.hydrate) };
      const migration = await connectedClient(res).pushPack(req.params.courseId, hydrated);
      return res.json({ pack_id: pack.pack_id, course_id: req.params.courseId, migration });
    } catch (err) {
      return res.status(400).json({ error: 'canvas_push_failed', message: err.message });
    }
  });

  return { enabled: true, publicRoutes: [{ route: '/api/canvas/oauth/callback', method: 'GET' }] };
}

module.exports = { setupCanvasRoutes, isTeacher };
