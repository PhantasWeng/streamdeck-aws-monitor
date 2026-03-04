import streamDeck, { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, SendToPluginEvent, DidReceiveSettingsEvent, WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import { fromEnv } from "@aws-sdk/credential-providers";
import { CodePipelineClient, GetPipelineStateCommand } from "@aws-sdk/client-codepipeline";
import dayjs from 'dayjs';
import { createCanvas, Canvas, CanvasRenderingContext2D, loadImage, Image } from 'canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Settings for {@link CodePipelineMonitor}.
 */
type CodePipelineMonitorSettings = {
	AWS_ACCESS_KEY_ID: string;
	AWS_SECRET_ACCESS_KEY: string;
	region?: string; // 舊版相容欄位（deprecated）
	pipelineRegion?: string;
	logRegion?: string;
	pollingMaxMinutes?: number | string;
	pipelineName: string;
	displayName?: string;
	logGroupName?: string; // 可選：CloudWatch Log Group 名稱
};

type ButtonEvent =
	| WillAppearEvent<CodePipelineMonitorSettings>
	| KeyDownEvent<CodePipelineMonitorSettings>
	| DidReceiveSettingsEvent<CodePipelineMonitorSettings>;

// Iconify line-md icon path definitions（靜態版，移除動畫）
type IconPathDef = { d: string; opacity?: number };

const ICON_CONFIRM_CIRCLE: IconPathDef[] = [
	{ d: 'M3 12c0-4.97 4.03-9 9-9c4.97 0 9 4.03 9 9c0 4.97-4.03 9-9 9c-4.97 0-9-4.03-9-9Z' },
	{ d: 'M8 12l3 3l5-5' },
];

const ICON_CLOSE_CIRCLE: IconPathDef[] = [
	{ d: 'M3 12c0-4.97 4.03-9 9-9c4.97 0 9 4.03 9 9c0 4.97-4.03 9-9 9c-4.97 0-9-4.03-9-9Z' },
	{ d: 'M12 12l4 4M12 12l-4-4M12 12l-4 4M12 12l4-4' },
];

const ICON_LOADING: IconPathDef[] = [
	{ d: 'M12 3c4.97 0 9 4.03 9 9' },
	{ d: 'M12 3c4.97 0 9 4.03 9 9c0 4.97-4.03 9-9 9c-4.97 0-9-4.03-9-9c0-4.97 4.03-9 9-9Z', opacity: 0.3 },
];

// Footer 用圖示（無圓圈）
const ICON_CHECK: IconPathDef[] = [
	{ d: 'M5 11l6 6l10-10' },
];

const ICON_ARROW_DOWN: IconPathDef[] = [
	{ d: 'M12 5v12' },
	{ d: 'M7 13l5 5l5-5' },
];

// Footer 終止用圖示（line-md--menu-to-close-transition 靜態終態）
const ICON_MENU_TO_CLOSE_TRANSITION: IconPathDef[] = [
	{ d: 'M6 6l12 12' },
	{ d: 'M18 6l-12 12' },
];

// 常數
const CANVAS_SIZE = 144;
const LONG_PRESS_DURATION = 1300;
const REFRESH_INTERVAL = 60000;
const DOUBLE_CLICK_THRESHOLD = 500; // 雙擊閾值 (ms)
const DEBUG_STAGE_COUNT = 3;
const DEBUG_STEP_INTERVAL = 3000; // Debug 模式每 3 秒推進一個 stage
const DEBUG_PIPELINE_NAME = 'debug';
const TITLE_Y = 12;
const STATUS_ICON_Y = 50;
const LOADING_ANIMATION_FPS = 10;
const LOADING_ANIMATION_INTERVAL = Math.round(1000 / LOADING_ANIMATION_FPS);
const LOADING_ROTATION_STEP = 24;
const STATUS_CHANGE_LOADING_DURATION = 300;
const DEFAULT_POLLING_MAX_MINUTES = 30;

// 必填欄位
const REQUIRED_FIELDS: (keyof CodePipelineMonitorSettings)[] = [
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'pipelineName'
];
const DEBUG_REQUIRED_FIELDS: (keyof CodePipelineMonitorSettings)[] = [
	'pipelineName'
];

// 使用 Map 來追蹤每個按鈕實例的計時器，避免全域變數被共用
const pressTimers = new Map<string, NodeJS.Timeout>();
const refreshTimers = new Map<string, NodeJS.Timeout>();
const lastClickTimes = new Map<string, number>(); // 追蹤上次點擊時間，用於雙擊檢測
const loadingAnimationTimers = new Map<string, NodeJS.Timeout>();
const loadingAngles = new Map<string, number>();
const loadingRenderers = new Map<string, () => Promise<void>>();
const iconImageCache = new Map<string, Promise<Image>>();
const pollingStartedAtMap = new Map<string, number>();
const previousStageStatusesMap = new Map<string, string[]>();
const stageStatusTransitionUntilMap = new Map<string, Map<number, number>>();
const stageStatusTransitionTimers = new Map<string, NodeJS.Timeout>();
const actionKeyIconPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../imgs/actions/codepipeline/key@2x.png'
);
const actionKeyIconPromise = loadImage(actionKeyIconPath);

/**
 * 檢查必填設定是否完整（不包含 logGroupName）
 */
const isDebugMode = (settings: CodePipelineMonitorSettings): boolean => {
	return settings.pipelineName?.trim().toLowerCase() === DEBUG_PIPELINE_NAME;
};

const getPipelineRegion = (settings: CodePipelineMonitorSettings): string =>
	settings.pipelineRegion?.trim() || settings.region?.trim() || '';

const getLogRegion = (settings: CodePipelineMonitorSettings): string =>
	settings.logRegion?.trim() || getPipelineRegion(settings);

const getPollingMaxMinutes = (settings: CodePipelineMonitorSettings): number => {
	const parsed = Number(settings.pollingMaxMinutes);
	if (Number.isFinite(parsed) && parsed > 0) {
		return parsed;
	}
	return DEFAULT_POLLING_MAX_MINUTES;
};

const normalizeSettings = (settings: CodePipelineMonitorSettings): CodePipelineMonitorSettings => ({
	...settings,
	pipelineRegion: getPipelineRegion(settings),
	logRegion: getLogRegion(settings),
	pollingMaxMinutes: getPollingMaxMinutes(settings),
});

const getButtonTitle = (settings: CodePipelineMonitorSettings): string =>
	settings.displayName?.trim() || settings.pipelineName?.trim() || 'AWS CodePipeline';

const hasRequiredSettings = (settings: CodePipelineMonitorSettings): boolean => {
	const requiredFields = isDebugMode(settings) ? DEBUG_REQUIRED_FIELDS : REQUIRED_FIELDS;
	if (!requiredFields.every(field => settings[field] && settings[field] !== '')) {
		return false;
	}
	return isDebugMode(settings) || getPipelineRegion(settings) !== '';
};

/**
 * 建立 Canvas 並初始化基本設定
 */
const createButtonCanvas = (): { canvas: Canvas; ctx: CanvasRenderingContext2D } => {
	const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
	const ctx = canvas.getContext('2d');
	ctx.textBaseline = 'top';
	return { canvas, ctx };
};

/**
 * 繪製標題文字
 */
const drawTitle = (ctx: CanvasRenderingContext2D, title: string): void => {
	ctx.fillStyle = 'white';
	ctx.font = '20px sans-serif bold';
	ctx.textAlign = 'center';
	ctx.fillText(title, 72, TITLE_Y, 134);
};

/**
 * 清理刷新計時器
 */
const clearRefreshTimer = (actionId: string): void => {
	const refreshTimer = refreshTimers.get(actionId);
	if (refreshTimer) {
		clearInterval(refreshTimer);
		refreshTimers.delete(actionId);
	}
};

/**
 * 清理 loading 動畫計時器
 */
const clearLoadingAnimation = (actionId: string): void => {
	const loadingTimer = loadingAnimationTimers.get(actionId);
	if (loadingTimer) {
		clearInterval(loadingTimer);
		loadingAnimationTimers.delete(actionId);
	}
	loadingAngles.delete(actionId);
	loadingRenderers.delete(actionId);
};

const clearPollingState = (actionId: string): void => {
	pollingStartedAtMap.delete(actionId);
};

const clearStageStatusTransitionTimer = (actionId: string): void => {
	const transitionTimer = stageStatusTransitionTimers.get(actionId);
	if (transitionTimer) {
		clearTimeout(transitionTimer);
		stageStatusTransitionTimers.delete(actionId);
	}
};

const clearStageStatusTracking = (actionId: string): void => {
	clearStageStatusTransitionTimer(actionId);
	previousStageStatusesMap.delete(actionId);
	stageStatusTransitionUntilMap.delete(actionId);
};

/**
 * 判斷是否為 loading 狀態
 */
const isLoadingStatus = (status: string): boolean => {
	return status !== 'Succeeded' && status !== 'Failed';
};

const registerStageStatusTransitions = (actionId: string, statuses: string[]): boolean => {
	const previousStatuses = previousStageStatusesMap.get(actionId);
	previousStageStatusesMap.set(actionId, [...statuses]);
	if (!previousStatuses) {
		return false;
	}

	const now = Date.now();
	let hasTransition = false;
	const existingTransitions = stageStatusTransitionUntilMap.get(actionId) ?? new Map<number, number>();
	for (let idx = 0; idx < statuses.length; idx += 1) {
		const currentStatus = statuses[idx];
		const previousStatus = previousStatuses[idx];
		if (previousStatus !== undefined && currentStatus !== previousStatus) {
			existingTransitions.set(idx, now + STATUS_CHANGE_LOADING_DURATION);
			hasTransition = true;
		}
	}

	if (existingTransitions.size > 0) {
		stageStatusTransitionUntilMap.set(actionId, existingTransitions);
	}

	return hasTransition;
};

const getDisplayStatuses = (actionId: string, statuses: string[]): string[] => {
	const now = Date.now();
	const transitions = stageStatusTransitionUntilMap.get(actionId);
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
		stageStatusTransitionUntilMap.delete(actionId);
	}

	return displayStatuses;
};

const scheduleStageStatusTransitionFinalize = (
	actionId: string,
	renderer: () => Promise<void>,
	resyncAnimation: () => void
): void => {
	clearStageStatusTransitionTimer(actionId);

	const now = Date.now();
	const transitions = stageStatusTransitionUntilMap.get(actionId);
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
	const transitionTimer = setTimeout(() => {
		stageStatusTransitionTimers.delete(actionId);
		void renderer();
		resyncAnimation();
	}, timeoutMs);
	stageStatusTransitionTimers.set(actionId, transitionTimer);
};

/**
 * 同步 loading 動畫狀態
 */
const syncLoadingAnimation = (actionId: string, shouldAnimate: boolean, renderer: () => Promise<void>): void => {
	loadingRenderers.set(actionId, renderer);

	if (!shouldAnimate) {
		clearLoadingAnimation(actionId);
		return;
	}

	if (loadingAnimationTimers.has(actionId)) {
		return;
	}

	loadingAngles.set(actionId, 0);
	const loadingTimer = setInterval(() => {
		const nextRotation = ((loadingAngles.get(actionId) ?? 0) + LOADING_ROTATION_STEP) % 360;
		loadingAngles.set(actionId, nextRotation);
		const currentRenderer = loadingRenderers.get(actionId);
		if (currentRenderer) {
			void currentRenderer();
		}
	}, LOADING_ANIMATION_INTERVAL);
	loadingAnimationTimers.set(actionId, loadingTimer);
};

/**
 * 取得 AWS Console URL
 */
const getAwsConsoleUrl = (settings: CodePipelineMonitorSettings): string => {
	const pipelineRegion = getPipelineRegion(settings);
	return `https://${pipelineRegion}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${settings.pipelineName}/view?region=${pipelineRegion}`;
};

/**
 * 取得 CloudWatch Log Group URL
 */
const getCloudWatchLogGroupUrl = (settings: CodePipelineMonitorSettings): string => {
	const encodedLogGroup = encodeURIComponent(settings.logGroupName || '');
	const logRegion = getLogRegion(settings);
	return `https://${logRegion}.console.aws.amazon.com/cloudwatch/home?region=${logRegion}#logsV2:log-groups/log-group/${encodedLogGroup}`;
};

/**
 * An example action class that displays a count that increments by one each time the button is pressed.
*/
@action({ UUID: "com.phantas-weng.aws-monitor.codepipeline" })
export class CodePipelineMonitor extends SingletonAction<CodePipelineMonitorSettings> {
	/**
	 * The {@link SingletonAction.onWillAppear} event is useful for setting the visual representation of an action when it becomes visible. This could be due to the Stream Deck first
	 * starting up, or the user navigating between pages / folders etc.. There is also an inverse of this event in the form of {@link streamDeck.client.onWillDisappear}. In this example,
	 * we're setting the title to the "count" that is incremented in {@link CodePipelineMonitor.onKeyDown}.
	 */
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
		// 清理該按鈕實例的計時器
		clearRefreshTimer(ev.action.id);
		clearLoadingAnimation(ev.action.id);
		clearPollingState(ev.action.id);
		clearStageStatusTracking(ev.action.id);
		const pressTimer = pressTimers.get(ev.action.id);
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimers.delete(ev.action.id);
		}
		lastClickTimes.delete(ev.action.id);
	}
	/**
	 * Listens for the {@link SingletonAction.onKeyDown} event which is emitted by Stream Deck when an action is pressed. Stream Deck provides various events for tracking interaction
	 * with devices including key down/up, dial rotations, and device connectivity, etc. When triggered, {@link ev} object contains information about the event including any payloads
	 * and action information where applicable. In this example, our action will display a counter that increments by one each press. We track the current count on the action's persisted
	 * settings using `setSettings` and `getSettings`.
	 */
	override async onKeyDown(ev: KeyDownEvent<CodePipelineMonitorSettings>): Promise<void> {
		streamDeck.logger.debug('onKeyDown');
		const actionId = ev.action.id;
		const settings = ev.payload.settings;
		// 只有在設定完整時才設置長按計時器
		if (hasRequiredSettings(settings)) {
			if (isDebugMode(settings)) {
				runDebugDemo(ev);
				return;
			}

			const pressTimer = setTimeout(() => {
				streamDeck.logger.debug('長按超過1.3秒');
				streamDeck.system.openUrl(getAwsConsoleUrl(settings));
				// 清理計時器
				pressTimers.delete(actionId);
			}, LONG_PRESS_DURATION);
			pressTimers.set(actionId, pressTimer);
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

		const actionId = ev.action.id;
		const pressTimer = pressTimers.get(actionId);
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimers.delete(actionId);

			// 檢測雙擊
			if (hasRequiredSettings(ev.payload.settings)) {
				const now = Date.now();
				const lastClickTime = lastClickTimes.get(actionId) || 0;

				if (now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
					// 雙擊
					lastClickTimes.delete(actionId);
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
					lastClickTimes.set(actionId, now);
				}
			}
		}
	}
}

const buildButton = (ev: ButtonEvent): void => {
	if (hasRequiredSettings(ev.payload.settings)) {
		if (isDebugMode(ev.payload.settings)) {
			runDebugDemo(ev);
		} else {
			getPipelineState(ev, true);
		}
	} else {
		clearRefreshTimer(ev.action.id);
		clearLoadingAnimation(ev.action.id);
		clearPollingState(ev.action.id);
		clearStageStatusTracking(ev.action.id);
		void renderInitButton(ev);
	}
};

const renderInitButton = async (ev: ButtonEvent): Promise<void> => {
	const { canvas, ctx } = createButtonCanvas();
	const title = getButtonTitle(ev.payload.settings);
	drawTitle(ctx, title);

	try {
		const iconImg = await actionKeyIconPromise;
		ctx.drawImage(iconImg, 36, 37, 72, 72);
	} catch (error) {
		streamDeck.logger.error('Failed to load action key icon', error);
	}

	// High-contrast status text (no badge background)
	ctx.fillStyle = '#f59e0b';
	ctx.font = '15px sans-serif bold';
	ctx.textAlign = 'center';
	ctx.fillText('NOT CONFIGURED', 72, 110, 132);

	ev.action.setImage(canvas.toDataURL());
};

/**
 * 產生 Iconify line-md 圖示的 SVG Buffer
 */
const createIconSvg = (paths: IconPathDef[], color: string): Buffer => {
	const pathElements = paths.map(({ d, opacity }) =>
		`<path d="${d}"${opacity !== undefined ? ` opacity="${opacity}"` : ''}/>`
	).join('');
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
		`<g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">` +
		`${pathElements}</g></svg>`
	);
};

/**
 * 取得快取圖示
 */
const getIconImage = async (paths: IconPathDef[], color: string): Promise<Image> => {
	const key = `${color}|${paths.map(({ d, opacity }) => `${d}:${opacity ?? ''}`).join('|')}`;
	const cached = iconImageCache.get(key);
	if (cached) {
		return cached;
	}

	const imagePromise = loadImage(createIconSvg(paths, color));
	iconImageCache.set(key, imagePromise);
	return imagePromise;
};

/**
 * 繪製 Iconify line-md 圖示到 Canvas
 */
const drawIcon = async (ctx: CanvasRenderingContext2D, paths: IconPathDef[], color: string, x: number, y: number, size: number, rotationDeg = 0): Promise<void> => {
	const img = await getIconImage(paths, color);
	if (rotationDeg === 0) {
		ctx.drawImage(img, x, y, size, size);
		return;
	}

	const centerX = x + size / 2;
	const centerY = y + size / 2;
	ctx.save();
	ctx.translate(centerX, centerY);
	ctx.rotate((rotationDeg * Math.PI) / 180);
	ctx.drawImage(img, -size / 2, -size / 2, size, size);
	ctx.restore();
};

/**
 * 繪製呼吸效果圖示（向下位移 + 輕微透明度變化）
 */
const drawBreathingIcon = async (
	ctx: CanvasRenderingContext2D,
	paths: IconPathDef[],
	color: string,
	x: number,
	y: number,
	size: number,
	phaseDeg: number
): Promise<void> => {
	const img = await getIconImage(paths, color);
	const wave = Math.sin((phaseDeg * Math.PI) / 180);
	const downwardWave = (wave + 1) / 2;
	const yOffset = 4 * downwardWave;
	const alpha = 0.78 + 0.22 * (1 - downwardWave);
	const centerX = x + size / 2;
	const centerY = y + size / 2;

	ctx.save();
	ctx.translate(centerX, centerY + yOffset);
	ctx.globalAlpha = alpha;
	ctx.drawImage(img, -size / 2, -size / 2, size, size);
	ctx.restore();
};

/**
 * 取得 pipeline 狀態對應的圖示
 */
const getStatusIcon = (status: string): { icon: IconPathDef[]; color: string } => {
	if (status === 'Succeeded') return { icon: ICON_CONFIRM_CIRCLE, color: '#4ade80' };
	if (status === 'Failed') return { icon: ICON_CLOSE_CIRCLE, color: '#f87171' };
	return { icon: ICON_LOADING, color: '#60a5fa' };
};

/**
 * 繪製狀態圖示
 */
const drawStatusSymbols = async (ctx: CanvasRenderingContext2D, actionId: string, statuses: string[]): Promise<void> => {
	const iconSize = 40;
	const gap = 4;
	const totalWidth = statuses.length * iconSize + (statuses.length - 1) * gap;
	let x = (CANVAS_SIZE - totalWidth) / 2;
	const y = STATUS_ICON_Y;

	for (const status of statuses) {
		const { icon, color } = getStatusIcon(status);
		const rotationDeg = isLoadingStatus(status) ? (loadingAngles.get(actionId) ?? 0) : 0;
		await drawIcon(ctx, icon, color, x, y, iconSize, rotationDeg);
		x += iconSize + gap;
	}
};

/**
 * 繪製底部時間和狀態指示器
 */
const drawFooter = async (ctx: CanvasRenderingContext2D, actionId: string, isAllSucceeded: boolean, isRefreshing: boolean): Promise<void> => {
	ctx.fillStyle = 'white';
	ctx.font = '22px sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText(dayjs().format('HH:mm'), 52, 110);
	if (isAllSucceeded) {
		await drawIcon(ctx, ICON_CHECK, '#4ade80', 96, 108, 22);
	} else {
		const phaseDeg = loadingAngles.get(actionId) ?? 0;
		if (isRefreshing) {
			await drawBreathingIcon(ctx, ICON_ARROW_DOWN, 'white', 96, 108, 22, phaseDeg);
		} else {
			await drawIcon(ctx, ICON_ARROW_DOWN, 'white', 96, 108, 22);
		}
	}
};

const drawTerminatedFooter = async (ctx: CanvasRenderingContext2D): Promise<void> => {
	ctx.fillStyle = 'white';
	ctx.font = '22px sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText(dayjs().format('HH:mm'), 52, 110);
	await drawIcon(ctx, ICON_MENU_TO_CLOSE_TRANSITION, '#f87171', 92, 106, 24);
};

const renderDebugFrame = async (ev: ButtonEvent, statuses: string[], isTerminated = false): Promise<void> => {
	const { canvas, ctx } = createButtonCanvas();
	drawTitle(ctx, getButtonTitle(ev.payload.settings));
	await drawStatusSymbols(ctx, ev.action.id, statuses);
	if (isTerminated) {
		await drawTerminatedFooter(ctx);
	} else {
		await drawFooter(
			ctx,
			ev.action.id,
			statuses.every((status) => status === 'Succeeded'),
			refreshTimers.has(ev.action.id)
		);
	}
	ev.action.setImage(canvas.toDataURL());
};

const runDebugDemo = (ev: ButtonEvent): void => {
	const actionId = ev.action.id;
	const settings = normalizeSettings(ev.payload.settings);
	const pollingMaxMs = getPollingMaxMinutes(settings) * 60 * 1000;
	clearRefreshTimer(actionId);
	clearPollingState(actionId);
	clearStageStatusTracking(actionId);

	const statuses = Array.from({ length: DEBUG_STAGE_COUNT }, () => 'InProgress');
	let isTerminated = false;
	let debugTick = 0;
	void registerStageStatusTransitions(actionId, statuses);
	const renderDebug = () => {
		const displayStatuses = getDisplayStatuses(actionId, statuses);
		return renderDebugFrame(ev, displayStatuses, isTerminated);
	};
	const resyncAnimation = (): void => {
		const displayStatuses = getDisplayStatuses(actionId, statuses);
		const hasLoading = displayStatuses.some(isLoadingStatus);
		const shouldAnimate = !isTerminated && (hasLoading || refreshTimers.has(actionId));
		syncLoadingAnimation(actionId, shouldAnimate, renderDebug);
	};
	const startedAt = Date.now();
	const debugTimer = setInterval(() => {
		if (Date.now() - startedAt >= pollingMaxMs) {
			isTerminated = true;
			clearRefreshTimer(actionId);
			clearStageStatusTransitionTimer(actionId);
			const renderTerminated = () => renderDebugFrame(ev, getDisplayStatuses(actionId, statuses), true);
			void renderTerminated();
			syncLoadingAnimation(actionId, false, renderTerminated);
			return;
		}

		if (debugTick === 0) {
			statuses[0] = 'Succeeded';
			statuses[1] = 'Failed';
			statuses[2] = 'Failed';
		} else if (debugTick === 1) {
			statuses[0] = 'Succeeded';
			statuses[1] = 'Succeeded';
			statuses[2] = 'Failed';
		} else {
			const isAllSucceededSample = Math.random() >= 0.5;
			statuses[0] = 'Succeeded';
			statuses[1] = 'Succeeded';
			statuses[2] = isAllSucceededSample ? 'Succeeded' : 'Failed';
		}
		debugTick += 1;
		const hasStatusTransition = registerStageStatusTransitions(actionId, statuses);

		const isAllSucceeded = statuses.every((status) => status === 'Succeeded');
		void renderDebug();
		resyncAnimation();
		if (hasStatusTransition) {
			scheduleStageStatusTransitionFinalize(actionId, renderDebug, resyncAnimation);
		} else {
			clearStageStatusTransitionTimer(actionId);
		}

		if (isAllSucceeded) {
			clearRefreshTimer(actionId);
		}
	}, DEBUG_STEP_INTERVAL);

	refreshTimers.set(actionId, debugTimer);
	void renderDebug();
	resyncAnimation();
};

const getPipelineState = async (ev: ButtonEvent, resetPollingWindow = false): Promise<void> => {
	const settings = normalizeSettings(ev.payload.settings);
	process.env.AWS_ACCESS_KEY_ID = settings.AWS_ACCESS_KEY_ID;
	process.env.AWS_SECRET_ACCESS_KEY = settings.AWS_SECRET_ACCESS_KEY;
	const actionId = ev.action.id;

	if (resetPollingWindow) {
		clearPollingState(actionId);
		clearStageStatusTracking(actionId);
	}

	const codePipelineClient = new CodePipelineClient({
		region: getPipelineRegion(settings),
		credentials: fromEnv()
	});

	try {
		const command = new GetPipelineStateCommand({ name: settings.pipelineName });
		const response = await codePipelineClient.send(command);
		streamDeck.logger.info('AWS CodePipeline Response', response);

		const allStatuses = response.stageStates?.map(stage => stage.latestExecution?.status ?? '') ?? [];
		const hasStatusTransition = registerStageStatusTransitions(actionId, allStatuses);
		const isAllSucceeded = allStatuses.every(status => status === 'Succeeded');
		const pollingMaxMs = getPollingMaxMinutes(settings) * 60 * 1000;
		let isTerminated = false;

		if (isAllSucceeded) {
			clearPollingState(actionId);
		} else {
			if (!pollingStartedAtMap.has(actionId)) {
				pollingStartedAtMap.set(actionId, Date.now());
			}
			const startedAt = pollingStartedAtMap.get(actionId) ?? Date.now();
			if (Date.now() - startedAt >= pollingMaxMs) {
				isTerminated = true;
			}
		}

		const renderCurrent = async () => {
			const { canvas, ctx } = createButtonCanvas();
			drawTitle(ctx, getButtonTitle(settings));
			const displayStatuses = getDisplayStatuses(actionId, allStatuses);
			await drawStatusSymbols(ctx, actionId, displayStatuses);
			if (isTerminated) {
				await drawTerminatedFooter(ctx);
			} else {
				await drawFooter(ctx, actionId, displayStatuses.every(status => status === 'Succeeded'), refreshTimers.has(actionId));
			}
			ev.action.setImage(canvas.toDataURL());
		};

		const resyncAnimation = (): void => {
			const displayStatuses = getDisplayStatuses(actionId, allStatuses);
			const hasLoading = displayStatuses.some(isLoadingStatus);
			const shouldAnimate = !isTerminated && (hasLoading || refreshTimers.has(actionId));
			syncLoadingAnimation(actionId, shouldAnimate, renderCurrent);
		};

		// MEMO: 如果所有狀態都成功，則停止刷新
		// 當你上傳新的 code 的時候，要手動先點選按鈕一次
		if (isAllSucceeded) {
			clearRefreshTimer(actionId);
			streamDeck.logger.debug('All Succeeded, stop refresh');
		} else if (isTerminated) {
			clearRefreshTimer(actionId);
			streamDeck.logger.debug('Polling exceeded max time, terminated');
		} else {
			// 清理舊的計時器
			clearRefreshTimer(actionId);
			// 設定新的計時器
			const newRefreshTimer = setInterval(() => {
				getPipelineState(ev);
			}, REFRESH_INTERVAL);
			refreshTimers.set(actionId, newRefreshTimer);
		}

		// 繪製按鈕
		await renderCurrent();
		resyncAnimation();
		if (hasStatusTransition) {
			scheduleStageStatusTransitionFinalize(actionId, renderCurrent, resyncAnimation);
		} else {
			clearStageStatusTransitionTimer(actionId);
		}
	} catch (error) {
		streamDeck.logger.error(error);
		clearRefreshTimer(ev.action.id);
		clearLoadingAnimation(ev.action.id);
		clearStageStatusTracking(ev.action.id);
		ev.action.showAlert();
	}
};
