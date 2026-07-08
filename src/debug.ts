import type { StatusFetcher } from './button-state';

export const DEBUG_STAGE_COUNT = 3;
export const DEBUG_STEP_INTERVAL = 3000; // Debug 模式每 3 秒推進一個 stage

/**
 * 建立 debug 模式的模擬狀態來源：
 * 模擬 3-stage pipeline 的進度推進，不需要 AWS 憑證，
 * 與正式模式共用同一套 polling / 渲染流程
 */
export const createDebugFetcher = (): StatusFetcher => {
	let tick = -1;
	return async () => {
		tick += 1;
		if (tick === 0) {
			return Array.from({ length: DEBUG_STAGE_COUNT }, () => 'InProgress');
		}
		if (tick === 1) {
			return ['Succeeded', 'Failed', 'Failed'];
		}
		if (tick === 2) {
			return ['Succeeded', 'Succeeded', 'Failed'];
		}
		// 之後每次隨機：偶爾重回全部 InProgress（模擬偵測到新部署，
		// 驗證 settled → active 的自動切回快輪），否則落定為全成功或含失敗
		const sample = Math.random();
		if (sample < 0.33) {
			return Array.from({ length: DEBUG_STAGE_COUNT }, () => 'InProgress');
		}
		return ['Succeeded', 'Succeeded', sample >= 0.66 ? 'Succeeded' : 'Failed'];
	};
};
