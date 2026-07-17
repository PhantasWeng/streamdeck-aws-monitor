import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import {
  buildChangelog,
  computeNextVersion,
  groupCommits,
  parseCommitLines,
  renderChangelogSection,
  replaceManifestVersion,
} from "./release-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const manifestPath = resolve(rootDir, "com.phantas-weng.aws-monitor.sdPlugin", "manifest.json");
const changelogPath = resolve(rootDir, "CHANGELOG.md");

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit", shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const capture = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`Command failed: ${command} ${args.join(" ")}\n${result.stderr ?? ""}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
};

const readManifestVersion = () => JSON.parse(readFileSync(manifestPath, "utf8")).Version;

// 只替換 Version 那一行，保留檔案其餘格式（tab 縮排等）
const writeManifestVersion = (nextVersion) => {
  const text = readFileSync(manifestPath, "utf8");
  writeFileSync(manifestPath, replaceManifestVersion(text, nextVersion));
};

const localDate = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// 取上一個 v* tag（依建立時間），無則回傳 null（涵蓋全部歷史）
const lastVersionTag = () => {
  const out = capture("git", ["tag", "--list", "v*", "--sort=-creatordate"]).trim();
  return out ? out.split("\n")[0].trim() : null;
};

const commitsSince = (tag) => {
  const range = tag ? [`${tag}..HEAD`] : ["HEAD"];
  return parseCommitLines(capture("git", ["log", ...range, "--no-merges", "--pretty=format:%h%x09%s"]));
};

// 工作區有未 commit 的變更時中止：bump 若先於功能 commit，tag 指到的 commit
// 不含該變更，release 包與 note 都會漏掉（--force 可略過）
const assertCleanWorkTree = (force) => {
  const out = capture("git", ["status", "--porcelain"]).trim();
  if (!out) {
    return;
  }
  const lines = out.split("\n");
  const untracked = lines.filter((line) => line.startsWith("??"));
  const modified = lines.filter((line) => !line.startsWith("??"));
  if (modified.length > 0 && !force) {
    console.error("工作區有未 commit 的變更，請先 commit（或 stash）再 bump，否則這些變更不會進入 release：");
    console.error(modified.map((line) => `  ${line}`).join("\n"));
    console.error("（確定要略過此檢查請加 --force）");
    process.exit(1);
  }
  if (untracked.length > 0) {
    console.warn(`注意：${untracked.length} 個未追蹤檔案不會進入 release。`);
  }
};

const askBump = async (currentVersion) => {
  if (!input.isTTY || !output.isTTY) {
    console.error("Provide a bump argument (major|minor|patch|build or x.y.z.w) in non-interactive mode.");
    process.exit(1);
  }
  const rl = createInterface({ input, output });
  try {
    console.log(`Current version: ${currentVersion}`);
    const answer = (await rl.question("Bump to (major|minor|patch|build or explicit x.y.z.w)? ")).trim();
    if (!answer) {
      console.error("Bump cannot be empty.");
      process.exit(1);
    }
    return answer;
  } finally {
    rl.close();
  }
};

const main = async () => {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const positional = argv.filter((a) => !a.startsWith("--"));

  if (!dryRun) {
    assertCleanWorkTree(force);
  }

  const currentVersion = readManifestVersion();
  const bumpArg = positional[0] ?? (await askBump(currentVersion));
  const nextVersion = computeNextVersion(currentVersion, bumpArg);
  const tagName = `v${nextVersion}`;

  if (capture("git", ["tag", "--list", tagName]).trim() === tagName) {
    console.error(`Git tag already exists: ${tagName}`);
    process.exit(1);
  }

  const lastTag = lastVersionTag();
  const groups = groupCommits(commitsSince(lastTag));
  const section = renderChangelogSection(nextVersion, localDate(), groups);

  // 沒有任何可寫進 note 的 commit → 多半是還沒 commit 就 bump，中止避免發出空 release
  if (groups.length === 0 && !dryRun && !force) {
    console.error(`自 ${lastTag ?? "初始 commit"} 以來沒有可寫入 release note 的 commit（note 會是「No notable changes」）。`);
    console.error("請確認功能已 commit；確定要發佈空版本請加 --force。");
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[dry-run] ${currentVersion} → ${nextVersion} (tag ${tagName})`);
    console.log(`[dry-run] release note range: ${lastTag ?? "(全部歷史)"}..HEAD\n`);
    console.log(section);
    console.log(`[dry-run] 不會寫檔、commit 或 tag。`);
    return;
  }

  const existingChangelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
  writeFileSync(changelogPath, buildChangelog(existingChangelog, section));
  writeManifestVersion(nextVersion);

  run("git", ["add", manifestPath, changelogPath]);
  run("git", ["commit", "-m", `chore: release ${tagName}`]);
  run("git", ["tag", "-a", tagName, "-m", section]);

  console.log(`\n✓ Bumped ${currentVersion} → ${nextVersion}`);
  console.log(`✓ Updated manifest.json and CHANGELOG.md`);
  console.log(`✓ Committed and created annotated tag ${tagName}`);
  console.log(`\n下一步（確認無誤後推送以觸發 CI Release）：`);
  console.log(`  git push && git push origin ${tagName}`);
};

await main();
