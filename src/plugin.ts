import streamDeck from "@elgato/streamdeck";

import { CodePipelineMonitor } from "./actions/codepipeline";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("debug"); // "trace"

// Register the increment action.
streamDeck.actions.registerAction(new CodePipelineMonitor());

// Finally, connect to the Stream Deck.
streamDeck.connect();
