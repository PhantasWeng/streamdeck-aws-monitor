# Debug Demo Mode Design

## Trigger
- `pipelineName === "debug"` activates demo mode
- Only requires `pipelineName` + `displayName` (skips AWS credentials)

## State Machine
3 stages, each advances every 3 seconds. Each stage randomly succeeds or fails.
If a stage fails, subsequent stages stay as loading and the demo stops.

```
Initial: [loading, loading, loading]
  ↓ 3s
Step 1:  [success/fail, loading, loading]
  ↓ 3s (only if step 1 succeeded)
Step 2:  [success, success/fail, loading]
  ↓ 3s (only if step 2 succeeded)
Step 3:  [success, success, success/fail]
  → Stop. Press button to re-run.
```

## New Functions
- `isDebugMode(settings)` — checks `pipelineName === "debug"`
- `runDebugDemo(ev)` — starts simulation with `setInterval`, 3s per step
- `renderDebugFrame(ev, statuses)` — draws one frame reusing `drawTitle`, `drawStatusSymbols`, `drawFooter`

## Modified Points
- `buildButton`: debug branch calls `runDebugDemo` instead of `getPipelineState`
- `hasRequiredSettings`: debug mode only needs `pipelineName` + `displayName`
- `onKeyDown`: debug mode — short press re-runs demo, no long-press AWS Console
- `onWillDisappear`: cleans up debug timer via existing `clearRefreshTimer`

## Interaction (debug mode)
- Short press: re-run demo
- Long press / double-click: no-op
