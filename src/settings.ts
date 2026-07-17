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
	borderWidth?: number | string; // 可選：外框線寬（px），未填用預設值
};

export const DEBUG_PIPELINE_NAME = 'debug';
// debug 或 debug:N（N = 模擬 stage 數）
const DEBUG_PIPELINE_NAME_PATTERN = /^debug(?::(\d+))?$/;
export const DEFAULT_POLLING_MAX_MINUTES = 30;
// 外框線寬預設值與上限（px）；上限小於內容內縮邊距（12），避免框線壓到內容
export const DEFAULT_BORDER_WIDTH = 6;
export const MAX_BORDER_WIDTH = 10;

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
 * pipelineName 為 `debug` 或 `debug:N` 時進入模擬模式（不需要 AWS 憑證），
 * N 為模擬的 stage 數量（省略時用預設值）
 */
export const isDebugMode = (settings: CodePipelineMonitorSettings): boolean => {
	return DEBUG_PIPELINE_NAME_PATTERN.test(settings.pipelineName?.trim().toLowerCase() ?? '');
};

/**
 * 取得 debug 模式的模擬 stage 數；`debug` 未指定數量時回傳 undefined（用預設值）。
 * 數量限制在 1–12（Stream Deck 按鈕 144px 寬的可辨識上限）
 */
export const getDebugStageCount = (settings: CodePipelineMonitorSettings): number | undefined => {
	const match = DEBUG_PIPELINE_NAME_PATTERN.exec(settings.pipelineName?.trim().toLowerCase() ?? '');
	if (!match?.[1]) {
		return undefined;
	}
	return Math.min(12, Math.max(1, Number(match[1])));
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
 * 將任意外框線寬輸入正規化為 px：未填或無效值回傳預設值，
 * 並夾在 1–MAX_BORDER_WIDTH 之間（四捨五入為整數，避免非整數線寬造成邊緣模糊）。
 * CodePipeline 與 EC2 兩個 action 共用此邏輯。
 */
export const resolveBorderWidth = (value: number | string | undefined): number => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_BORDER_WIDTH;
	}
	return Math.min(MAX_BORDER_WIDTH, Math.max(1, Math.round(parsed)));
};

/**
 * 取得外框線寬（px）
 */
export const getBorderWidth = (settings: CodePipelineMonitorSettings): number =>
	resolveBorderWidth(settings.borderWidth);

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
