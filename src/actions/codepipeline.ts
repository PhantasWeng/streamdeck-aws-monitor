import streamDeck, { action, type KeyDownEvent, type KeyUpEvent, SingletonAction, type WillAppearEvent, type SendToPluginEvent, type DidReceiveSettingsEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import { detach } from "../async-guard";
import { fetchPipelineStatuses } from "../aws";
import {
	type ButtonState,
	clearLoadingAnimation,
	clearPressTimer,
	clearRefreshTimer,
	disposeButtonState,
	getButtonState,
	syncLoadingAnimation,
} from "../button-state";
import { createDebugFetcher, DEBUG_STEP_INTERVAL } from "../debug";
import { classifyPoll, deriveFooter, isLoadingStatus } from "../polling";
import { renderFrame, renderInitFrame } from "../rendering";
import {
	type CodePipelineMonitorSettings,
	getAwsConsoleUrl,
	getBorderColorHex,
	getBorderWidth,
	getButtonTitle,
	getCloudWatchLogGroupUrl,
	getDebugStageCount,
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
const LONG_PRESS_DURATION = 800;
const FAST_REFRESH_INTERVAL = 60000; // 有 stage 進行中時的快輪間隔
const IDLE_REFRESH_INTERVAL = 300000; // 落定後的慢輪間隔（5 分鐘），持續偵測新部署
const DOUBLE_CLICK_THRESHOLD = 500; // 雙擊閾值 (ms)

// 快輪 / 慢輪兩段間隔（debug 與正式模式數值不同）
type PollIntervals = { fast: number; idle: number };

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
				streamDeck.logger.debug('長按超過 0.8 秒');
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
		detach(renderInitButton(ev), 'renderInitButton');
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
		? createDebugFetcher(getDebugStageCount(settings))
		: () => fetchPipelineStatuses(state, settings);
	// debug 模式快輪與慢輪都用短間隔，方便快速觀察快/慢切換
	const intervals: PollIntervals = debug
		? { fast: DEBUG_STEP_INTERVAL, idle: DEBUG_STEP_INTERVAL }
		: { fast: FAST_REFRESH_INTERVAL, idle: IDLE_REFRESH_INTERVAL };
	detach(pollOnce(ev, settings, intervals), 'pollOnce');
};

const scheduleNextPoll = (state: ButtonState, ev: ButtonEvent, settings: CodePipelineMonitorSettings, intervals: PollIntervals, nextInterval: number): void => {
	// 實例已釋放（onWillDisappear）則不再排下一輪，避免殭屍輪詢
	if (state.disposed) {
		return;
	}
	clearRefreshTimer(state);
	state.refreshTimer = setTimeout(() => {
		state.refreshTimer = undefined;
		detach(pollOnce(ev, settings, intervals), 'scheduled pollOnce');
	}, nextInterval);
};

const pollOnce = async (ev: ButtonEvent, settings: CodePipelineMonitorSettings, intervals: PollIntervals): Promise<void> => {
	const state = getButtonState(ev.action.id);
	const fetcher = state.fetcher;
	if (!fetcher) {
		return;
	}

	const pollingMaxMs = getPollingMaxMinutes(settings) * 60 * 1000;

	try {
		const statuses = await fetcher();
		// fetch 期間可能已 onWillDisappear：此鏈持有的 state 已被釋放/取代，
		// 必須就此停止，否則會啟動永不被清的殭屍動畫計時器造成畫面閃爍
		if (state.disposed) {
			return;
		}
		const hasStatusTransition = registerStageStatusTransitions(state, statuses);

		// 依原始 statuses 決定輪詢節奏；classifyPoll 同時維護 pollingStartedAt，
		// 落定時清除、進行中時起算，讓每個新執行都重享完整快輪視窗
		const { mode, pollingStartedAt } = classifyPoll(statuses, state.pollingStartedAt, Date.now(), pollingMaxMs);
		state.pollingStartedAt = pollingStartedAt;
		const isTerminated = mode === 'terminated';
		const nextInterval = mode === 'active' ? intervals.fast : intervals.idle;

		// 這個 renderer 會被交給動畫計時器與過場計時器反覆呼叫（皆為射後不理），
		// 因此它自己吸收所有繪圖錯誤，絕不 reject：單幀失敗只是這次不更新畫面
		const renderCurrent = async (): Promise<void> => {
			try {
				const displayStatuses = getDisplayStatuses(state, statuses);
				ev.action.setImage(await renderFrame({
					title: getButtonTitle(settings),
					statuses: displayStatuses,
					footer: deriveFooter(displayStatuses, isTerminated),
					rotationDeg: state.loadingAngle ?? 0,
					borderColor: getBorderColorHex(settings),
					borderWidth: getBorderWidth(settings),
				}));
			} catch (error) {
				streamDeck.logger.error('Failed to render CodePipeline frame', error);
			}
		};

		const resyncAnimation = (): void => {
			const displayStatuses = getDisplayStatuses(state, statuses);
			// 只有實際有進行中（含過場覆蓋）且未 terminated 時才轉動畫，
			// 慢輪背景偵測時不空跑 10fps
			const shouldAnimate = !isTerminated && displayStatuses.some(isLoadingStatus);
			syncLoadingAnimation(state, shouldAnimate, renderCurrent);
		};

		// 永不停止：一律排下一輪。有進行中→快輪；落定/terminated→慢輪背景偵測新部署
		scheduleNextPoll(state, ev, settings, intervals, nextInterval);
		if (isTerminated) {
			streamDeck.logger.debug('Active run exceeded max time, slowing to idle polling');
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
		// 在快輪視窗內快速重試，超過後降為慢輪繼續重試（永不完全停止）
		streamDeck.logger.error('Failed to fetch pipeline state', error);
		// fetch 失敗期間也可能已 onWillDisappear，釋放後不再重試排程
		if (state.disposed) {
			return;
		}
		ev.action.showAlert();

		state.pollingStartedAt ??= Date.now();
		const withinFastWindow = Date.now() - state.pollingStartedAt < pollingMaxMs;
		scheduleNextPoll(state, ev, settings, intervals, withinFastWindow ? intervals.fast : intervals.idle);
	}
};
