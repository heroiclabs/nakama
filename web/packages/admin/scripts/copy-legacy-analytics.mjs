import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(here, "..");
const webRoot = resolve(adminRoot, "../..");
const source = resolve(webRoot, "analytics-dashboard/index.html");
const targetDir = resolve(adminRoot, "dist/legacy-analytics");
const target = resolve(targetDir, "index.html");

await mkdir(targetDir, { recursive: true });
await copyFile(source, target);

console.log(`[admin-dashboard] copied legacy analytics dashboard to ${target}`);
