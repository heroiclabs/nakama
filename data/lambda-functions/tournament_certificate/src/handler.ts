/**
 * tournament_certificate — AWS Lambda
 *
 * Two invocation modes:
 *
 *   1. API Gateway HTTP (GET /certificate/{certId}/render)
 *      Renders + uploads the PDF & OG image if not already present,
 *      then returns the public S3 URLs as JSON. This is the path the
 *      web /certificate/[id] page hits when it sees pdf_status="pending"
 *      on the Nakama-stored certificate row.
 *
 *   2. SQS / direct invoke ({ certId, force })
 *      Same render-and-upload, but triggered by a queued job (e.g. the
 *      post-settlement fan-out cron). `force: true` re-renders even if
 *      the S3 object already exists (used to push template updates).
 *
 * S3 layout:
 *   s3://intelli-verse-x-media/tournaments/certificates/{certId}.pdf
 *   s3://intelli-verse-x-media/tournaments/certificates/{certId}-og.png   (1200×630)
 *
 * Inputs come from Nakama via NakamaCertReader.readCertificate(certId).
 * In MVP we read straight from the public Nakama console API; once the
 * server-side wallet RPC includes a /certificate/internal read we'll
 * switch to that (lower latency).
 */

import type { APIGatewayProxyEventV2, Context, SQSEvent } from "aws-lambda";
import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";

const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.CERT_BUCKET || "intelli-verse-x-media";
const PREFIX = process.env.CERT_PREFIX || "tournaments/certificates";
const NAKAMA_BASE = process.env.NAKAMA_INTERNAL_URL || "http://nakama.nakama.svc.cluster.local:7350";
const NAKAMA_HTTP_KEY = process.env.NAKAMA_HTTP_KEY || "";

const s3 = new S3Client({ region: REGION });

type Tier = "gold" | "silver" | "bronze" | "participation";

interface CertificateRow {
  id: string;
  tier: Tier;
  player_username: string;
  tournament_name: string;
  tournament_slug: string;
  final_rank: number;
  final_score: number;
  issued_iso: string;
}

const TIER_COLORS: Record<Tier, [number, number, number]> = {
  gold:          [0.94, 0.74, 0.20],
  silver:        [0.78, 0.78, 0.80],
  bronze:        [0.80, 0.50, 0.20],
  participation: [0.40, 0.40, 0.42],
};

export const handler = async (
  event: APIGatewayProxyEventV2 | SQSEvent,
  _ctx: Context,
): Promise<unknown> => {
  // Route between the two invocation modes.
  if ("Records" in event && Array.isArray((event as SQSEvent).Records)) {
    for (const rec of (event as SQSEvent).Records) {
      try {
        const body = JSON.parse(rec.body || "{}");
        await renderCertificate(body.certId, !!body.force);
      } catch (err) {
        console.error("SQS render failed", err);
      }
    }
    return { ok: true };
  }

  const httpEvt = event as APIGatewayProxyEventV2;
  const certId = httpEvt.pathParameters?.certId;
  if (!certId) {
    return { statusCode: 400, body: JSON.stringify({ error: "certId required" }) };
  }
  try {
    const urls = await renderCertificate(certId, false);
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...urls }) };
  } catch (err) {
    console.error("render failed", err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};

async function renderCertificate(certId: string, force: boolean): Promise<{ pdf_url: string; og_url: string }> {
  const pdfKey = `${PREFIX}/${certId}.pdf`;
  const ogKey  = `${PREFIX}/${certId}-og.png`;
  const pdfUrl = publicUrl(pdfKey);
  const ogUrl  = publicUrl(ogKey);

  if (!force && (await s3Exists(pdfKey)) && (await s3Exists(ogKey))) {
    return { pdf_url: pdfUrl, og_url: ogUrl };
  }

  const row = await readCertificateRow(certId);
  if (!row) {
    throw new Error(`certificate row not found: ${certId}`);
  }

  const pdfBytes = await renderPdf(row);
  const ogBytes  = await renderOg(row);

  await Promise.all([
    s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: pdfKey, Body: pdfBytes,
      ContentType: "application/pdf", CacheControl: "public, max-age=31536000, immutable",
    })),
    s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: ogKey, Body: ogBytes,
      ContentType: "image/png", CacheControl: "public, max-age=31536000, immutable",
    })),
  ]);

  return { pdf_url: pdfUrl, og_url: ogUrl };
}

async function s3Exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") return false;
    throw err;
  }
}

async function readCertificateRow(certId: string): Promise<CertificateRow | null> {
  const url = `${NAKAMA_BASE}/v2/rpc/certificate_get?http_key=${encodeURIComponent(NAKAMA_HTTP_KEY)}`;
  const body = JSON.stringify({ id: certId });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), // Nakama wraps the payload in quotes
  });
  if (!res.ok) {
    console.error(`Nakama certificate_get HTTP ${res.status}`);
    return null;
  }
  const env = await res.json() as { payload?: string };
  if (!env?.payload) return null;
  try {
    const parsed = JSON.parse(env.payload);
    return parsed?.certificate ?? null;
  } catch {
    return null;
  }
}

function publicUrl(key: string): string {
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

// ── PDF rendering (pdf-lib, A4 landscape) ─────────────────────────────────
async function renderPdf(row: CertificateRow): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([842, 595]); // A4 landscape
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helv     = await doc.embedFont(StandardFonts.Helvetica);
  const [r, g, b] = TIER_COLORS[row.tier];

  // Border
  page.drawRectangle({ x: 30, y: 30, width: 782, height: 535, borderColor: rgb(r, g, b), borderWidth: 6 });

  page.drawText("QUIZVERSE TOURNAMENT", {
    x: 60, y: 510, size: 12, font: helvBold, color: rgb(0.3, 0.3, 0.3),
  });
  page.drawText(tierTitle(row.tier), {
    x: 60, y: 470, size: 38, font: helvBold, color: rgb(r, g, b),
  });

  page.drawText(row.player_username, {
    x: 60, y: 360, size: 42, font: helvBold, color: rgb(0.1, 0.1, 0.12),
  });
  page.drawText(row.tournament_name, {
    x: 60, y: 310, size: 22, font: helv, color: rgb(0.3, 0.3, 0.35),
  });
  page.drawText(`Final rank: #${row.final_rank}     Score: ${row.final_score.toLocaleString()}`, {
    x: 60, y: 250, size: 16, font: helv, color: rgb(0.3, 0.3, 0.35),
  });
  page.drawText(`Issued ${formatDate(row.issued_iso)}  ·  verify: ${row.id}`, {
    x: 60, y: 60, size: 10, font: helv, color: rgb(0.55, 0.55, 0.6),
  });

  return doc.save();
}

// ── Open-graph share image (1200x630, sharp + SVG) ────────────────────────
async function renderOg(row: CertificateRow): Promise<Buffer> {
  const [r, g, bl] = TIER_COLORS[row.tier];
  const hex = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(bl * 255)})`;
  const svg = `
    <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0a0b10"/>
          <stop offset="100%" stop-color="#1c1d28"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#bg)"/>
      <rect x="40" y="40" width="1120" height="550" fill="none" stroke="${hex}" stroke-width="6" rx="20"/>
      <text x="80" y="140" fill="${hex}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="28" letter-spacing="6">
        ${tierTitle(row.tier).toUpperCase()}
      </text>
      <text x="80" y="280" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="86">
        ${escapeXml(row.player_username)}
      </text>
      <text x="80" y="360" fill="#cdd0d8" font-family="Helvetica, Arial, sans-serif" font-size="36">
        ${escapeXml(row.tournament_name)}
      </text>
      <text x="80" y="470" fill="#9aa0ad" font-family="Helvetica, Arial, sans-serif" font-size="28">
        Final rank #${row.final_rank}  ·  ${row.final_score.toLocaleString()} pts
      </text>
      <text x="80" y="560" fill="#5d6275" font-family="Helvetica, Arial, sans-serif" font-size="20">
        QuizVerse Tournaments  ·  quizverse.world
      </text>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function tierTitle(tier: Tier): string {
  switch (tier) {
    case "gold":          return "GOLD · #1";
    case "silver":        return "SILVER · TOP 3";
    case "bronze":        return "BRONZE · TOP 10";
    case "participation": return "PARTICIPATION";
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso || Date.now());
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[c]!));
}
