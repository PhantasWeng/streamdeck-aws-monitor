import { describe, expect, it } from 'vitest';
import {
	type CodePipelineMonitorSettings,
	DEFAULT_POLLING_MAX_MINUTES,
	getAwsConsoleUrl,
	getButtonTitle,
	getCloudWatchLogGroupUrl,
	getLogRegion,
	getPipelineRegion,
	getPollingMaxMinutes,
	hasRequiredSettings,
	isDebugMode,
	normalizeSettings,
} from '../src/settings';

const baseSettings: CodePipelineMonitorSettings = {
	AWS_ACCESS_KEY_ID: 'AKIA_TEST',
	AWS_SECRET_ACCESS_KEY: 'secret',
	pipelineName: 'my-pipeline',
	pipelineRegion: 'ap-northeast-1',
};

describe('isDebugMode', () => {
	it('pipelineName 為 debug 時啟用（不分大小寫、忽略空白）', () => {
		expect(isDebugMode({ ...baseSettings, pipelineName: 'debug' })).toBe(true);
		expect(isDebugMode({ ...baseSettings, pipelineName: '  DEBUG ' })).toBe(true);
	});

	it('一般 pipeline 名稱不啟用', () => {
		expect(isDebugMode(baseSettings)).toBe(false);
		expect(isDebugMode({ ...baseSettings, pipelineName: 'debug-pipeline' })).toBe(false);
	});
});

describe('getPipelineRegion / getLogRegion', () => {
	it('優先使用 pipelineRegion，其次為舊版 region 欄位', () => {
		expect(getPipelineRegion({ ...baseSettings, pipelineRegion: 'us-east-1', region: 'eu-west-1' })).toBe('us-east-1');
		expect(getPipelineRegion({ ...baseSettings, pipelineRegion: undefined, region: 'eu-west-1' })).toBe('eu-west-1');
		expect(getPipelineRegion({ ...baseSettings, pipelineRegion: undefined })).toBe('');
	});

	it('logRegion 未設定時沿用 pipelineRegion', () => {
		expect(getLogRegion({ ...baseSettings, logRegion: 'us-west-2' })).toBe('us-west-2');
		expect(getLogRegion(baseSettings)).toBe('ap-northeast-1');
	});
});

describe('getPollingMaxMinutes', () => {
	it('接受數字與數字字串', () => {
		expect(getPollingMaxMinutes({ ...baseSettings, pollingMaxMinutes: 15 })).toBe(15);
		expect(getPollingMaxMinutes({ ...baseSettings, pollingMaxMinutes: '45' })).toBe(45);
	});

	it('無效值回傳預設 30 分鐘', () => {
		expect(getPollingMaxMinutes(baseSettings)).toBe(DEFAULT_POLLING_MAX_MINUTES);
		expect(getPollingMaxMinutes({ ...baseSettings, pollingMaxMinutes: 'abc' })).toBe(DEFAULT_POLLING_MAX_MINUTES);
		expect(getPollingMaxMinutes({ ...baseSettings, pollingMaxMinutes: 0 })).toBe(DEFAULT_POLLING_MAX_MINUTES);
		expect(getPollingMaxMinutes({ ...baseSettings, pollingMaxMinutes: -5 })).toBe(DEFAULT_POLLING_MAX_MINUTES);
	});
});

describe('normalizeSettings', () => {
	it('將舊版 region 欄位併入 pipelineRegion 與 logRegion', () => {
		const normalized = normalizeSettings({
			...baseSettings,
			pipelineRegion: undefined,
			region: 'eu-central-1',
		});
		expect(normalized.pipelineRegion).toBe('eu-central-1');
		expect(normalized.logRegion).toBe('eu-central-1');
		expect(normalized.pollingMaxMinutes).toBe(DEFAULT_POLLING_MAX_MINUTES);
	});
});

describe('hasRequiredSettings', () => {
	it('正式模式需要憑證、pipeline 名稱與 region', () => {
		expect(hasRequiredSettings(baseSettings)).toBe(true);
		expect(hasRequiredSettings({ ...baseSettings, AWS_ACCESS_KEY_ID: '' })).toBe(false);
		expect(hasRequiredSettings({ ...baseSettings, AWS_SECRET_ACCESS_KEY: '' })).toBe(false);
		expect(hasRequiredSettings({ ...baseSettings, pipelineRegion: undefined })).toBe(false);
	});

	it('debug 模式只需要 pipelineName', () => {
		expect(hasRequiredSettings({
			AWS_ACCESS_KEY_ID: '',
			AWS_SECRET_ACCESS_KEY: '',
			pipelineName: 'debug',
		})).toBe(true);
	});
});

describe('getButtonTitle', () => {
	it('優先使用 displayName，其次 pipelineName，最後為預設值', () => {
		expect(getButtonTitle({ ...baseSettings, displayName: 'Prod' })).toBe('Prod');
		expect(getButtonTitle(baseSettings)).toBe('my-pipeline');
		expect(getButtonTitle({ ...baseSettings, pipelineName: '' })).toBe('AWS CodePipeline');
	});
});

describe('URL builders', () => {
	it('組出 AWS Console pipeline URL', () => {
		expect(getAwsConsoleUrl(baseSettings)).toBe(
			'https://ap-northeast-1.console.aws.amazon.com/codesuite/codepipeline/pipelines/my-pipeline/view?region=ap-northeast-1'
		);
	});

	it('組出 CloudWatch Log Group URL（log group 名稱需編碼）', () => {
		const url = getCloudWatchLogGroupUrl({
			...baseSettings,
			logGroupName: '/aws/lambda/my-fn',
			logRegion: 'us-east-1',
		});
		expect(url).toContain('https://us-east-1.console.aws.amazon.com/cloudwatch/');
		expect(url).toContain(encodeURIComponent('/aws/lambda/my-fn'));
	});
});
