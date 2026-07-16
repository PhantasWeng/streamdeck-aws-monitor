import type { Ec2Snapshot } from './ec2-metrics';

export const DEBUG_STEP_INTERVAL = 3000; // Debug 模式每 3 秒推進一步

// 模擬一輪 EC2 生命週期的狀態序列：開機 → 執行一段時間 → 關機 → 停止，之後循環
const LIFECYCLE: string[] = ['pending', 'running', 'running', 'running', 'running', 'stopping', 'stopped'];

/**
 * 以 tick 為相位產生可預期波動的百分比（40–90 之間），不依賴亂數以利測試
 */
const wave = (tick: number, offset: number): number => Math.round(65 + 25 * Math.sin((tick + offset) * 0.9));

/**
 * 建立 debug 模式的模擬 EC2 狀態來源：
 * 循環走過 pending → running → stopping → stopped，running 期間回傳
 * 含 CPU/記憶體/磁碟三項指標（展示完整自適應版面），不需要 AWS 憑證，
 * 與正式模式共用同一套 polling / 渲染流程。
 */
export const createDebugFetcher = (): (() => Promise<Ec2Snapshot>) => {
	let tick = -1;
	return async () => {
		tick = (tick + 1) % LIFECYCLE.length;
		const state = LIFECYCLE[tick];
		if (state !== 'running') {
			// 非 running（開機/關機/停止中）沒有指標
			return { state, metrics: {} };
		}
		return {
			state,
			statusCheck: 'ok',
			metrics: {
				cpu: wave(tick, 0),
				mem: wave(tick, 2),
				disk: wave(tick, 4),
			},
		};
	};
};
