import { describe, expect, it } from 'vitest';
import { classifyPoll, deriveFooter, isLoadingStatus } from '../src/polling';

describe('isLoadingStatus', () => {
	it('Succeeded 與 Failed 為非 loading', () => {
		expect(isLoadingStatus('Succeeded')).toBe(false);
		expect(isLoadingStatus('Failed')).toBe(false);
	});

	it('其他狀態（InProgress、TransitionLoading）皆為 loading', () => {
		expect(isLoadingStatus('InProgress')).toBe(true);
		expect(isLoadingStatus('TransitionLoading')).toBe(true);
		expect(isLoadingStatus('')).toBe(true);
	});
});

describe('classifyPoll', () => {
	const MAX = 30 * 60 * 1000;

	it('沒有任何 stage 在進行 → settled，並清除 pollingStartedAt', () => {
		expect(classifyPoll(['Succeeded', 'Succeeded'], 1000, 5000, MAX)).toEqual({
			mode: 'settled',
			pollingStartedAt: undefined,
		});
	});

	it('含 Failed 但無 in-progress → 仍是 settled', () => {
		expect(classifyPoll(['Succeeded', 'Failed'], undefined, 5000, MAX)).toEqual({
			mode: 'settled',
			pollingStartedAt: undefined,
		});
	});

	it('有 in-progress 且尚未計時 → active，並以 now 起算 pollingStartedAt', () => {
		expect(classifyPoll(['InProgress', 'Succeeded'], undefined, 5000, MAX)).toEqual({
			mode: 'active',
			pollingStartedAt: 5000,
		});
	});

	it('有 in-progress 且已在計時中、未超時 → active，沿用原本的 pollingStartedAt', () => {
		expect(classifyPoll(['InProgress'], 1000, 1000 + MAX - 1, MAX)).toEqual({
			mode: 'active',
			pollingStartedAt: 1000,
		});
	});

	it('有 in-progress 且達到 pollingMaxMs（邊界） → terminated', () => {
		expect(classifyPoll(['InProgress'], 1000, 1000 + MAX, MAX)).toEqual({
			mode: 'terminated',
			pollingStartedAt: 1000,
		});
	});

	it('落定後再出現新的 in-progress → 重新以 now 起算（模擬偵測到新部署）', () => {
		// 先落定清除計時
		const settled = classifyPoll(['Succeeded'], 1000, 5000, MAX);
		expect(settled.pollingStartedAt).toBeUndefined();
		// 新部署觸發
		expect(classifyPoll(['InProgress'], settled.pollingStartedAt, 9000, MAX)).toEqual({
			mode: 'active',
			pollingStartedAt: 9000,
		});
	});
});

describe('deriveFooter', () => {
	it('terminated 優先於一切', () => {
		expect(deriveFooter(['InProgress'], true)).toBe('terminated');
		expect(deriveFooter(['Succeeded', 'Succeeded'], true)).toBe('terminated');
	});

	it('全部成功 → succeeded', () => {
		expect(deriveFooter(['Succeeded', 'Succeeded'], false)).toBe('succeeded');
	});

	it('有進行中（含過場 TransitionLoading） → refreshing', () => {
		expect(deriveFooter(['InProgress', 'Succeeded'], false)).toBe('refreshing');
		expect(deriveFooter(['TransitionLoading', 'Succeeded'], false)).toBe('refreshing');
	});

	it('落定但含 Failed、無進行中 → idle', () => {
		expect(deriveFooter(['Succeeded', 'Failed'], false)).toBe('idle');
	});
});
