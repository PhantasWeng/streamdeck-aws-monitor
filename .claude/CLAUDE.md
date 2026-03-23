# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
yarn build              # Production build: bundles + prompts for version + packs .streamDeckPlugin + creates git tag
yarn build:bundle       # Rollup bundle only (no packaging/versioning)
yarn watch              # Development mode with auto-rebuild and plugin restart
yarn screenshots:key-states  # Generate README screenshots of button key states
```

`yarn build` is interactive — it reads the version from `manifest.json`, prompts for the next version, runs `streamdeck pack`, outputs to `releases/`, and tags git.

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

**Tech Stack**: TypeScript, Elgato Stream Deck SDK v2.0.2, AWS SDK v3, node-canvas, Rollup

**Entry Point**: `src/plugin.ts` — registers the `CodePipelineMonitor` action and connects to Stream Deck.

**Action Pattern**: Uses `SingletonAction` from Stream Deck SDK. Each action handles Stream Deck events (`onWillAppear`, `onKeyDown`, `onKeyUp`, `onWillDisappear`, `onDidReceiveSettings`).

**Main Action**: `src/actions/codepipeline.ts` — `CodePipelineMonitor`
- Polls AWS CodePipeline every 60 seconds while any stage is in progress
- Auto-stops polling when all stages succeed or when `pollingMaxMinutes` (default 30) is exceeded (shows terminated state)
- Renders dynamic 144×144px button images using node-canvas with SVG icons (Iconify line-md paths)
- All per-button state is tracked in module-level Maps keyed by `action.id` to support multiple buttons

**UI/Settings**: `com.phantas-weng.aws-monitor.sdPlugin/ui/codepipeline.html` — Property inspector for AWS credentials and pipeline settings

**Manifest**: `com.phantas-weng.aws-monitor.sdPlugin/manifest.json` — Plugin version, action UUIDs, Node.js 20 runtime config

**Build Output**: Rollup bundles `src/plugin.ts` → `com.phantas-weng.aws-monitor.sdPlugin/bin/plugin.js` (code-split chunks with hashed names)

## Key Implementation Details

**Canvas rendering**: `canvas` is marked `external` in `rollup.config.mjs` because the Stream Deck Node.js runtime provides it. All button images are drawn via `createCanvas(144, 144)` and sent as base64 data URLs via `ev.action.setImage()`.

**State maps** (all keyed by `action.id`):
- `refreshTimers` — 60s polling intervals
- `pressTimers` — long-press detection timeouts
- `loadingAnimationTimers` / `loadingAngles` / `loadingRenderers` — spinning animation at 10 FPS
- `stageStatusTransitionUntilMap` — brief "TransitionLoading" overlay (300ms) when a stage status changes
- `pollingStartedAtMap` — tracks when polling started for the `pollingMaxMinutes` timeout

**Button interactions**: short press → refresh; double-click (within 500ms) → open CloudWatch logs (requires `logGroupName`); long-press (1.3s) → open AWS Console

**Debug mode**: Set `pipelineName` to `debug` in settings — simulates 3-stage pipeline progression without AWS credentials. Useful for UI development.

**Settings normalization**: `normalizeSettings()` runs on every settings change, coalescing the deprecated `region` field into `pipelineRegion`/`logRegion`.

**Code comments**: Written in Traditional Chinese (zh-TW).
