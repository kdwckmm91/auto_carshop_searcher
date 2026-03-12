import { Browser, Page } from 'playwright';
import { CarListing, ScraperConfig } from '../types';
import {
  SiteScraper,
  sleep,
  parsePrice,
  parseMileage,
  toAbsoluteUrl,
  clickNextPageIfExists,
  nowJst,
} from './base';

// =========================================================
// 定数
// =========================================================

const SITE_NAME = 'カーセンサー';
const BASE_DOMAIN = 'https://www.carsensor.net';

/**
 * ScraperConfig からカーセンサーの検索URLを組み立てる。
 * AR（エリアコード）の区切り文字 '*' が URLSearchParams でエンコードされないよう
 * params.toString().replace(/%2A/g, '*') で元に戻す。
 */
function buildSearchUrl(scraperConfig: ScraperConfig): string {
  const baseUrl = 'https://www.carsensor.net/usedcar/search.php';
  const params = new URLSearchParams({
    STID: 'CS210610',
    CARC: 'HO_S094',
    YMIN: scraperConfig.yearMin.toString(),
    AR: scraperConfig.areaCodes.join('*'),
    SMAX: scraperConfig.mileageMax.toString(),
    CL: scraperConfig.blackColor ? 'BK' : '',
    OPTCD: scraperConfig.repairHistory ? 'REP0' : 'REP1',
    ASSESS: scraperConfig.assessment ? '1' : '0',
    CSHOSHO: scraperConfig.afterWarranty ? '1' : '0',
  });
  // URLSearchParams が '*' を '%2A' にエンコードするため元に戻す
  return baseUrl + '?' + params.toString().replace(/%2A/g, '*');
}

// =========================================================
// カーセンサー スクレイパー
// =========================================================

export class CarsensorScraper implements SiteScraper {
  readonly siteName = SITE_NAME;

  private readonly delayMinMs: number;
  private readonly delayMaxMs: number;
  private readonly headless: boolean;
  private readonly scraperConfig: ScraperConfig;

  constructor(headless: boolean, delayMinMs: number, delayMaxMs: number, scraperConfig: ScraperConfig) {
    this.headless = headless;
    this.delayMinMs = delayMinMs;
    this.delayMaxMs = delayMaxMs;
    this.scraperConfig = scraperConfig;
  }

  async scrape(browser: Browser): Promise<Omit<CarListing, 'status'>[]> {
    const page: Page = await browser.newPage();
    const results: Omit<CarListing, 'status'>[] = [];
    const searchUrl = buildSearchUrl(this.scraperConfig);

    try {
      console.log(`  [${SITE_NAME}] 検索URL へ遷移: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      let pageNum = 1;

      while (true) {
        console.log(`  [${SITE_NAME}] ページ ${pageNum} を処理中...`);

        // カセット一覧が描画されるまで待機
        await page
          .waitForSelector('div.cassette.js_listTableCassette', { timeout: 30000 })
          .catch(() => {
            // 0件ページでも継続
          });

        // 1ページ分の車両情報を抽出
        const pageResults = await this.extractPage(page);
        results.push(...pageResults);
        console.log(`  [${SITE_NAME}] ${pageResults.length} 件取得`);

        // 次ページボタンの有無を確認
        const nextBtn = page.locator('button.pager__btn__next').first();
        const nextVisible = await nextBtn.isVisible().catch(() => false);
        const nextDisabled = await nextBtn.isDisabled().catch(() => false);
        if (!nextVisible || nextDisabled) break;

        // クリックとdomcontentloadedをPromise.allで同時待機し、
        // 旧ページ要素が残ったまま waitForSelector に到達するレースを防ぐ
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: 30000 }),
          nextBtn.click(),
        ]).catch(() => {});

        pageNum++;
        await sleep(this.delayMinMs, this.delayMaxMs);

        // 新ページの車両リストが描画されるまで待機
        await page
          .waitForSelector('div.cassette.js_listTableCassette', { timeout: 30000 })
          .catch(() => {});
      }
    } finally {
      await page.close();
    }

    return results;
  }

  // =========================================================
  // ページ内の車両情報抽出
  // =========================================================

  private async extractPage(
    page: Page
  ): Promise<Omit<CarListing, 'status'>[]> {
    const now = nowJst();

    return page.evaluate(
      ({ baseDomain, siteName, now }: { baseDomain: string; siteName: string; now: string }) => {
        const containers = Array.from(
          document.querySelectorAll('div.cassette.js_listTableCassette')
        );

        return containers.map((el) => {
          // ----- 車種・グレード / URL -----
          const titleAnchor = el.querySelector<HTMLAnchorElement>(
            'h3.cassetteMain__title a'
          );
          const href = titleAnchor?.getAttribute('href') ?? '';
          const url = href.startsWith('http')
            ? href
            : `${baseDomain}${href}`;

          // ----- 支払総額 -----
          const tpMain =
            el.querySelector('.totalPrice__mainPriceNum')?.textContent?.trim() ?? '';
          const tpSub =
            el.querySelector('.totalPrice__subPriceNum')?.textContent?.trim() ?? '';
          const totalPriceStr = tpSub
            ? `${tpMain.replace(/[^0-9]/g, '')}.${tpSub.replace(/[^0-9]/g, '')}`
            : tpMain.replace(/[^0-9]/g, '');
          const totalPrice = totalPriceStr ? parseFloat(totalPriceStr) : null;

          // ----- 本体価格 -----
          const bpMain =
            el.querySelector('.basePrice__mainPriceNum')?.textContent?.trim() ?? '';
          const bpSub =
            el.querySelector('.basePrice__subPriceNum')?.textContent?.trim() ?? '';
          const basePriceStr = bpSub
            ? `${bpMain.replace(/[^0-9]/g, '')}.${bpSub.replace(/[^0-9]/g, '')}`
            : bpMain.replace(/[^0-9]/g, '');
          const basePrice = basePriceStr ? parseFloat(basePriceStr) : null;

          // ----- スペック情報（キー・バリュースキャン） -----
          let year: number | null = null;
          let mileage: number | null = null;
          let inspectionExpiry: string | null = null;
          let repairHistory: string | null = null;
          let color: string | null = null;

          const dtElements = Array.from(el.querySelectorAll('dl dt'));
          for (const dt of dtElements) {
            const key = dt.textContent?.trim() ?? '';
            const dd = dt.nextElementSibling;
            if (!dd) continue;

            const val = dd.textContent?.trim() ?? '';

            if (key.includes('年式')) {
              const m = val.match(/(\d{4})/);
              if (m) year = parseInt(m[1], 10);
            } else if (key.includes('走行距離')) {
              // "2.4万km" or "24,000km"
              const manM = val.match(/([\d.]+)\s*万/);
              const kmM = val.match(/([\d,]+)\s*km/i);
              if (manM) {
                mileage = parseFloat(manM[1]);
              } else if (kmM) {
                const km = parseFloat(kmM[1].replace(/,/g, ''));
                mileage = isNaN(km) ? null : km / 10000;
              }
            } else if (key.includes('車検')) {
              inspectionExpiry = val;
            } else if (key.includes('修復歴')) {
              repairHistory = val;
            } else if (key.includes('色') || key.includes('カラー')) {
              color = val;
            }
          }

          // ----- 在庫場所 -----
          const locationEls = Array.from(
            el.querySelectorAll('.cassetteSub__area p')
          );
          const location =
            locationEls.length > 0
              ? locationEls.map((e) => e.textContent?.trim() ?? '').join(' ')
              : null;

          // ----- 店舗名 -----
          const shopAnchor = el.querySelector<HTMLAnchorElement>(
            '.cassetteSub__shop p.js_shop a'
          );
          const shopName =
            shopAnchor?.textContent?.trim() ??
            el.querySelector('.cassetteSub__shop p')?.textContent?.trim() ??
            null;

          return {
            totalPrice: isNaN(totalPrice as number) ? null : totalPrice,
            basePrice: isNaN(basePrice as number) ? null : basePrice,
            year,
            mileage,
            inspectionExpiry,
            repairHistory,
            color,
            location,
            shopName,
            source: siteName,
            url,
            scrapedAt: now,
          };
        });
      },
      { baseDomain: BASE_DOMAIN, siteName: SITE_NAME, now }
    );
  }
}
