import streamDeck, { action, type KeyDownEvent, type KeyUpEvent, SingletonAction, type WillAppearEvent, type SendToPluginEvent, type DidReceiveSettingsEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import { fetchPipelineStatuses } from "../aws";
import {
	clearLoadingAnimation,
	clearPressTimer,
	clearRefreshTimer,
	disposeButtonState,
	getButtonState,
	syncLoadingAnimation,
} from "../button-state";
import { createDebugFetcher, DEBUG_STEP_INTERVAL } from "../debug";
import { type FrameFooter, isLoadingStatus, renderFrame, renderInitFrame } from "../rendering";
import {
	type CodePipelineMonitorSettings,
	getAwsConsoleUrl,
	getButtonTitle,
	getCloudWatchLogGroupUrl,
	getPollingMaxMinutes,
	hasRequiredSettings,
	isDebugMode,
	normalizeSettings,
} from "../settings";
import {
	clearStageStatusTracking,
	clearStageStatusTransitionTimer,
	getDisplayStatuses,
	registerStageStatusTransitions,
	scheduleStageStatusTransitionFinalize,
} from "../transitions";

type ButtonEvent =
	| WillAppearEvent<CodePipelineMonitorSettings>
	| KeyDownEvent<CodePipelineMonitorSettings>
	| DidReceiveSettingsEvent<CodePipelineMonitorSettings>;

// 常數
const LONG_PRESS_DURATION = 1300;
const REFRESH_INTERVAL = 60000;
const DOUBLE_CLICK_THRESHOLD = 500; // 雙擊閾值 (ms)

/**
 * 監控 AWS CodePipeline 部署狀態的按鈕。
 * 短按：重新整理；雙擊：開啟 CloudWatch Logs；長按：開啟 AWS Console。
 */
@action({ UUID: "com.phantas-weng.aws-monitor.codepipeline" })
export class CodePipelineMonitor extends SingletonAction<CodePipelineMonitorSettings> {
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<CodePipelineMonitorSettings>): void | Promise<void> {
		const normalized = normalizeSettings(ev.payload.settings);
		ev.action.setSettings(normalized);
		buildButton({
			...ev,
			payload: {
				...ev.payload,
				settings: normalized
			}
		});
	}
	override onSendToPlugin(_ev: SendToPluginEvent<JsonValue, JsonObject>): void | Promise<void> {
		streamDeck.logger.debug('onSendToPlugin');
	}
	override async onWillAppear(ev: WillAppearEvent<CodePipelineMonitorSettings>): Promise<void> {
		streamDeck.logger.debug('onWillAppear');
		const normalized = normalizeSettings(ev.payload.settings);
		await ev.action.setSettings(normalized);
		buildButton(ev);
	}
	override async onWillDisappear(ev: WillDisappearEvent<CodePipelineMonitorSettings>): Promise<void> {
		streamDeck.logger.debug('onWillDisappear');
		// 一次清理該按鈕實例的所有計時器與資源
		disposeButtonState(ev.action.id);
	}
	override async onKeyDown(ev: KeyDownEvent<CodePipelineMonitorSettings>): Promise<void> {
		streamDeck.logger.debug('onKeyDown');
		const state = getButtonState(ev.action.id);
		const settings = ev.payload.settings;
		// 只有在設定完整時才設置長按計時器
		if (hasRequiredSettings(settings)) {
			if (isDebugMode(settings)) {
				buildButton(ev);
				return;
			}

			clearPressTimer(state);
			state.pressTimer = setTimeout(() => {
				streamDeck.logger.debug('長按超過1.3秒');
				streamDeck.system.openUrl(getAwsConsoleUrl(settings));
				// 清理計時器
				state.pressTimer = undefined;
			}, LONG_PRESS_DURATION);
			buildButton(ev);
		} else {
			ev.action.showAlert();
		}
	}
	override async onKeyUp(ev: KeyUpEvent<CodePipelineMonitorSettings>): Promise<void> {
		streamDeck.logger.debug('onKeyUp');
		if (isDebugMode(ev.payload.settings)) {
			return;
		}

		const state = getButtonState(ev.action.id);
		if (state.pressTimer) {
			clearPressTimer(state);

			// 檢測雙擊
			if (hasRequiredSettings(ev.payload.settings)) {
				const now = Date.now();
				const lastClickTime = state.lastClickTime ?? 0;

				if (now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
					// 雙擊
					state.lastClickTime = undefined;
					if (ev.payload.settings.logGroupName) {
						// 有設定 logGroupName：開啟 CloudWatch Log Group
						streamDeck.logger.debug('雙擊，開啟 CloudWatch');
						streamDeck.system.openUrl(getCloudWatchLogGroupUrl(ev.payload.settings));
					} else {
						// 沒有設定 logGroupName：顯示 alert
						streamDeck.logger.debug('雙擊，但未設定 logGroupName');
						ev.action.showAlert();
					}
				} else {
					// 記錄點擊時間
					state.lastClickTime = now;
				}
			}
		}
	}
}

const buildButton = (ev: ButtonEvent): void => {
	const state = getButtonState(ev.action.id);
	if (hasRequiredSettings(ev.payload.settings)) {
		startMonitoring(ev);
	} else {
		clearRefreshTimer(state);
		clearLoadingAnimation(state);
		clearStageStatusTracking(state);
		state.pollingStartedAt = undefined;
		void renderInitButton(ev);
	}
};

const renderInitButton = async (ev: ButtonEvent): Promise<void> => {
	const title = getButtonTitle(ev.payload.settings);
	ev.action.setImage(await renderInitFrame(title));
};

/**
 * 啟動（或重新啟動）監控：重置 polling 視窗與狀態追蹤，
 * debug 模式注入模擬狀態來源，正式模式查詢 AWS
 */
const startMonitoring = (ev: ButtonEvent): void => {
	const settings = normalizeSettings(ev.payload.settings);
	const state = getButtonState(ev.action.id);

	clearRefreshTimer(state);
	clearStageStatusTracking(state);
	state.pollingStartedAt = undefined;

	const debug = isDebugMode(settings);
	state.fetcher = debug
		? createDebugFetcher()
		: () => fetchPipelineStatuses(state, settings);
	void pollOnce(ev, settings, debug ? DEBUG_STEP_INTERVAL : REFRESH_INTERVAL);
};

const scheduleNextPoll = (ev: ButtonEvent, settings: CodePipelineMonitorSettings, interval: number): void => {
	const state = getButtonState(ev.action.id);
	clearRefreshTimer(state);
	state.refreshTimer = setTimeout(() => {
		state.refreshTimer = undefined;
		void pollOnce(ev, settings, interval);
	}, interval);
};

const pollOnce = async (ev: ButtonEvent, settings: CodePipelineMonitorSettings, interval: number): Promise<void> => {
	const state = getButtonState(ev.action.id);
	const fetcher = state.fetcher;
	if (!fetcher) {
		return;
	}

	const pollingMaxMs = getPollingMaxMinutes(settings) * 60 * 1000;

	try {
		const statuses = await fetcher();
		const hasStatusTransition = registerStageStatusTransitions(state, statuses);
		const isAllSucceeded = statuses.every(status => status === 'Succeeded');
		let isTerminated = false;

		if (isAllSucceeded) {
			state.pollingStartedAt = undefined;
		} else {
			state.pollingStartedAt ??= Date.now();
			if (Date.now() - state.pollingStartedAt >= pollingMaxMs) {
				isTerminated = true;
			}
		}

		const renderCurrent = async (): Promise<void> => {
			const displayStatuses = getDisplayStatuses(state, statuses);
			const footer: FrameFooter = isTerminated
				? 'terminated'
				: displayStatuses.every(status => status === 'Succeeded')
					? 'succeeded'
					: state.refreshTimer
						? 'refreshing'
						: 'idle';
			ev.action.setImage(await renderFrame({
				title: getButtonTitle(settings),
				statuses: displayStatuses,
				footer,
				rotationDeg: state.loadingAngle ?? 0,
			}));
		};

		const resyncAnimation = (): void => {
			const displayStatuses = getDisplayStatuses(state, statuses);
			const hasLoading = displayStatuses.some(isLoadingStatus);
			const shouldAnimate = !isTerminated && (hasLoading || state.refreshTimer !== undefined);
			syncLoadingAnimation(state, shouldAnimate, renderCurrent);
		};

		// MEMO: 如果所有狀態都成功，則停止刷新
		// 當你上傳新的 code 的時候，要手動先點選按鈕一次
		if (isAllSucceeded) {
			clearRefreshTimer(state);
			streamDeck.logger.debug('All Succeeded, stop refresh');
		} else if (isTerminated) {
			clearRefreshTimer(state);
			streamDeck.logger.debug('Polling exceeded max time, terminated');
		} else {
			scheduleNextPoll(ev, settings, interval);
		}

		// 繪製按鈕
		await renderCurrent();
		resyncAnimation();
		if (hasStatusTransition) {
			scheduleStageStatusTransitionFinalize(state, renderCurrent, resyncAnimation);
		} else {
			clearStageStatusTransitionTimer(state);
		}
	} catch (error) {
		// 暫時性錯誤（網路中斷、休眠喚醒等）不停止 polling，
		// 在 polling 視窗內持續重試，超過上限才停止
		streamDeck.logger.error('Failed to fetch pipeline state', error);
		ev.action.showAlert();

		state.pollingStartedAt ??= Date.now();
		if (Date.now() - state.pollingStartedAt < pollingMaxMs) {
			scheduleNextPoll(ev, settings, interval);
		} else {
			clearRefreshTimer(state);
			clearLoadingAnimation(state);
			clearStageStatusTracking(state);
		}
	}
};
