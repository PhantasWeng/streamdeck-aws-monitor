import streamDeck, { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, SendToPluginEvent, JsonValue, JsonObject, DidReceiveSettingsEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { fromEnv } from "@aws-sdk/credential-providers";
import { CodePipelineClient, GetPipelineStateCommand } from "@aws-sdk/client-codepipeline";
import dayjs from 'dayjs';
import { createCanvas, Canvas, CanvasRenderingContext2D } from 'canvas';

/**
 * Settings for {@link CodePipelineMonitor}.
 */
type CodePipelineMonitorSettings = {
	AWS_ACCESS_KEY_ID: string;
	AWS_SECRET_ACCESS_KEY: string;
	region: string;
	pipelineName: string;
	displayName: string;
};

type ButtonEvent = WillAppearEvent<CodePipelineMonitorSettings> | KeyDownEvent<CodePipelineMonitorSettings>;

// 常數
const CANVAS_SIZE = 144;
const LONG_PRESS_DURATION = 1300;
const REFRESH_INTERVAL = 60000;
const SETTINGS_KEYS_COUNT = 5;

// 使用 Map 來追蹤每個按鈕實例的計時器，避免全域變數被共用
const pressTimers = new Map<string, NodeJS.Timeout>();
const refreshTimers = new Map<string, NodeJS.Timeout>();
// const sendToPropertyInspector = (e: JsonValue) => streamDeck.ui.current?.sendToPropertyInspector(e)

/**
 * 檢查設定是否完整
 */
const isConfigured = (settings: CodePipelineMonitorSettings): boolean => {
	return Object.keys(settings).length === SETTINGS_KEYS_COUNT &&
		Object.values(settings).every(value => value !== '');
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
	ctx.fillText(title, 72, 20, 124);
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
		if (isConfigured(ev.payload.settings)) {
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
		}
	}
}

const buildButton = (ev: ButtonEvent): void => {
	if (isConfigured(ev.payload.settings)) {
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
 * 將 pipeline 狀態轉換為顯示符號
 */
const getStatusSymbol = (status: string): { symbol: string; color: string } => {
	if (status === 'Succeeded') return { symbol: '✔', color: 'green' };
	if (status === 'Failed') return { symbol: '✘', color: 'red' };
	return { symbol: '.', color: 'blue' };
};

/**
 * 繪製狀態符號
 */
const drawStatusSymbols = (ctx: CanvasRenderingContext2D, statuses: string[]): void => {
	const statusSymbols = statuses.map(getStatusSymbol);

	ctx.font = '60px sans-serif';
	ctx.textAlign = 'center';

	const combinedWidth = statusSymbols.length * 30;
	let startX = 66 - combinedWidth / 2 + 15;

	statusSymbols.forEach(({ symbol, color }) => {
		ctx.fillStyle = color;
		ctx.fillText(symbol, startX, 40);
		startX += 40;
	});
};

/**
 * 繪製底部時間和狀態指示器
 */
const drawFooter = (ctx: CanvasRenderingContext2D, isAllSucceeded: boolean): void => {
	ctx.fillStyle = 'white';
	ctx.font = '22px sans-serif';
	ctx.fillText(dayjs().format('HH:mm'), 60, 120);
	ctx.fillText(isAllSucceeded ? '✔︎' : '✽', 105, 114);
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
		drawStatusSymbols(ctx, allStatuses);
		drawFooter(ctx, isAllSucceeded);
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
