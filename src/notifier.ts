import axios from 'axios';
import { CarListing } from './types';

const LINE_NOTIFY_URL = 'https://notify-api.line.me/api/notify';

/** LINE Notify でメッセージを送信する */
export async function sendLineNotify(token: string, message: string): Promise<void> {
  if (!token || token === 'YOUR_LINE_NOTIFY_TOKEN') {
    console.warn('[LINE] トークン未設定のため通知をスキップします');
    return;
  }

  await axios.post(
    LINE_NOTIFY_URL,
    new URLSearchParams({ message }),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
}

// =========================================================
// 通知メッセージ組み立て
// =========================================================

/** 新着・値下げ車両の通知メッセージを作成する */
export function buildNotificationMessage(
  newListings: CarListing[],
  priceDownListings: CarListing[]
): string {
  const lines: string[] = [];

  if (newListings.length > 0) {
    lines.push(`\n🚗 【新着 ${newListings.length}件】`);
    for (const l of newListings.slice(0, 5)) {
      lines.push(formatListing(l));
    }
    if (newListings.length > 5) {
      lines.push(`  ...他 ${newListings.length - 5} 件`);
    }
  }

  if (priceDownListings.length > 0) {
    lines.push(`\n📉 【値下げ ${priceDownListings.length}件】`);
    for (const l of priceDownListings.slice(0, 5)) {
      lines.push(formatListing(l));
    }
    if (priceDownListings.length > 5) {
      lines.push(`  ...他 ${priceDownListings.length - 5} 件`);
    }
  }

  return lines.join('\n');
}

function formatListing(l: CarListing): string {
  const price = l.totalPrice !== null ? `${l.totalPrice}万円` : '価格不明';
  const year = l.year !== null ? `${l.year}年式` : '';
  const mileage = l.mileage !== null ? `${l.mileage}万km` : '';
  const shop = l.shopName ?? '';
  const source = l.source;

  return `  [${source}] ${year} ${mileage} ${price}\n  ${shop}\n  ${l.url}`;
}
