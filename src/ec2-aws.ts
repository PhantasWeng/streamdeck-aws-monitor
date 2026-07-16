import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { DescribeInstancesCommand, DescribeInstanceStatusCommand, EC2Client } from '@aws-sdk/client-ec2';
import streamDeck from '@elgato/streamdeck';
import type { ButtonState } from './button-state';
import type { Ec2Metrics, Ec2Snapshot } from './ec2-metrics';
import { type Ec2MonitorSettings, getRegion } from './ec2-settings';

// CloudWatch 指標查詢視窗：往回 15 分鐘、5 分鐘一個資料點，取最新的一筆
const METRIC_LOOKBACK_MS = 15 * 60 * 1000;
const METRIC_PERIOD_SECONDS = 300;

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

/**
 * 查詢 CPU / 記憶體 / 磁碟使用率。
 * CPU 走 EC2 原生指標（維度僅 InstanceId，精準可靠）；
 * 記憶體與磁碟為 CloudWatch Agent 指標，對多組常見 schema 各發一次 SEARCH，
 * 取第一個有資料的（相容不同 agent 設定）。磁碟只取根目錄。
 * 未裝 CloudWatch Agent 時全部回空，對應指標為 undefined（自動不顯示）。
 */
const fetchMetrics = async (cw: CloudWatchClient, instanceId: string): Promise<Ec2Metrics> => {
	const now = new Date();
	const start = new Date(now.getTime() - METRIC_LOOKBACK_MS);
	const memQueries = MEM_SCHEMAS.map((schema, i) => ({
		Id: `mem${i}`,
		Expression: `AVG(SEARCH('${schema} MetricName="mem_used_percent" InstanceId="${instanceId}"', 'Average', ${METRIC_PERIOD_SECONDS}))`,
		ReturnData: true,
	}));
	const diskQueries = DISK_SCHEMAS.map((schema, i) => ({
		Id: `disk${i}`,
		Expression: `AVG(SEARCH('${schema} MetricName="disk_used_percent" InstanceId="${instanceId}" path="/"', 'Average', ${METRIC_PERIOD_SECONDS}))`,
		ReturnData: true,
	}));

	const response = await cw.send(
		new GetMetricDataCommand({
			StartTime: start,
			EndTime: now,
			ScanBy: 'TimestampDescending', // 最新的資料點排在最前
			MetricDataQueries: [
				{
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
				},
				...memQueries,
				...diskQueries,
			],
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
 * 查詢單台 EC2 instance 的狀態、status check 與使用率指標。
 * 只有 running 時才拉 CloudWatch 指標（其他狀態沒有資料，省下 API 呼叫）。
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

	const metrics = instanceState === 'running' ? await fetchMetrics(cw, instanceId) : {};

	const snapshot: Ec2Snapshot = { state: instanceState, statusCheck, metrics };
	streamDeck.logger.debug('AWS EC2 snapshot', snapshot);
	return snapshot;
};
