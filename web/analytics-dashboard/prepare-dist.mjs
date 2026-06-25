/**
 * Bundle web/analytics-dashboard for Nakama embed (console/ui/dist/analytics.html).
 *
 * Dev: index.html + dashboard.css (external link, npx serve).
 * Prod: inlines dashboard.css into analytics.html so /analytics.html works without a separate CSS file.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const srcHtml = path.join(here, 'index.html');
const srcCss = path.join(here, 'dashboard.css');
const distDir = path.join(repoRoot, 'console', 'ui', 'dist');
const linkRe = /<link\s+rel="stylesheet"\s+href="dashboard\.css"\s*>\s*/i;

function main() {
  if (!fs.existsSync(srcHtml)) {
    console.error('prepare-dist: missing', srcHtml);
    process.exit(1);
  }
  if (!fs.existsSync(srcCss)) {
    console.error('prepare-dist: missing', srcCss);
    process.exit(1);
  }

  const html = fs.readFileSync(srcHtml, 'utf8');
  const css = fs.readFileSync(srcCss, 'utf8');

  if (!linkRe.test(html)) {
    console.error('prepare-dist: index.html has no <link rel="stylesheet" href="dashboard.css">');
    process.exit(1);
  }

  const bundled = html.replace(linkRe, `<style>\n${css}\n</style>\n`);

  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'analytics.html'), bundled);
  fs.writeFileSync(path.join(distDir, 'analytics2.html'), bundled);
  fs.copyFileSync(srcCss, path.join(distDir, 'dashboard.css'));

  console.log('prepare-dist: wrote console/ui/dist/analytics.html (CSS inlined)');
  console.log('prepare-dist: wrote console/ui/dist/analytics2.html (CSS inlined)');
  console.log('prepare-dist: copied console/ui/dist/dashboard.css');
}

main();
