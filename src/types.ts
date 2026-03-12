// ===========================
// 型定義
// ===========================

/** 車両リストのステータス */
export type ListingStatus = '新着' | '値下げ' | '継続' | '販売終了';

/** スクレイピングで取得した1台分の車両情報 */
export interface CarListing {
  /** ステータス（前回データとの比較結果） */
  status: ListingStatus;
  /** 支払総額（万円）。取得不可の場合は null */
  totalPrice: number | null;
  /** 車両本体価格（万円）。取得不可の場合は null */
  basePrice: number | null;
  /** 年式（例: 2021）。取得不可の場合は null */
  year: number | null;
  /** 走行距離（万km）。取得不可の場合は null */
  mileage: number | null;
  /** 車検期限（例: "2026年3月"）。取得不可の場合は null */
  inspectionExpiry: string | null;
  /** 修復歴（例: "なし"）。取得不可の場合は null */
  repairHistory: string | null;
  /** 外装色（例: "ブラック"）。取得不可の場合は null */
  color: string | null;
  /** 店舗名（例: "ネクステージ 横浜都筑店"） */
  shopName: string | null;
  /** 在庫場所・店舗住所（例: "神奈川県横浜市都筑区"）。取得不可の場合は null */
  location: string | null;
  /** 取得元サイト（例: "カーセンサー"） */
  source: string;
  /** 詳細ページの URL */
  url: string;
  /** 取得日時（ISO 8601形式） */
  scrapedAt: string;
}

/** スプレッドシートの1行分のデータ（ヘッダー順） */
export type SheetRow = [
  string,       // ステータス
  string,       // 支払総額
  string,       // 本体価格
  string,       // 年式
  string,       // 走行距離
  string,       // 車検期限
  string,       // 修復歴
  string,       // 外装色
  string,       // 店舗名
  string,       // 在庫場所
  string,       // 取得元サイト
  string,       // URL
  string,       // 取得日時
  string        // スコア
];

export const SHEET_HEADERS: SheetRow = [
  'ステータス',
  '支払総額(万円)',
  '本体価格(万円)',
  '年式',
  '走行距離(万km)',
  '車検期限',
  '修復歴',
  '外装色',
  '店舗名',
  '在庫場所',
  '取得元サイト',
  'URL',
  '取得日時',
  'スコア',
];

/**
 * バリュー効率スコアを算出する。
 *
 * Score = (残走行距離[万km] + 残耐用年数[万km換算]) / 支払総額[万円]
 *
 * - 期待寿命: 15万km
 * - 期待耐用年数: 15年（α=1万km/年）
 * - 数値が高いほど「1万円あたりの残存価値」が大きい（割安）
 */
export function calcScore(
  totalPrice: number | null,
  mileage: number | null,
  year: number | null
): number | null {
  if (totalPrice === null || totalPrice <= 0) return null;
  if (mileage === null || year === null) return null;
  const currentYear = new Date().getFullYear();
  const remainingMileage = 15 - mileage;
  const remainingYears = Math.max(0, 15 - (currentYear - year));
  const raw = (remainingMileage + remainingYears) / totalPrice;
  return Math.round(raw * 1000) / 1000;
}

/** スクレイパー共通の検索条件（config.json で設定） */
export interface ScraperConfig {
  /** 年式下限（例: 2020） */
  yearMin: number;
  /** 走行距離上限（km 単位、例: 50000） */
  mileageMax: number;
  /** エリアコード一覧（カーセンサー用、例: ["35","34","33","36"]） */
  areaCodes: string[];
  /** 都道府県コード一覧（グーネット用、例: ["13","11","14","12"]） */
  prefCodes: string[];
  /** 修復歴なし（true = なし） */
  repairHistory: boolean;
  /** 車両品質評価書あり */
  assessment: boolean;
  /** アフター保証対象車 */
  afterWarranty: boolean;
  /** 車体色ブラック系 */
  blackColor: boolean;
  /** グー鑑定あり（グーネット専用） */
  gooKante: boolean;
}

/** config.json の構造 */
export interface Config {
  /** 書き込み先スプレッドシートID */
  spreadsheet_id: string;
  /** 書き込み先シート名 */
  sheet_name: string;
  /** LINE Notify アクセストークン */
  line_token: string;
  /** ヘッドレスモード（true = 画面非表示） */
  headless: boolean;
  /** ページ遷移待機時間 最小値 (ms) */
  delay_min_ms: number;
  /** ページ遷移待機時間 最大値 (ms) */
  delay_max_ms: number;
  /** 有効にするスクレイパー（順序が巡回優先度） */
  enabled_scrapers: Array<'carsensor' | 'goonet' | 'nextage' | 'gulliver'>;
  /** スクレイパー共通の検索条件 */
  scraper_config: ScraperConfig;
}

/** Sheets 書き込み結果の集計 */
export interface WriteStats {
  added: number;
  priceDown: number;
  ended: number;
  unchanged: number;
}
