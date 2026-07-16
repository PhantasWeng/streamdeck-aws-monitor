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
