# 自動偵測新部署（永不停止的雙速輪詢）

日期：2026-07-08
狀態：設計已核可，待實作計畫

## 背景與問題

目前 `CodePipelineMonitor` 的輪詢在「所有 stage 成功」或「超過 `pollingMaxMinutes` 被標記為 terminated」時會**完全停止**（`src/actions/codepipeline.ts` 的 `pollOnce`）。程式碼註解也明講：

```
// MEMO: 如果所有狀態都成功，則停止刷新
// 當你上傳新的 code 的時候，要手動先點選按鈕一次
```

因此使用者 push 新 code、觸發新的 deployment 時，按鈕不會自動得知，必須**手動按一下**才會重新開始監控。

需求：讓按鈕在 pipeline 發生變動時自動抓最新的，不用手動按。

## 決策紀錄（brainstorming 結論）

- **不走事件驅動（EventBridge → SQS / IoT Core）**：那需要使用者在自己的 AWS 帳號預先建 EventBridge rule + SQS queue 並多開 IAM 權限，破壞「貼上 access key 即用」的簡單體驗。改用低頻率輪詢逼近。
- **閒置後永不停止**：只要按鈕還在 Stream Deck 上就持續輪詢。
- **閒置輪詢間隔 = 5 分鐘**；偵測到新部署後自動切回 60 秒快輪。
- **失敗 / terminated 狀態也繼續偵測**：任何「已結束」狀態（全成功 / 含失敗 / terminated）都進入慢輪，一有新部署就切回快輪。

## 設計（方向：統一雙速輪詢）

採用單一 poll loop，永遠 `scheduleNextPoll`，僅依當下狀態選擇間隔。偵測新部署是這個模型的自然副作用，不需額外的「偵測新執行」邏輯。

### 常數

- `FAST_REFRESH_INTERVAL = 60000`（原 `REFRESH_INTERVAL`，快輪）
- `IDLE_REFRESH_INTERVAL = 300000`（新增，5 分鐘慢輪）
- Debug 模式：快輪與慢輪都沿用 `DEBUG_STEP_INTERVAL`（3s），方便快速觀察快/慢切換。

### 核心輪詢分類

每次 `pollOnce` 抓到 `statuses` 後計算：

- `hasInProgress = statuses.some(isLoadingStatus)`
  （`isLoadingStatus(s)` = `s !== 'Succeeded' && s !== 'Failed'`，即 InProgress 類）
- 分類：
  - **active**：`hasInProgress === true` 且未超過 `pollingMaxMinutes`
    → 記錄 `pollingStartedAt`（`??= now`）→ 下一輪用 `FAST`
  - **terminated**：`hasInProgress === true` 且 `now - pollingStartedAt >= pollingMaxMs`
    → 下一輪用 `IDLE`（降速，**不再停止**）
  - **settled**：`hasInProgress === false`（全成功或含失敗）
    → 清掉 `pollingStartedAt` → 下一輪用 `IDLE`
- **一律 `scheduleNextPoll`**，移除所有「`clearRefreshTimer` 後就停」的終止路徑。唯一會停的是 `onWillDisappear`（`disposeButtonState`）與設定不完整（`buildButton` 的 else 分支）。

註：`pollingStartedAt` 語意調整為「目前這個 in-progress 執行開始被快輪監看的時間點」。落定時清除；新執行開始時（settled → in-progress）重新計時，因此每個新執行都重新享有完整的 `pollingMaxMinutes` 快輪視窗。

### footer 與 loading 動畫改由「分類」驅動

現況 footer 與動畫依賴 `state.refreshTimer` 是否存在來判斷；新模型下 timer 幾乎永遠存在，會失準。改為由分類結果決定：

| 狀態 | footer | loading 動畫 |
|------|--------|--------------|
| 全部 Succeeded | `succeeded` | 關 |
| 有 in-progress（active，快輪中） | `refreshing` | 開 |
| 落定但含 Failed（settled，慢輪背景監控） | `idle`（靜態箭頭） | 關 |
| terminated（超時降速） | `terminated` | 關 |

效果：閒置慢輪時不再空跑 10fps 動畫，省資源；footer 語意也更精確。

### `pollingMaxMinutes` 語意變更

- 舊：超過就**完全停止**輪詢。
- 新：單一 in-progress 執行**最多快輪多久**；超過後降到 5 分鐘背景慢輪（footer 顯示 `terminated`），仍持續偵測下一次部署。
- 預設維持 30 分鐘。
- Property Inspector（`ui/codepipeline.html`）中此欄位的說明文字若描述為「停止輪詢」，需一併更新為「最長快速輪詢時間」。（實作時確認並更新。）

### Debug 模式

現況 debug fetcher 在 tick≥1 後皆為落定狀態，不會再產生新的 in-progress，無法示範自動偵測。調整：

- 讓 debug fetcher 在閒置若干次後**偶爾重新回到全 `InProgress`**，模擬新部署觸發，用以驗證 settled → active 的自動切換。
- Debug 的慢輪間隔沿用 `DEBUG_STEP_INTERVAL`（3s）。

### 錯誤處理

維持「暫時性錯誤不停止輪詢」的精神，但配合永不停止調整：

- 發生錯誤時仍 `showAlert()` 並繼續排下一輪，**不再完全停止**。
- 重試速度：在 `pollingStartedAt` 起算的 `pollingMaxMs` 內用 `FAST` 重試；超過後降為 `IDLE` 重試（而非停止）。
- `pollingStartedAt` 在首次錯誤時 `??= now`。

## 可測試性

抽出純函式便於單元測試（不需 canvas / network）：

```
classifyPoll(statuses, pollingStartedAt, now, pollingMaxMs)
  → { mode: 'active' | 'settled' | 'terminated', footer: FrameFooter }
```

- 純函式**只回傳 `mode` 與 `footer`**，不含間隔常數（維持與 debug/正式模式無關、可獨立測試）。呼叫端 `pollOnce` 依 `mode` 映射間隔：`active` → fast、`settled`/`terminated` → idle（fast/idle 的實際毫秒數由呼叫端依 debug 與否傳入）。`footer` 需區分 `settled` 之下的「全成功（`succeeded`）」與「含失敗（`idle`）」，故由函式一併回傳。
- 新增 `tests/` 對 `classifyPoll` 的各分類與邊界（剛好等於 `pollingMaxMs`、空 statuses、全 Failed 等）的測試。
- Debug fetcher 新的「閒置後重回 InProgress」行為補上測試。

## 影響範圍

- `src/actions/codepipeline.ts`：`pollOnce`、`scheduleNextPoll`、`startMonitoring`、常數、footer/動畫判斷。
- `src/debug.ts`：fetcher 閒置後重回 InProgress。
- 新增純函式（放 `codepipeline.ts` 或新檔，實作時決定）+ 對應測試。
- `com.phantas-weng.aws-monitor.sdPlugin/ui/codepipeline.html`：`pollingMaxMinutes` 說明文字（若需要）。

## 非目標（YAGNI）

- 不做事件驅動（SQS / IoT Core）。
- 閒置間隔暫不開放使用者設定，先以常數 `IDLE_REFRESH_INTERVAL` 實作（日後有需要再加設定欄位）。
