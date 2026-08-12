import { describe, expect, it, vi } from 'vitest';

vi.mock('@elgato/streamdeck', () => ({
	default: { logger: { error: vi.fn() } },
}));

import { CHART_LOOKBACK_MS, CHART_PERIOD_SECONDS } from '../src/ec2-chart';
import type { Ec2Series } from '../src/ec2-metrics';
import { renderFrame } from '../src/ec2-rendering';

const WINDOW_END = 1_700_000_000_000;
const STEP_MS = CHART_PERIOD_SECONDS * 1000;

const seriesOf = (values: number[]): Ec2Series => ({
	windowStartMs: WINDOW_END - CHART_LOOKBACK_MS,
	windowEndMs: WINDOW_END,
	points: values.map((v, i) => ({ t: WINDOW_END - (values.length - 1 - i) * STEP_MS, v })),
});

const baseSpec = {
	title: 'my-server',
	state: 'running',
	metrics: {},
	footer: 'healthy' as const,
	rotationDeg: 0,
};

const isPng = (dataUrl: string): boolean => dataUrl.startsWith('data:image/png;base64,') && dataUrl.length > 100;

describe('renderFrame 線圖模式', () => {
	it('有序列資料時產出有效畫面', async () => {
		const dataUrl = await renderFrame({
			...baseSpec,
			displayMode: 'cpu',
			series: seriesOf([10, 40, 25, 80, 62]),
		});
		expect(isPng(dataUrl)).toBe(true);
	});

	it('序列為空時走 NO DATA 而不是拋錯', async () => {
		const dataUrl = await renderFrame({
			...baseSpec,
			displayMode: 'mem',
			series: seriesOf([]),
		});
		expect(isPng(dataUrl)).toBe(true);
	});

	it('線圖模式但完全沒有 series 欄位也不會爆', async () => {
		const dataUrl = await renderFrame({ ...baseSpec, displayMode: 'disk' });
		expect(isPng(dataUrl)).toBe(true);
	});

	it('含資料缺口的序列可以正常繪製', async () => {
		const withGap: Ec2Series = {
			windowStartMs: WINDOW_END - CHART_LOOKBACK_MS,
			windowEndMs: WINDOW_END,
			points: [
				{ t: WINDOW_END - CHART_LOOKBACK_MS, v: 20 },
				{ t: WINDOW_END - CHART_LOOKBACK_MS + STEP_MS, v: 30 },
				// 中間整段沒有資料
				{ t: WINDOW_END, v: 55 },
			],
		};
		expect(isPng(await renderFrame({ ...baseSpec, displayMode: 'cpu', series: withGap }))).toBe(true);
	});

	it('impaired 時畫面與正常波形不同（線壓成 0、數值改 --）', async () => {
		const series = seriesOf([10, 40, 25, 80, 62]);
		const spec = { ...baseSpec, title: 'impaired-cmp', displayMode: 'cpu' as const, series };
		const healthy = await renderFrame(spec);
		const impaired = await renderFrame({ ...spec, footer: 'impaired' });
		expect(isPng(impaired)).toBe(true);
		expect(impaired).not.toBe(healthy);
	});

	it('impaired 即使沒有序列資料也不會走 NO DATA', async () => {
		const spec = { ...baseSpec, title: 'impaired-empty', displayMode: 'disk' as const };
		const noData = await renderFrame(spec);
		const impaired = await renderFrame({ ...spec, footer: 'impaired' });
		expect(impaired).not.toBe(noData);
	});

	it('非 running 狀態改走大字狀態畫面', async () => {
		const dataUrl = await renderFrame({
			...baseSpec,
			state: 'stopped',
			footer: 'stopped',
			displayMode: 'cpu',
		});
		expect(isPng(dataUrl)).toBe(true);
	});
});

describe('renderFrame 快取', () => {
	it('序列值改變就必須重畫（值有進快取 key）', async () => {
		const spec = { ...baseSpec, title: 'cache-values', displayMode: 'cpu' as const };
		const first = await renderFrame({ ...spec, series: seriesOf([10, 20, 30]) });
		const second = await renderFrame({ ...spec, series: seriesOf([90, 80, 70]) });
		expect(first).not.toBe(second);
	});

	it('完全相同的序列命中快取，回傳同一份結果', async () => {
		const spec = { ...baseSpec, title: 'cache-hit', displayMode: 'cpu' as const };
		const first = await renderFrame({ ...spec, series: seriesOf([10, 20, 30]) });
		const second = await renderFrame({ ...spec, series: seriesOf([10, 20, 30]) });
		expect(first).toBe(second);
	});

	it('顯示模式不同不會互相污染快取', async () => {
		const series = seriesOf([50, 50, 50]);
		const spec = { ...baseSpec, title: 'cache-mode' };
		const chart = await renderFrame({ ...spec, displayMode: 'cpu', series });
		const all = await renderFrame({ ...spec, displayMode: 'all', metrics: { cpu: 50 } });
		expect(chart).not.toBe(all);
	});
});

describe('renderFrame all 模式（既有行為）', () => {
	it('未指定 displayMode 時仍畫指標列', async () => {
		const dataUrl = await renderFrame({ ...baseSpec, metrics: { cpu: 62, mem: 45, disk: 28 } });
		expect(isPng(dataUrl)).toBe(true);
	});
});
