import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const pluginPath = resolve(rootDir, "com.phantas-weng.aws-monitor.sdPlugin");
const manifestPath = resolve(pluginPath, "manifest.json");
const releaseDir = resolve(rootDir, "releases");

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const runCapture = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: false
  });

  return result;
};

const readCurrentPluginVersion = () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return manifest.Version;
};

const askNextVersion = async (currentVersion) => {
  if (!input.isTTY || !output.isTTY) {
    console.error("Build requires an interactive terminal to input the next version.");
    process.exit(1);
  }

  const rl = createInterface({ input, output });

  try {
    console.log(`Current plugin version: ${currentVersion}`);
    const nextVersion = (await rl.question("What should the next version be? ")).trim();

    if (!nextVersion) {
      console.error("Version cannot be empty.");
      process.exit(1);
    }

    return nextVersion;
  } finally {
    rl.close();
  }
};

const main = async () => {
  run("yarn", ["build:bundle"]);

  const currentVersion = readCurrentPluginVersion();
  const nextVersion = await askNextVersion(currentVersion);

  if (!existsSync(releaseDir)) {
    mkdirSync(releaseDir, { recursive: true });
  }

  run("streamdeck", [
    "pack",
    pluginPath,
    "--version",
    nextVersion,
    "-o",
    releaseDir,
    "-f"
  ]);

  const tagName = `v${nextVersion}`;
  const tagCheck = runCapture("git", ["tag", "--list", tagName]);
  if (tagCheck.status !== 0) {
    console.error("Failed to check existing git tags.");
    process.exit(tagCheck.status ?? 1);
  }

  if (tagCheck.stdout.trim() === tagName) {
    console.error(`Git tag already exists: ${tagName}`);
    process.exit(1);
  }

  run("git", ["tag", tagName]);
  console.log(`Created git tag: ${tagName}`);
};

await main();
