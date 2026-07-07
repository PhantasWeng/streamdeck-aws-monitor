import streamDeck from "@elgato/streamdeck";

import { CodePipelineMonitor } from "./actions/codepipeline";

// 正式環境使用 info，避免 log 檔隨長時間 polling 膨脹；
// 開發時可暫時改為 "debug" 或 "trace" 查看完整事件
streamDeck.logger.setLevel("info");

// Register the CodePipeline monitor action.
streamDeck.actions.registerAction(new CodePipelineMonitor());

// Finally, connect to the Stream Deck.
streamDeck.connect();
