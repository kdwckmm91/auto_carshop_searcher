import { Browser, Page } from 'playwright';
import { CarListing } from '../types';

/** 各サイトのスクレイパーが実装すべきインターフェース（アダプターパターン） */
export interface SiteScraper {
  /** サイト識別名（ログ・ステータス表示用） */
  readonly siteName: string;

  /**
   * 検索・巡回を実行し、全ページ分の車両情報を返す。
   * @param browser Playwright ブラウザインスタンス
   * @returns 取得した車両リスト（0件でも空配列を返す）
   */
  scrape(browser: Browser): Promise<Omit<CarListing, 'status'>[]>;
}

// =========================================================
// 共通ユーティリティ
// =========================================================

/** ランダムな待機時間 (ms) をスリープ */
export function sleep(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 価格文字列（整数部＋小数部）を万円の数値に変換する。
 * @param main 整数部のテキスト（例: "116"）
 * @param sub  小数部のテキスト（例: ".8" または "8"）
 * @returns 数値（例: 116.8）、変換不可の場合は null
 */
export function parsePrice(main: string, sub?: string): number | null {
  const mainClean = main.replace(/[^0-9]/g, '');
  if (!mainClean) return null;
  const subClean = sub ? sub.replace(/[^0-9]/g, '') : '';
  const combined = subClean ? `${mainClean}.${subClean}` : mainClean;
  const val = parseFloat(combined);
  return isNaN(val) ? null : val;
}

/**
 * 走行距離文字列を万km の数値に変換する。
 * 例: "2.4万km" → 2.4 / "28,000km" → 2.8
 */
export function parseMileage(text: string): number | null {
  // "x.x万km" 形式
  const manMatch = text.match(/([\d.]+)\s*万/);
  if (manMatch) return parseFloat(manMatch[1]);

  // "xxx,xxxkm" or "xxxxxkm" 形式（km単位）
  const kmMatch = text.match(/([\d,]+)\s*km/i);
  if (kmMatch) {
    const km = parseFloat(kmMatch[1].replace(/,/g, ''));
    return isNaN(km) ? null : km / 10000;
  }
  return null;
}

/** URL が相対パスであれば baseUrl を付加して絶対パスにする */
export function toAbsoluteUrl(href: string | null, baseUrl: string): string {
  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  const base = new URL(baseUrl);
  return new URL(href, base.origin).toString();
}

/**
 * 現在時刻を日本時間 (JST, UTC+9) で ISO 8601 形式の文字列として返す。
 * 例: "2026-03-11T14:30:00+09:00"
 */
export function nowJst(): string {
  const d = new Date();
  // UTC+9 に補正したオフセット付き文字列を生成
  const jstOffset = 9 * 60; // 分
  const localOffset = d.getTimezoneOffset(); // 分（UTC-local、UTCより西が正）
  const diff = (jstOffset + localOffset) * 60 * 1000;
  const jst = new Date(d.getTime() + diff);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}` +
    `T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}+09:00`
  );
}

/** ページネーション共通: 「次へ」ボタンをクリックして次ページへ遷移するか判定 */
export async function clickNextPageIfExists(
  page: Page,
  selector: string
): Promise<boolean> {
  const btn = page.locator(selector).first();
  const visible = await btn.isVisible().catch(() => false);
  if (!visible) return false;
  const disabled = await btn.isDisabled().catch(() => false);
  if (disabled) return false;
  await btn.click();
  return true;
}
