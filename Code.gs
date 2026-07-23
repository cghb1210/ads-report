/**
 * Google Ads 匯出表 → Weekly Campaign Report
 *
 * 使用方式：
 * 1. 將本檔內容貼到「目的試算表」綁定的 Apps Script 專案。
 * 2. 重新整理試算表。
 * 3. 使用「廣告週報」選單設定來源表、預覽、更新。
 *
 * 本程式更新目的表的 C:L、N:O、P:S，並設定 L:M 的顯示格式。
 * 不會修改 A:B、M、T 的內容。
 */

const REPORT_CONFIG = Object.freeze({
  menuName: '廣告週報',
  sourceIdProperty: 'GOOGLE_ADS_SOURCE_SPREADSHEET_ID',
  conversionSourceIdProperty: 'GOOGLE_ADS_CONVERSION_SOURCE_SPREADSHEET_ID',
  targetStartColumn: 3, // C
  targetColumnCount: 10, // C:L
  conversionStartColumn: 16, // P
  conversionColumnCount: 4, // P:S
  targetHeaderRow: 2,
  campaignColumn: 2, // B
  previewLimit: 20,
  backupPrefix: '_備份_',
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(REPORT_CONFIG.menuName)
    .addItem('1. 設定成效來源試算表', 'setSourceSpreadsheet')
    .addItem('2. 設定 Conversion 來源試算表', 'setConversionSourceSpreadsheet')
    .addItem('3. 預覽差異（不寫入）', 'previewGoogleAdsUpdate')
    .addSeparator()
    .addItem('4. 確認並更新目前月份', 'confirmAndUpdateGoogleAdsReport')
    .addToUi();
}

function setSourceSpreadsheet() {
  setSpreadsheetProperty_(
    REPORT_CONFIG.sourceIdProperty,
    '設定成效來源試算表',
    '請貼上 Google Ads Campaign 成效匯出試算表的完整網址，或試算表 ID：'
  );
}

function setConversionSourceSpreadsheet() {
  setSpreadsheetProperty_(
    REPORT_CONFIG.conversionSourceIdProperty,
    '設定 Conversion 來源試算表',
    '請貼上 Conversions by campaign 試算表的完整網址，或試算表 ID：'
  );
}

function setSpreadsheetProperty_(propertyName, title, message) {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    title,
    message,
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  const sourceId = extractSpreadsheetId_(response.getResponseText());
  if (!sourceId) {
    ui.alert('無法辨識試算表網址或 ID，設定未變更。');
    return;
  }

  // 先測試目前使用者是否有讀取權限，再儲存設定。
  const source = SpreadsheetApp.openById(sourceId);
  const sourceSheet = source.getSheets()[0];
  if (!sourceSheet) throw new Error('來源試算表沒有可讀取的分頁。');

  PropertiesService.getDocumentProperties()
    .setProperty(propertyName, sourceId);

  ui.alert(
    '設定完成',
    `檔案：${source.getName()}\n分頁：${sourceSheet.getName()}`,
    ui.ButtonSet.OK
  );
}

function previewGoogleAdsUpdate() {
  const plan = buildUpdatePlan_();
  SpreadsheetApp.getUi().alert(
    '差異預覽（尚未寫入）',
    formatPreview_(plan),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function confirmAndUpdateGoogleAdsReport() {
  const ui = SpreadsheetApp.getUi();
  const plan = buildUpdatePlan_();

  if (plan.updates.length === 0) {
    ui.alert('沒有需要更新的 Campaign；試算表未做任何變更。');
    return;
  }

  const response = ui.alert(
    '確認更新',
    `${formatPreview_(plan)}\n\n確定要先建立備份，再更新 C:L、N:O 與 P:S 嗎？`,
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    // 鎖定後重新建立計畫，避免預覽後來源或目的資料已被他人修改。
    const freshPlan = buildUpdatePlan_();
    if (freshPlan.updates.length === 0) {
      ui.alert('資料已是最新狀態；試算表未做任何變更。');
      return;
    }

    const backupName = createBackup_(freshPlan.targetSheet);
    freshPlan.updates.forEach(update => {
      freshPlan.targetSheet
        .getRange(
          update.row,
          REPORT_CONFIG.targetStartColumn,
          1,
          REPORT_CONFIG.targetColumnCount
        )
        .setValues([update.newValues]);
      freshPlan.targetSheet
        .getRange(
          update.row,
          REPORT_CONFIG.conversionStartColumn,
          1,
          REPORT_CONFIG.conversionColumnCount
        )
        .setValues([update.newConversionValues]);

      // N Usage% = Cost / Budget；O CPA = Cost / Total。
      freshPlan.targetSheet
        .getRange(update.row, 14, 1, 2)
        .setFormulas([[
          `=L${update.row}/M${update.row}`,
          `=L${update.row}/S${update.row}`,
        ]]);

      // Cost（L）與 Budget（M）以 USD 整數顯示；底層數值不截斷。
      freshPlan.targetSheet
        .getRange(update.row, 12, 1, 2)
        .setNumberFormat('[$$]#,##0');
    });

    SpreadsheetApp.flush();
    ui.alert(
      '更新完成',
        `已更新 ${freshPlan.updates.length} 個 Campaign。\n備份分頁：${backupName}\n成效未配對：${freshPlan.unmatched.length} 個。\n未分類 Conversion action：${freshPlan.unknownConversionActions.length} 個。`,
      ui.ButtonSet.OK
    );
  } finally {
    lock.releaseLock();
  }
}

function buildUpdatePlan_() {
  const sourceId = PropertiesService.getDocumentProperties()
    .getProperty(REPORT_CONFIG.sourceIdProperty);
  if (!sourceId) {
    throw new Error('尚未設定成效來源。請先執行「1. 設定成效來源試算表」。');
  }
  const conversionSourceId = PropertiesService.getDocumentProperties()
    .getProperty(REPORT_CONFIG.conversionSourceIdProperty);
  if (!conversionSourceId) {
    throw new Error('尚未設定 Conversion 來源。請先執行「2. 設定 Conversion 來源試算表」。');
  }

  const sourceSpreadsheet = SpreadsheetApp.openById(sourceId);
  const sourceSheet = sourceSpreadsheet.getSheets()[0];
  const sourceValues = sourceSheet.getDataRange().getValues();
  if (sourceValues.length < 4) throw new Error('來源資料不足，找不到標題列與 Campaign。');

  const sourceHeaderRowIndex = findSourceHeaderRow_(sourceValues);
  const headerMap = createHeaderMap_(sourceValues[sourceHeaderRowIndex]);
  validateRequiredHeaders_(headerMap);

  const reportPeriod = parseReportPeriod_(sourceValues, sourceHeaderRowIndex);
  const conversionSpreadsheet = SpreadsheetApp.openById(conversionSourceId);
  const conversionSheet = conversionSpreadsheet.getSheets()[0];
  const conversionValues = conversionSheet.getDataRange().getValues();
  const conversionHeaderRowIndex = findConversionHeaderRow_(conversionValues);
  const conversionHeaders = createHeaderMap_(conversionValues[conversionHeaderRowIndex]);
  validateConversionHeaders_(conversionHeaders);
  const conversionPeriod = parseReportPeriod_(conversionValues, conversionHeaderRowIndex);
  assertSamePeriod_(reportPeriod, conversionPeriod);
  const conversionIndex = indexConversions_(
    conversionValues,
    conversionHeaderRowIndex + 1,
    conversionHeaders
  );
  const targetSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheet = findTargetMonthSheet_(targetSpreadsheet, reportPeriod.end);
  const targetValues = targetSheet.getDataRange().getValues();
  const block = findTargetPeriodBlock_(targetValues, reportPeriod);
  const sourceByCampaign = indexSourceCampaigns_(
    sourceValues,
    sourceHeaderRowIndex + 1,
    headerMap
  );

  const updates = [];
  const unmatched = [];

  for (let rowIndex = block.startRowIndex; rowIndex < block.endRowIndex; rowIndex++) {
    const targetRow = targetValues[rowIndex] || [];
    const campaign = normalizeText_(targetRow[REPORT_CONFIG.campaignColumn - 1]);
    if (!campaign) continue;

    const sourceRow = sourceByCampaign.get(campaign);
    if (!sourceRow) {
      // 分組標題也位於 B 欄，因此只有看起來像實際 Campaign 的列才列入未配對。
      if (hasMetrics_(targetRow)) unmatched.push({ row: rowIndex + 1, campaign });
      continue;
    }

    const newValues = mapSourceToTarget_(sourceRow, headerMap, rowIndex + 1);
    const conversionValuesForCampaign =
      conversionIndex.byCampaign.get(campaign) ||
      conversionIndex.byCampaign.get(conversionCampaignAlias_(campaign)) ||
      [0, 0, 0];
    const newConversionValues = [
      conversionValuesForCampaign[0],
      conversionValuesForCampaign[1],
      conversionValuesForCampaign[2],
      `=SUM(P${rowIndex + 1}:R${rowIndex + 1})`,
    ];
    const oldValues = targetRow.slice(
      REPORT_CONFIG.targetStartColumn - 1,
      REPORT_CONFIG.targetStartColumn - 1 + REPORT_CONFIG.targetColumnCount
    );
    const oldConversionValues = targetRow.slice(
      REPORT_CONFIG.conversionStartColumn - 1,
      REPORT_CONFIG.conversionStartColumn - 1 + REPORT_CONFIG.conversionColumnCount
    );

    if (
      !rowsEquivalent_(oldValues, newValues) ||
      !conversionRowsEquivalent_(oldConversionValues, newConversionValues)
    ) {
      updates.push({
        row: rowIndex + 1,
        campaign,
        oldValues,
        newValues,
        oldConversionValues,
        newConversionValues,
      });
    }
  }

  return {
    sourceSpreadsheet,
    sourceSheet,
    conversionSpreadsheet,
    conversionSheet,
    targetSheet,
    reportPeriod,
    block,
    updates,
    unmatched,
    unknownConversionActions: conversionIndex.unknownActions,
  };
}

function mapSourceToTarget_(row, headers, targetRowNumber) {
  const campaignType = normalizeText_(row[headers['Campaign type']]);
  const impressions = numberOrZero_(row[headers['Impr.']]);
  const clicks = numberOrZero_(row[headers['Clicks']]);
  const engagements = campaignType === 'Search'
    ? clicks
    : numberOrZero_(row[headers['Engagements']]);

  return [
    impressions,                                      // C Impr.
    engagements,                                     // D Engmt.
    `=IFERROR(D${targetRowNumber}/C${targetRowNumber},0)`, // E Engmt. Rate
    numberOrZero_(row[headers['Viewable impr.']]),    // F Views
    `=IFERROR(H${targetRowNumber}/C${targetRowNumber},0)`, // G CTR
    clicks,                                           // H Clicks
    numberOrZero_(row[headers['Avg. CPC']]),          // I Avg. CPC
    numberOrZero_(row[headers['Conversions']]),       // J Conv.
    numberOrZero_(row[headers['Conv. rate']]),        // K Conv. Rate
    numberOrZero_(row[headers['Cost']]),              // L Cost
  ];
}

function findConversionHeaderRow_(values) {
  const required = ['Campaign', 'Conversion action', 'Conversions'];
  for (let i = 0; i < Math.min(values.length, 20); i++) {
    const row = values[i].map(normalizeText_);
    if (required.every(name => row.includes(name))) return i;
  }
  throw new Error('找不到 Conversion 標題列（Campaign、Conversion action、Conversions）。');
}

function validateConversionHeaders_(headers) {
  const required = ['Campaign', 'Conversion action', 'Conversions'];
  const missing = required.filter(name => headers[name] === undefined);
  if (missing.length) {
    throw new Error(`Conversion 來源缺少必要欄位：${missing.join('、')}`);
  }
}

function indexConversions_(values, firstDataRowIndex, headers) {
  const byCampaign = new Map();
  const unknownActions = new Set();

  for (let i = firstDataRowIndex; i < values.length; i++) {
    const row = values[i];
    const campaign = normalizeText_(row[headers['Campaign']]);
    const action = normalizeText_(row[headers['Conversion action']]);
    if (!campaign || !action || campaign.startsWith('Total:')) continue;

    const bucketIndex = classifyConversionAction_(action);
    if (bucketIndex < 0) {
      unknownActions.add(action);
      continue;
    }

    const totals = byCampaign.get(campaign) || [0, 0, 0];
    totals[bucketIndex] += numberOrZero_(row[headers['Conversions']]);
    byCampaign.set(campaign, totals);
  }

  return {
    byCampaign,
    unknownActions: Array.from(unknownActions).sort(),
  };
}

function classifyConversionAction_(action) {
  // Q：瀏覽三頁。
  if (/more than 3 pages/i.test(action)) return 1;

  // P：名稱中只要有獨立的 DL 或 download，一律歸類為 Download。
  if (/\bdl\b|download/i.test(action)) return 0;

  // R：其餘無法辨識的 action 一律歸類為 Registration or Plugin DL。
  return 2;
}

function conversionCampaignAlias_(campaign) {
  const aliases = {
    'Keyword Search (IC) - NEW': 'Keyword Search (IC)',
  };
  return aliases[campaign] || campaign;
}

function assertSamePeriod_(first, second) {
  if (
    first.start.getTime() !== second.start.getTime() ||
    first.end.getTime() !== second.end.getTime()
  ) {
    throw new Error(
      `兩個來源的期間不一致，已停止更新。\n` +
      `成效來源：${first.sourceLabel}\n` +
      `Conversion 來源：${second.sourceLabel}`
    );
  }
}

function findSourceHeaderRow_(values) {
  const required = ['Campaign', 'Impr.', 'Clicks', 'Cost'];
  for (let i = 0; i < Math.min(values.length, 20); i++) {
    const row = values[i].map(normalizeText_);
    if (required.every(name => row.includes(name))) return i;
  }
  throw new Error('找不到來源標題列（Campaign、Impr.、Clicks、Cost）。');
}

function createHeaderMap_(headerRow) {
  return headerRow.reduce((map, value, index) => {
    const name = normalizeText_(value);
    if (name) map[name] = index;
    return map;
  }, {});
}

function validateRequiredHeaders_(headers) {
  const required = [
    'Campaign',
    'Campaign type',
    'Impr.',
    'Engagements',
    'Viewable impr.',
    'Clicks',
    'Avg. CPC',
    'Conversions',
    'Conv. rate',
    'Cost',
  ];
  const missing = required.filter(name => headers[name] === undefined);
  if (missing.length) {
    throw new Error(`來源缺少必要欄位：${missing.join('、')}`);
  }
}

function parseReportPeriod_(sourceValues, headerRowIndex) {
  const englishMonths = {
    january: 0, february: 1, march: 2, april: 3,
    may: 4, june: 5, july: 6, august: 7,
    september: 8, october: 9, november: 10, december: 11,
  };

  for (let i = 0; i < headerRowIndex; i++) {
    const text = normalizeText_(sourceValues[i][0]);
    const match = text.match(
      /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/
    );
    if (!match) continue;

    const startMonth = englishMonths[match[1].toLowerCase()];
    const endMonth = englishMonths[match[4].toLowerCase()];
    if (startMonth === undefined || endMonth === undefined) continue;

    return {
      start: new Date(Number(match[3]), startMonth, Number(match[2])),
      end: new Date(Number(match[6]), endMonth, Number(match[5])),
      sourceLabel: text,
    };
  }
  throw new Error('找不到來源報表期間，例如 July 1, 2026 - July 19, 2026。');
}

function findTargetMonthSheet_(spreadsheet, endDate) {
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const name = monthNames[endDate.getMonth()];
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error(`目的試算表找不到月份分頁：${name}`);
  return sheet;
}

function findTargetPeriodBlock_(targetValues, period) {
  const expected = `${period.start.getMonth() + 1}/${period.start.getDate()}-${period.end.getMonth() + 1}/${period.end.getDate()}`;
  const markerRegex = /^\s*W\d+\s*:\s*(\d{1,2}\/\d{1,2}-\d{1,2}\/\d{1,2})\s*$/i;
  let startRowIndex = -1;

  for (let i = 0; i < targetValues.length; i++) {
    const match = normalizeText_(targetValues[i][0]).match(markerRegex);
    if (match && match[1] === expected) {
      startRowIndex = i + 1; // 從週次標記的下一列開始
      break;
    }
  }
  if (startRowIndex < 0) {
    throw new Error(`目的分頁找不到期間：${expected}`);
  }

  let endRowIndex = targetValues.length;
  for (let i = startRowIndex; i < targetValues.length; i++) {
    if (markerRegex.test(normalizeText_(targetValues[i][0]))) {
      endRowIndex = i;
      break;
    }
  }
  return { startRowIndex, endRowIndex, label: expected };
}

function indexSourceCampaigns_(values, firstDataRowIndex, headers) {
  const result = new Map();
  const campaignIndex = headers['Campaign'];

  for (let i = firstDataRowIndex; i < values.length; i++) {
    const row = values[i];
    const campaign = normalizeText_(row[campaignIndex]);
    if (!campaign || campaign.startsWith('Total:')) continue;
    if (result.has(campaign)) {
      throw new Error(`來源含有重複 Campaign，無法安全更新：${campaign}`);
    }
    result.set(campaign, row);
  }
  return result;
}

function formatPreview_(plan) {
  const lines = [
    `來源：${plan.sourceSpreadsheet.getName()} / ${plan.sourceSheet.getName()}`,
    `Conversion：${plan.conversionSpreadsheet.getName()} / ${plan.conversionSheet.getName()}`,
    `目的：${plan.targetSheet.getName()} / ${plan.block.label}`,
    `將更新：${plan.updates.length} 個 Campaign（C:L、N:O、P:S；L:M 套用 USD 整數格式）`,
    `成效未配對：${plan.unmatched.length} 個`,
    `未分類 Conversion action：${plan.unknownConversionActions.length} 個`,
  ];

  if (plan.updates.length) {
    lines.push('', `前 ${Math.min(REPORT_CONFIG.previewLimit, plan.updates.length)} 筆差異：`);
    plan.updates.slice(0, REPORT_CONFIG.previewLimit).forEach(update => {
      const changedColumns = [];
      for (let i = 0; i < REPORT_CONFIG.targetColumnCount; i++) {
        if (!valuesEquivalent_(update.oldValues[i], update.newValues[i])) {
          changedColumns.push(columnLetter_(REPORT_CONFIG.targetStartColumn + i));
        }
      }
      for (let i = 0; i < REPORT_CONFIG.conversionColumnCount; i++) {
        if (!valuesEquivalent_(
          update.oldConversionValues[i],
          update.newConversionValues[i]
        )) {
          changedColumns.push(
            columnLetter_(REPORT_CONFIG.conversionStartColumn + i)
          );
        }
      }
      changedColumns.push('N', 'O');
      lines.push(`• 第 ${update.row} 列 ${update.campaign}：${changedColumns.join(', ')}`);
    });
  }

  if (plan.unmatched.length) {
    lines.push('', '未配對 Campaign：');
    plan.unmatched.slice(0, REPORT_CONFIG.previewLimit)
      .forEach(item => lines.push(`• 第 ${item.row} 列 ${item.campaign}`));
  }
  if (plan.unknownConversionActions.length) {
    lines.push('', '未分類 Conversion action（不會寫入 P:R）：');
    plan.unknownConversionActions.slice(0, REPORT_CONFIG.previewLimit)
      .forEach(action => lines.push(`• ${action}`));
  }
  return lines.join('\n');
}

function createBackup_(sourceSheet) {
  const spreadsheet = sourceSheet.getParent();
  // 部分複製的試算表可能暫時回傳空白或非字串時區；
  // Utilities.formatDate 的 timeZone 參數必須是有效字串。
  const spreadsheetTimezone = spreadsheet.getSpreadsheetTimeZone();
  const scriptTimezone = Session.getScriptTimeZone();
  const timezone =
    (typeof spreadsheetTimezone === 'string' && spreadsheetTimezone.trim()) ||
    (typeof scriptTimezone === 'string' && scriptTimezone.trim()) ||
    'Asia/Taipei';
  const timestamp = Utilities.formatDate(new Date(), timezone, 'MMdd_HHmmss');
  const baseName = `${REPORT_CONFIG.backupPrefix}${sourceSheet.getName()}_${timestamp}`;
  let backupName = baseName.slice(0, 99);
  let suffix = 2;
  while (spreadsheet.getSheetByName(backupName)) {
    backupName = `${baseName.slice(0, 95)}_${suffix++}`;
  }

  const backup = sourceSheet.copyTo(spreadsheet).setName(backupName);
  backup.hideSheet();
  return backupName;
}

function extractSpreadsheetId_(input) {
  const text = normalizeText_(input);
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(text) ? text : '';
}

function hasMetrics_(row) {
  return row.slice(2, 12).some(value => value !== '' && value !== null);
}

function rowsEquivalent_(a, b) {
  for (let i = 0; i < REPORT_CONFIG.targetColumnCount; i++) {
    if (!valuesEquivalent_(a[i], b[i])) return false;
  }
  return true;
}

function conversionRowsEquivalent_(a, b) {
  for (let i = 0; i < REPORT_CONFIG.conversionColumnCount; i++) {
    if (!valuesEquivalent_(a[i], b[i])) return false;
  }
  return true;
}

function valuesEquivalent_(a, b) {
  if (typeof b === 'string' && b.startsWith('=')) {
    // 既有公式的計算結果可能是數字；預覽時視為可能有差異，以便重新套用標準公式。
    return a === b;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 0.0000001;
  }
  return normalizeText_(a) === normalizeText_(b);
}

function numberOrZero_(value) {
  if (value === '' || value === null || value === undefined || value === '--') return 0;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`遇到非數字資料：${value}`);
  return number;
}

function normalizeText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function columnLetter_(columnNumber) {
  let result = '';
  let number = columnNumber;
  while (number > 0) {
    number--;
    result = String.fromCharCode(65 + (number % 26)) + result;
    number = Math.floor(number / 26);
  }
  return result;
}
