# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
yarn build          # Production build (TypeScript + Rollup)
yarn watch          # Development mode with auto-rebuild and plugin restart
```

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

**Tech Stack**: TypeScript, Elgato Stream Deck SDK v1.0.0, AWS SDK, node-canvas, Rollup

**Entry Point**: `src/plugin.ts` - Registers actions and connects to Stream Deck

**Action Pattern**: Uses `SingletonAction` from Stream Deck SDK. Each action handles Stream Deck events (onWillAppear, onKeyDown, onKeyUp, onWillDisappear).

**Main Action**: `src/actions/codepipeline.ts` - CodePipelineMonitor
- Polls AWS CodePipeline every 60 seconds when pipeline is in progress
- Auto-stops polling when all stages succeed
- Uses HTML5 Canvas API to render dynamic button images
- Timer state is tracked per-button using Maps (`pressTimers`, `refreshTimers`)

**UI/Settings**: `com.phantas-weng.aws-monitor.sdPlugin/ui/codepipeline.html` - Property inspector for configuring AWS credentials and pipeline settings

**Build Output**: Compiled JS goes to `com.phantas-weng.aws-monitor.sdPlugin/bin/`

## Key Implementation Details

- `canvas` package is marked as external in Rollup (provided by Stream Deck runtime)
- Timer cleanup in `onWillDisappear` prevents memory leaks
- Button interactions: short press refreshes status, double-click opens CloudWatch logs (if `logGroupName` configured), long-press (1.3s) opens AWS Console
- Status symbols: ✔ (green=success), ✘ (red=failed), . (blue=in progress)
- Code comments are in Traditional Chinese (zh-TW)
