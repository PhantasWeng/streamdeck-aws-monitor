import { describe, expect, it } from 'vitest';
import {
	type Ec2MonitorSettings,
	getAwsConsoleUrl,
	getBorderColorHex,
	getButtonTitle,
	getCloudWatchUrl,
	getRegion,
	hasRequiredSettings,
	isDebugMode,
	normalizeSettings,
} from '../src/ec2-settings';

const baseSettings: Ec2MonitorSettings = {
	AWS_ACCESS_KEY_ID: 'AKIA_TEST',
	AWS_SECRET_ACCESS_KEY: 'secret',
	instanceId: 'i-0abc123def456',
	region: 'ap-northeast-1',
};

describe('isDebugMode', () => {
	it('instanceId 為 debug 時啟用（不分大小寫、忽略空白）', () => {
		expect(isDebugMode({ ...baseSettings, instanceId: 'debug' })).toBe(true);
		expect(isDebugMode({ ...baseSettings, instanceId: '  DEBUG ' })).toBe(true);
	});

	it('一般 instanceId 不啟用', () => {
		expect(isDebugMode(baseSettings)).toBe(false);
		expect(isDebugMode({ ...baseSettings, instanceId: 'debug-instance' })).toBe(false);
	});
});

describe('getRegion', () => {
	it('回傳 trim 後的 region，未設定回傳空字串', () => {
		expect(getRegion({ ...baseSettings, region: ' us-east-1 ' })).toBe('us-east-1');
		expect(getRegion({ ...baseSettings, region: undefined })).toBe('');
	});
});

describe('normalizeSettings', () => {
	it('trim region', () => {
		expect(normalizeSettings({ ...baseSettings, region: ' eu-central-1 ' }).region).toBe('eu-central-1');
	});
});

describe('hasRequiredSettings', () => {
	it('正式模式需要憑證、instanceId 與 region', () => {
		expect(hasRequiredSettings(baseSettings)).toBe(true);
		expect(hasRequiredSettings({ ...baseSettings, AWS_ACCESS_KEY_ID: '' })).toBe(false);
		expect(hasRequiredSettings({ ...baseSettings, AWS_SECRET_ACCESS_KEY: '' })).toBe(false);
		expect(hasRequiredSettings({ ...baseSettings, instanceId: '' })).toBe(false);
		expect(hasRequiredSettings({ ...baseSettings, region: undefined })).toBe(false);
	});

	it('debug 模式只需要 instanceId', () => {
		expect(hasRequiredSettings({
			AWS_ACCESS_KEY_ID: '',
			AWS_SECRET_ACCESS_KEY: '',
			instanceId: 'debug',
		})).toBe(true);
	});
});

describe('getButtonTitle', () => {
	it('優先使用 displayName，其次 instanceId，最後為預設值', () => {
		expect(getButtonTitle({ ...baseSettings, displayName: 'web-prod' })).toBe('web-prod');
		expect(getButtonTitle(baseSettings)).toBe('i-0abc123def456');
		expect(getButtonTitle({ ...baseSettings, instanceId: '' })).toBe('EC2');
	});
});

describe('getBorderColorHex', () => {
	it('顏色代號對應到 hex（大小寫與空白不影響）', () => {
		expect(getBorderColorHex({ ...baseSettings, borderColor: 'green' })).toBe('#4ade80');
		expect(getBorderColorHex({ ...baseSettings, borderColor: '  RED ' })).toBe('#ef4444');
	});

	it('未選或未知代號回傳 null', () => {
		expect(getBorderColorHex(baseSettings)).toBeNull();
		expect(getBorderColorHex({ ...baseSettings, borderColor: 'rainbow' })).toBeNull();
	});
});

describe('URL builders', () => {
	it('組出 EC2 Console instance URL', () => {
		expect(getAwsConsoleUrl(baseSettings)).toBe(
			'https://ap-northeast-1.console.aws.amazon.com/ec2/home?region=ap-northeast-1#InstanceDetails:instanceId=i-0abc123def456'
		);
	});

	it('組出 CloudWatch metrics 搜尋 URL（含 instanceId）', () => {
		const url = getCloudWatchUrl(baseSettings);
		expect(url).toContain('https://ap-northeast-1.console.aws.amazon.com/cloudwatch/');
		expect(url).toContain('i-0abc123def456');
	});
});
