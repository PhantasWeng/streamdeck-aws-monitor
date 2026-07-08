/**
 * CodePipelineMonitor 的設定型別與純函式工具
 */
export type CodePipelineMonitorSettings = {
	AWS_ACCESS_KEY_ID: string;
	AWS_SECRET_ACCESS_KEY: string;
	region?: string; // 舊版相容欄位（deprecated）
	pipelineRegion?: string;
	logRegion?: string;
	pollingMaxMinutes?: number | string;
	pipelineName: string;
	displayName?: string;
	logGroupName?: string; // 可選：CloudWatch Log Group 名稱
	borderColor?: string; // 可選：外框顏色代號（red/orange/yellow/green/blue/indigo/violet）
};

export const DEBUG_PIPELINE_NAME = 'debug';
export const DEFAULT_POLLING_MAX_MINUTES = 30;

// 外框顏色代號 → hex 對應表（紅橙黃綠藍靛紫）
export const BORDER_COLORS: Record<string, string> = {
	red: '#ef4444',
	orange: '#fb923c',
	yellow: '#facc15',
	green: '#4ade80',
	blue: '#38bdf8',
	indigo: '#6366f1',
	violet: '#d946ef',
};

// 必填欄位
const REQUIRED_FIELDS: (keyof CodePipelineMonitorSettings)[] = [
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'pipelineName'
];
const DEBUG_REQUIRED_FIELDS: (keyof CodePipelineMonitorSettings)[] = [
	'pipelineName'
];

/**
 * pipelineName 為 `debug` 時進入模擬模式（不需要 AWS 憑證）
 */
export const isDebugMode = (settings: CodePipelineMonitorSettings): boolean => {
	return settings.pipelineName?.trim().toLowerCase() === DEBUG_PIPELINE_NAME;
};

export const getPipelineRegion = (settings: CodePipelineMonitorSettings): string =>
	settings.pipelineRegion?.trim() || settings.region?.trim() || '';

export const getLogRegion = (settings: CodePipelineMonitorSettings): string =>
	settings.logRegion?.trim() || getPipelineRegion(settings);

export const getPollingMaxMinutes = (settings: CodePipelineMonitorSettings): number => {
	const parsed = Number(settings.pollingMaxMinutes);
	if (Number.isFinite(parsed) && parsed > 0) {
		return parsed;
	}
	return DEFAULT_POLLING_MAX_MINUTES;
};

/**
 * 正規化設定：將舊版 `region` 欄位併入 pipelineRegion / logRegion
 */
export const normalizeSettings = (settings: CodePipelineMonitorSettings): CodePipelineMonitorSettings => ({
	...settings,
	pipelineRegion: getPipelineRegion(settings),
	logRegion: getLogRegion(settings),
	pollingMaxMinutes: getPollingMaxMinutes(settings),
});

export const getButtonTitle = (settings: CodePipelineMonitorSettings): string =>
	settings.displayName?.trim() || settings.pipelineName?.trim() || 'CodePipeline';

/**
 * 取得外框顏色 hex；未選或未知代號回傳 null（不畫框）
 */
export const getBorderColorHex = (settings: CodePipelineMonitorSettings): string | null =>
	BORDER_COLORS[settings.borderColor?.trim().toLowerCase() ?? ''] ?? null;

/**
 * 檢查必填設定是否完整（不包含 logGroupName）
 */
export const hasRequiredSettings = (settings: CodePipelineMonitorSettings): boolean => {
	const requiredFields = isDebugMode(settings) ? DEBUG_REQUIRED_FIELDS : REQUIRED_FIELDS;
	if (!requiredFields.every(field => settings[field] && settings[field] !== '')) {
		return false;
	}
	return isDebugMode(settings) || getPipelineRegion(settings) !== '';
};

/**
 * 取得 AWS Console URL
 */
export const getAwsConsoleUrl = (settings: CodePipelineMonitorSettings): string => {
	const pipelineRegion = getPipelineRegion(settings);
	return `https://${pipelineRegion}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${settings.pipelineName}/view?region=${pipelineRegion}`;
};

/**
 * 取得 CloudWatch Log Group URL
 */
export const getCloudWatchLogGroupUrl = (settings: CodePipelineMonitorSettings): string => {
	const encodedLogGroup = encodeURIComponent(settings.logGroupName || '');
	const logRegion = getLogRegion(settings);
	return `https://${logRegion}.console.aws.amazon.com/cloudwatch/home?region=${logRegion}#logsV2:log-groups/log-group/${encodedLogGroup}`;
};
