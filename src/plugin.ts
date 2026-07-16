import streamDeck from "@elgato/streamdeck";

import { CodePipelineMonitor } from "./actions/codepipeline";
import { Ec2Monitor } from "./actions/ec2";

// 正式環境使用 info，避免 log 檔隨長時間 polling 膨脹；
// 開發時可暫時改為 "debug" 或 "trace" 查看完整事件
streamDeck.logger.setLevel("info");

// Register the monitor actions.
streamDeck.actions.registerAction(new CodePipelineMonitor());
streamDeck.actions.registerAction(new Ec2Monitor());

// Finally, connect to the Stream Deck.
streamDeck.connect();
