import streamDeck, { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, SendToPluginEvent, JsonValue, JsonObject, DidReceiveSettingsEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { fromEnv } from "@aws-sdk/credential-providers";
import { CodePipelineClient, GetPipelineStateCommand } from "@aws-sdk/client-codepipeline";
import dayjs from 'dayjs';
import { createCanvas, Canvas, CanvasRenderingContext2D, loadImage } from 'canvas';

/**
 * Settings for {@link CodePipelineMonitor}.
 */
type CodePipelineMonitorSettings = {
	AWS_ACCESS_KEY_ID: string;
	AWS_SECRET_ACCESS_KEY: string;
	region: string;
	pipelineName: string;
	displayName: string;
	logGroupName?: string; // 可選：CloudWatch Log Group 名稱
};

type ButtonEvent = WillAppearEvent<CodePipelineMonitorSettings> | KeyDownEvent<CodePipelineMonitorSettings>;

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

const ICON_REFRESH: IconPathDef[] = [
	{ d: 'M12 6c3.31 0 6 2.69 6 6c0 3.31-2.69 6-6 6c-3.31 0-6-2.69-6-6v-2.5' },
	{ d: 'M6 9l-3 3M6 9l3 3' },
];

// 常數
const CANVAS_SIZE = 144;
const LONG_PRESS_DURATION = 1300;
const REFRESH_INTERVAL = 60000;
const DOUBLE_CLICK_THRESHOLD = 500; // 雙擊閾值 (ms)

// 必填欄位
const REQUIRED_FIELDS: (keyof CodePipelineMonitorSettings)[] = [
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'region',
	'pipelineName',
	'displayName'
];

// 使用 Map 來追蹤每個按鈕實例的計時器，避免全域變數被共用
const pressTimers = new Map<string, NodeJS.Timeout>();
const refreshTimers = new Map<string, NodeJS.Timeout>();
const lastClickTimes = new Map<string, number>(); // 追蹤上次點擊時間，用於雙擊檢測

/**
 * 檢查必填設定是否完整（不包含 logGroupName）
 */
const hasRequiredSettings = (settings: CodePipelineMonitorSettings): boolean => {
	return REQUIRED_FIELDS.every(field => settings[field] && settings[field] !== '');
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
	ctx.fillText(title, 72, 12, 134);
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
 * 取得 AWS Console URL
 */
const getAwsConsoleUrl = (settings: CodePipelineMonitorSettings): string => {
	return `https://${settings.region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${settings.pipelineName}/view?region=${settings.region}`;
};

/**
 * 取得 CloudWatch Log Group URL
 */
const getCloudWatchLogGroupUrl = (settings: CodePipelineMonitorSettings): string => {
	const encodedLogGroup = encodeURIComponent(settings.logGroupName || '');
	return `https://${settings.region}.console.aws.amazon.com/cloudwatch/home?region=${settings.region}#logsV2:log-groups/log-group/${encodedLogGroup}`;
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
		ev.action.setSettings(ev.payload.settings);
	}
	override onSendToPlugin(_ev: SendToPluginEvent<JsonValue, JsonObject>): void | Promise<void> {
		streamDeck.logger.debug('onSendToPlugin');
	}
	override async onWillAppear(ev: WillAppearEvent<CodePipelineMonitorSettings>): Promise<void> {
		streamDeck.logger.debug('onWillAppear');
		buildButton(ev);
	}
	override async onWillDisappear(ev: WillDisappearEvent<CodePipelineMonitorSettings>): Promise<void> {
		streamDeck.logger.debug('onWillDisappear');
		// 清理該按鈕實例的計時器
		clearRefreshTimer(ev.action.id);
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
		// 只有在設定完整時才設置長按計時器
		if (hasRequiredSettings(ev.payload.settings)) {
			const pressTimer = setTimeout(() => {
				streamDeck.logger.debug('長按超過1.3秒');
				streamDeck.system.openUrl(getAwsConsoleUrl(ev.payload.settings));
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
		getPipelineState(ev);
	} else {
		renderInitButton(ev);
	}
};

const renderInitButton = (ev: ButtonEvent): void => {
	const { canvas, ctx } = createButtonCanvas();

	if (ev.payload.settings.displayName) {
		drawTitle(ctx, ev.payload.settings.displayName);
	} else {
		ctx.fillStyle = 'white';
		ctx.font = '20px sans-serif bold';
		ctx.textAlign = 'center';
		ctx.fillText('AWS CodePipeline', 72, 20, 124);
		ctx.font = '18px sans-serif';
		ctx.fillStyle = 'orange';
		ctx.fillText('Not Configured', 72, 70);
	}
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
 * 繪製 Iconify line-md 圖示到 Canvas
 */
const drawIcon = async (ctx: CanvasRenderingContext2D, paths: IconPathDef[], color: string, x: number, y: number, size: number): Promise<void> => {
	const svg = createIconSvg(paths, color);
	const img = await loadImage(svg);
	ctx.drawImage(img, x, y, size, size);
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
const drawStatusSymbols = async (ctx: CanvasRenderingContext2D, statuses: string[]): Promise<void> => {
	const statusIcons = statuses.map(getStatusIcon);
	const iconSize = 40;
	const gap = 4;
	const totalWidth = statusIcons.length * iconSize + (statusIcons.length - 1) * gap;
	let x = (CANVAS_SIZE - totalWidth) / 2;
	const y = 46;

	for (const { icon, color } of statusIcons) {
		await drawIcon(ctx, icon, color, x, y, iconSize);
		x += iconSize + gap;
	}
};

/**
 * 繪製底部時間和狀態指示器
 */
const drawFooter = async (ctx: CanvasRenderingContext2D, isAllSucceeded: boolean): Promise<void> => {
	ctx.fillStyle = 'white';
	ctx.font = '22px sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText(dayjs().format('HH:mm'), 52, 110);
	if (isAllSucceeded) {
		await drawIcon(ctx, ICON_CHECK, '#4ade80', 96, 108, 22);
	} else {
		await drawIcon(ctx, ICON_REFRESH, 'white', 96, 108, 22);
	}
};

const getPipelineState = async (ev: ButtonEvent): Promise<void> => {
	process.env.AWS_ACCESS_KEY_ID = ev.payload.settings.AWS_ACCESS_KEY_ID;
	process.env.AWS_SECRET_ACCESS_KEY = ev.payload.settings.AWS_SECRET_ACCESS_KEY;

	const codePipelineClient = new CodePipelineClient({
		region: ev.payload.settings.region,
		credentials: fromEnv()
	});

	try {
		const command = new GetPipelineStateCommand({ name: ev.payload.settings.pipelineName });
		const response = await codePipelineClient.send(command);
		streamDeck.logger.info('AWS CodePipeline Response', response);

		const allStatuses = response.stageStates?.map(stage => stage.latestExecution?.status ?? '') ?? [];
		const isAllSucceeded = allStatuses.every(status => status === 'Succeeded');
		const actionId = ev.action.id;

		// 繪製按鈕
		const { canvas, ctx } = createButtonCanvas();
		drawTitle(ctx, ev.payload.settings.displayName);
		await drawStatusSymbols(ctx, allStatuses);
		await drawFooter(ctx, isAllSucceeded);
		ev.action.setImage(canvas.toDataURL());

		// MEMO: 如果所有狀態都成功，則停止刷新
		// 當你上傳新的 code 的時候，要手動先點選按鈕一次
		if (isAllSucceeded) {
			clearRefreshTimer(actionId);
			streamDeck.logger.debug('All Succeeded, stop refresh');
		} else {
			// 清理舊的計時器
			clearRefreshTimer(actionId);
			// 設定新的計時器
			const newRefreshTimer = setInterval(() => {
				getPipelineState(ev);
			}, REFRESH_INTERVAL);
			refreshTimers.set(actionId, newRefreshTimer);
		}
	} catch (error) {
		streamDeck.logger.error(error);
		clearRefreshTimer(ev.action.id);
		ev.action.showAlert();
	}
};
