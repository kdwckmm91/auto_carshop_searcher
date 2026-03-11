import * as fs from 'fs';
import * as path from 'path';
import { google, sheets_v4 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { CarListing, SheetRow, SHEET_HEADERS, WriteStats } from './types';

// =========================================================
// 認証
// =========================================================

const CREDENTIALS_PATH = path.resolve(__dirname, '..', 'credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function getAuth(): GoogleAuth {
  // GitHub Actions では環境変数 GOOGLE_CREDENTIALS_JSON から読む
  const credRaw =
    process.env['GOOGLE_CREDENTIALS_JSON'] ??
    (fs.existsSync(CREDENTIALS_PATH)
      ? fs.readFileSync(CREDENTIALS_PATH, 'utf-8')
      : null);

  if (!credRaw) {
    throw new Error(
      'Google 認証情報が見つかりません。credentials.json を配置するか GOOGLE_CREDENTIALS_JSON 環境変数を設定してください。'
    );
  }

  const credentials = JSON.parse(credRaw);
  return new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
}

// =========================================================
// シート操作
// =========================================================

/**
 * シートの全データを取得する（2行目以降 = ヘッダーを除くデータ行）。
 * URLの列インデックスを返すためにヘッダー行も読む。
 */
export async function getAllRows(
  spreadsheetId: string,
  sheetName: string
): Promise<{ rows: string[][]; urlColIndex: number }> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });

  const values = (res.data.values as string[][] | undefined) ?? [];
  if (values.length === 0) return { rows: [], urlColIndex: -1 };

  const header = values[0];
  const urlColIndex = header.findIndex((h) => h === 'URL');
  const dataRows = values.slice(1);

  return { rows: dataRows, urlColIndex };
}

/**
 * スプレッドシートへ車両情報を書き込む。
 *
 * - URL が既存行と一致する場合: ステータスと価格を更新（値下げ・継続）
 * - 新規: 末尾に追加（ステータス = 新着）
 * - 取得できなかったURL: ステータスを「販売終了」に変更
 */
export async function writeListings(
  spreadsheetId: string,
  sheetName: string,
  listings: CarListing[]
): Promise<WriteStats> {
  if (!spreadsheetId || spreadsheetId === 'YOUR_SPREADSHEET_ID') {
    console.warn('[Sheets] spreadsheet_id 未設定のため書き込みをスキップします');
    return { added: 0, priceDown: 0, ended: 0, unchanged: 0 };
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const stats: WriteStats = { added: 0, priceDown: 0, ended: 0, unchanged: 0 };

  // --- ヘッダー確認・作成 ---
  await ensureHeader(sheets, spreadsheetId, sheetName);

  // --- 既存データ読み込み ---
  const { rows: existingRows, urlColIndex } = await getAllRows(spreadsheetId, sheetName);

  const statusColIndex = SHEET_HEADERS.indexOf('ステータス');
  const totalPriceColIndex = SHEET_HEADERS.indexOf('支払総額(万円)');

  // 既存URLのマップ（URL → 行番号 1-indexed（ヘッダー行=1）)
  const urlToRowNum = new Map<string, number>();
  for (let i = 0; i < existingRows.length; i++) {
    const url = urlColIndex >= 0 ? (existingRows[i][urlColIndex] ?? '') : '';
    if (url) urlToRowNum.set(url, i + 2); // +2: ヘッダー(1行目) + 0-indexed → 1-indexed
  }

  const scrapedUrls = new Set<string>(listings.map((l) => l.url));
  const batchUpdates: sheets_v4.Schema$ValueRange[] = [];
  const appendRows: SheetRow[] = [];

  for (const listing of listings) {
    const rowNum = urlToRowNum.get(listing.url);
    if (rowNum !== undefined) {
      // 既存行: 価格変動チェック
      const existingRow = existingRows[rowNum - 2];
      const existingTotalPrice = parseFloat(existingRow[totalPriceColIndex] ?? '');
      const isPriceDown =
        listing.totalPrice !== null &&
        !isNaN(existingTotalPrice) &&
        listing.totalPrice < existingTotalPrice;

      if (isPriceDown) {
        listing.status = '値下げ';
        stats.priceDown++;
      } else {
        listing.status = '継続';
        stats.unchanged++;
      }

      // ステータス列と支払総額列を更新
      batchUpdates.push({
        range: `${sheetName}!${colLetter(statusColIndex + 1)}${rowNum}`,
        values: [[listing.status]],
      });
      batchUpdates.push({
        range: `${sheetName}!${colLetter(totalPriceColIndex + 1)}${rowNum}`,
        values: [[listing.totalPrice ?? '']],
      });
    } else {
      // 新規行
      listing.status = '新着';
      appendRows.push(toSheetRow(listing));
      stats.added++;
    }
  }

  // 販売終了チェック: 既存URLが今回の取得リストに含まれていない場合
  for (const [url, rowNum] of urlToRowNum) {
    if (!scrapedUrls.has(url)) {
      const existingRow = existingRows[rowNum - 2];
      if (existingRow[statusColIndex] !== '販売終了') {
        batchUpdates.push({
          range: `${sheetName}!${colLetter(statusColIndex + 1)}${rowNum}`,
          values: [['販売終了']],
        });
        stats.ended++;
      }
    }
  }

  // バッチ更新
  if (batchUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: batchUpdates,
      },
    });
  }

  // 新規行の追記
  if (appendRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:O`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appendRows },
    });
  }

  return stats;
}

// =========================================================
// ヘルパー
// =========================================================

/** ヘッダー行の確認・作成 */
async function ensureHeader(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:O1`,
  });
  const firstRow = res.data.values?.[0] ?? [];
  if (firstRow.length === 0 || firstRow[0] !== SHEET_HEADERS[0]) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [SHEET_HEADERS] },
    });
  }
}

/** CarListing → SheetRow 変換 */
function toSheetRow(l: CarListing): SheetRow {
  return [
    l.status,
    l.totalPrice !== null ? String(l.totalPrice) : '',
    l.basePrice !== null ? String(l.basePrice) : '',
    l.year !== null ? String(l.year) : '',
    l.mileage !== null ? String(l.mileage) : '',
    l.inspectionExpiry ?? '',
    l.repairHistory ?? '',
    l.color ?? '',
    l.shopName ?? '',
    l.location ?? '',
    l.source,
    l.url,
    l.vehicleIdSuffix ?? '',
    l.scrapedAt,
  ];
}

/** 列番号（1始まり）→ A, B, C .... Z, AA ... */
function colLetter(n: number): string {
  let result = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}
