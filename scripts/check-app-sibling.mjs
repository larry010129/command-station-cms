// The contract tests run the CMS output through the app's own code, so the app repo must sit next to this one.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../../command-station/src/state/gachaContent.ts", import.meta.url));
if (!existsSync(app)) {
  console.error("Contract tests need the app repo checked out next to this one as ../command-station (not found).");
  process.exit(1);
}
