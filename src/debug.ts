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
		// 之後每次 50% 機率全部成功（全部成功時 polling 會自動停止）
		const isAllSucceededSample = Math.random() >= 0.5;
		return ['Succeeded', 'Succeeded', isAllSucceededSample ? 'Succeeded' : 'Failed'];
	};
};
