'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  parseMoodleXml,
  generateMoodleXml,
  parseQtiZip,
  generateQtiZip,
} = require('../src/converters');
const { assertFidelityReport, buildProvenance } = require('../src/converters/canonical');
const { safeArchivePath, makeMediaAsset, MAX_MEDIA_BYTES } = require('../src/converters/media');
const { createMediaStore } = require('../src/media-store');
const { createCanvasTokenStore } = require('../src/canvas-token-store');
const {
  USER_AGENT,
  createPkce,
  buildAuthorizationUrl,
  createCanvasClient,
} = require('../src/canvas-client');

// Valid 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const ASSET = makeMediaAsset(PNG, 'pixel.png', 'image/png', 'fixture/pixel.png');
const IMAGE_PACK = {
  pack_id: 'image_pack',
  title: 'Image Round Trip',
  media: [ASSET],
  questions: [{
    question_id: 'image_q1',
    title: 'Pixel question',
    text: 'Which image is shown?',
    text_html: '<p>Which image is shown?</p><p><img src="pixel.png" alt="pixel"></p>',
    options: ['A pixel', 'A video'],
    correct_index: 0,
    question_type: 'multiple_choice',
    points: 2,
    shuffle: false,
    image_ids: [ASSET.media_id],
  }],
};

test('Moodle XML preserves valid base64 images and metadata', () => {
  const xml = generateMoodleXml(IMAGE_PACK);
  assert.match(xml, /<file name="[a-f0-9]{12}-pixel\.png"[^>]*encoding="base64">/);
  const parsed = parseMoodleXml(xml, { source: { filename: 'roundtrip.xml' } });
  assert.equal(parsed.media.length, 1);
  assert.equal(parsed.media[0].sha256, ASSET.sha256);
  assert.deepEqual(parsed.questions[0].image_ids, [ASSET.media_id]);
  assert.equal(parsed.questions[0].title, 'Pixel question');
  assert.equal(parsed.questions[0].points, 2);
  assert.equal(parsed.questions[0].shuffle, false);
  assert.equal(parsed.fidelity.imported_with_loss, 0);
  assertFidelityReport(parsed.fidelity);
});

test('Canvas QTI package preserves image resources through its manifest', () => {
  const zip = generateQtiZip(IMAGE_PACK);
  const parsed = parseQtiZip(zip, { source: { course_id: '42', quiz_id: '7' } });
  assert.equal(parsed.media.length, 1);
  assert.equal(parsed.media[0].sha256, ASSET.sha256);
  assert.deepEqual(parsed.questions[0].image_ids, [ASSET.media_id]);
  assert.equal(parsed.questions[0].question_id, 'image_q1');
  assert.equal(parsed.questions[0].points, 2);
  assert.equal(parsed.fidelity.skipped, 0);
  assertFidelityReport(parsed.fidelity);
});

test('Canvas QTI ↔ Moodle XML conversions preserve image bytes both directions', () => {
  const fromQti = parseQtiZip(generateQtiZip(IMAGE_PACK));
  const viaMoodle = parseMoodleXml(generateMoodleXml({ ...IMAGE_PACK, ...fromQti }));
  assert.equal(viaMoodle.media[0].sha256, ASSET.sha256);

  const fromMoodle = parseMoodleXml(generateMoodleXml(IMAGE_PACK));
  const viaQti = parseQtiZip(generateQtiZip({ ...IMAGE_PACK, ...fromMoodle }));
  assert.equal(viaQti.media[0].sha256, ASSET.sha256);
});

test('exports content-address media with colliding source filenames', () => {
  const secondBytes = Buffer.concat([PNG, Buffer.from([0])]);
  const second = makeMediaAsset(secondBytes, 'pixel.png', 'image/png', 'other/pixel.png');
  const pack = {
    ...IMAGE_PACK,
    media: [ASSET, second],
    questions: [
      IMAGE_PACK.questions[0],
      { ...IMAGE_PACK.questions[0], question_id: 'image_q2', image_ids: [second.media_id] },
    ],
  };
  const moodle = parseMoodleXml(generateMoodleXml(pack));
  const qti = parseQtiZip(generateQtiZip(pack));
  assert.equal(new Set(moodle.media.map((asset) => asset.sha256)).size, 2);
  assert.equal(new Set(qti.media.map((asset) => asset.sha256)).size, 2);
});

test('media security rejects traversal, spoofed files, and oversized assets', () => {
  assert.throws(() => safeArchivePath('../escape.png'), /Unsafe package path/);
  assert.throws(() => safeArchivePath('/absolute.png'), /Unsafe package path/);
  assert.throws(() => makeMediaAsset(Buffer.from('not an image'), 'fake.png', 'image/png'), /Unsupported/);
  assert.throws(
    () => makeMediaAsset(Buffer.alloc(MAX_MEDIA_BYTES + 1), 'large.png', 'image/png'),
    /exceeds/
  );
});

test('controlled media store writes only verified content and hydrates exports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-media-'));
  const store = createMediaStore(root);
  const [stored] = store.persist([ASSET]);
  assert.ok(store.find(stored.media_id).startsWith(root + path.sep));
  const hydrated = store.hydrate({ ...stored, data_base64: undefined });
  assert.equal(hydrated.data_base64, ASSET.data_base64);
  fs.rmSync(root, { recursive: true, force: true });
});

test('provenance contains required source identity and timestamps', () => {
  const source = buildProvenance('canvas', 'qti_1.2', {
    course_id: '42',
    quiz_id: '7',
    source_url: 'https://canvas.example/courses/42/quizzes/7',
  });
  assert.equal(source.platform, 'canvas');
  assert.equal(source.course_id, '42');
  assert.equal(source.quiz_id, '7');
  assert.match(source.imported_at, /^\d{4}-\d\d-\d\dT/);
});

test('Canvas OAuth uses PKCE, state, HTTPS, and no token in authorization URL', () => {
  const pkce = createPkce();
  assert.ok(pkce.verifier.length >= 43);
  const url = new URL(buildAuthorizationUrl({
    baseUrl: 'https://school.instructure.com',
    clientId: 'client',
    redirectUri: 'https://tool.example/callback',
    state: 'one-time-state',
    codeChallenge: pkce.challenge,
  }));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'one-time-state');
  assert.equal(url.searchParams.has('access_token'), false);
  assert.throws(() => buildAuthorizationUrl({ baseUrl: 'http://canvas.example', clientId: 'x' }), /HTTPS/);
});

test('Canvas token store encrypts teacher tokens at rest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-token-'));
  const file = path.join(dir, 'tokens.json');
  const store = createCanvasTokenStore(file, 'a'.repeat(32));
  store.put('teacher-1', { access_token: 'super-secret-token', refresh_token: 'refresh-secret' });
  const raw = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(raw, /super-secret-token|refresh-secret/);
  assert.equal(store.get('teacher-1').access_token, 'super-secret-token');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Canvas REST course pull follows export protocol and records provenance', async () => {
  const qti = generateQtiZip(IMAGE_PACK);
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', headers: new Headers(init.headers || {}) });
    if (u.includes('/quizzes?')) return Response.json([{ id: 7, title: 'Image Quiz' }]);
    if (u.endsWith('/content_exports')) return Response.json({ id: 9, progress_url: 'https://school.instructure.com/api/v1/progress/9' });
    if (u.endsWith('/progress/9')) return Response.json({ workflow_state: 'exported', created_at: '2026-07-12T00:00:00Z', attachment: { url: 'https://files.instructure.com/export.zip' } });
    if (u === 'https://files.instructure.com/export.zip') return new Response(qti, { status: 200 });
    throw new Error(`unexpected request ${u}`);
  };
  const client = createCanvasClient({
    baseUrl: 'https://school.instructure.com',
    accessToken: 'teacher-token',
    fetchImpl: fakeFetch,
    poll: { delayMs: 0 },
  });
  const packs = await client.pullCourse('42');
  assert.equal(packs.length, 1);
  assert.equal(packs[0].source.course_id, '42');
  assert.equal(packs[0].source.quiz_id, '7');
  assert.equal(packs[0].media[0].sha256, ASSET.sha256);
  assert.ok(calls.every((call) => call.headers.get('user-agent') === USER_AGENT));
});

test('Canvas content_migrations push uploads QTI then polls completion', async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body });
    if (u.endsWith('/content_migrations')) {
      assert.match(String(init.body), /migration_type=qti_converter/);
      return Response.json({
        id: 33,
        progress_url: 'https://school.instructure.com/api/v1/progress/33',
        pre_attachment: { upload_url: 'https://uploads.instructure.com/files', upload_params: { key: 'value' } },
      });
    }
    if (u === 'https://uploads.instructure.com/files') return new Response('', { status: 201 });
    if (u.endsWith('/progress/33')) return Response.json({ workflow_state: 'completed' });
    throw new Error(`unexpected request ${u}`);
  };
  const client = createCanvasClient({
    baseUrl: 'https://school.instructure.com',
    accessToken: 'teacher-token',
    fetchImpl: fakeFetch,
    poll: { delayMs: 0 },
  });
  const result = await client.pushPack('42', IMAGE_PACK);
  assert.equal(result.migration_id, 33);
  assert.equal(result.workflow_state, 'completed');
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'POST', 'GET']);
});
