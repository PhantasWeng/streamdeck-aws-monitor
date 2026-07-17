/**
 * Ec2Monitor 的設定型別與純函式工具
 */
import { BORDER_COLORS, resolveBorderWidth } from './settings';

export type Ec2MonitorSettings = {
	AWS_ACCESS_KEY_ID: string;
	AWS_SECRET_ACCESS_KEY: string;
	region?: string; // EC2 與 CloudWatch 共用的 region
	instanceId: string;
	displayName?: string;
	borderColor?: string; // 可選：外框顏色代號（red/orange/yellow/green/blue/indigo/violet）
	borderWidth?: number | string; // 可選：外框線寬（px），未填用預設值
};

// instanceId 設為此值即進入模擬模式（不需要 AWS 憑證）
export const DEBUG_INSTANCE_ID = 'debug';

// 必填欄位
const REQUIRED_FIELDS: (keyof Ec2MonitorSettings)[] = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'instanceId'];
const DEBUG_REQUIRED_FIELDS: (keyof Ec2MonitorSettings)[] = ['instanceId'];

/**
 * instanceId 為 `debug`（不分大小寫）時進入模擬模式
 */
export const isDebugMode = (settings: Ec2MonitorSettings): boolean =>
	settings.instanceId?.trim().toLowerCase() === DEBUG_INSTANCE_ID;

export const getRegion = (settings: Ec2MonitorSettings): string => settings.region?.trim() || '';

/**
 * 正規化設定：trim region（保留一致的 normalize 入口，與 CodePipeline 對齊）
 */
export const normalizeSettings = (settings: Ec2MonitorSettings): Ec2MonitorSettings => ({
	...settings,
	region: getRegion(settings),
});

export const getButtonTitle = (settings: Ec2MonitorSettings): string =>
	settings.displayName?.trim() || settings.instanceId?.trim() || 'EC2';

/**
 * 取得外框顏色 hex；未選或未知代號回傳 null（不畫框）
 */
export const getBorderColorHex = (settings: Ec2MonitorSettings): string | null =>
	BORDER_COLORS[settings.borderColor?.trim().toLowerCase() ?? ''] ?? null;

/**
 * 取得外框線寬（px）
 */
export const getBorderWidth = (settings: Ec2MonitorSettings): number =>
	resolveBorderWidth(settings.borderWidth);

/**
 * 檢查必填設定是否完整
 */
export const hasRequiredSettings = (settings: Ec2MonitorSettings): boolean => {
	const requiredFields = isDebugMode(settings) ? DEBUG_REQUIRED_FIELDS : REQUIRED_FIELDS;
	if (!requiredFields.every(field => settings[field] && settings[field] !== '')) {
		return false;
	}
	return isDebugMode(settings) || getRegion(settings) !== '';
};

/**
 * 取得 EC2 Console（該 instance 詳情頁）URL
 */
export const getAwsConsoleUrl = (settings: Ec2MonitorSettings): string => {
	const region = getRegion(settings);
	return `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#InstanceDetails:instanceId=${settings.instanceId}`;
};

/**
 * 取得 CloudWatch metrics（以 instanceId 搜尋）URL
 */
export const getCloudWatchUrl = (settings: Ec2MonitorSettings): string => {
	const region = getRegion(settings);
	return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#metricsV2:graph=~();search=${settings.instanceId}`;
};
