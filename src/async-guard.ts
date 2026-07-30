import streamDeck from '@elgato/streamdeck';

/**
 * 接住「射後不理」（fire-and-forget）非同步呼叫的錯誤。
 *
 * Node 20 預設 `--unhandled-rejections=throw`：任何沒有 handler 的 rejected promise
 * 會直接終止整個外掛程序。在 Stream Deck 端的表現是 `Plugin connected` 之後立刻
 * `disconnected without reason`，接著每 10 秒重啟一次的崩潰迴圈。
 * 單顆按鈕的一次繪圖或輪詢失敗不該有這種後果，因此所有不被 await 的呼叫
 * 都必須經過這裡，而不是用 `void`。
 */
export const detach = (promise: Promise<unknown>, context: string): void => {
	promise.catch((error) => {
		streamDeck.logger.error(`Detached operation failed: ${context}`, error);
	});
};
