# Google Ads 週報 Apps Script

將 Ads 轉出的 Sheet 整理到週報 Sheet。

這份程式會讀取兩份 Google Ads 匯出試算表：

1. Campaign 成效來源
2. Conversions by campaign 來源

程式會配對目的報表中的 Campaign 名稱，並更新目前月份、相同日期區間的週報。

## 更新範圍

更新目的報表的 **C:L**：

| 目的欄 | 內容 | 來源／計算方式 |
|---|---|---|
| C | Impr. | `Impr.` |
| D | Engmt. | Search 使用 `Clicks`；其他類型使用 `Engagements` |
| E | Engmt. Rate | `D ÷ C` 公式 |
| F | Views | `Viewable impr.` |
| G | CTR | `H ÷ C` 公式 |
| H | Clicks | `Clicks` |
| I | Avg. CPC | `Avg. CPC` |
| J | Conv. | `Conversions` |
| K | Conv. Rate | `Conv. rate` |
| L | Cost | `Cost` |

另外更新 **N:O、P:S**：

| 目的欄 | 內容 | 分類／計算方式 |
|---|---|---|
| N | Usage% | `=L列/M列` |
| O | CPA | `=L列/S列` |
| P | Download | Conversion action 名稱包含獨立的 `DL` 或 `download` |
| Q | View 3 pages | Conversion action 包含 `more than 3 pages` |
| R | Registration or Plugin DL | 其餘無法辨識的 Conversion action |
| S | Total | `=SUM(P列:R列)` |

L（Cost）與 M（Budget）會套用 USD 整數顯示格式；底層數值不會被四捨五入或截斷。

程式不會修改：

- A:B：狀態、Campaign 與分組標題
- M：Budget 內容（只調整顯示格式）
- T：Note
- 目的表既有格式

## 安裝位置

在「目的 Google 試算表」操作：

1. 選擇上方的 **擴充功能 → Apps Script**。
2. 開啟預設的 `Code.gs`。
3. 刪除編輯器內的範例內容。
4. 複製本資料夾 `Code.gs` 的全部內容並貼上。
5. 按 **儲存**。
6. 回到 Google 試算表並重新整理網頁。
7. 上方選單應出現 **廣告週報**。

## 第一次使用

1. 選擇 **廣告週報 → 1. 設定成效來源試算表**，貼上 Campaign 成效來源網址。
2. 選擇 **廣告週報 → 2. 設定 Conversion 來源試算表**，貼上 Conversions by campaign 來源網址。
3. Google 會顯示授權畫面；確認帳號後允許程式讀寫必要的試算表。
4. 使用者必須具備：
   - 來源試算表的讀取權限
   - 目的試算表的編輯權限

若看到「Google 尚未驗證這個應用程式」，這通常是因為它是組織內自行建立的 Apps Script。請先由組織的 Google Workspace 管理員確認公司政策，再決定是否允許執行。

## 每週操作

1. 先選擇 **廣告週報 → 3. 預覽差異（不寫入）**。
2. 檢查來源、目的月份、期間、配對數及未配對 Campaign。
3. 確認正確後，選擇 **廣告週報 → 4. 確認並更新目前月份**。
4. 再次按下確認後才會寫入。

更新前，程式會複製完整月份分頁，建立名稱類似 `_備份_Jul_0723_153000` 的隱藏備份分頁。若結果不正確，可取消隱藏該分頁並以備份內容還原。

## 資料條件

- 來源檔第一個分頁必須是 Google Ads 匯出資料。
- 標題列必須包含：
  `Campaign`、`Campaign type`、`Impr.`、`Engagements`、`Viewable impr.`、`Clicks`、`Avg. CPC`、`Conversions`、`Conv. rate`、`Cost`。
- 來源上方需有日期，例如：
  `July 1, 2026 - July 19, 2026`。
- Conversion 來源標題列必須包含：
  `Campaign`、`Conversion action`、`Conversions`。
- 兩份來源的起訖日期必須完全相同；不一致時程式會停止，不會建立備份或寫入資料。
- 目的月份分頁需使用英文縮寫，例如 `Jul`。
- 目的表需有相同日期區間，例如 `W3: 7/1-7/19`。
- Campaign 名稱必須完全一致。

## 分享給其他人

Apps Script 綁定在目的試算表內，因此分享目的試算表時，程式也會隨檔案保留。

每位執行者第一次使用時，仍可能需要自行授權；對方也必須能讀取來源檔。若只希望少數管理者可以更新，其他人只需要檢視結果，請只給管理者目的表的編輯權限。
