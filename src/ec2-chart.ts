/**
 * 線圖（心電圖）的座標計算：把時間序列映射到畫布座標並在資料缺口處斷segment。
 * 純函式、不依賴 canvas，便於單元測試；ec2-rendering.ts 只負責照著座標畫。
 */
import type { Ec2Series, MetricPoint } from './ec2-metrics';

export type ChartPoint = { x: number; y: number };

export type ChartBox = {
	left: number;
	top: number;
	width: number;
	height: number;
};

// 線圖的取樣參數（三種指標統一）：5 分鐘一點 × 2.5 小時 ≈ 30 點，
// 在 144px 寬的按鈕上約 4.5px/點。CPU 在 basic monitoring（5 分鐘解析度）
// 下也能填滿，不必開 detailed monitoring。
export const CHART_PERIOD_SECONDS = 300;
export const CHART_LOOKBACK_MS = 150 * 60 * 1000;
// 相鄰資料點超過兩個 period 視為缺口，折線就此斷開
export const CHART_GAP_MS = CHART_PERIOD_SECONDS * 2 * 1000;

// y 軸固定 0–100%：不做動態縮放，否則 3% 的雜訊會被畫得像暴衝
const Y_MIN = 0;
const Y_MAX = 100;

const clampPercent = (value: number): number => Math.max(Y_MIN, Math.min(Y_MAX, value));

/**
 * 把單一資料點映射到畫布座標。
 * x 依「時間在視窗中的比例」定位（而非陣列索引），視窗寬度為 0 時退回最左側。
 */
const toChartPoint = (point: MetricPoint, series: Ec2Series, box: ChartBox): ChartPoint => {
	const span = series.windowEndMs - series.windowStartMs;
	const ratio = span > 0 ? (point.t - series.windowStartMs) / span : 0;
	const clampedRatio = Math.max(0, Math.min(1, ratio));
	return {
		x: box.left + clampedRatio * box.width,
		y: box.top + (1 - clampPercent(point.v) / Y_MAX) * box.height,
	};
};

/**
 * 把序列切成多段折線：相鄰兩點間隔超過 gapMs 視為資料缺口，斷開成不同段。
 * 缺口不連線是刻意的——instance 剛開機或 CloudWatch Agent 中斷時，
 * 一條橫跨空窗的直線會讓人以為那段時間有穩定資料。
 * 回傳的每段至少含一個點；空序列回傳空陣列。
 */
export const buildChartSegments = (series: Ec2Series, box: ChartBox, gapMs: number): ChartPoint[][] => {
	const segments: ChartPoint[][] = [];
	let current: ChartPoint[] = [];
	let previousTime: number | undefined;

	for (const point of series.points) {
		if (previousTime !== undefined && point.t - previousTime > gapMs && current.length > 0) {
			segments.push(current);
			current = [];
		}
		current.push(toChartPoint(point, series, box));
		previousTime = point.t;
	}
	if (current.length > 0) {
		segments.push(current);
	}
	return segments;
};

/**
 * 取序列最新（時間最大）的資料點值；空序列回傳 undefined。
 * 標題列的數字一律走這裡，確保與線圖末端是同一筆資料。
 */
export const latestValue = (series?: Ec2Series): number | undefined => {
	const last = series?.points.at(-1);
	return last ? clampPercent(last.v) : undefined;
};

/**
 * 序列是否有可畫的資料
 */
export const hasChartData = (series?: Ec2Series): boolean => (series?.points.length ?? 0) > 0;
