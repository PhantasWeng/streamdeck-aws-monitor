/**
 * Stage 狀態變化追蹤：狀態改變時短暫顯示 TransitionLoading 過場效果
 */
export const STATUS_CHANGE_LOADING_DURATION = 300;

export type StageTransitionState = {
	previousStageStatuses?: string[];
	stageStatusTransitionUntil?: Map<number, number>;
	stageStatusTransitionTimer?: NodeJS.Timeout;
};

/**
 * 記錄本次與上次狀態的差異，回傳是否有 stage 狀態發生變化
 */
export const registerStageStatusTransitions = (state: StageTransitionState, statuses: string[]): boolean => {
	const previousStatuses = state.previousStageStatuses;
	state.previousStageStatuses = [...statuses];
	if (!previousStatuses) {
		return false;
	}

	const now = Date.now();
	let hasTransition = false;
	const existingTransitions = state.stageStatusTransitionUntil ?? new Map<number, number>();
	for (let idx = 0; idx < statuses.length; idx += 1) {
		const currentStatus = statuses[idx];
		const previousStatus = previousStatuses[idx];
		if (previousStatus !== undefined && currentStatus !== previousStatus) {
			existingTransitions.set(idx, now + STATUS_CHANGE_LOADING_DURATION);
			hasTransition = true;
		}
	}

	if (existingTransitions.size > 0) {
		state.stageStatusTransitionUntil = existingTransitions;
	}

	return hasTransition;
};

/**
 * 取得顯示用狀態：仍在過場期間的 stage 會被替換為 TransitionLoading
 */
export const getDisplayStatuses = (state: StageTransitionState, statuses: string[]): string[] => {
	const now = Date.now();
	const transitions = state.stageStatusTransitionUntil;
	if (!transitions || transitions.size === 0) {
		return statuses;
	}

	const displayStatuses = statuses.map((status, idx) => {
		const until = transitions.get(idx) ?? 0;
		if (until > now) {
			return 'TransitionLoading';
		}
		if (until > 0) {
			transitions.delete(idx);
		}
		return status;
	});

	if (transitions.size === 0) {
		state.stageStatusTransitionUntil = undefined;
	}

	return displayStatuses;
};

export const clearStageStatusTransitionTimer = (state: StageTransitionState): void => {
	if (state.stageStatusTransitionTimer) {
		clearTimeout(state.stageStatusTransitionTimer);
		state.stageStatusTransitionTimer = undefined;
	}
};

export const clearStageStatusTracking = (state: StageTransitionState): void => {
	clearStageStatusTransitionTimer(state);
	state.previousStageStatuses = undefined;
	state.stageStatusTransitionUntil = undefined;
};

/**
 * 排程過場效果結束後的重繪
 */
export const scheduleStageStatusTransitionFinalize = (
	state: StageTransitionState,
	renderer: () => Promise<void>,
	resyncAnimation: () => void
): void => {
	clearStageStatusTransitionTimer(state);

	const now = Date.now();
	const transitions = state.stageStatusTransitionUntil;
	if (!transitions || transitions.size === 0) {
		return;
	}

	let nearestDue = Number.POSITIVE_INFINITY;
	for (const until of transitions.values()) {
		if (until > now && until < nearestDue) {
			nearestDue = until;
		}
	}

	if (!Number.isFinite(nearestDue)) {
		return;
	}

	const timeoutMs = Math.max(0, nearestDue - now);
	state.stageStatusTransitionTimer = setTimeout(() => {
		state.stageStatusTransitionTimer = undefined;
		void renderer();
		resyncAnimation();
	}, timeoutMs);
};
