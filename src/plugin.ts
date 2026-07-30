import streamDeck from "@elgato/streamdeck";

import { CodePipelineMonitor } from "./actions/codepipeline";
import { Ec2Monitor } from "./actions/ec2";

// 正式環境使用 info，避免 log 檔隨長時間 polling 膨脹；
// 開發時可暫時改為 "debug" 或 "trace" 查看完整事件
streamDeck.logger.setLevel("info");

// 程序級兜底：Node 20 預設會讓未處理的 rejection / 例外直接終止程序，
// 對外掛而言就是 Stream Deck 端每 10 秒重啟一次的崩潰迴圈，最終被標記為 unstable 並停用。
// 個別失敗（例如某一幀繪圖失敗）已在各自的呼叫點處理（見 async-guard.ts）；
// 這裡只保證任何漏網之魚都被記錄下來而不會弄死整個外掛。
process.on("unhandledRejection", (reason) => {
	streamDeck.logger.error("Unhandled promise rejection", reason);
});
process.on("uncaughtException", (error) => {
	streamDeck.logger.error("Uncaught exception", error);
});

// Register the monitor actions.
streamDeck.actions.registerAction(new CodePipelineMonitor());
streamDeck.actions.registerAction(new Ec2Monitor());

// Finally, connect to the Stream Deck.
streamDeck.connect();
