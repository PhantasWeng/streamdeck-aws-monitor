import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from '@elgato/streamdeck';
import { detach } from '../async-guard';
import {
	type ButtonState,
	clearLoadingAnimation,
	clearPressTimer,
	clearRefreshTimer,
	disposeButtonState,
	getButtonState,
	syncLoadingAnimation,
} from '../button-state';
import { fetchEc2Snapshot } from '../ec2-aws';
import { createDebugFetcher, DEBUG_STEP_INTERVAL } from '../ec2-debug';
import { classifyPoll, deriveFooter, isTransitioning } from '../ec2-metrics';
import { renderFrame, renderInitFrame } from '../ec2-rendering';
import {
	type Ec2MonitorSettings,
	getAwsConsoleUrl,
	getBorderColorHex,
	getBorderWidth,
	getButtonTitle,
	getCloudWatchUrl,
	hasRequiredSettings,
	isDebugMode,
	normalizeSettings,
} from '../ec2-settings';

type ButtonEvent =
	| WillAppearEvent<Ec2MonitorSettings>
	| KeyDownEvent<Ec2MonitorSettings>
	| DidReceiveSettingsEvent<Ec2MonitorSettings>;

// 常數
const LONG_PRESS_DURATION = 800;
const FAST_REFRESH_INTERVAL = 60000; // 過渡中或 running 時的快輪間隔
const IDLE_REFRESH_INTERVAL = 300000; // stopped/terminated 的慢輪間隔（5 分鐘），持續偵測重新啟動
const DOUBLE_CLICK_THRESHOLD = 500; // 雙擊閾值 (ms)

// 快輪 / 慢輪兩段間隔（debug 與正式模式數值不同）
type PollIntervals = { fast: number; idle: number };

/**
 * 監控單台 AWS EC2 instance 的狀態與使用率。
 * 短按：重新整理；雙擊：開啟 CloudWatch metrics；長按：開啟 EC2 Console。
 */
@action({ UUID: 'com.phantas-weng.aws-monitor.ec2' })
export class Ec2Monitor extends SingletonAction<Ec2MonitorSettings> {
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Ec2MonitorSettings>): void | Promise<void> {
		const normalized = normalizeSettings(ev.payload.settings);
		ev.action.setSettings(normalized);
		buildButton({
			...ev,
			payload: {
				...ev.payload,
				settings: normalized,
			},
		});
	}
	override async onWillAppear(ev: WillAppearEvent<Ec2MonitorSettings>): Promise<void> {
		streamDeck.logger.debug('EC2 onWillAppear');
		const normalized = normalizeSettings(ev.payload.settings);
		await ev.action.setSettings(normalized);
		buildButton(ev);
	}
	override async onWillDisappear(ev: WillDisappearEvent<Ec2MonitorSettings>): Promise<void> {
		streamDeck.logger.debug('EC2 onWillDisappear');
		// 一次清理該按鈕實例的所有計時器與資源
		disposeButtonState(ev.action.id);
	}
	override async onKeyDown(ev: KeyDownEvent<Ec2MonitorSettings>): Promise<void> {
		streamDeck.logger.debug('EC2 onKeyDown');
		const state = getButtonState(ev.action.id);
		const settings = ev.payload.settings;
		if (hasRequiredSettings(settings)) {
			if (isDebugMode(settings)) {
				buildButton(ev);
				return;
			}

			clearPressTimer(state);
			state.pressTimer = setTimeout(() => {
				streamDeck.logger.debug('EC2 長按超過 0.8 秒');
				streamDeck.system.openUrl(getAwsConsoleUrl(settings));
				state.pressTimer = undefined;
			}, LONG_PRESS_DURATION);
			buildButton(ev);
		} else {
			ev.action.showAlert();
		}
	}
	override async onKeyUp(ev: KeyUpEvent<Ec2MonitorSettings>): Promise<void> {
		streamDeck.logger.debug('EC2 onKeyUp');
		if (isDebugMode(ev.payload.settings)) {
			return;
		}

		const state = getButtonState(ev.action.id);
		if (state.pressTimer) {
			clearPressTimer(state);

			// 檢測雙擊 → 開啟 CloudWatch metrics
			if (hasRequiredSettings(ev.payload.settings)) {
				const now = Date.now();
				const lastClickTime = state.lastClickTime ?? 0;

				if (now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
					state.lastClickTime = undefined;
					streamDeck.logger.debug('EC2 雙擊，開啟 CloudWatch');
					streamDeck.system.openUrl(getCloudWatchUrl(ev.payload.settings));
				} else {
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
		detach(renderInitButton(ev), 'EC2 renderInitButton');
	}
};

const renderInitButton = async (ev: ButtonEvent): Promise<void> => {
	const title = getButtonTitle(ev.payload.settings);
	ev.action.setImage(await renderInitFrame(title));
};

/**
 * 啟動（或重新啟動）監控：debug 模式注入模擬狀態來源，正式模式查詢 AWS
 */
const startMonitoring = (ev: ButtonEvent): void => {
	const settings = normalizeSettings(ev.payload.settings);
	const state = getButtonState(ev.action.id);

	clearRefreshTimer(state);

	const debug = isDebugMode(settings);
	state.ec2Fetcher = debug ? createDebugFetcher() : () => fetchEc2Snapshot(state, settings);
	// debug 模式快輪與慢輪都用短間隔，方便快速觀察狀態切換
	const intervals: PollIntervals = debug
		? { fast: DEBUG_STEP_INTERVAL, idle: DEBUG_STEP_INTERVAL }
		: { fast: FAST_REFRESH_INTERVAL, idle: IDLE_REFRESH_INTERVAL };
	detach(pollOnce(ev, settings, intervals), 'EC2 pollOnce');
};

const scheduleNextPoll = (
	state: ButtonState,
	ev: ButtonEvent,
	settings: Ec2MonitorSettings,
	intervals: PollIntervals,
	nextInterval: number
): void => {
	// 實例已釋放（onWillDisappear）則不再排下一輪，避免殭屍輪詢
	if (state.disposed) {
		return;
	}
	clearRefreshTimer(state);
	state.refreshTimer = setTimeout(() => {
		state.refreshTimer = undefined;
		detach(pollOnce(ev, settings, intervals), 'EC2 scheduled pollOnce');
	}, nextInterval);
};

const pollOnce = async (ev: ButtonEvent, settings: Ec2MonitorSettings, intervals: PollIntervals): Promise<void> => {
	const state = getButtonState(ev.action.id);
	const fetcher = state.ec2Fetcher;
	if (!fetcher) {
		return;
	}

	try {
		const snapshot = await fetcher();
		// fetch 期間可能已 onWillDisappear：此鏈持有的 state 已被釋放/取代，
		// 必須就此停止，否則會啟動永不被清的殭屍動畫計時器造成畫面閃爍
		if (state.disposed) {
			return;
		}

		const mode = classifyPoll(snapshot.state);
		const nextInterval = mode === 'active' ? intervals.fast : intervals.idle;

		// 這個 renderer 會被交給動畫計時器反覆呼叫（射後不理），
		// 因此它自己吸收所有繪圖錯誤，絕不 reject：單幀失敗只是這次不更新畫面
		const renderCurrent = async (): Promise<void> => {
			try {
				ev.action.setImage(
					await renderFrame({
						title: getButtonTitle(settings),
						state: snapshot.state,
						metrics: snapshot.metrics,
						footer: deriveFooter(snapshot.state, snapshot.statusCheck),
						rotationDeg: state.loadingAngle ?? 0,
						borderColor: getBorderColorHex(settings),
						borderWidth: getBorderWidth(settings),
					})
				);
			} catch (error) {
				streamDeck.logger.error('Failed to render EC2 frame', error);
			}
		};

		const resyncAnimation = (): void => {
			// 只有過渡狀態（pending/stopping/...）才跑脈動動畫，穩定狀態不空跑 10fps
			syncLoadingAnimation(state, isTransitioning(snapshot.state), renderCurrent);
		};

		// 永不停止：一律排下一輪。過渡中/running→快輪；stopped/terminated→慢輪偵測重啟
		scheduleNextPoll(state, ev, settings, intervals, nextInterval);

		await renderCurrent();
		resyncAnimation();
	} catch (error) {
		// 暫時性錯誤（網路中斷、休眠喚醒等）不停止 polling，於快輪間隔重試（永不完全停止）
		streamDeck.logger.error('Failed to fetch EC2 snapshot', error);
		if (state.disposed) {
			return;
		}
		ev.action.showAlert();
		scheduleNextPoll(state, ev, settings, intervals, intervals.fast);
	}
};
