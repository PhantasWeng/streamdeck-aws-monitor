/**
 * EC2 狀態分類、輪詢節奏與 footer 判斷（純函式，不依賴 canvas / AWS，便於單元測試）
 * 同時定義跨模組共用的 Ec2Snapshot 型別。
 */

export type Ec2Metrics = {
	cpu?: number; // CPU 使用率 %
	mem?: number; // 記憶體使用率 %（需 CloudWatch Agent）
	disk?: number; // 磁碟使用率 %（需 CloudWatch Agent）
};

export type Ec2Snapshot = {
	state: string; // running / stopped / pending / stopping / shutting-down / terminated
	statusCheck?: string; // ok / impaired / insufficient-data（system 與 instance 檢查合併）
	metrics: Ec2Metrics;
};

// 依 EC2 生命週期狀態的語意分類
export type Ec2StateClass = 'transitioning' | 'running' | 'stopped' | 'terminated' | 'unknown';

/**
 * 將原始 instance state 對應到語意分類。
 * pending / stopping / shutting-down 屬過渡狀態（會自行改變）。
 */
export const classifyInstanceState = (state: string): Ec2StateClass => {
	switch (state) {
		case 'pending':
		case 'stopping':
		case 'shutting-down':
			return 'transitioning';
		case 'running':
			return 'running';
		case 'stopped':
			return 'stopped';
		case 'terminated':
			return 'terminated';
		default:
			return 'unknown';
	}
};

export type Ec2PollMode = 'active' | 'idle';

/**
 * 決定輪詢節奏：
 * - active（快輪）：過渡中（狀態會變）或 running（保持 CPU/指標新鮮）
 * - idle（慢輪）：stopped / terminated / unknown（幾乎不再變化）
 */
export const classifyPoll = (state: string): Ec2PollMode => {
	const cls = classifyInstanceState(state);
	return cls === 'transitioning' || cls === 'running' ? 'active' : 'idle';
};

/**
 * 是否為過渡狀態（用來決定要不要跑 loading 脈動動畫）
 */
export const isTransitioning = (state: string): boolean => classifyInstanceState(state) === 'transitioning';

export type Ec2Footer = 'healthy' | 'transitioning' | 'impaired' | 'stopped' | 'terminated' | 'unknown';

/**
 * 依 state 與 status check 決定 footer 指示：
 * 過渡中 → transitioning；running 且 status check impaired → impaired，否則 healthy；
 * stopped / terminated 各自對應；其餘 unknown。
 */
export const deriveFooter = (state: string, statusCheck?: string): Ec2Footer => {
	const cls = classifyInstanceState(state);
	switch (cls) {
		case 'transitioning':
			return 'transitioning';
		case 'terminated':
			return 'terminated';
		case 'stopped':
			return 'stopped';
		case 'running':
			return statusCheck === 'impaired' ? 'impaired' : 'healthy';
		default:
			return 'unknown';
	}
};

/**
 * 判斷指標是否有有效數值（拿不到的指標為 undefined）
 */
export const hasMetric = (value?: number): value is number => typeof value === 'number' && Number.isFinite(value);

export type Ec2MetricRow = { key: keyof Ec2Metrics; label: string; value: number };

// 指標顯示順序與標籤
const METRIC_ORDER: { key: keyof Ec2Metrics; label: string }[] = [
	{ key: 'cpu', label: 'CPU' },
	{ key: 'mem', label: 'MEM' },
	{ key: 'disk', label: 'DSK' },
];

/**
 * 取出目前拿得到的指標（依固定順序），供 rendering 依數量自適應版面。
 * 沒裝 CloudWatch Agent 時只會回傳 CPU（甚至空陣列）。
 */
export const availableMetrics = (metrics: Ec2Metrics): Ec2MetricRow[] =>
	METRIC_ORDER.filter(({ key }) => hasMetric(metrics[key])).map(({ key, label }) => ({
		key,
		label,
		value: metrics[key] as number,
	}));
