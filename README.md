> [!WARNING]  
> **WIP: This project is currently under active development.**  
> Installation steps, folder structure, configuration methods, and runtime behavior are all subject to change.

# AWS Monitor - Stream Deck Plugin

A Stream Deck plugin that provides real-time monitoring of AWS services, starting with AWS CodePipeline. This plugin allows you to monitor the status of your CodePipeline deployments directly from your Stream Deck.

## Features

- **Real-time CodePipeline Monitoring**: Monitor the status of your AWS CodePipeline deployments
- **Visual Status Indicators**: Clear visual representation of pipeline stages with color-coded status symbols
- **Quick Access**: Long-press (1.3 seconds) to open the pipeline in AWS Console
- **Multi-region Support**: Support for all AWS regions
- **Custom Display Names**: Set custom names for your pipeline buttons

## Status Symbols

- ✅ **Green Checkmark**: Stage completed successfully
- ❌ **Red X**: Stage failed
- 🔵 **Blue Dot**: Stage in progress or pending

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
3. **Region**: Select the AWS region where your pipeline is located
4. **Display Name**: A custom name for the button (optional)
5. **Pipeline Name**: The name of your CodePipeline

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
   - **Long press (1.3s)**: Open pipeline in AWS Console

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