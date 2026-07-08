/**
 * 輪詢節奏分類與 footer 判斷（純函式，不依賴 canvas / AWS，便於單元測試）
 */

/**
 * 判斷是否為 loading 狀態（非 Succeeded 非 Failed，即進行中或過場）
 */
export const isLoadingStatus = (status: string): boolean => {
	return status !== 'Succeeded' && status !== 'Failed';
};

export type FrameFooter = 'succeeded' | 'refreshing' | 'idle' | 'terminated';

export type PollMode = 'active' | 'settled' | 'terminated';

export type PollClassification = {
	mode: PollMode;
	pollingStartedAt: number | undefined;
};

/**
 * 依原始 statuses 決定輪詢節奏：
 * - active：有 stage 進行中且未超過 pollingMaxMs（快輪）
 * - terminated：有 stage 進行中但已超過 pollingMaxMs（降速慢輪）
 * - settled：無任何 stage 進行中，全成功或含失敗（慢輪背景偵測）
 *
 * 同時回傳更新後的 pollingStartedAt（落定時清除、進行中時以 now 起算），
 * 讓每個新執行都重新享有完整的快輪視窗，自然達成「偵測新部署後切回快輪」。
 */
export const classifyPoll = (
	statuses: string[],
	pollingStartedAt: number | undefined,
	now: number,
	pollingMaxMs: number,
): PollClassification => {
	const hasInProgress = statuses.some(isLoadingStatus);
	if (!hasInProgress) {
		return { mode: 'settled', pollingStartedAt: undefined };
	}
	const startedAt = pollingStartedAt ?? now;
	const mode: PollMode = now - startedAt >= pollingMaxMs ? 'terminated' : 'active';
	return { mode, pollingStartedAt: startedAt };
};

/**
 * 依顯示用 statuses（含過場覆蓋）與是否 terminated 決定 footer。
 * terminated 優先；其次全成功；再來有進行中（含過場）；最後落定含失敗。
 */
export const deriveFooter = (displayStatuses: string[], isTerminated: boolean): FrameFooter => {
	if (isTerminated) {
		return 'terminated';
	}
	if (displayStatuses.every(status => status === 'Succeeded')) {
		return 'succeeded';
	}
	if (displayStatuses.some(isLoadingStatus)) {
		return 'refreshing';
	}
	return 'idle';
};
