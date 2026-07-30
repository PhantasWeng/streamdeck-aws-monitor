import { describe, expect, it, vi } from 'vitest';

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }));

vi.mock('@elgato/streamdeck', () => ({
	default: { logger: { error: errorMock } },
}));

import { renderInitFrame } from '../src/rendering';
import { renderInitFrame as renderEc2InitFrame } from '../src/ec2-rendering';

/**
 * 這兩支 renderInitFrame 會 await 一個在 module 載入時就啟動的 loadImage promise。
 * 在測試環境下該圖檔路徑（<repo>/imgs/...）本來就不存在——正式環境是
 * <sdPlugin>/bin/../imgs——所以這裡天然重現了「logo 圖檔讀不到」的情境，
 * 正是 Windows 崩潰迴圈的根因：修復前那個 rejection 沒有 handler，
 * Node 20 會直接終止整個外掛程序。
 */
describe('renderInitFrame 對缺失資源的韌性', () => {
	it('CodePipeline：logo 讀不到時仍產出有效畫面而不 reject', async () => {
		const dataUrl = await renderInitFrame('my-pipeline');

		expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
		expect(dataUrl.length).toBeGreaterThan(100);
	});

	it('EC2：logo 讀不到時仍產出有效畫面而不 reject', async () => {
		const dataUrl = await renderEc2InitFrame('my-instance');

		expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
		expect(dataUrl.length).toBeGreaterThan(100);
	});

	it('logo 載入失敗有被記錄下來（不是靜默吞掉）', () => {
		expect(errorMock).toHaveBeenCalled();
	});
});
