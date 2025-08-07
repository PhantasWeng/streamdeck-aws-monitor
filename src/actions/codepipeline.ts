import streamDeck, { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, SendToPluginEvent, JsonValue, JsonObject, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import { fromEnv } from "@aws-sdk/credential-providers";
import { CodePipelineClient, GetPipelineStateCommand } from "@aws-sdk/client-codepipeline";

import { createCanvas } from 'canvas';


/**
 * An example action class that displays a count that increments by one each time the button is pressed.
*/

let timer: NodeJS.Timeout;
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
		const canvas = createCanvas(144, 144);
		const ctx = canvas.getContext('2d');

		ctx.textBaseline = 'top';

		ctx.fillStyle = 'white'
		ctx.font = '20px sans-serif bold'
		ctx.textAlign = 'center';
		ctx.fillText(ev.payload.settings.displayName, 72, 20, 124)
		ev.action.setImage(canvas.toDataURL());
	}
	/**
	 * Listens for the {@link SingletonAction.onKeyDown} event which is emitted by Stream Deck when an action is pressed. Stream Deck provides various events for tracking interaction
	 * with devices including key down/up, dial rotations, and device connectivity, etc. When triggered, {@link ev} object contains information about the event including any payloads
	 * and action information where applicable. In this example, our action will display a counter that increments by one each press. We track the current count on the action's persisted
	 * settings using `setSettings` and `getSettings`.
	 */
	override async onKeyDown(ev: KeyDownEvent<CodePipelineMonitorSettings>): Promise<void> {
		console.log('onKeyDown');
		timer = setTimeout(() => {
			console.log('長按超過1.3秒');
			streamDeck.system.openUrl(`https://${ev.payload.settings.region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${ev.payload.settings.pipelineName}/view?region=${ev.payload.settings.region}`);
			return;
		}, 1300);
		getPipelineState(ev);
		return;
	}
	override async onKeyUp(ev: KeyUpEvent<CodePipelineMonitorSettings>): Promise<void> {
		console.log('onKeyUp');
		clearTimeout(timer);
	}
}

const getPipelineState = async (ev: KeyDownEvent<CodePipelineMonitorSettings>) => {
	process.env.AWS_ACCESS_KEY_ID = ev.payload.settings.AWS_ACCESS_KEY_ID;
	process.env.AWS_SECRET_ACCESS_KEY = ev.payload.settings.AWS_SECRET_ACCESS_KEY;

	const codePipelineClient = new CodePipelineClient({
		region: ev.payload.settings.region,
		credentials: fromEnv()
	});
	try {
		const command = new GetPipelineStateCommand({ name: ev.payload.settings.pipelineName });
		const response = await codePipelineClient.send(command);
		console.log(response);
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

		ctx.font = '60px sans-serif';
		ctx.textAlign = 'center';

		const combinedWidth = statusSymbols.length * 30;
		let startX = 72 - combinedWidth / 2 + 15;

		statusSymbols.forEach(({ symbol, color }) => {
			ctx.fillStyle = color;
			ctx.fillText(symbol, startX, 60);
			startX += 40;
		});
		ev.action.setImage(canvas.toDataURL());
	} catch (error) {
		console.error(error);
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
