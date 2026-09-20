// `npm test` — runs every tests/*.test.ts under node:test with tsx as the
// TypeScript loader. This wrapper exists because Node 20's `--test` neither
// expands globs itself nor discovers `.ts` files when handed a directory,
// and npm scripts get no shell globbing on Windows.

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = path.join(root, "tests");

const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => path.join("tests", f))
  .sort();

if (files.length === 0) {
  console.error("no tests found in tests/");
  process.exit(1);
}

const res = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  cwd: root,
  stdio: "inherit",
});
process.exit(res.status ?? 1);
