# P4/P5 Verification Report

Verified 2026-07-12 from the isolated `feat/lms-tool-web-service` worktree.

## Exit criteria

### P4 — content pull

- **PASS — Canvas QTI 1.2 parser:** manifest-required package parsing, answer keys, metadata, rich text, and referenced images are covered by automated fixtures.
- **PASS — Moodle XML parser:** real Moodle XML plus generated image-bearing XML parse into playable canonical packs.
- **PASS — images survive both formats:** Canvas QTI → Moodle XML → canonical and Moodle XML → QTI → canonical preserve SHA-256 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`.
- **PASS — safe extraction:** archive traversal, absolute paths, spoofed media, per-file size, expanded-package size, and aggregate media size are rejected. Persisted files use content-addressed names in a controlled directory.
- **PASS — provenance:** imported packs carry platform, format, course/quiz IDs when known, source URL/file/hash, and timestamps.
- **PASS — mandatory fidelity report:** every converter/import path validates a machine-readable report with per-item status, notes, dropped fields, totals, report ID, and timestamp. The report is stored with the local pack and sent to Nakama.
- **PASS (protocol) — Canvas teacher OAuth course pull:** PKCE, one-time state, encrypted token-at-rest, stable User-Agent, classic-quiz QTI export polling/download, and pack import are covered by a fake HTTP platform protocol test.
- **EXTERNAL — real Canvas tenant:** no institution developer key + teacher OAuth grant was available. The local Canvas container was not counted as tenant proof.

### P5 — content push and bridge

- **PASS — Moodle XML export:** canonical packs export rich metadata and inline base64 images.
- **PASS — Canvas QTI export:** canonical packs export IMS Content Packaging zip with `imsmanifest.xml`, assessment XML, and referenced media resources.
- **PASS (protocol) — Canvas `content_migrations` push:** automated test proves migration creation (`qti_converter`), signed upload handoff, and completion polling. This is not a real-tenant claim.
- **PASS — standalone converter:** `/converter` and `/api/converter/convert` provide Canvas QTI ↔ Moodle XML conversion with mandatory fidelity and provenance.
- **PASS — real Moodle import/export:** Moodle build `2024100704` imported one generated image-bearing question and exported it back. Re-parse returned `questions=1`, `media=1`, `imported=1`, `imported_with_loss=0`, `skipped=0`, with the identical image SHA-256 above.

## Reproduction

```bash
cd web/lms-tool
npm test
LMS_REAL_FIXTURE_DIR=/absolute/path/to/.lms-dev/fixtures npm test
node scripts/verify-p4p5-fixtures.js /tmp/qv-p4p5-proof

docker cp /tmp/qv-p4p5-proof/p4p5-input.moodle.xml lms-moodle-moodle-1:/tmp/p4p5-input.moodle.xml
docker cp scripts/moodle-real-roundtrip.php lms-moodle-moodle-1:/tmp/moodle-real-roundtrip.php
docker exec lms-moodle-moodle-1 php /tmp/moodle-real-roundtrip.php \
  /tmp/p4p5-input.moodle.xml /tmp/p4p5-exported.moodle.xml
```

## Remaining blockers

1. A Canvas administrator must issue a developer key and authorize a teacher account on a real tenant.
2. Run course pull and `content_migrations` push there, then import the pushed quiz in Canvas and visually verify the image.
3. Canvas New Quizzes migration remains outside this P4/P5 classic-QTI scope; the undocumented `settings[import_quizzes_next]` flag is intentionally not used.
