import type { StatusFetcher } from './button-state';

export const DEBUG_STAGE_COUNT = 3;
export const DEBUG_STEP_INTERVAL = 3000; // Debug 模式每 3 秒推進一個 stage
// 每次推進時目前 stage 失敗的機率（失敗即結束本輪 demo）
const DEBUG_FAILURE_RATE = 0.15;

/**
 * 建立 debug 模式的模擬狀態來源：
 * 模擬 N-stage pipeline（預設 3）的一輪部署推進，不需要 AWS 憑證，
 * 與正式模式共用同一套 polling / 渲染流程。
 *
 * 每輪流程：全部 InProgress → 從第一個 stage 開始依序 Succeeded、
 * 其餘維持 InProgress → 全成功結束；推進途中依機率失敗，
 * 失敗的 stage 顯示 Failed、其後的 stage 顯示未執行（空字串），
 * 本輪就此結束。結束後下一次 tick 自動開始新一輪（驗證 settled → active 的切回快輪）
 */
export const createDebugFetcher = (stageCount: number = DEBUG_STAGE_COUNT): StatusFetcher => {
	// -1 表示本輪已結束（或尚未開始），下一次 tick 重新開始；0..n-1 為已成功的 stage 數
	let succeededCount = -1;
	return async () => {
		if (succeededCount < 0) {
			succeededCount = 0;
			return Array.from({ length: stageCount }, () => 'InProgress');
		}

		if (Math.random() < DEBUG_FAILURE_RATE) {
			const failedIdx = succeededCount;
			succeededCount = -1;
			return Array.from({ length: stageCount }, (_, idx) => {
				if (idx < failedIdx) return 'Succeeded';
				return idx === failedIdx ? 'Failed' : '';
			});
		}

		succeededCount += 1;
		const statuses = Array.from({ length: stageCount }, (_, idx) =>
			idx < succeededCount ? 'Succeeded' : 'InProgress'
		);
		if (succeededCount >= stageCount) {
			succeededCount = -1;
		}
		return statuses;
	};
};
