import { execFileSync } from "node:child_process";
import { groupCommits, parseCommitLines, renderChangelogSection } from "./release-lib.mjs";

// 用法：node scripts/generate-notes.mjs <tag>
// 找出 <tag> 沿祖先鏈的前一個 v* tag，用兩個 tag 之間的 commit 產生 release note 區塊。
// CHANGELOG.md 抽不到該版本區塊時，CI 以此作為 fallback（需要完整 git 歷史與 tags）。
const tag = process.argv[2];
if (!tag) {
  console.error("Usage: generate-notes.mjs <tag>");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

// 沿 tag 的父 commit 找前一個 v* tag；第一個 release 沒有前一個 tag，改涵蓋全部歷史
let prevTag = null;
try {
  prevTag = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  prevTag = null;
}

const range = prevTag ? `${prevTag}..${tag}` : tag;
const commits = parseCommitLines(git("log", range, "--no-merges", "--pretty=format:%h%x09%s"));

const version = tag.replace(/^v/, "");
const dateStr = git("log", "-1", "--format=%cd", "--date=format:%Y-%m-%d", tag);
process.stdout.write(renderChangelogSection(version, dateStr, groupCommits(commits)));
