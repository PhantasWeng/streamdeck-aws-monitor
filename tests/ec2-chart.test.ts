import { describe, expect, it } from 'vitest';
import { buildChartSegments, type ChartBox, hasChartData, latestValue } from '../src/ec2-chart';
import type { Ec2Series } from '../src/ec2-metrics';

const BOX: ChartBox = { left: 0, top: 0, width: 100, height: 100 };
const GAP_MS = 600;

const series = (points: { t: number; v: number }[], windowStartMs = 0, windowEndMs = 1000): Ec2Series => ({
	windowStartMs,
	windowEndMs,
	points,
});

describe('buildChartSegments', () => {
	it('依時間比例定位 x、依百分比反轉定位 y', () => {
		const segments = buildChartSegments(
			series([
				{ t: 0, v: 100 },
				{ t: 500, v: 50 },
				{ t: 1000, v: 0 },
			]),
			BOX,
			GAP_MS
		);
		expect(segments).toHaveLength(1);
		expect(segments[0]).toEqual([
			{ x: 0, y: 0 },
			{ x: 50, y: 50 },
			{ x: 100, y: 100 },
		]);
	});

	it('x 用時間定位而非陣列索引：稀疏資料不會被均分拉開', () => {
		// 三個點都擠在視窗前四分之一，右側應留白而不是被均分成 0/50/100
		const segments = buildChartSegments(
			series([
				{ t: 0, v: 0 },
				{ t: 125, v: 0 },
				{ t: 250, v: 0 },
			]),
			BOX,
			GAP_MS
		);
		expect(segments[0].map(p => p.x)).toEqual([0, 12.5, 25]);
	});

	it('間隔超過 gapMs 時斷成多段（資料缺口不連線）', () => {
		const segments = buildChartSegments(
			series([
				{ t: 0, v: 10 },
				{ t: 100, v: 20 },
				{ t: 900, v: 30 }, // 與前一點相差 800 > 600
				{ t: 1000, v: 40 },
			]),
			BOX,
			GAP_MS
		);
		expect(segments).toHaveLength(2);
		expect(segments[0].map(p => p.x)).toEqual([0, 10]);
		expect(segments[1].map(p => p.x)).toEqual([90, 100]);
	});

	it('剛好等於 gapMs 不算缺口', () => {
		const segments = buildChartSegments(
			series([
				{ t: 0, v: 10 },
				{ t: 600, v: 20 },
			]),
			BOX,
			GAP_MS
		);
		expect(segments).toHaveLength(1);
	});

	it('值超出 0–100 會被夾住（y 不會畫到框外）', () => {
		const segments = buildChartSegments(
			series([
				{ t: 0, v: 150 },
				{ t: 1000, v: -20 },
			]),
			BOX,
			GAP_MS * 10 // 放大到不觸發缺口切段，這裡只驗證 y 的夾值
		);
		expect(segments[0].map(p => p.y)).toEqual([0, 100]);
	});

	it('資料點落在視窗外時 x 被夾在框內', () => {
		const segments = buildChartSegments(
			series([
				{ t: -500, v: 50 },
				{ t: 1500, v: 50 },
			]),
			BOX,
			GAP_MS * 10
		);
		expect(segments[0].map(p => p.x)).toEqual([0, 100]);
	});

	it('套用 box 的位移與尺寸', () => {
		const segments = buildChartSegments(
			series([{ t: 500, v: 50 }]),
			{ left: 4, top: 44, width: 136, height: 68 },
			GAP_MS
		);
		expect(segments[0][0]).toEqual({ x: 72, y: 78 });
	});

	it('空序列回傳空陣列', () => {
		expect(buildChartSegments(series([]), BOX, GAP_MS)).toEqual([]);
	});

	it('單一資料點回傳一段一點', () => {
		const segments = buildChartSegments(series([{ t: 0, v: 50 }]), BOX, GAP_MS);
		expect(segments).toEqual([[{ x: 0, y: 50 }]]);
	});

	it('視窗寬度為 0 時退回最左側而不是產生 NaN', () => {
		const segments = buildChartSegments(series([{ t: 5, v: 50 }], 5, 5), BOX, GAP_MS);
		expect(segments[0][0]).toEqual({ x: 0, y: 50 });
	});
});

describe('latestValue', () => {
	it('取時間最後一筆的值', () => {
		expect(
			latestValue(
				series([
					{ t: 0, v: 10 },
					{ t: 1000, v: 62 },
				])
			)
		).toBe(62);
	});

	it('夾在 0–100', () => {
		expect(latestValue(series([{ t: 0, v: 120 }]))).toBe(100);
		expect(latestValue(series([{ t: 0, v: -5 }]))).toBe(0);
	});

	it('保留 0（0% 是有效資料，不可當成沒資料）', () => {
		expect(latestValue(series([{ t: 0, v: 0 }]))).toBe(0);
	});

	it('空序列或未提供回傳 undefined', () => {
		expect(latestValue(series([]))).toBeUndefined();
		expect(latestValue(undefined)).toBeUndefined();
	});
});

describe('hasChartData', () => {
	it('有點為 true，空的或未提供為 false', () => {
		expect(hasChartData(series([{ t: 0, v: 1 }]))).toBe(true);
		expect(hasChartData(series([]))).toBe(false);
		expect(hasChartData(undefined)).toBe(false);
	});
});
