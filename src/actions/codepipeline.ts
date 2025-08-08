import streamDeck, { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, SendToPluginEvent, JsonValue, JsonObject, DidReceiveSettingsEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { fromEnv } from "@aws-sdk/credential-providers";
import { CodePipelineClient, GetPipelineStateCommand } from "@aws-sdk/client-codepipeline";
import dayjs from 'dayjs';
import { createCanvas } from 'canvas';


/**
 * An example action class that displays a count that increments by one each time the button is pressed.
*/

let pressTimer: NodeJS.Timeout;
let refreshTimer: NodeJS.Timeout;
// const sendToPropertyInspector = (e: JsonValue) => streamDeck.ui.current?.sendToPropertyInspector(e)

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
	override onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): void | Promise<void> {
		console.log('onSendToPlugin', ev);
	}
	override async onWillAppear(ev: WillAppearEvent<CodePipelineMonitorSettings>): Promise<void> {
		console.log('onWillAppear', ev.payload.settings);
		buildButton(ev);
	}
	override async onWillDisappear(ev: WillDisappearEvent<CodePipelineMonitorSettings>): Promise<void> {
		console.log('onWillDisappear', ev.payload.settings);
		clearInterval(refreshTimer);
	}
	/**
	 * Listens for the {@link SingletonAction.onKeyDown} event which is emitted by Stream Deck when an action is pressed. Stream Deck provides various events for tracking interaction
	 * with devices including key down/up, dial rotations, and device connectivity, etc. When triggered, {@link ev} object contains information about the event including any payloads
	 * and action information where applicable. In this example, our action will display a counter that increments by one each press. We track the current count on the action's persisted
	 * settings using `setSettings` and `getSettings`.
	 */
	override async onKeyDown(ev: KeyDownEvent<CodePipelineMonitorSettings>): Promise<void> {
		console.log('onKeyDown');
		pressTimer = setTimeout(() => {
			console.log('長按超過1.3秒');
			streamDeck.system.openUrl(`https://${ev.payload.settings.region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${ev.payload.settings.pipelineName}/view?region=${ev.payload.settings.region}`);
			return;
		}, 1300);
		buildButton(ev);
		return;
	}
	override async onKeyUp(ev: KeyUpEvent<CodePipelineMonitorSettings>): Promise<void> {
		console.log('onKeyUp');
		clearTimeout(pressTimer);
	}
}

const buildButton = (ev: WillAppearEvent<CodePipelineMonitorSettings> | KeyDownEvent<CodePipelineMonitorSettings>) => {
	if (Object.keys(ev.payload.settings).length === 5 && Object.values(ev.payload.settings).every(value => value !== '')) {
		getPipelineState(ev);
	} else {
		initButton(ev);
	}
}

const initButton = (ev: WillAppearEvent<CodePipelineMonitorSettings> | KeyDownEvent<CodePipelineMonitorSettings>) => {
	const canvas = createCanvas(144, 144);
	const ctx = canvas.getContext('2d');

	ctx.textBaseline = 'top';

	ctx.fillStyle = 'white'
	ctx.font = '20px sans-serif bold'
	ctx.textAlign = 'center';
	if (ev.payload.settings.displayName) {
		ctx.fillText(ev.payload.settings.displayName, 72, 20, 124)
	} else {
		ctx.fillText('AWS CodePipeline', 72, 20, 124)
		ctx.font = '18px sans-serif'
		ctx.fillStyle = 'orange'
		ctx.fillText('Not Configured', 72, 70)
	}
	ev.action.setImage(canvas.toDataURL());
}

const getPipelineState = async (ev: WillAppearEvent<CodePipelineMonitorSettings> | KeyDownEvent<CodePipelineMonitorSettings>) => {
	process.env.AWS_ACCESS_KEY_ID = ev.payload.settings.AWS_ACCESS_KEY_ID;
	process.env.AWS_SECRET_ACCESS_KEY = ev.payload.settings.AWS_SECRET_ACCESS_KEY;

	const codePipelineClient = new CodePipelineClient({
		region: ev.payload.settings.region,
		credentials: fromEnv()
	});
	try {
		const command = new GetPipelineStateCommand({ name: ev.payload.settings.pipelineName });
		const response = await codePipelineClient.send(command);
		// console.log(response);
		const AllStatus = response.stageStates?.map(stage => stage.latestExecution?.status ?? '')
		const canvas = createCanvas(144, 144);
		const ctx = canvas.getContext('2d');

		ctx.textBaseline = 'top';
		// ctx.fillRect(0, 0, 144, 144);

		ctx.font = '20px sans-serif bold';
		ctx.textAlign = 'center';
		ctx.fillStyle = 'white';
		ctx.fillText(ev.payload.settings.displayName, 72, 20, 124);

		const statusSymbols = AllStatus?.map((status): { symbol: string; color: string } => {
			if (status === 'Succeeded') return { symbol: '✔', color: 'green' };
			if (status === 'Failed') return { symbol: '✘', color: 'red' };
			return { symbol: '.', color: 'blue' };
		}) ?? [];
		// console.log(statusSymbols);

		ctx.font = '60px sans-serif';
		ctx.textAlign = 'center';

		const combinedWidth = statusSymbols.length * 30;
		let startX = 66 - combinedWidth / 2 + 15;

		statusSymbols.forEach(({ symbol, color }) => {
			ctx.fillStyle = color;
			ctx.fillText(symbol, startX, 40);
			startX += 40;
		});

		ctx.fillStyle = 'white';
		ctx.font = '22px sans-serif';
		ctx.fillText(dayjs().format('HH:mm'), 72, 120);
		ev.action.setImage(canvas.toDataURL());

		// MEMO: 如果所有狀態都成功，則停止刷新
		// 當你上傳新的 code 的時候，要手動先點選按鈕一次
		if (AllStatus?.every(status => status === 'Succeeded')) {
			clearInterval(refreshTimer);
			console.log('All Succeeded, stop refresh');
		} else {
			clearInterval(refreshTimer);
			refreshTimer = setInterval(() => {
				getPipelineState(ev);
			}, 60000);
		}
	} catch (error) {
		console.error(error);
		clearInterval(refreshTimer);
		ev.action.showAlert();
	}
}

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
