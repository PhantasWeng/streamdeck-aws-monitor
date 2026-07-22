// 將 @napi-rs/canvas 及各平台預編譯 binary 複製進外掛資料夾的 node_modules，
// 讓封裝出的 .streamDeckPlugin 自帶 canvas（外掛執行期 import '@napi-rs/canvas/node-canvas.js'
// 會從此處解析）。@napi-rs/canvas 的 loader 對每個平台會「先試本地 ./skia.<triple>.node、
// 再試 @napi-rs/canvas-<triple> 套件」，且該 .node 為靜態連結（免額外 DLL），因此只要把
// 對應平台的 skia.*.node 放進 loader 同目錄即可跨 macOS/Windows 運作。
//
// 這解決了原本 canvas 被標為 external 卻從未進封裝包、只在 dev 機器靠 symlink 走到 repo
// node_modules 才不崩的問題（乾淨安裝一律 ERR_MODULE_NOT_FOUND）。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const pluginDir = resolve(rootDir, 'com.phantas-weng.aws-monitor.sdPlugin');

const canvasSrc = resolve(rootDir, 'node_modules/@napi-rs/canvas');
const canvasDest = resolve(pluginDir, 'node_modules/@napi-rs/canvas');

// 外掛實際會在 macOS / Windows 上執行，需備妥兩者的預編譯 binary。
// macOS 無 universal 套件，故 arm64 + x64 各備一份；Windows 走 x64 msvc 版
// （不含 win32-arm64：Windows on ARM 的 Stream Deck 使用者極少，省下約 19MB 封裝體積）。
const TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64-msvc'];

if (!existsSync(canvasSrc)) {
	console.error('[copy-canvas] 找不到 node_modules/@napi-rs/canvas，請先 yarn install。');
	process.exit(1);
}

const version = JSON.parse(readFileSync(join(canvasSrc, 'package.json'), 'utf8')).version;

// 1) 重建目的地並複製 loader（純 JS，本身不含 .node）
rmSync(canvasDest, { recursive: true, force: true });
mkdirSync(canvasDest, { recursive: true });
cpSync(canvasSrc, canvasDest, { recursive: true });

// 2) 逐平台備妥 skia.<triple>.node：優先用 repo 已安裝的（等於本機平台，免下載），
//    其餘平台以 `npm pack` 抓取對應套件的 tarball 後解出 .node（與宿主平台無關）。
const tmpRoot = join(tmpdir(), `napi-canvas-${version}-${process.pid}`);
mkdirSync(tmpRoot, { recursive: true });

const placed = [];
try {
	for (const triple of TARGETS) {
		const fileName = `skia.${triple}.node`;
		const dest = join(canvasDest, fileName);
		const localPkgBinary = resolve(rootDir, `node_modules/@napi-rs/canvas-${triple}`, fileName);

		if (existsSync(localPkgBinary)) {
			cpSync(localPkgBinary, dest);
			placed.push(`${fileName} (local)`);
			continue;
		}

		// npm pack 只是下載並重打包指定套件的 tarball，不會依宿主平台過濾，
		// 因此可在 macOS / Linux CI 上取得 win32 的 binary。
		const pkg = `@napi-rs/canvas-${triple}@${version}`;
		const packDir = join(tmpRoot, triple);
		mkdirSync(packDir, { recursive: true });
		const out = execFileSync('npm', ['pack', pkg, '--pack-destination', packDir, '--silent'], {
			cwd: rootDir,
			encoding: 'utf8',
		});
		const tarball = out.trim().split('\n').pop().trim();
		execFileSync('tar', ['-xzf', join(packDir, tarball), '-C', packDir]);
		const extracted = join(packDir, 'package', fileName);
		if (!existsSync(extracted)) {
			throw new Error(`${pkg} 內找不到 ${fileName}`);
		}
		cpSync(extracted, dest);
		placed.push(`${fileName} (npm pack)`);
	}
} finally {
	rmSync(tmpRoot, { recursive: true, force: true });
}

// 3) 驗證：每個目標 binary 皆到位，否則讓建置失敗（避免打包出殘缺的外掛）
const missing = TARGETS.map((t) => `skia.${t}.node`).filter((f) => !existsSync(join(canvasDest, f)));
if (missing.length > 0) {
	console.error(`[copy-canvas] 缺少 binary：${missing.join(', ')}`);
	process.exit(1);
}

console.log(`[copy-canvas] @napi-rs/canvas@${version} → ${canvasDest.replace(`${rootDir}/`, '')}`);
console.log(`[copy-canvas] loader: ${readdirSync(canvasDest).filter((f) => f.endsWith('.js')).length} js 檔`);
for (const p of placed) console.log(`[copy-canvas]   ${p}`);
