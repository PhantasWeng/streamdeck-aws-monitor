import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearStageStatusTracking,
	getDisplayStatuses,
	registerStageStatusTransitions,
	scheduleStageStatusTransitionFinalize,
	type StageTransitionState,
	STATUS_CHANGE_LOADING_DURATION,
} from '../src/transitions';

describe('stage status transitions', () => {
	let state: StageTransitionState;

	beforeEach(() => {
		vi.useFakeTimers();
		state = {};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('第一次記錄狀態時不視為變化', () => {
		expect(registerStageStatusTransitions(state, ['InProgress', 'InProgress'])).toBe(false);
	});

	it('狀態改變時回傳 true 並在過場期間顯示 TransitionLoading', () => {
		registerStageStatusTransitions(state, ['InProgress', 'InProgress']);
		const hasTransition = registerStageStatusTransitions(state, ['Succeeded', 'InProgress']);
		expect(hasTransition).toBe(true);

		// 過場期間：變化的 stage 顯示 TransitionLoading
		expect(getDisplayStatuses(state, ['Succeeded', 'InProgress'])).toEqual(['TransitionLoading', 'InProgress']);

		// 過場結束後：恢復真實狀態
		vi.advanceTimersByTime(STATUS_CHANGE_LOADING_DURATION + 1);
		expect(getDisplayStatuses(state, ['Succeeded', 'InProgress'])).toEqual(['Succeeded', 'InProgress']);
	});

	it('狀態未變化時回傳 false 且不影響顯示', () => {
		registerStageStatusTransitions(state, ['Succeeded']);
		expect(registerStageStatusTransitions(state, ['Succeeded'])).toBe(false);
		expect(getDisplayStatuses(state, ['Succeeded'])).toEqual(['Succeeded']);
	});

	it('scheduleStageStatusTransitionFinalize 在過場結束時觸發重繪', () => {
		registerStageStatusTransitions(state, ['InProgress']);
		registerStageStatusTransitions(state, ['Succeeded']);

		const renderer = vi.fn(async () => {});
		const resync = vi.fn();
		scheduleStageStatusTransitionFinalize(state, renderer, resync);
		expect(renderer).not.toHaveBeenCalled();

		vi.advanceTimersByTime(STATUS_CHANGE_LOADING_DURATION + 1);
		expect(renderer).toHaveBeenCalledTimes(1);
		expect(resync).toHaveBeenCalledTimes(1);
		expect(state.stageStatusTransitionTimer).toBeUndefined();
	});

	it('clearStageStatusTracking 清空所有追蹤狀態', () => {
		registerStageStatusTransitions(state, ['InProgress']);
		registerStageStatusTransitions(state, ['Succeeded']);
		scheduleStageStatusTransitionFinalize(state, vi.fn(async () => {}), vi.fn());

		clearStageStatusTracking(state);
		expect(state.previousStageStatuses).toBeUndefined();
		expect(state.stageStatusTransitionUntil).toBeUndefined();
		expect(state.stageStatusTransitionTimer).toBeUndefined();

		// 清空後第一次記錄又不視為變化
		expect(registerStageStatusTransitions(state, ['Failed'])).toBe(false);
	});
});
