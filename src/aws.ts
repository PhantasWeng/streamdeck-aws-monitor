import { CodePipelineClient, GetPipelineStateCommand } from '@aws-sdk/client-codepipeline';
import streamDeck from '@elgato/streamdeck';
import type { ButtonState } from './button-state';
import { type CodePipelineMonitorSettings, getPipelineRegion } from './settings';

/**
 * 查詢 pipeline 各 stage 的最新執行狀態。
 * Client 以 region + 憑證為 key 快取在 ButtonState 上，
 * 避免每次 polling 都重建連線；憑證直接傳入 client，
 * 不寫入 process.env（多顆按鈕使用不同帳號時會互相覆寫）。
 */
export const fetchPipelineStatuses = async (state: ButtonState, settings: CodePipelineMonitorSettings): Promise<string[]> => {
	const region = getPipelineRegion(settings);
	const clientKey = `${region}|${settings.AWS_ACCESS_KEY_ID}|${settings.AWS_SECRET_ACCESS_KEY}`;
	if (!state.client || state.clientKey !== clientKey) {
		state.client?.destroy();
		state.client = new CodePipelineClient({
			region,
			credentials: {
				accessKeyId: settings.AWS_ACCESS_KEY_ID,
				secretAccessKey: settings.AWS_SECRET_ACCESS_KEY,
			},
		});
		state.clientKey = clientKey;
	}

	const command = new GetPipelineStateCommand({ name: settings.pipelineName });
	const response = await state.client.send(command);
	const statuses = response.stageStates?.map(stage => stage.latestExecution?.status ?? '') ?? [];
	streamDeck.logger.debug('AWS CodePipeline stage statuses', statuses);
	return statuses;
};
