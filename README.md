> [!WARNING]  
> **WIP: This project is currently under active development.**  
> Installation steps, folder structure, configuration methods, and runtime behavior are all subject to change.

# AWS Monitor - Stream Deck Plugin

A Stream Deck plugin that provides real-time monitoring of AWS services, starting with AWS CodePipeline. This plugin allows you to monitor the status of your CodePipeline deployments directly from your Stream Deck.

## Features

- **Real-time CodePipeline Monitoring**: Monitor the status of your AWS CodePipeline deployments
- **Visual Status Indicators**: Clear stage-by-stage status icons with color-coded symbols
- **Status Transition Animation**: When a stage status changes during polling, that stage shows loading for `0.3s` before switching to `✓` / `X`
- **Quick Access**: Long-press (1.3 seconds) to open the pipeline in AWS Console
- **CloudWatch Integration**: Double-click to open CloudWatch Log Group (optional)
- **Debug Demo Mode**: Set `Pipeline Name` to `debug` to run a local 3-stage simulation without AWS credentials
- **Polling Timeout Control**: Configure max polling duration (default `30` minutes). Footer shows `終止` when timeout is reached
- **Multi-region Support**: Independent region selection for Pipeline and Log Group, with backward compatibility for legacy `region` setting
- **Custom Display Names**: Set custom names for your pipeline buttons

## Status Symbols

- ✅ **Green Checkmark**: Stage completed successfully
- ❌ **Red X**: Stage failed
- 🔄 **Blue Loading Spinner**: Stage in progress/pending, or temporary transition animation when status changes

## Recent Updates

- `fb82192`: Added per-stage status transition tracking so changed stages animate loading for `0.3s` before showing final status icons.
- `7b8768e`: Refined action/plugin images and improved button rendering for clearer visual feedback.
- `f4b1fff`: Added configurable polling max timeout and termination footer behavior.
- `ce7ed5c`: Updated settings schema and UI for `pipelineRegion` / `logRegion`, while keeping compatibility with legacy `region`.

## Requirements

- **Stream Deck Software**: Version 6.5 or higher
- **Operating System**: 
  - macOS 12 or higher
  - Windows 10 or higher
- **Node.js**: Version 20
- **AWS Account**: With appropriate IAM permissions for CodePipeline

## Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd aws-monitor
   ```

2. **Install dependencies**:
   ```bash
   yarn install
   ```

3. **Build the plugin**:
   ```bash
   yarn build
   ```

4. **Install the plugin**:
   ```bash
   streamdeck install com.phantas-weng.aws-monitor.sdPlugin
   ```

## Development

### Prerequisites

- Node.js 20
- Yarn package manager
- Stream Deck CLI (`@elgato/cli`)

### Development Setup

1. **Install development dependencies**:
   ```bash
   yarn install
   ```

2. **Start development mode**:
   ```bash
   yarn watch
   ```
   This will automatically rebuild and restart the plugin when changes are made.

3. **Launch Stream Deck in debug mode** (important for viewing console logs):
   ```bash
   open -a "Elgato Stream Deck" --args -debug
   ```
   This opens Stream Deck with debug mode enabled, allowing you to view plugin logs in the developer console.

### Project Structure

```
aws-monitor/
├── src/
│   ├── actions/
│   │   └── codepipeline.ts      # CodePipeline monitoring action
│   └── plugin.ts                # Main plugin entry point
├── com.phantas-weng.aws-monitor.sdPlugin/
│   ├── manifest.json            # Plugin manifest
│   ├── ui/
│   │   └── codepipeline.html    # Property inspector UI
│   └── imgs/                    # Plugin icons and images
├── package.json                 # Dependencies and scripts
├── rollup.config.mjs           # Build configuration
└── tsconfig.json               # TypeScript configuration
```

## Configuration

### AWS Credentials

You'll need to provide your AWS credentials in the plugin settings:

1. **Access Key ID**: Your AWS access key ID
2. **Secret Access Key**: Your AWS secret access key
3. **Pipeline Region**: Select the AWS region where your pipeline is located
4. **Log Group Region**: Select the AWS region where your CloudWatch log group is located
5. **Display Name**: (Optional) A custom name for the button. If empty, pipeline name is used
6. **Pipeline Name**: The name of your CodePipeline
7. **Log Group Name**: (Optional) CloudWatch Log Group name for double-click access
8. **Polling Max (minutes)**: (Optional, default `30`) Stop polling when timeout is reached

### Debug Demo Mode

For quick UI testing without AWS access, set:

1. **Pipeline Name**: `debug`
2. **Display Name**: Any label you want

In debug mode:

- Only `Pipeline Name` is required (`Display Name` is optional)
- Initial state is `[loading, loading, loading]`
- 1st poll: `[Succeeded, Failed, Failed]`
- 2nd poll: `[Succeeded, Succeeded, Failed]`
- 3rd poll onward: random between `[Succeeded, Succeeded, Succeeded]` and `[Succeeded, Succeeded, Failed]`
- Stage status changes also use the same `0.3s` loading transition animation before `✓` / `X`
- Polling stops when all stages are `Succeeded`, or when `Polling Max` timeout is reached (`終止`)
- On timeout, stage status icons stay at the last fetched state (only polling stops + footer shows `終止`)

### IAM Permissions

Your AWS credentials need the following permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "codepipeline:GetPipelineState"
            ],
            "Resource": "arn:aws:codepipeline:*:*:*"
        }
    ]
}
```

## Usage

1. **Add the action to your Stream Deck**:
   - Open Stream Deck software
   - Drag the "CodePipeline" action to a button

2. **Configure the action**:
   - Click on the button to open the property inspector
   - Enter your AWS credentials and pipeline details
   - Save the settings

3. **Monitor your pipeline**:
   - **Short press**: Refresh pipeline status
   - **Double-click**: Open CloudWatch Log Group (requires Log Group Name configured)
   - **Long press (1.3s)**: Open pipeline in AWS Console
   - **Polling timeout**: Footer shows `終止` when polling exceeds `Polling Max`

### Debug Mode Key Behavior (`Pipeline Name = debug`)

- **Short press**: Restart debug simulation
- **Double-click**: No action
- **Long press**: No action

## Building

### Production Build

```bash
yarn build
```

This will create the compiled plugin in `com.phantas-weng.aws-monitor.sdPlugin/bin/`.

### Development Build

```bash
yarn watch
```

This will watch for changes and automatically rebuild the plugin.

## Dependencies

### Production Dependencies

- `@aws-sdk/client-codepipeline`: AWS CodePipeline client
- `@aws-sdk/credential-providers`: AWS credential management
- `@elgato/streamdeck`: Stream Deck SDK
- `canvas`: Canvas API for image generation

### Development Dependencies

- `@elgato/cli`: Stream Deck CLI
- `@rollup/plugin-*`: Rollup build plugins
- `typescript`: TypeScript compiler
- `rollup`: Module bundler

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Author

**Phantas Weng**

## Version

Current version: 0.1.0.0

## Support

For issues and feature requests, please create an issue in the repository.

---

**Note**: This plugin requires valid AWS credentials with appropriate permissions to function correctly. Make sure your AWS credentials have the necessary permissions to access CodePipeline resources. 
