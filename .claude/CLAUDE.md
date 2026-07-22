# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
yarn bump [major|minor|patch|build|x.y.z.w]  # Bump version + generate CHANGELOG note + commit + tag (no push). Add --dry-run to preview.
yarn build              # Local packaging: bundles + packs .streamDeckPlugin from manifest version → releases/ (no versioning/tag)
yarn build:bundle       # Clean + Rollup bundle only (no packaging/versioning)
yarn watch              # Development mode with auto-rebuild and plugin restart
yarn test               # Run vitest test suite (tests/)
yarn lint               # Biome lint check
yarn lint:fix           # Biome lint with auto-fix
yarn screenshots:key-states  # Generate README screenshots of button key states
```

**Release flow**: `yarn bump <level>` owns versioning — it computes the next 4-part version (`major.minor.patch.build`), writes it into `manifest.json`, generates a `CHANGELOG.md` section from `git log <last v* tag>..HEAD` grouped by Conventional-Commit prefix, commits, and creates an annotated tag `vX` (does NOT push). Pushing the tag triggers `.github/workflows/release.yml`, which packs and publishes a GitHub Release whose notes come from the CHANGELOG section for that version (`scripts/extract-notes.mjs` → `gh release --notes-file`); if the section is absent, `scripts/generate-notes.mjs` regenerates the notes from the git log between the previous `v*` tag and the pushed tag (checkout uses `fetch-depth: 0` for this), with `--generate-notes` as the last resort. `yarn bump` aborts if the working tree has uncommitted changes or if there are no notable commits since the last tag (bypass with `--force`) — this prevents tagging before the feature commit lands, which would ship a release missing both the code and the notes. `yarn build` is now packaging-only (reads the current `manifest.json` version, no prompt, no tag) for local `.streamDeckPlugin` builds. Pure release helpers live in `scripts/release-lib.mjs` (unit-tested in `tests/release-lib.test.ts`).

`yarn clean` removes `bin/` before bundling — Rollup does not clean its output dir, and stale hashed chunks would otherwise get packed into the plugin.

`yarn watch` restarts the plugin via the `streamdeck://plugins/restart/<uuid>` deep link (`open -g`) instead of `streamdeck restart` — the CLI's process check (find-process) crashes with ERR_CHILD_PROCESS_STDIO_MAXBUFFER when `ps ax -ww` output exceeds its hardcoded 2MB buffer, which happens on this machine (~4MB).

## Development Setup

1. Install dependencies: `yarn install`
2. Create symlink for development testing:
   ```bash
   ln -s /path/to/aws-monitor/com.phantas-weng.aws-monitor.sdPlugin ~/Library/Application\ Support/com.elgato.StreamDeck/Plugins/com.phantas-weng.aws-monitor.sdPlugin
   ```
3. Run `yarn watch` for development with hot reload
4. Launch Stream Deck in debug mode to view plugin logs:
   ```bash
   open -a "Elgato Stream Deck" --args -debug
   ```
5. Install plugin: `streamdeck install com.phantas-weng.aws-monitor.sdPlugin`

## Architecture

This is a **Stream Deck plugin** for monitoring AWS CodePipeline deployments.

**Tech Stack**: TypeScript, Elgato Stream Deck SDK v2.0.2, AWS SDK v3, @napi-rs/canvas (prebuilt, statically-linked; node-canvas compat entry), Rollup, Vitest, Biome

**Entry Point**: `src/plugin.ts` — registers the `CodePipelineMonitor` action and connects to Stream Deck. Logger level is `info` in production; bump to `debug`/`trace` temporarily when debugging.

**Source Modules** (`src/`):
- `actions/codepipeline.ts` — `CodePipelineMonitor` action class + polling orchestration (`startMonitoring` / `pollOnce`). Debug mode and real mode share the same polling/render flow via an injected `StatusFetcher`.
- `settings.ts` — settings type, normalization, validation, URL builders (pure functions, unit-tested)
- `button-state.ts` — per-button `ButtonState` in a single `Map<actionId, ButtonState>` (timers, loading animation, cached AWS client). `disposeButtonState()` cleans everything at once on `onWillDisappear`.
- `transitions.ts` — stage-status-change tracking with brief "TransitionLoading" overlay (300ms), unit-tested
- `polling.ts` — pure poll-cadence logic: `isLoadingStatus`, `classifyPoll` (active/settled/terminated + `pollingStartedAt` bookkeeping), `deriveFooter`, `FrameFooter` type. Unit-tested, no canvas/AWS deps.
- `rendering.ts` — @napi-rs/canvas drawing (144×144): stage 狀態畫成分段進度條（每段依狀態上色，任意 stage 數自動均分，下方顯示「完成數/總數」），footer 用 Iconify line-md SVG 圖示 + full-frame data-URL cache
- `aws.ts` — CodePipeline client (cached per button, credentials passed directly — never via `process.env`) and stage-status fetch
- `debug.ts` — simulated 3-stage pipeline fetcher for debug mode

**Action Pattern**: Uses `SingletonAction` from Stream Deck SDK. Handles `onWillAppear`, `onKeyDown`, `onKeyUp`, `onWillDisappear`, `onDidReceiveSettings`.

**Polling behavior**: Two-speed, never-stopping loop (see `src/polling.ts`). Polls every 60 seconds while any stage is in progress (fast); drops to every 5 minutes once settled (all succeeded or contains a failure) so it keeps auto-detecting the next deployment without a manual press. When a settled stage goes back to in-progress it switches straight back to fast polling. `pollingMaxMinutes` (default 30) now caps how long a single in-progress run is *fast-watched*; exceeding it slows to idle polling and shows the terminated footer (it no longer stops the loop). Only `onWillDisappear` (or incomplete settings) stops polling. Transient fetch errors never stop the loop — fast retry within the window, then idle retry.

**UI/Settings**: `com.phantas-weng.aws-monitor.sdPlugin/ui/codepipeline.html` — Property inspector for AWS credentials and pipeline settings. `sdpi-components.js` is vendored locally in `ui/libs/` (no CDN dependency).

**Manifest**: `com.phantas-weng.aws-monitor.sdPlugin/manifest.json` — Plugin version, action UUIDs, Node.js 20 runtime config

**Build Output**: Rollup bundles `src/plugin.ts` → `com.phantas-weng.aws-monitor.sdPlugin/bin/plugin.js` (code-split chunks with hashed names)

## Key Implementation Details

**Canvas rendering**: uses `@napi-rs/canvas` via its node-canvas compat entry (`@napi-rs/canvas/node-canvas.js` — keeps the `CanvasRenderingContext2D` type name). Its prebuilt `.node` binaries are **statically linked** (no external Cairo/Pango DLLs), so packaging just needs the right `skia.*.node` per platform. All button images are drawn via `createCanvas(144, 144)` and sent as base64 data URLs via `ev.action.setImage()`.

**Canvas packaging (IMPORTANT — do not regress)**: `@napi-rs/canvas` is `external` in `rollup.config.mjs` (its loader dynamically `require`s the platform `.node`, which a bundler must not rewrite). The Stream Deck runtime does **NOT** provide `canvas` — nothing does automatically. `scripts/copy-canvas.mjs` copies the loader + all target-platform binaries (macOS arm64/x64, Windows x64 — Windows-on-ARM is intentionally omitted; adjust `TARGETS` to change) into `com.phantas-weng.aws-monitor.sdPlugin/node_modules/@napi-rs/canvas/` before packing, so the `.streamDeckPlugin` is self-contained. Run in both `scripts/build.mjs` (local) and the CI "Bundle canvas into plugin" step (before `streamdeck pack`). Without this copy the packed plugin crashes on every clean install with `ERR_MODULE_NOT_FOUND` — it only "worked" on the dev machine because the install symlink lets Node resolve up into the repo's `node_modules`. This was the historical Windows-crash bug (the previous `canvas`/node-canvas build was never shipped in the package). `@napi-rs/canvas` is version-pinned (exact) so the copied loader JS matches the fetched binaries.

**Frame cache**: the loading animation phase advances in 24° steps (15 distinct frames — drives the in-progress segments' pulse and the footer breathing arrow) and the only other time-varying element is the `HH:mm` footer text, so `rendering.ts` caches complete frame data URLs keyed by `(title, statuses, footer, rotation)` and invalidates the cache when the minute changes. This avoids re-drawing/PNG-encoding at 10 FPS.

**Button interactions**: short press → refresh; double-click (within 500ms) → open CloudWatch logs (requires `logGroupName`); long-press (0.8s) → open AWS Console

**Debug mode**: Set `pipelineName` to `debug` (or `debug:N` for an N-stage simulation, N clamped to 1–12) in settings — simulates pipeline progression without AWS credentials (see `src/debug.ts`). Useful for UI development.

**Settings normalization**: `normalizeSettings()` runs on every settings change, coalescing the deprecated `region` field into `pipelineRegion`/`logRegion`.

**Tests**: `tests/` covers the pure modules (`settings`, `transitions`, `debug`, `polling`). Rendering/AWS modules are not covered (require canvas / network).

**Code comments**: Written in Traditional Chinese (zh-TW).
