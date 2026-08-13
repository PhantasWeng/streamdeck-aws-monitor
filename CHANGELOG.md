# Changelog

All notable changes to this project are documented in this file.

## [1.5.0.0] - 2026-08-13

### Bug Fixes

- stop unhandled promise rejections from killing the plugin process (cf078e9)
- ship canvas binaries in the package so the plugin runs on clean installs (3feadfe)

### Features

- add single-metric chart display mode for the EC2 action (c2dc820)
- generate CI release notes from tag range and guard bump preconditions (332e0d9)
- add configurable border width for CodePipeline and EC2 buttons (d6e82e0)

### Documentation

- add EC2 key-states screenshot to README (9f5c644)
- document EC2 action and fix README inaccuracies (f0fd5b3)
- add Stream Deck promo scene (074fac5)

## [1.4.0.0] - 2026-07-17

- No notable changes.

## [1.3.0.0] - 2026-07-16

### Features

- monochrome white AWS icons and larger unconfigured-state logo (db2cc02)

## [1.2.1.0] - 2026-07-16

### Bug Fixes

- center EC2 title with state dot in front of the name (67cf22a)

## [1.2.0.0] - 2026-07-16

### Features

- add EC2 instance monitor action (83a1035)

## [1.1.0.0] - 2026-07-15

### Features

- render stage statuses as segmented progress bar supporting any stage count (7ff85ac)

## [1.0.1.0] - 2026-07-15

### Bug Fixes

- eliminate zombie animation timers causing button flicker (5a4de18)

### Chores

- remove obsolete AWS Monitor Stream Deck plugin file from releases (a518b37)

## [1.0.0.0] - 2026-07-09

### Features

- add configurable button border color and refine button layout (aa77971)
- add yarn bump release workflow with auto-generated CHANGELOG notes (4179cd2)
- auto-detect new deployments via never-stopping two-speed polling (2870e3e)
- upgrade to Stream Deck SDKVersion 3 and bump @elgato/streamdeck to 2.1.0 (669d83b)
- refactor CodePipeline monitoring action to improve state management and rendering efficiency, add debug mode support, and enhance button state handling (3c09fec)
- add comprehensive CLAUDE.md file for plugin development guidance and remove outdated documentation (3ebf91d)
- add key state screenshots and corresponding images to README for better visualization of plugin status (a75e1c9)
- add new Stream Deck plugin for AWS monitoring functionality (286e706)
- implement stage status transition tracking and loading animations for better user experience during status changes (fb82192)
- add new images and enhance button rendering for better UI feedback (7b8768e)
- add polling max timeout feature to CodePipeline monitor for better control over polling duration and user experience (f4b1fff)
- enhance AWS region selection and settings management for improved user experience and compatibility with new pipeline configurations (ce7ed5c)
- add debug demo mode documentation and design plan for local simulation without AWS credentials (1ca6e9a)
- add local settings for permissions and enhance CLAUDE documentation with debug mode instructions and icon updates in codepipeline actions (4d1db1c)
- add optional log group name field and enhance double-click functionality for CloudWatch access (adc3e2e)
- enhance CodePipelineMonitor with improved canvas handling, configuration checks, and status rendering for better user experience (99e8713)
- add CLAUDE.md for project guidance and settings configuration (7089a4b)
- add dayjs for date formatting and implement onWillDisappear event for better resource management (d1f774e)
- add README.md with project details, installation, and usage instructions for AWS Monitor Stream Deck Plugin (a8d0adb)
- add AWS Monitor Stream Deck plugin with CodePipeline action and configuration files (3f5317e)

### Bug Fixes

- bump fails when target version equals current manifest version (27f843a)

### Refactoring

- replace console logging with streamDeck logger for better logging consistency and maintainability (833595a)
- replace global timers with instance-specific Maps to avoid variable sharing and improve timer management (2ba9ebb)
- rename timer variables and extract button building logic to improve code clarity and maintainability (76d094f)

### Documentation

- clarify requirements (no aws-cli/Node needed) and tighten IAM guidance (7674ac8)
- refresh README (SDK v3 badge, install-from-releases, accuracy) (6369245)
- add design spec for auto-detecting new deployments (b8ac4e3)
- update features and recent updates sections for clarity and detail on new functionalities (3d9e86d)
- add instructions for launching Stream Deck in debug mode to enhance debugging capabilities (197e4a8)
- add installation instructions for the development plugin to enhance usability during development (461a510)

### Chores

- update marketplace images to enhance visual quality and consistency (8f55c12)
- bump checkout and setup-node actions to v5 (25a68f7)
- auto-build and publish GitHub Release on v* tag push (fc762d5)
- distribute .streamDeckPlugin via GitHub Releases instead of git (0034762)
- add packaged .streamDeckPlugin build artifact (e8d9501)
- stop tracking .DS_Store files (de7f2f5)
- upgrade @elgato/cli to 1.7.4 (45a6370)
- update project configuration by adding bump plugin version to 1.0.0.0, and refactor build process with new build script (0c34a7f)
- add .env to .gitignore to prevent sensitive data exposure (811bd21)

### Other

- Revert "docs(README): add installation instructions for the development plugin to enhance usability during development" (bf677ad)
