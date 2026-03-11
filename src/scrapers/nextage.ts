import { Browser, Page } from 'playwright';
import { CarListing } from '../types';
import { SiteScraper, sleep, clickNextPageIfExists, nowJst } from './base';

// =========================================================
// 定数
// =========================================================

const SITE_NAME = 'ネクステージ';
const BASE_DOMAIN = 'https://www.nextage.jp';

/**
 * ネクステージ 検索URL
 * - make=HONDA / model=N-BOX
 * - year_from=2020 : 2020年式以降
 * - mileage_to=50000 : 走行距離 5万km以下
 * - no_repair=1 : 修復歴なし
 * - area=13,11,14,12 : 東京・埼玉・神奈川・千葉
 */
const SEARCH_URL =
  'https://www.nextage.jp/buy/search/?CARC=HO_S094&YMIN=2020&SMAX=50000&OPTCD=REP0&AR=35*34*33*36';

// =========================================================
// ネクステージ スクレイパー
// =========================================================

export class NextageScraper implements SiteScraper {
  readonly siteName = SITE_NAME;

  private readonly delayMinMs: number;
  private readonly delayMaxMs: number;

  constructor(_headless: boolean, delayMinMs: number, delayMaxMs: number) {
    this.delayMinMs = delayMinMs;
    this.delayMaxMs = delayMaxMs;
  }

  async scrape(browser: Browser): Promise<Omit<CarListing, 'status'>[]> {
    const page: Page = await browser.newPage();
    const results: Omit<CarListing, 'status'>[] = [];

    try {
      console.log(`  [${SITE_NAME}] 検索URLへ遷移: ${SEARCH_URL}`);
      await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(1500, 2500);

      let pageNum = 1;

      while (true) {
        console.log(`  [${SITE_NAME}] ページ ${pageNum} を処理中...`);

        await page
          .waitForSelector('.vehicle-list__item, .car-item, .list-item', { timeout: 20000 })
          .catch(() => {});

        const pageResults = await this.extractPage(page);
        results.push(...pageResults);
        console.log(`  [${SITE_NAME}] ${pageResults.length} 件取得`);

        const hasNext = await clickNextPageIfExists(
          page,
          'a.pagination__next, a[data-page="next"], .pager_next a'
        );
        if (!hasNext) break;

        pageNum++;
        await sleep(this.delayMinMs, this.delayMaxMs);
      }
    } finally {
      await page.close();
    }

    return results;
  }

  private async extractPage(page: Page): Promise<Omit<CarListing, 'status'>[]> {
    const now = nowJst();

    return page.evaluate(
      ({ baseDomain, siteName, now }: { baseDomain: string; siteName: string; now: string }) => {
        // ネクステージの一覧ページ構造（シンプルなリスト形式）
        const containers = Array.from(
          document.querySelectorAll('.vehicle-list__item, .car-item, .list-item, li.item')
        );

        return containers
          .map((el) => {
            const anchor = el.querySelector<HTMLAnchorElement>('a[href*="/buy/"]');
            const href = anchor?.getAttribute('href') ?? '';
            if (!href) return null;
            const url = href.startsWith('http') ? href : `${baseDomain}${href}`;

            // 価格
            const priceEl = el.querySelector('.price em, .total-price em, .payment em');
            const priceRaw = priceEl?.textContent?.replace(/[^0-9.]/g, '') ?? '';
            const totalPrice = priceRaw ? parseFloat(priceRaw) : null;

            // 年式
            const yearEl = el.querySelector('[class*="year"], [data-label="年式"]');
            const yearText = yearEl?.textContent ?? '';
            const yearM = yearText.match(/20\d{2}/);
            const year = yearM ? parseInt(yearM[0], 10) : null;

            // 走行距離
            const mileageEl = el.querySelector('[class*="mileage"], [data-label="走行距離"]');
            const mileageText = mileageEl?.textContent ?? '';
            const manM = mileageText.match(/([\d.]+)\s*万/);
            const kmM = mileageText.match(/([\d,]+)\s*km/i);
            let mileage: number | null = null;
            if (manM) mileage = parseFloat(manM[1]);
            else if (kmM) {
              const km = parseFloat(kmM[1].replace(/,/g, ''));
              mileage = isNaN(km) ? null : km / 10000;
            }

            // 外装色
            const colorEl = el.querySelector('[class*="color"], [data-label="色"]');
            const color = colorEl?.textContent?.trim() ?? null;

            // 店舗名
            const shopEl = el.querySelector('.shop-name, .store-name, [class*="shop"]');
            const shopName = shopEl?.textContent?.trim() ?? null;

            // 在庫場所
            const locationEl = el.querySelector('.pref, .area, [class*="location"]');
            const location = locationEl?.textContent?.trim() ?? null;

            return {
              totalPrice: isNaN(totalPrice as number) ? null : totalPrice,
              basePrice: null,
              year,
              mileage,
              inspectionExpiry: null,
              repairHistory: 'なし', // 検索条件で修復歴なしを指定
              color,
              location,
              shopName,
              shopAddress: null,
              source: siteName,
              url,
              vehicleIdSuffix: null,
              scrapedAt: now,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
      },
      { baseDomain: BASE_DOMAIN, siteName: SITE_NAME, now }
    );
  }
}
