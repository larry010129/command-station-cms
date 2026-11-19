// Copy published releases into the sibling command-station-releases repo (Cloudflare Pages host).
// Usage: npm run sync:releases   then commit + push ../command-station-releases
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../data/releases/", import.meta.url));
const repo = fileURLToPath(new URL("../../command-station-releases/", import.meta.url));
if (!existsSync(repo + ".git")) {
  console.error("Clone command-station-releases next to this folder first.");
  process.exit(1);
}
const dest = repo + "public/releases/";
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const name of ["current.json", "by-number", "blobs"]) {
  if (existsSync(src + name)) cpSync(src + name, dest + name, { recursive: true });
}
console.log("Synced to", dest, "- now commit and push command-station-releases.");
