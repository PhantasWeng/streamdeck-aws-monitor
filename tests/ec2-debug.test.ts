import { describe, expect, it } from 'vitest';
import { createDebugFetcher } from '../src/ec2-debug';

describe('createDebugFetcher', () => {
	it('循環走過 pending → running → stopping → stopped', async () => {
		const fetcher = createDebugFetcher();
		const states: string[] = [];
		for (let i = 0; i < 7; i++) {
			states.push((await fetcher()).state);
		}
		expect(states).toEqual(['pending', 'running', 'running', 'running', 'running', 'stopping', 'stopped']);
	});

	it('running 期間回傳三項指標，且落在合理範圍', async () => {
		const fetcher = createDebugFetcher();
		await fetcher(); // pending
		const snap = await fetcher(); // running
		expect(snap.state).toBe('running');
		expect(snap.statusCheck).toBe('ok');
		for (const key of ['cpu', 'mem', 'disk'] as const) {
			const value = snap.metrics[key];
			expect(typeof value).toBe('number');
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(100);
		}
	});

	it('非 running 狀態沒有指標', async () => {
		const fetcher = createDebugFetcher();
		const pending = await fetcher(); // pending
		expect(pending.metrics).toEqual({});
	});

	it('走完一輪後重新開始新一輪', async () => {
		const fetcher = createDebugFetcher();
		for (let i = 0; i < 7; i++) {
			await fetcher();
		}
		expect((await fetcher()).state).toBe('pending');
	});

	it('每個 fetcher 各自獨立計數', async () => {
		const first = createDebugFetcher();
		const second = createDebugFetcher();
		await first();
		await first();
		expect((await second()).state).toBe('pending');
	});
});

describe('createDebugFetcher 線圖模式', () => {
	it('running 期間回傳時間序列而非橫條指標', async () => {
		const fetcher = createDebugFetcher('cpu');
		await fetcher(); // pending
		const snap = await fetcher(); // running
		expect(snap.state).toBe('running');
		expect(snap.metrics).toEqual({});
		expect(snap.series?.points.length).toBeGreaterThan(1);
	});

	it('序列時間遞增且落在視窗內、值在 0–100', async () => {
		const fetcher = createDebugFetcher('mem');
		await fetcher();
		const series = (await fetcher()).series;
		if (!series) {
			throw new Error('running 應該要有序列');
		}
		const times = series.points.map(p => p.t);
		expect([...times].sort((a, b) => a - b)).toEqual(times);
		expect(times[0]).toBeGreaterThanOrEqual(series.windowStartMs);
		expect(times.at(-1)).toBeLessThanOrEqual(series.windowEndMs);
		for (const point of series.points) {
			expect(point.v).toBeGreaterThanOrEqual(0);
			expect(point.v).toBeLessThanOrEqual(100);
		}
	});

	it('非 running 狀態沒有序列', async () => {
		const fetcher = createDebugFetcher('disk');
		expect((await fetcher()).series).toBeUndefined();
	});

	it('不同指標波形不同（切換模式看得出差異）', async () => {
		const cpu = createDebugFetcher('cpu');
		const disk = createDebugFetcher('disk');
		await cpu();
		await disk();
		const cpuValues = (await cpu()).series?.points.map(p => p.v);
		const diskValues = (await disk()).series?.points.map(p => p.v);
		expect(cpuValues).not.toEqual(diskValues);
	});

	it('預設仍是 all 模式（回傳三項指標）', async () => {
		const fetcher = createDebugFetcher();
		await fetcher();
		const snap = await fetcher();
		expect(snap.series).toBeUndefined();
		expect(typeof snap.metrics.cpu).toBe('number');
	});
});
