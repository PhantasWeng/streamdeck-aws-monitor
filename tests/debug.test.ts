import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDebugFetcher } from '../src/debug';

describe('createDebugFetcher', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('模擬 3-stage pipeline 的固定進度推進', async () => {
		const fetcher = createDebugFetcher();
		expect(await fetcher()).toEqual(['InProgress', 'InProgress', 'InProgress']);
		expect(await fetcher()).toEqual(['Succeeded', 'Failed', 'Failed']);
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'Failed']);
	});

	it('第 4 次之後依隨機值決定最後一個 stage 是否成功', async () => {
		const fetcher = createDebugFetcher();
		await fetcher();
		await fetcher();
		await fetcher();

		vi.spyOn(Math, 'random').mockReturnValue(0.9);
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'Succeeded']);

		vi.spyOn(Math, 'random').mockReturnValue(0.1);
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'Failed']);
	});

	it('每個 fetcher 各自獨立計數', async () => {
		const first = createDebugFetcher();
		const second = createDebugFetcher();
		await first();
		await first();
		expect(await second()).toEqual(['InProgress', 'InProgress', 'InProgress']);
	});
});
