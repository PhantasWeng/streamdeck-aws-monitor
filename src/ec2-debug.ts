import { CHART_LOOKBACK_MS, CHART_PERIOD_SECONDS } from './ec2-chart';
import { chartMetricKey, type Ec2DisplayMode, type Ec2Series, type Ec2Snapshot } from './ec2-metrics';

export const DEBUG_STEP_INTERVAL = 3000; // Debug 模式每 3 秒推進一步

// 模擬一輪 EC2 生命週期的狀態序列：開機 → 執行一段時間 → 關機 → 停止，之後循環
const LIFECYCLE: string[] = ['pending', 'running', 'running', 'running', 'running', 'stopping', 'stopped'];

// 模擬序列的資料點數（與正式模式的視窗/解析度一致）
const CHART_POINTS = Math.round(CHART_LOOKBACK_MS / (CHART_PERIOD_SECONDS * 1000));
const CHART_STEP_MS = CHART_PERIOD_SECONDS * 1000;

/**
 * 以 tick 為相位產生可預期波動的百分比（40–90 之間），不依賴亂數以利測試
 */
const wave = (tick: number, offset: number): number => Math.round(65 + 25 * Math.sin((tick + offset) * 0.9));

/**
 * 疊兩個不同頻率的正弦波，做出比單一 sin 更像心電圖的起伏（夾在 5–95）。
 * 同樣不依賴亂數：相同 (index, offset) 必得相同值。
 */
const chartWave = (index: number, offset: number): number => {
	const raw = 55 + 20 * Math.sin((index + offset) * 0.5) + 14 * Math.sin((index + offset) * 1.7);
	return Math.max(5, Math.min(95, Math.round(raw)));
};

/**
 * 產生一段模擬時間序列：以 nowMs 為視窗右緣往回鋪滿 CHART_POINTS 個點，
 * tick 讓波形隨每次輪詢向左滑動，看起來像持續更新的心電圖。
 */
const createDebugSeries = (tick: number, offset: number, nowMs: number): Ec2Series => ({
	windowStartMs: nowMs - CHART_LOOKBACK_MS,
	windowEndMs: nowMs,
	points: Array.from({ length: CHART_POINTS }, (_, i) => ({
		t: nowMs - (CHART_POINTS - 1 - i) * CHART_STEP_MS,
		v: chartWave(i + tick, offset),
	})),
});

// 各指標用不同相位，切換顯示模式時波形看得出差異
const CHART_OFFSETS: Record<string, number> = { cpu: 0, mem: 7, disk: 13 };

/**
 * 建立 debug 模式的模擬 EC2 狀態來源：
 * 循環走過 pending → running → stopping → stopped，running 期間依顯示模式回傳
 * all 的三項指標（展示自適應版面）或單一指標的時間序列（展示線圖），
 * 不需要 AWS 憑證，與正式模式共用同一套 polling / 渲染流程。
 */
export const createDebugFetcher = (mode: Ec2DisplayMode = 'all'): (() => Promise<Ec2Snapshot>) => {
	const chartKey = chartMetricKey(mode);
	let tick = -1;
	return async () => {
		tick = (tick + 1) % LIFECYCLE.length;
		const state = LIFECYCLE[tick];
		if (state !== 'running') {
			// 非 running（開機/關機/停止中）沒有指標
			return { state, metrics: {} };
		}
		if (chartKey) {
			return {
				state,
				statusCheck: 'ok',
				metrics: {},
				series: createDebugSeries(tick, CHART_OFFSETS[chartKey] ?? 0, Date.now()),
			};
		}
		return {
			state,
			statusCheck: 'ok',
			metrics: {
				cpu: wave(tick, 0),
				mem: wave(tick, 2),
				disk: wave(tick, 4),
			},
		};
	};
};
