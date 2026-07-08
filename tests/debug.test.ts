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

	it('第 4 次之後依隨機值決定落定結果或模擬新部署', async () => {
		const fetcher = createDebugFetcher();
		await fetcher();
		await fetcher();
		await fetcher();

		// 高值：全部成功（落定）
		vi.spyOn(Math, 'random').mockReturnValue(0.9);
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'Succeeded']);

		// 中值：含失敗（落定）
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'Failed']);

		// 低值：模擬偵測到新部署，重回全部 InProgress
		vi.spyOn(Math, 'random').mockReturnValue(0.1);
		expect(await fetcher()).toEqual(['InProgress', 'InProgress', 'InProgress']);
	});

	it('每個 fetcher 各自獨立計數', async () => {
		const first = createDebugFetcher();
		const second = createDebugFetcher();
		await first();
		await first();
		expect(await second()).toEqual(['InProgress', 'InProgress', 'InProgress']);
	});
});
