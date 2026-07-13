'use strict';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** JSON safe to inline inside a <script> tag. */
function inlineJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
}

const BASE_CSS = `
  :root {
    --bg: #f6f7fb; --card: #ffffff; --ink: #1d2333; --muted: #6b7280;
    --accent: #4f46e5; --accent-ink: #ffffff; --ok: #16a34a; --warn: #d97706; --err: #dc2626;
    --border: #e5e7eb; --radius: 12px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: var(--bg); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
  }
  .card {
    max-width: 720px; margin: 0 auto; background: var(--card);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.06);
  }
  h1 { font-size: 1.35rem; margin: 0 0 8px; }
  h2 { font-size: 1.1rem; margin: 0 0 8px; }
  p.muted, span.muted { color: var(--muted); }
  button.primary {
    background: var(--accent); color: var(--accent-ink); border: 0;
    padding: 12px 24px; border-radius: 8px; font-size: 1rem; cursor: pointer;
  }
  button.primary:disabled { opacity: .5; cursor: default; }
  button.ghost {
    background: transparent; border: 1px solid var(--border); color: var(--ink);
    padding: 10px 18px; border-radius: 8px; font-size: .95rem; cursor: pointer;
  }
  .chip {
    display: inline-block; padding: 4px 12px; border-radius: 999px;
    font-size: .8rem; font-weight: 600; border: 1px solid var(--border);
  }
  .chip.ok { background: #ecfdf5; color: var(--ok); border-color: #a7f3d0; }
  .chip.warn { background: #fffbeb; color: var(--warn); border-color: #fde68a; }
  .chip.err { background: #fef2f2; color: var(--err); border-color: #fecaca; }
  .chip.pending { background: #eef2ff; color: var(--accent); border-color: #c7d2fe; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: .9rem; }
  code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: .85em; word-break: break-all; }
  input[type=text], input[type=url], input[type=number], select {
    width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; font-size: .95rem;
  }
  label { display: block; font-size: .85rem; font-weight: 600; margin: 12px 0 4px; }
`;

function page(title, body, extraCss = '', script = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}${extraCss}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

module.exports = { page, escapeHtml, inlineJson };
