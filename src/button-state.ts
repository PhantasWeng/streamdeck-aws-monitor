import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import type { CodePipelineClient } from '@aws-sdk/client-codepipeline';
import type { EC2Client } from '@aws-sdk/client-ec2';
import { detach } from './async-guard';
import type { Ec2Snapshot } from './ec2-metrics';
import { clearStageStatusTracking, type StageTransitionState } from './transitions';

export type StatusFetcher = () => Promise<string[]>;
export type Ec2SnapshotFetcher = () => Promise<Ec2Snapshot>;

/**
 * 每個按鈕實例的完整狀態（keyed by action.id），
 * 集中在單一物件避免多個 Map 清理時遺漏
 */
export type ButtonState = StageTransitionState & {
	pressTimer?: NodeJS.Timeout;
	refreshTimer?: NodeJS.Timeout;
	lastClickTime?: number;
	loadingAnimationTimer?: NodeJS.Timeout;
	loadingAngle?: number;
	loadingRenderer?: () => Promise<void>;
	pollingStartedAt?: number;
	fetcher?: StatusFetcher;
	client?: CodePipelineClient;
	clientKey?: string;
	// EC2 監控專用：EC2 與 CloudWatch client 各自快取，與 CodePipeline 欄位互不干擾
	ec2Fetcher?: Ec2SnapshotFetcher;
	ec2Client?: EC2Client;
	cwClient?: CloudWatchClient;
	ec2ClientKey?: string;
	// onWillDisappear 已釋放此實例；任何跨越 async 邊界（await fetch）
	// 而殘留的 poll / 動畫鏈都應檢查此旗標並自我終止，避免殭屍計時器
	disposed?: boolean;
};

const LOADING_ANIMATION_FPS = 10;
const LOADING_ANIMATION_INTERVAL = Math.round(1000 / LOADING_ANIMATION_FPS);
export const LOADING_ROTATION_STEP = 24;

const buttonStates = new Map<string, ButtonState>();

export const getButtonState = (actionId: string): ButtonState => {
	let state = buttonStates.get(actionId);
	if (!state) {
		state = {};
		buttonStates.set(actionId, state);
	}
	return state;
};

export const clearRefreshTimer = (state: ButtonState): void => {
	if (state.refreshTimer) {
		clearTimeout(state.refreshTimer);
		state.refreshTimer = undefined;
	}
};

export const clearPressTimer = (state: ButtonState): void => {
	if (state.pressTimer) {
		clearTimeout(state.pressTimer);
		state.pressTimer = undefined;
	}
};

export const clearLoadingAnimation = (state: ButtonState): void => {
	if (state.loadingAnimationTimer) {
		clearInterval(state.loadingAnimationTimer);
		state.loadingAnimationTimer = undefined;
	}
	state.loadingAngle = undefined;
	state.loadingRenderer = undefined;
};

/**
 * 同步 loading 動畫狀態
 */
export const syncLoadingAnimation = (state: ButtonState, shouldAnimate: boolean, renderer: () => Promise<void>): void => {
	// 已釋放的殘留鏈不得再啟動動畫（否則會產生永不被清的殭屍計時器）
	if (state.disposed || !shouldAnimate) {
		clearLoadingAnimation(state);
		return;
	}

	state.loadingRenderer = renderer;

	if (state.loadingAnimationTimer) {
		return;
	}

	state.loadingAngle = 0;
	state.loadingAnimationTimer = setInterval(() => {
		// 實例已釋放時自我停止並清理，防止殭屍計時器持續 setImage
		if (state.disposed) {
			clearLoadingAnimation(state);
			return;
		}
		state.loadingAngle = ((state.loadingAngle ?? 0) + LOADING_ROTATION_STEP) % 360;
		const currentRenderer = state.loadingRenderer;
		if (currentRenderer) {
			// 每秒 10 次的射後不理呼叫：任何一次 rejection 裸奔都會終止整個外掛程序
			detach(currentRenderer(), 'loading animation frame');
		}
	}, LOADING_ANIMATION_INTERVAL);
};

/**
 * 按鈕從畫面移除時，一次清理該實例的所有計時器與資源
 */
export const disposeButtonState = (actionId: string): void => {
	const state = buttonStates.get(actionId);
	if (!state) {
		return;
	}
	// 先標記釋放，讓任何 in-flight 的 poll / 動畫鏈（await 期間）自我終止
	state.disposed = true;
	clearRefreshTimer(state);
	clearPressTimer(state);
	clearLoadingAnimation(state);
	clearStageStatusTracking(state);
	state.client?.destroy();
	state.ec2Client?.destroy();
	state.cwClient?.destroy();
	buttonStates.delete(actionId);
};
