import { CarListing } from './types';

// =========================================================
// 重複排除（名寄せ）ロジック
// =========================================================

/**
 * 複数サイトから収集した車両リストを名寄せし、同一車両を1件にまとめる。
 *
 * 同一車両の判定条件（AND）:
 *   1. 年式が一致
 *   2. 走行距離が ±0.5万km 以内
 *   3. 外装色が一致（両方 null の場合もマッチ対象）
 *   条件1〜3 に加えて、以下どちらかを満たす場合に統合:
 *   4a. 店舗名が類似（Levenshtein距離 <= 3）かつ支払総額が ±5万円以内
 *   4b. 車台番号下3桁が一致（両方非 null の場合のみ）
 */
export function deduplicateListings(
  listings: Omit<CarListing, 'status'>[]
): Omit<CarListing, 'status'>[] {
  const merged: Omit<CarListing, 'status'>[] = [];

  for (const candidate of listings) {
    const existing = merged.find((m) => isSameVehicle(m, candidate));
    if (existing) {
      // 既存レコードに取得元サイトを追記
      if (!existing.source.includes(candidate.source)) {
        existing.source = `${existing.source} / ${candidate.source}`;
      }
      // URL が未設定なら補完
      if (!existing.url) existing.url = candidate.url;
    } else {
      merged.push({ ...candidate });
    }
  }

  return merged;
}

// =========================================================
// ユーティリティ
// =========================================================

function isSameVehicle(
  a: Omit<CarListing, 'status'>,
  b: Omit<CarListing, 'status'>
): boolean {
  // 条件1: 年式
  if (a.year !== null && b.year !== null && a.year !== b.year) return false;

  // 条件2: 走行距離（±0.5万km 以内）
  if (a.mileage !== null && b.mileage !== null) {
    if (Math.abs(a.mileage - b.mileage) > 0.5) return false;
  }

  // 条件3: 外装色（両方 null の場合はスキップ）
  if (a.color !== null && b.color !== null && normalizeColor(a.color) !== normalizeColor(b.color)) {
    return false;
  }

  // 条件4a: 店舗名類似 + 価格一致
  const shopSimilar =
    a.shopName !== null &&
    b.shopName !== null &&
    levenshtein(normalize(a.shopName), normalize(b.shopName)) <= 3;

  const priceSimilar =
    a.totalPrice !== null &&
    b.totalPrice !== null &&
    Math.abs(a.totalPrice - b.totalPrice) <= 5;

  if (shopSimilar && priceSimilar) return true;

  return false;
}

/** 色の表記を正規化（スペース・記号除去・小文字化） */
function normalizeColor(color: string): string {
  return color.replace(/[\s・\-_]/g, '').toLowerCase();
}

/** 文字列の正規化（スペース・括弧除去） */
function normalize(s: string): string {
  return s.replace(/[\s　（）()]/g, '').toLowerCase();
}

/** レーベンシュタイン距離 */
function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[la][lb];
}
