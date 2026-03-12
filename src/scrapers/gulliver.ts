import { Browser, Page } from 'playwright';
import { CarListing } from '../types';
import { SiteScraper, sleep, clickNextPageIfExists, nowJst } from './base';

// =========================================================
// 定数
// =========================================================

const SITE_NAME = 'ガリバー';
const BASE_DOMAIN = 'https://www.gulliver.co.jp';

/**
 * ガリバー 検索URL
 * - ホンダ N-BOX / 2020年式以降 / 5万km以下 / 修復歴なし
 */
const SEARCH_URL =
  'https://www.gulliver.co.jp/used/result/?maker=5&car=126&year_from=2020&mileage_to=50000&repair=0&pref%5B%5D=13&pref%5B%5D=11&pref%5B%5D=14&pref%5B%5D=12';

// =========================================================
// ガリバー スクレイパー
// =========================================================

export class GulliverScraper implements SiteScraper {
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
          .waitForSelector('.car-item, .vehicle-item, .result-item', { timeout: 20000 })
          .catch(() => {});

        const pageResults = await this.extractPage(page);
        results.push(...pageResults);
        console.log(`  [${SITE_NAME}] ${pageResults.length} 件取得`);

        const hasNext = await clickNextPageIfExists(
          page,
          'a.next, .pagination a[rel="next"], .pager_next a'
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
        const containers = Array.from(
          document.querySelectorAll('.car-item, .vehicle-item, .result-item')
        );

        return containers
          .map((el) => {
            const anchor = el.querySelector<HTMLAnchorElement>('a[href]');
            const href = anchor?.getAttribute('href') ?? '';
            if (!href) return null;
            const url = href.startsWith('http') ? href : `${baseDomain}${href}`;

            // 価格（支払総額）
            const priceEl = el.querySelector('.total-price em, .price em, .payment-price em');
            const priceRaw = priceEl?.textContent?.replace(/[^0-9.]/g, '') ?? '';
            const totalPrice = priceRaw ? parseFloat(priceRaw) : null;

            // 本体価格
            const basePriceEl = el.querySelector('.vehicle-price em, .base-price em');
            const basePriceRaw = basePriceEl?.textContent?.replace(/[^0-9.]/g, '') ?? '';
            const basePrice = basePriceRaw ? parseFloat(basePriceRaw) : null;

            // 年式
            const yearEls = Array.from(el.querySelectorAll('dl dt, th, [class*="year"]'));
            let year: number | null = null;
            for (const e of yearEls) {
              if (e.textContent?.includes('年式') || e.className?.includes('year')) {
                const sibling = e.nextElementSibling;
                const text = sibling?.textContent ?? e.textContent ?? '';
                const m = text.match(/20\d{2}/);
                if (m) { year = parseInt(m[0], 10); break; }
              }
            }

            // 走行距離
            let mileage: number | null = null;
            const allText = el.textContent ?? '';
            const manM = allText.match(/走行距離[^\d]*([\d.]+)\s*万/);
            const kmM = allText.match(/走行距離[^0-9]*([\d,]+)\s*km/i);
            if (manM) mileage = parseFloat(manM[1]);
            else if (kmM) {
              const km = parseFloat(kmM[1].replace(/,/g, ''));
              mileage = isNaN(km) ? null : km / 10000;
            }

            // 店舗・場所
            const shopEl = el.querySelector('.shop-name, .store, [class*="shop"]');
            const shopName = shopEl?.textContent?.trim() ?? null;
            const locationEl = el.querySelector('.pref, .area, .location');
            const location = locationEl?.textContent?.trim() ?? null;

            // 外装色
            const colorEl = el.querySelector('[class*="color"]');
            const color = colorEl?.textContent?.trim() ?? null;

            return {
              totalPrice: isNaN(totalPrice as number) ? null : totalPrice,
              basePrice: isNaN(basePrice as number) ? null : basePrice,
              year,
              mileage,
              inspectionExpiry: null,
              repairHistory: 'なし',
              color,
              location,
              shopName,
              shopAddress: null,
              source: siteName,
              url,
              scrapedAt: now,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
      },
      { baseDomain: BASE_DOMAIN, siteName: SITE_NAME, now }
    );
  }
}
