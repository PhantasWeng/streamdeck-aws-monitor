import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDebugFetcher } from '../src/debug';

describe('createDebugFetcher', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('一開始全部 InProgress，之後從第一個 stage 依序變成 Succeeded、其餘維持 InProgress', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.9); // 不觸發失敗
		const fetcher = createDebugFetcher();
		expect(await fetcher()).toEqual(['InProgress', 'InProgress', 'InProgress']);
		expect(await fetcher()).toEqual(['Succeeded', 'InProgress', 'InProgress']);
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'InProgress']);
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'Succeeded']);
	});

	it('全成功結束後，下一次 tick 重新開始新一輪（全部 InProgress）', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.9);
		const fetcher = createDebugFetcher();
		await fetcher();
		await fetcher();
		await fetcher();
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'Succeeded']);
		expect(await fetcher()).toEqual(['InProgress', 'InProgress', 'InProgress']);
	});

	it('推進途中失敗：該 stage 變 Failed、其後顯示未執行，本輪結束後重新開始', async () => {
		const random = vi.spyOn(Math, 'random').mockReturnValue(0.9);
		const fetcher = createDebugFetcher();
		await fetcher(); // 全部 InProgress
		await fetcher(); // ['Succeeded', 'InProgress', 'InProgress']

		random.mockReturnValue(0.05); // 下一步失敗
		expect(await fetcher()).toEqual(['Succeeded', 'Failed', '']);

		// 失敗即結束本輪，下一次 tick 開始新一輪
		random.mockReturnValue(0.9);
		expect(await fetcher()).toEqual(['InProgress', 'InProgress', 'InProgress']);
		expect(await fetcher()).toEqual(['Succeeded', 'InProgress', 'InProgress']);
	});

	it('指定 stage 數時模擬 N-stage 的逐步推進', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.9);
		const fetcher = createDebugFetcher(5);
		expect(await fetcher()).toEqual(['InProgress', 'InProgress', 'InProgress', 'InProgress', 'InProgress']);
		expect(await fetcher()).toEqual(['Succeeded', 'InProgress', 'InProgress', 'InProgress', 'InProgress']);
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'InProgress', 'InProgress', 'InProgress']);
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'Succeeded', 'InProgress', 'InProgress']);
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'Succeeded', 'Succeeded', 'InProgress']);
		expect(await fetcher()).toEqual(['Succeeded', 'Succeeded', 'Succeeded', 'Succeeded', 'Succeeded']);
	});

	it('每個 fetcher 各自獨立計數', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.9);
		const first = createDebugFetcher();
		const second = createDebugFetcher();
		await first();
		await first();
		expect(await second()).toEqual(['InProgress', 'InProgress', 'InProgress']);
	});
});
