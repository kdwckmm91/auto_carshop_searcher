import { chromium } from 'playwright';
import { loadConfig } from './config';
import { CarListing } from './types';
import {
  CarsensorScraper,
  GoonetScraper,
  NextageScraper,
  GulliverScraper,
  SiteScraper,
  sleep,
} from './scrapers';
import { deduplicateListings } from './deduplicator';
import { writeListings } from './sheets';
import { sendLineNotify, buildNotificationMessage } from './notifier';

// =========================================================
// メイン処理
// =========================================================

async function main(): Promise<void> {
  console.log('==========================================');
  console.log('  中古車自動巡回システム (N-BOX) 起動');
  console.log('==========================================\n');

  // 1. 設定読み込み
  const config = loadConfig();

  const hasSpreadsheet =
    !!config.spreadsheet_id && config.spreadsheet_id !== 'YOUR_SPREADSHEET_ID';
  const hasLineToken =
    !!config.line_token && config.line_token !== 'YOUR_LINE_NOTIFY_TOKEN';

  console.log(`有効スクレイパー: ${config.enabled_scrapers.join(', ')}`);
  console.log(`Spreadsheet: ${hasSpreadsheet ? '設定済み' : '未設定（スキップ）'}`);
  console.log(`LINE Notify: ${hasLineToken ? '設定済み' : '未設定（スキップ）'}\n`);

  // 2. スクレイパーのインスタンス生成（優先順位順）
  const scraperMap: Record<string, SiteScraper> = {
    carsensor: new CarsensorScraper(config.headless, config.delay_min_ms, config.delay_max_ms, config.scraper_config),
    goonet: new GoonetScraper(config.headless, config.delay_min_ms, config.delay_max_ms, config.scraper_config),
    nextage: new NextageScraper(config.headless, config.delay_min_ms, config.delay_max_ms),
    gulliver: new GulliverScraper(config.headless, config.delay_min_ms, config.delay_max_ms),
  };

  const enabledScrapers: SiteScraper[] = config.enabled_scrapers
    .map((name) => scraperMap[name])
    .filter((s): s is SiteScraper => !!s);

  // 3. ブラウザ起動
  const browser = await chromium.launch({ headless: config.headless });
  console.log(`[Browser] 起動 (headless: ${config.headless})\n`);

  const allRaw: Omit<CarListing, 'status'>[] = [];
  let errorCount = 0;

  // 4. 各サイトの巡回
  for (let i = 0; i < enabledScrapers.length; i++) {
    const scraper = enabledScrapers[i];
    console.log(`\n[${i + 1}/${enabledScrapers.length}] ${scraper.siteName} 巡回開始`);

    try {
      const results = await scraper.scrape(browser);
      console.log(`  → 合計 ${results.length} 件取得`);
      allRaw.push(...results);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [ERROR] ${scraper.siteName} の処理中にエラー: ${msg}`);
      errorCount++;
    }

    // サイト間のウェイト
    if (i < enabledScrapers.length - 1) {
      await sleep(config.delay_min_ms, config.delay_max_ms);
    }
  }

  await browser.close();
  console.log('\n[Browser] 終了');

  console.log(`\n[合計] スクレイピング結果: ${allRaw.length} 件（重複排除前）`);

  // 5. フィルタリング: 支払総額未取得・年式範囲外を除外
  const yearMin = config.scraper_config.yearMin;
  const filtered = allRaw.filter((l) => {
    if (l.totalPrice === null) return false;
    if (l.year === null || l.year < yearMin) return false;
    return true;
  });
  console.log(`[合計] フィルタリング後: ${filtered.length} 件（除外: ${allRaw.length - filtered.length} 件）`);

  // 6. 重複排除
  const deduplicated = deduplicateListings(filtered);
  console.log(`[合計] 重複排除後: ${deduplicated.length} 件\n`);

  if (deduplicated.length === 0) {
    console.log('取得件数が 0 件のため処理を終了します');
    return;
  }

  // status を仮設定（writeListings 内で確定させる）
  const listings: CarListing[] = deduplicated.map((l) => ({ ...l, status: '新着' as const }));

  // 7. スプレッドシートへ書き込み
  let notifyListings: CarListing[] = [];
  let priceDownListings: CarListing[] = [];

  if (hasSpreadsheet) {
    console.log('[Sheets] スプレッドシートへ書き込み中...');
    try {
      const stats = await writeListings(config.spreadsheet_id, config.sheet_name, listings);
      console.log(
        `[Sheets] 完了: 新着=${stats.added} / 値下げ=${stats.priceDown} / 販売終了=${stats.ended} / 継続=${stats.unchanged}`
      );
      notifyListings = listings.filter((l) => l.status === '新着');
      priceDownListings = listings.filter((l) => l.status === '値下げ');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Sheets] エラー: ${msg}`);
      errorCount++;
    }
  } else {
    // Sheets未設定でも新着として扱う
    notifyListings = listings;
  }

  // 8. LINE 通知
  if (hasLineToken && (notifyListings.length > 0 || priceDownListings.length > 0)) {
    console.log(`\n[LINE] 通知送信中... (新着: ${notifyListings.length}, 値下げ: ${priceDownListings.length})`);
    try {
      const message = buildNotificationMessage(notifyListings, priceDownListings);
      await sendLineNotify(config.line_token, message);
      console.log('[LINE] 送信完了');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[LINE] エラー: ${msg}`);
      errorCount++;
    }
  } else if (!hasLineToken) {
    // トークン未設定時はコンソールにサマリを表示
    if (notifyListings.length > 0) {
      console.log(`\n--- 新着 ${notifyListings.length} 件 ---`);
      for (const l of notifyListings.slice(0, 10)) {
        console.log(`  [${l.source}] ${l.year ?? '?'}年式 ${l.mileage ?? '?'}万km ${l.totalPrice ?? '?'}万円 ${l.url}`);
      }
    }
  }

  console.log('\n==========================================');
  console.log(`  処理完了 (エラー: ${errorCount} 件)`);
  console.log('==========================================');

  if (errorCount > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('起動エラー:', err);
  process.exit(1);
});
