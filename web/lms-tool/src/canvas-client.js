'use strict';

const crypto = require('crypto');
const { parseQtiZip, generateQtiZip } = require('./converters/qti');
const { buildProvenance, assertFidelityReport } = require('./converters/canonical');

const USER_AGENT = 'QuizVerse-LMS-Bridge/0.2 (+https://lms.quizverse.world)';

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function validateCanvasUrl(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Canvas base URL must use HTTPS (HTTP is allowed only for localhost)');
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function createPkce() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function buildAuthorizationUrl(options) {
  const baseUrl = validateCanvasUrl(options.baseUrl);
  const url = new URL('/login/oauth2/auth', baseUrl);
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('state', options.state);
  url.searchParams.set('code_challenge', options.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function exchangeAuthorizationCode(options, fetchImpl = fetch) {
  const baseUrl = validateCanvasUrl(options.baseUrl);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: options.clientId,
    client_secret: options.clientSecret,
    redirect_uri: options.redirectUri,
    code: options.code,
    code_verifier: options.codeVerifier,
  });
  const response = await fetchImpl(`${baseUrl}/login/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Canvas OAuth token exchange failed (${response.status})`);
  return response.json();
}

function createCanvasClient(options) {
  const baseUrl = validateCanvasUrl(options.baseUrl);
  const token = String(options.accessToken || '');
  const fetchImpl = options.fetchImpl || fetch;
  if (!token) throw new Error('Canvas access token is required');

  async function request(pathOrUrl, init = {}) {
    const url = new URL(pathOrUrl, baseUrl);
    if (url.origin !== new URL(baseUrl).origin && !init.allowExternalDownload) {
      throw new Error(`Refusing Canvas request to unexpected origin: ${url.origin}`);
    }
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('User-Agent', USER_AGENT);
    const response = await fetchImpl(url, {
      ...init,
      headers,
      signal: init.signal || AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Canvas API ${response.status} ${url.pathname}: ${detail}`);
    }
    return response;
  }

  async function json(pathOrUrl, init) {
    return (await request(pathOrUrl, init)).json();
  }

  async function listCourses() {
    return json('/api/v1/courses?enrollment_type=teacher&enrollment_state=active&per_page=100');
  }

  async function listQuizzes(courseId) {
    return json(`/api/v1/courses/${encodeURIComponent(courseId)}/quizzes?per_page=100`);
  }

  async function waitFor(pathOrUrl, complete, options = {}) {
    const attempts = options.attempts || 30;
    const delayMs = options.delayMs === undefined ? 1000 : options.delayMs;
    for (let i = 0; i < attempts; i += 1) {
      const value = await json(pathOrUrl);
      if (complete(value)) return value;
      if (/failed/i.test(String(value.workflow_state || value.completion || ''))) {
        throw new Error(`Canvas job failed: ${JSON.stringify(value.message || value)}`);
      }
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error('Canvas job timed out');
  }

  async function exportQuiz(courseId, quiz) {
    const form = new URLSearchParams();
    form.set('export_type', 'qti');
    form.append('select[quizzes][]', String(quiz.id));
    const job = await json(`/api/v1/courses/${encodeURIComponent(courseId)}/content_exports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const finished = await waitFor(
      job.progress_url || `/api/v1/courses/${encodeURIComponent(courseId)}/content_exports/${job.id}`,
      (value) => Boolean(value.attachment && value.attachment.url) || value.workflow_state === 'exported',
      options.poll
    );
    if (!finished.attachment || !finished.attachment.url) throw new Error(`Canvas QTI export ${job.id} has no attachment`);
    const attachmentUrl = new URL(finished.attachment.url);
    if (!/^https?:$/.test(attachmentUrl.protocol)) throw new Error('Canvas export returned an unsafe attachment URL');
    const response = await fetchImpl(attachmentUrl, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Canvas QTI download failed (${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const parsed = parseQtiZip(buffer, {
      source: { platform: 'canvas', course_id: String(courseId), quiz_id: String(quiz.id), source_url: `${baseUrl}/courses/${courseId}/quizzes/${quiz.id}` },
    });
    assertFidelityReport(parsed.fidelity);
    return {
      pack_id: `canvas_${courseId}_${quiz.id}`,
      title: parsed.title || quiz.title,
      questions: parsed.questions,
      media: parsed.media,
      source: buildProvenance('canvas', 'qti_1.2', {
        course_id: String(courseId),
        quiz_id: String(quiz.id),
        source_url: `${baseUrl}/courses/${courseId}/quizzes/${quiz.id}`,
        exported_at: finished.created_at || new Date().toISOString(),
      }),
      fidelity: parsed.fidelity,
    };
  }

  async function pullCourse(courseId) {
    const quizzes = await listQuizzes(courseId);
    const packs = [];
    for (const quiz of quizzes) packs.push(await exportQuiz(courseId, quiz));
    return packs;
  }

  async function pushPack(courseId, pack) {
    const qti = generateQtiZip(pack);
    const name = `${String(pack.pack_id || 'quizverse').replace(/[^a-zA-Z0-9_-]/g, '_')}.qti.zip`;
    const form = new URLSearchParams({
      migration_type: 'qti_converter',
      'pre_attachment[name]': name,
      'pre_attachment[size]': String(qti.length),
    });
    const migration = await json(`/api/v1/courses/${encodeURIComponent(courseId)}/content_migrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const upload = migration.pre_attachment || migration;
    const uploadUrl = upload.upload_url || migration.file_upload_url;
    if (!uploadUrl) throw new Error('Canvas content migration did not return a file upload URL');
    const uploadBody = new FormData();
    for (const [key, value] of Object.entries(upload.upload_params || {})) uploadBody.append(key, String(value));
    uploadBody.append('file', new Blob([qti], { type: 'application/zip' }), name);
    const uploadResponse = await fetchImpl(uploadUrl, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT },
      body: uploadBody,
      signal: AbortSignal.timeout(30000),
    });
    if (!uploadResponse.ok) throw new Error(`Canvas migration upload failed (${uploadResponse.status})`);
    const completed = await waitFor(
      migration.progress_url || `/api/v1/courses/${encodeURIComponent(courseId)}/content_migrations/${migration.id}`,
      (value) => ['completed', 'completed_with_issues', 'imported'].includes(String(value.workflow_state || value.completion)),
      options.poll
    );
    return { migration_id: migration.id, workflow_state: completed.workflow_state || completed.completion, qti_bytes: qti.length };
  }

  return { baseUrl, request, listCourses, listQuizzes, exportQuiz, pullCourse, pushPack };
}

module.exports = {
  USER_AGENT,
  validateCanvasUrl,
  createPkce,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  createCanvasClient,
};
