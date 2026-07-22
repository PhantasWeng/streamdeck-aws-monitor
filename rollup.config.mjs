import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";
import json from '@rollup/plugin-json';

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.phantas-weng.aws-monitor.sdPlugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
	input: "src/plugin.ts",
	output: {
		dir: `${sdPlugin}/bin`,
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		}
	},
	// @napi-rs/canvas（含 /node-canvas 相容層）維持 external：其 loader 會動態 require
	// 各平台的 skia.*.node，不能被打包器改寫；binary 由 scripts/copy-canvas.mjs 複製進外掛。
	external: [/^@napi-rs\/canvas(\/|$)/],
	plugins: [
		{
			name: "watch-externals",
			buildStart: function () {
				this.addWatchFile(`${sdPlugin}/manifest.json`);
			},
		},
		typescript({
			mapRoot: isWatching ? "./" : undefined
		}),
		json(),
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true
		}),
		commonjs(),
		!isWatching && terser(),
		{
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			}
		}
	]
};

export default config;
