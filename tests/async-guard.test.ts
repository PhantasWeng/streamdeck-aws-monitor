import { beforeEach, describe, expect, it, vi } from 'vitest';

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }));

vi.mock('@elgato/streamdeck', () => ({
	default: { logger: { error: errorMock } },
}));

import { detach } from '../src/async-guard';

/**
 * 等待 microtask 與 process 的 unhandledRejection 偵測跑完一輪
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe('detach（射後不理呼叫的 rejection 防護）', () => {
	beforeEach(() => {
		errorMock.mockClear();
	});

	it('接住 rejection 並記錄 context，不向呼叫端拋出', async () => {
		const failure = new Error('render failed');

		expect(() => detach(Promise.reject(failure), 'renderInitButton')).not.toThrow();

		await flush();
		expect(errorMock).toHaveBeenCalledWith('Detached operation failed: renderInitButton', failure);
	});

	it('resolved promise 不記錄任何錯誤', async () => {
		detach(Promise.resolve('ok'), 'pollOnce');

		await flush();
		expect(errorMock).not.toHaveBeenCalled();
	});

	// 這是本次修復的核心回歸測試：修復前 `void somePromise` 會讓 rejection 裸奔，
	// Node 20 預設 --unhandled-rejections=throw 直接終止整個外掛程序
	it('rejected promise 不再觸發 unhandledRejection', async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown): void => {
			unhandled.push(reason);
		};
		process.on('unhandledRejection', onUnhandled);

		try {
			detach(Promise.reject(new Error('boom')), 'loading animation frame');
			await flush();
			expect(unhandled).toHaveLength(0);
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});
});
