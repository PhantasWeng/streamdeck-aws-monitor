import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { DescribeInstancesCommand, DescribeInstanceStatusCommand, EC2Client } from '@aws-sdk/client-ec2';
import streamDeck from '@elgato/streamdeck';
import type { ButtonState } from './button-state';
import { CHART_LOOKBACK_MS, CHART_PERIOD_SECONDS } from './ec2-chart';
import { chartMetricKey, type Ec2Metrics, type Ec2Series, type Ec2Snapshot } from './ec2-metrics';
import { type Ec2MonitorSettings, getDisplayMode, getRegion } from './ec2-settings';

// CloudWatch 指標查詢視窗：往回 15 分鐘、5 分鐘一個資料點，取最新的一筆
const METRIC_LOOKBACK_MS = 15 * 60 * 1000;
const METRIC_PERIOD_SECONDS = CHART_PERIOD_SECONDS;

/**
 * 確保 EC2 與 CloudWatch client 已建立且對應目前的 region/憑證。
 * 兩個 client 以 region + 憑證為 key 一起快取在 ButtonState，
 * 憑證直接傳入 client，不寫入 process.env（多顆按鈕使用不同帳號時會互相覆寫）。
 */
const ensureClients = (state: ButtonState, settings: Ec2MonitorSettings): { ec2: EC2Client; cw: CloudWatchClient } => {
	const region = getRegion(settings);
	const clientKey = `${region}|${settings.AWS_ACCESS_KEY_ID}|${settings.AWS_SECRET_ACCESS_KEY}`;
	if (!state.ec2Client || !state.cwClient || state.ec2ClientKey !== clientKey) {
		state.ec2Client?.destroy();
		state.cwClient?.destroy();
		const credentials = {
			accessKeyId: settings.AWS_ACCESS_KEY_ID,
			secretAccessKey: settings.AWS_SECRET_ACCESS_KEY,
		};
		state.ec2Client = new EC2Client({ region, credentials });
		state.cwClient = new CloudWatchClient({ region, credentials });
		state.ec2ClientKey = clientKey;
	}
	return { ec2: state.ec2Client, cw: state.cwClient };
};

/**
 * 合併 system 與 instance 兩項 status check：
 * 任一 impaired → impaired；皆 ok → ok；否則若有 insufficient-data → insufficient-data。
 */
const combineStatusCheck = (system?: string, instance?: string): string | undefined => {
	const checks = [system, instance].filter((c): c is string => !!c);
	if (checks.length === 0) {
		return undefined;
	}
	if (checks.some(c => c === 'impaired')) {
		return 'impaired';
	}
	if (checks.every(c => c === 'ok')) {
		return 'ok';
	}
	if (checks.some(c => c === 'insufficient-data')) {
		return 'insufficient-data';
	}
	return checks[0];
};

/**
 * 將百分比四捨五入並夾在 0–100
 */
const toPercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

// CloudWatch Agent 指標的維度 schema 因 agent 設定（append_dimensions）而異，
// 而 SEARCH 的 schema 必須「完整列出維度名稱」才會比對到（namespace-only 的
// {CWAgent} 比對不到有維度的指標）。故對常見設定各備一組 schema，取第一個有資料的。
// 由精簡到完整排序：最小設定（僅 InstanceId）、wizard 預設（含 ImageId/InstanceType）、含 ASG。
const MEM_SCHEMAS = [
	'{CWAgent,InstanceId}',
	'{CWAgent,ImageId,InstanceId,InstanceType}',
	'{CWAgent,AutoScalingGroupName,ImageId,InstanceId,InstanceType}',
];
// 磁碟固定帶 device/fstype/path 維度；只取根目錄 path="/"，避免 snap/overlay 等
// 唯讀 loop 掛載（squashfs 永遠 100%）灌爆數字。
const DISK_SCHEMAS = [
	'{CWAgent,InstanceId,device,fstype,path}',
	'{CWAgent,ImageId,InstanceId,InstanceType,device,fstype,path}',
	'{CWAgent,AutoScalingGroupName,ImageId,InstanceId,InstanceType,device,fstype,path}',
];

// CloudWatch Agent 指標（mem/disk）的查詢設定；CPU 走原生指標故不在此表
type AgentMetricKey = 'mem' | 'disk';
const AGENT_METRICS: Record<AgentMetricKey, { schemas: string[]; metricName: string; extraFilter: string }> = {
	mem: { schemas: MEM_SCHEMAS, metricName: 'mem_used_percent', extraFilter: '' },
	disk: { schemas: DISK_SCHEMAS, metricName: 'disk_used_percent', extraFilter: ' path="/"' },
};

/**
 * CPU 走 EC2 原生指標（維度僅 InstanceId，精準可靠）
 */
const buildCpuQuery = (instanceId: string) => ({
	Id: 'cpu',
	MetricStat: {
		Metric: {
			Namespace: 'AWS/EC2',
			MetricName: 'CPUUtilization',
			Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
		},
		Period: METRIC_PERIOD_SECONDS,
		Stat: 'Average',
	},
	ReturnData: true,
});

/**
 * 記憶體與磁碟為 CloudWatch Agent 指標，對多組常見 schema 各發一次 SEARCH，
 * 由呼叫端取第一個有資料的（相容不同 agent 設定）。磁碟只取根目錄。
 */
const buildAgentQueries = (key: AgentMetricKey, instanceId: string) => {
	const { schemas, metricName, extraFilter } = AGENT_METRICS[key];
	return schemas.map((schema, i) => ({
		Id: `${key}${i}`,
		Expression: `AVG(SEARCH('${schema} MetricName="${metricName}" InstanceId="${instanceId}"${extraFilter}', 'Average', ${METRIC_PERIOD_SECONDS}))`,
		ReturnData: true,
	}));
};

/**
 * 查詢 CPU / 記憶體 / 磁碟的目前使用率（all 模式）。
 * 未裝 CloudWatch Agent 時記憶體與磁碟回 undefined（畫面自動不顯示該列）。
 */
const fetchMetrics = async (cw: CloudWatchClient, instanceId: string): Promise<Ec2Metrics> => {
	const now = new Date();
	const start = new Date(now.getTime() - METRIC_LOOKBACK_MS);
	const memQueries = buildAgentQueries('mem', instanceId);
	const diskQueries = buildAgentQueries('disk', instanceId);

	const response = await cw.send(
		new GetMetricDataCommand({
			StartTime: start,
			EndTime: now,
			ScanBy: 'TimestampDescending', // 最新的資料點排在最前
			MetricDataQueries: [buildCpuQuery(instanceId), ...memQueries, ...diskQueries],
		})
	);

	const latest = (id: string): number | undefined => {
		const result = response.MetricDataResults?.find(r => r.Id === id);
		const value = result?.Values?.[0];
		return typeof value === 'number' ? toPercent(value) : undefined;
	};
	// 依 schema 候選順序取第一個有資料的
	const firstAvailable = (ids: string[]): number | undefined => {
		for (const id of ids) {
			const value = latest(id);
			if (value !== undefined) {
				return value;
			}
		}
		return undefined;
	};

	return {
		cpu: latest('cpu'),
		mem: firstAvailable(memQueries.map(q => q.Id)),
		disk: firstAvailable(diskQueries.map(q => q.Id)),
	};
};

/**
 * 查詢單一指標的時間序列（線圖模式）。
 * 只查選定的那個指標——CPU 只需 1 個 metric、mem/disk 各 3 個 schema 候選，
 * 比 all 模式的 7 個省下大半 GetMetricData 費用。
 * 拉長視窗本身不加價（GetMetricData 依「requested metrics 數量」計費，與資料點數無關）。
 */
const fetchMetricSeries = async (
	cw: CloudWatchClient,
	instanceId: string,
	key: keyof Ec2Metrics
): Promise<Ec2Series> => {
	const now = new Date();
	const start = new Date(now.getTime() - CHART_LOOKBACK_MS);
	const queries = key === 'cpu' ? [buildCpuQuery(instanceId)] : buildAgentQueries(key, instanceId);
	const window = { windowStartMs: start.getTime(), windowEndMs: now.getTime() };

	const response = await cw.send(
		new GetMetricDataCommand({
			StartTime: start,
			EndTime: now,
			ScanBy: 'TimestampAscending', // 線圖需要時間遞增
			MetricDataQueries: queries,
		})
	);

	// 依 schema 候選順序取第一個有資料的序列
	for (const query of queries) {
		const result = response.MetricDataResults?.find(r => r.Id === query.Id);
		const timestamps = result?.Timestamps ?? [];
		const values = result?.Values ?? [];
		const points = timestamps
			.map((timestamp, i) => ({ t: timestamp.getTime(), v: values[i] }))
			.filter((point): point is { t: number; v: number } => typeof point.v === 'number')
			.map(({ t, v }) => ({ t, v: toPercent(v) }))
			.sort((a, b) => a.t - b.t);
		if (points.length > 0) {
			return { ...window, points };
		}
	}
	return { ...window, points: [] };
};

/**
 * 查詢單台 EC2 instance 的狀態、status check 與使用率指標。
 * 只有 running 時才拉 CloudWatch 指標（其他狀態沒有資料，省下 API 呼叫）。
 * 線圖模式改拉單一指標的時間序列，all 模式維持三項指標的目前值。
 */
export const fetchEc2Snapshot = async (state: ButtonState, settings: Ec2MonitorSettings): Promise<Ec2Snapshot> => {
	const { ec2, cw } = ensureClients(state, settings);
	const instanceId = settings.instanceId;

	const describe = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
	const instance = describe.Reservations?.[0]?.Instances?.[0];
	const instanceState = instance?.State?.Name ?? 'unknown';

	const statusResponse = await ec2.send(
		new DescribeInstanceStatusCommand({ InstanceIds: [instanceId], IncludeAllInstances: true })
	);
	const status = statusResponse.InstanceStatuses?.[0];
	const statusCheck = combineStatusCheck(status?.SystemStatus?.Status, status?.InstanceStatus?.Status);

	const chartKey = chartMetricKey(getDisplayMode(settings));
	const running = instanceState === 'running';
	const snapshot: Ec2Snapshot = {
		state: instanceState,
		statusCheck,
		metrics: running && !chartKey ? await fetchMetrics(cw, instanceId) : {},
		series: running && chartKey ? await fetchMetricSeries(cw, instanceId, chartKey) : undefined,
	};
	streamDeck.logger.debug('AWS EC2 snapshot', snapshot);
	return snapshot;
};
