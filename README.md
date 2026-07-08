# AWS Monitor for Stream Deck
[![Stream Deck SDK](https://img.shields.io/badge/Stream%20Deck%20SDK-v2-111827?logo=elgato)](https://docs.elgato.com/streamdeck/sdk/)
[![Node](https://img.shields.io/badge/Node-20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%2012%2B%20%7C%20Windows%2010%2B-2563eb)](https://docs.elgato.com/streamdeck/sdk/introduction/distribution)

A Stream Deck plugin for monitoring AWS services, starting with **CodePipeline**.

It renders stage-by-stage status directly on the key and supports fast actions for refresh, AWS Console open, and optional CloudWatch log access.

## Screenshots

Order: `Not Configured` -> `Loading` -> `Partially Complete` -> `Fully Complete`

![Key states overview](docs/images/key-states/overview.png)

## Why This Plugin

- See deployment status without switching tabs.
- Read stage-level result at a glance (`Succeeded` / `Failed` / `InProgress`).
- Keep a live operational signal on your Stream Deck.

## Features

- Real-time CodePipeline stage monitoring
- Visual key rendering with status icons and timestamp footer
- Optional colored border per key for environment identification (`red` / `orange` / `yellow` / `green` / `blue` / `indigo` / `violet`)
- Status transition animation (`0.3s` loading transition on state change)
- Long press (`1.3s`) to open pipeline in AWS Console
- Double-click to open CloudWatch Log Group (optional)
- Debug simulation mode (`Pipeline Name = debug`)
- Configurable polling timeout (`Polling Max (minutes)`)
- Independent `Pipeline Region` and `Log Group Region`

### Environment Border Colors

Pick a **Border Color** in the Property Inspector to frame the key — handy for telling `stage` / `release` / `production` apart at a glance. Leave it empty for no border.

![Border color options](docs/images/key-states/border-colors.png)

## Requirements

- Stream Deck software `6.9+`
- Node.js `20`
- macOS `12+` or Windows `10+`
- AWS credentials with CodePipeline read access

## Quick Start

```bash
git clone https://github.com/PhantasWeng/streamdeck-aws-monitor
cd streamdeck-aws-monitor
npm install
npm run build:bundle
npx streamdeck install com.phantas-weng.aws-monitor.sdPlugin
```

## Usage

1. Open Stream Deck and drag **CodePipeline** action to a key.
2. Fill settings in Property Inspector and save.
3. Use key interactions:

- Short press: Refresh Status
- Double-click: Open CloudWatch Log Group (when configured)
- Long press (`1.3s`): Open CodePipeline in AWS Console

## Configuration

| Field | Required | Description |
| --- | --- | --- |
| `AWS_ACCESS_KEY_ID` | Yes (except debug) | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | Yes (except debug) | AWS secret key |
| `Pipeline Name` | Yes | CodePipeline name; set `debug` to enable simulation mode |
| `Pipeline Region` | Yes (except debug) | Region for CodePipeline API calls |
| `Display Name` | No | Custom key title |
| `Border Color` | No | Environment border color (`red`/`orange`/`yellow`/`green`/`blue`/`indigo`/`violet`); empty for none |
| `Log Group Name` | No | CloudWatch log group for double-click action |
| `Log Group Region` | No | Region for CloudWatch log URL; defaults to pipeline region |
| `Polling Max (minutes)` | No | Polling timeout; default `30` |

## Debug Mode

Set `Pipeline Name` to `debug`.

Behavior:
- Starts with three loading stages
- Simulates partial and full completion states
- Uses the same rendering and transition logic as normal mode
- Uses the same two-speed, never-stopping polling loop as normal mode

## IAM Permissions

Minimum policy example:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["codepipeline:GetPipelineState"],
      "Resource": "arn:aws:codepipeline:*:*:*"
    }
  ]
}
```

## Development

Run watch mode:

```bash
yarn watch
```

Run Stream Deck in debug mode (macOS):

```bash
open -a "Elgato Stream Deck" --args -debug
```

Project structure:

```text
aws-monitor/
├── src/
│   ├── actions/codepipeline.ts
│   └── plugin.ts
├── com.phantas-weng.aws-monitor.sdPlugin/
│   ├── manifest.json
│   ├── ui/codepipeline.html
│   └── imgs/
├── scripts/
├── package.json
└── rollup.config.mjs
```

## Release Workflow

Versioning is owned by `yarn bump`; packaging is a separate step.

```bash
yarn bump <major|minor|patch|build|x.y.z.w>   # add --dry-run to preview
```

`yarn bump`:
- Computes the next 4-part version (`major.minor.patch.build`) and writes it into `manifest.json`
- Generates a `CHANGELOG.md` section from commits since the last tag (grouped by Conventional-Commit prefix)
- Commits and creates an annotated tag `v<version>` (does **not** push)

Push the tag to publish a GitHub Release (packing runs in CI via `.github/workflows/release.yml`):

```bash
git push && git push origin v<version>
```

For a local `.streamDeckPlugin` build (packaging only, no versioning/tag):

```bash
yarn build
```

## Screenshot Asset Generation

Regenerate README screenshot assets:

```bash
yarn screenshots:key-states
```

This regenerates `docs/images/key-states/*.png`, including `overview.png`.

## Troubleshooting

- Key stays in `NOT SET`:
  verify required fields are saved.
- Double-click does nothing:
  check `Log Group Name` and `Log Group Region`.
- Slow updates after completion:
  once all stages settle, polling drops to a slower cadence (every `5` minutes) but keeps
  running to auto-detect the next deployment; short-press to refresh immediately.

## Contributing

Issues and pull requests are welcome.

Recommended flow:

1. Fork the repo
2. Create a feature branch
3. Make changes and validate behavior on Stream Deck
4. Open a pull request with context and screenshots

## License

MIT
