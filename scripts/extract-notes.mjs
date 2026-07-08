import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractVersionSection } from "./release-lib.mjs";

// 用法：node scripts/extract-notes.mjs <version>
// 從 CHANGELOG.md 印出該版本的區塊；找不到則印空字串並以非 0 結束（供 CI fallback）。
const __dirname = dirname(fileURLToPath(import.meta.url));
const changelogPath = resolve(__dirname, "..", "CHANGELOG.md");

const version = process.argv[2];
if (!version) {
  console.error("Usage: extract-notes.mjs <version>");
  process.exit(2);
}

if (!existsSync(changelogPath)) {
  process.exit(1);
}

const section = extractVersionSection(readFileSync(changelogPath, "utf8"), version);
if (!section) {
  process.exit(1);
}

process.stdout.write(section);
