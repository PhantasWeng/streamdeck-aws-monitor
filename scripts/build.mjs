import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

const readCurrentPluginVersion = () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return manifest.Version;
};

// 本地打包：讀 manifest.json 現有版本，打包成 .streamDeckPlugin 供本地安裝/測試。
// 版本、CHANGELOG、git tag 一律由 `yarn bump` 負責，正式 release 由 CI（tag push）處理。
const main = async () => {
  run("yarn", ["build:bundle"]);

  // canvas 為 external：把 @napi-rs/canvas 及各平台 binary 複製進外掛 node_modules，
  // 否則封裝出的 .streamDeckPlugin 在乾淨安裝時會 ERR_MODULE_NOT_FOUND 崩潰。
  run("node", ["scripts/copy-canvas.mjs"]);

  const version = readCurrentPluginVersion();

  if (!existsSync(releaseDir)) {
    mkdirSync(releaseDir, { recursive: true });
  }

  run("streamdeck", [
    "pack",
    pluginPath,
    "--version",
    version,
    "-o",
    releaseDir,
    "-f"
  ]);

  console.log(`Packed plugin v${version} → ${releaseDir}`);
};

await main();
