import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }));

vi.mock('@elgato/streamdeck', () => ({
	default: { logger: { error: errorMock } },
}));

import {
	type ButtonState,
	disposeButtonState,
	getButtonState,
	syncLoadingAnimation,
} from '../src/button-state';

describe('loading animation 生命週期（防殭屍計時器）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('已釋放的實例不得啟動動畫計時器', () => {
		const state: ButtonState = { disposed: true };
		let calls = 0;
		syncLoadingAnimation(state, true, async () => {
			calls += 1;
		});
		expect(state.loadingAnimationTimer).toBeUndefined();
		vi.advanceTimersByTime(1000);
		expect(calls).toBe(0);
	});

	it('動畫運行中被釋放時，下一個 tick 會自我清理並停止 setImage', () => {
		const state: ButtonState = {};
		let calls = 0;
		syncLoadingAnimation(state, true, async () => {
			calls += 1;
		});
		expect(state.loadingAnimationTimer).toBeDefined();

		// 第一個 tick 正常渲染
		vi.advanceTimersByTime(100);
		expect(calls).toBe(1);

		// 模擬 onWillDisappear 釋放實例
		state.disposed = true;
		vi.advanceTimersByTime(100);
		expect(state.loadingAnimationTimer).toBeUndefined();

		// 之後不再有任何 render 呼叫（殭屍計時器已清除）
		const callsAfterDispose = calls;
		vi.advanceTimersByTime(1000);
		expect(calls).toBe(callsAfterDispose);
	});

	// 修復前這裡是 `void currentRenderer()`：繪圖失敗的 rejection 裸奔，
	// Node 20 直接終止外掛程序，Stream Deck 端表現為每 10 秒重啟的崩潰迴圈
	it('單幀繪圖失敗只記錄錯誤，動畫繼續運行', async () => {
		errorMock.mockClear();
		const state: ButtonState = {};
		let calls = 0;
		syncLoadingAnimation(state, true, async () => {
			calls += 1;
			throw new Error('canvas render failed');
		});

		await vi.advanceTimersByTimeAsync(100);
		expect(calls).toBe(1);
		expect(errorMock).toHaveBeenCalledWith(
			'Detached operation failed: loading animation frame',
			expect.any(Error)
		);

		// 失敗不該停掉動畫：下一幀照常嘗試
		await vi.advanceTimersByTimeAsync(100);
		expect(calls).toBe(2);
		expect(state.loadingAnimationTimer).toBeDefined();
	});

	it('disposeButtonState 標記 disposed、清掉計時器，且下次取得為全新實例', () => {
		const id = 'test-action-dispose';
		const state = getButtonState(id);
		syncLoadingAnimation(state, true, async () => {});
		expect(state.loadingAnimationTimer).toBeDefined();

		disposeButtonState(id);
		expect(state.disposed).toBe(true);
		expect(state.loadingAnimationTimer).toBeUndefined();

		// 同一 id 再次出現：全新乾淨實例，disposed 旗標不外洩
		const fresh = getButtonState(id);
		expect(fresh).not.toBe(state);
		expect(fresh.disposed).toBeFalsy();
	});
});
