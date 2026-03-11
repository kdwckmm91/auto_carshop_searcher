import { Browser, Page } from 'playwright';
import { CarListing, ScraperConfig } from '../types';
import { SiteScraper, sleep, clickNextPageIfExists, nowJst } from './base';
import { logDebug, logWarn } from '../logger';

// =========================================================
// 定数
// =========================================================

const SITE_NAME = 'グーネット';
const BASE_DOMAIN = 'https://www.goo-net.com';

/** グーネット 検索結果ページ ベース URL */
const SEARCH_URL_BASE = 'https://www.goo-net.com/php/search/summary.php';
/** グーネット N-BOX の maker_cd (Honda) */
const MAKER_CD = '1020';
/** グーネット N-BOX の integration_car_cd */
const INTEGRATION_CAR_CD = '10202038|';

// =========================================================
// グーネット スクレイパー
// =========================================================

export class GoonetScraper implements SiteScraper {
  readonly siteName = SITE_NAME;

  private readonly delayMinMs: number;
  private readonly delayMaxMs: number;
  private readonly scraperConfig: ScraperConfig;

  constructor(_headless: boolean, delayMinMs: number, delayMaxMs: number, scraperConfig: ScraperConfig) {
    this.delayMinMs = delayMinMs;
    this.delayMaxMs = delayMaxMs;
    this.scraperConfig = scraperConfig;
  }

  async scrape(browser: Browser): Promise<Omit<CarListing, 'status'>[]> {
    const page: Page = await browser.newPage();
    const results: Omit<CarListing, 'status'>[] = [];
    const searchUrl = this.buildSearchUrl();

    try {
      console.log(`  [${SITE_NAME}] 検索URLへ遷移: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });

      // 結果ページが表示されるまで待機
      await page
        .waitForSelector('div.box_item_detail', { timeout: 30000 })
        .catch(() => { logDebug(`[${SITE_NAME}] div.box_item_detail が見つかりません`); });
      logDebug(`[${SITE_NAME}] 結果ページURL: ${page.url()}`);

      // ステージ1: オプション条件（グー鑑定／評価書付き／グー保証）を適用
      await this.applyOptionalFilters(page);
      await sleep(this.delayMinMs, this.delayMaxMs);

      // ステージ2: データ抽出（ページネーション）
      let pageNum = 1;
      while (true) {
        console.log(`  [${SITE_NAME}] ページ ${pageNum} を処理中...`);

        const pageResults = await this.extractPage(page);
        results.push(...pageResults);
        console.log(`  [${SITE_NAME}] ${pageResults.length} 件取得`);

        await this.debugPagination(page);

        const hasNext = await clickNextPageIfExists(
          page,
          'div.page_ctrl a:has-text("次へ")'
        );
        if (!hasNext) break;

        pageNum++;
        await sleep(this.delayMinMs, this.delayMaxMs);

        await page.waitForLoadState('networkidle').catch(() => {});
        await page
          .waitForSelector('div.box_item_detail', { timeout: 30000 })
          .catch(() => {});
      }
    } finally {
      await page.close();
    }

    return results;
  }

  // =========================================================
  // デバッグ: ページネーション状況の確認
  // =========================================================

  private async debugPagination(page: Page): Promise<void> {
    const info = await page.evaluate(() => {
      // クラス名に "pag" または "page" を含む全要素を総当たりする
      const pagingCandidates = Array.from(
        document.querySelectorAll('[class*="paging"], [class*="pagination"], [class*="page_ctrl"], [class*="page-nav"]')
      ).map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: el.className,
        html: el.innerHTML.substring(0, 300),
      }));

      // 「次」を含む全リンク
      const nextLinks = Array.from(document.querySelectorAll('a')
      ).filter((a) => /次/.test(a.textContent ?? '')
      ).map((a) => ({
        text: a.textContent?.trim() ?? '',
        href: (a as HTMLAnchorElement).getAttribute('href') ?? '',
        visible: (a as HTMLElement).offsetParent !== null,
      }));

      return { pagingCandidates, nextLinks };
    });

    if (info.pagingCandidates.length === 0) {
      logDebug(`[${SITE_NAME}] ページング関連要素（[class*="pag"]）が見つかりません`);
    } else {
      for (const p of info.pagingCandidates) {
        logDebug(`[${SITE_NAME}] ページング要素 <${p.tag} class="${p.cls}">: ${p.html}`);
      }
    }
    if (info.nextLinks.length === 0) {
      logDebug(`[${SITE_NAME}] 「次」を含むリンクなし`);
    } else {
      for (const lnk of info.nextLinks) {
        logDebug(`[${SITE_NAME}] "次"リンク: text="${lnk.text}" visible=${lnk.visible} href="${lnk.href.substring(0, 100)}"`);
      }
    }
  }

  // =========================================================
  // URL生成: ScraperConfig からクエリパラメータ付き検索URLを構築
  // =========================================================

  private buildSearchUrl(): string {
    // pref_c はカンマ区切りのままサーバーへ渡すため URLSearchParams を使わず手動結合する
    // （URLSearchParams は "," を "%2C" にエンコードしてしまうため）
    const params = new URLSearchParams({
      maker_cd: MAKER_CD,
      integration_car_cd: INTEGRATION_CAR_CD,
      distance2: this.scraperConfig.mileageMax.toString(),
      restored: this.scraperConfig.repairHistory ? '1' : '0',
      nen1: this.scraperConfig.yearMin.toString(),
      lite_top: 'true',
    });
    if (this.scraperConfig.blackColor) {
      params.set('color', '30');
    }
    // pref_c はエンコードせずカンマ区切りのまま末尾へ付加
    const prefParam = `pref_c=${this.scraperConfig.prefCodes.join(',')}`;
    return `${SEARCH_URL_BASE}?${params.toString()}&${prefParam}`;
  }

  // =========================================================
  // ステージ1: オプション条件の適用（グー鑑定／評価書／グー保証）
  // =========================================================

  private async applyOptionalFilters(page: Page): Promise<void> {
    const targets: Array<{ flag: boolean; id: string; label: string }> = [
      { flag: this.scraperConfig.gooKante,     id: 'check_goo_hosho',     label: 'グー鑑定' },
      { flag: this.scraperConfig.assessment,   id: 'check_certificate',   label: '評価書付き' },
      { flag: this.scraperConfig.afterWarranty, id: 'check_goo_hosyou_flg', label: 'グー保証' },
    ];

    let anyChecked = false;
    for (const { flag, id, label } of targets) {
      if (!flag) continue;
      const success = await page.evaluate((elId: string) => {
        const el = document.getElementById(elId) as HTMLInputElement | null;
        if (!el) return false;
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, id);
      if (success) {
        logDebug(`[${SITE_NAME}] ${label} チェック済み (#${id})`);
        anyChecked = true;
      } else {
        logWarn(`  [${SITE_NAME}] ${label} チェックボックスが見つかりませんでした (#${id})`);
      }
    }

    if (!anyChecked) return;

    // 絞り込みボタンをクリックして再検索
    const submitBtn = page.locator('a.red_btn_search').first();
    const btnVisible = await submitBtn.isVisible().catch(() => false);
    if (btnVisible) {
      await submitBtn.click();
    } else {
      await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        if (typeof w['checkAndSubmitJump'] === 'function') {
          (w['checkAndSubmitJump'] as (s: string) => void)('detail_list');
        }
      }).catch(() => {});
    }

    // 再検索後に結果が表示されるまで待機
    await page.waitForLoadState('networkidle').catch(() => {});
    await page
      .waitForSelector('div.box_item_detail', { timeout: 30000 })
      .catch(() => { logDebug(`[${SITE_NAME}] applyOptionalFilters: div.box_item_detail が見つかりません`); });
    logDebug(`[${SITE_NAME}] オプション条件適用後URL: ${page.url()}`);
  }

  // =========================================================
  // ステージ2: ページ内の車両情報抽出
  // =========================================================

  private async extractPage(page: Page): Promise<Omit<CarListing, 'status'>[]> {
    const now = nowJst();

    return page.evaluate(
      ({ baseDomain, siteName, now }: { baseDomain: string; siteName: string; now: string }) => {
        const containers = Array.from(
          document.querySelectorAll('div.box_item_detail')
        );

        return containers
          .map((el) => {
            // ----- URL -----
            // data-link-list="list_summary" にリンクがある (visual部の画像リンク)
            // フォールバックとして heading h3 a を使用
            const anchor =
              el.querySelector<HTMLAnchorElement>('a[data-link-list="list_summary"]') ??
              el.querySelector<HTMLAnchorElement>('.heading h3 a, h3 a, a[href*="/usedcar/spread/"]');
            const href = anchor?.getAttribute('href') ?? '';
            const url = href.startsWith('http') ? href : href ? `${baseDomain}${href}` : '';
            if (!url) return null;

            // ----- 支払総額 -----
            const paymentEl = el.querySelector('.payment-amount + .num-red em, .num-red em');
            const paymentRaw = paymentEl?.textContent?.replace(/[^0-9.]/g, '') ?? '';
            const totalPrice = paymentRaw ? parseFloat(paymentRaw) : null;

            // ----- 本体価格 -----
            const basePriceEl = el.querySelector('.hontai-price .num em, .hontai em');
            const basePriceRaw = basePriceEl?.textContent?.replace(/[^0-9.]/g, '') ?? '';
            const basePrice = basePriceRaw ? parseFloat(basePriceRaw) : null;

            // ----- スペック情報（li テキストスキャン） -----
            let year: number | null = null;
            let mileage: number | null = null;
            let color: string | null = null;
            let inspectionExpiry: string | null = null;
            let repairHistory: string | null = null;

            const liItems = Array.from(el.querySelectorAll('ul > li'));
            for (const li of liItems) {
              const text = li.textContent?.trim() ?? '';
              if (text.includes('年式')) {
                const m = text.match(/20\d{2}/);
                if (m) year = parseInt(m[0], 10);
              } else if (text.includes('走行距離')) {
                const manM = text.match(/([\d.]+)\s*万/);
                const kmM = text.match(/([\d,]+)\s*km/i);
                if (manM) {
                  mileage = parseFloat(manM[1]);
                } else if (kmM) {
                  const km = parseFloat(kmM[1].replace(/,/g, ''));
                  mileage = isNaN(km) ? null : km / 10000;
                }
              } else if (text.includes('色') || text.includes('カラー')) {
                color = text.replace(/.*[:：]\s*/, '').trim() || null;
              } else if (text.includes('車検')) {
                inspectionExpiry = text.replace(/.*[:：]\s*/, '').trim() || null;
              } else if (text.includes('修復歴')) {
                repairHistory = text.replace(/.*[:：]\s*/, '').trim() || null;
              }
            }

            // ----- 店舗名 -----
            // 実HTML: div.shop2_name > a > ... または .dealer-name a span
            const shopEl =
              el.querySelector<HTMLElement>('.shop2_name a, .dealer-name a span, .dealer-name a');
            const shopName = shopEl?.textContent?.trim() ?? null;

            // ----- 在庫場所（店舗住所を優先、なければエリア情報を使用） -----
            const shopAddressEls = Array.from(el.querySelectorAll('.dealerDetailShopInfo address p'));
            const shopAddress = shopAddressEls.length > 0
              ? shopAddressEls.map((p) => (p.textContent ?? '').replace(/^住所[：:] */u, '').trim()).filter(Boolean).join(' ')
              : null;
            const areaEl = el.querySelector('.area, .pref, .location');
            const location = shopAddress || areaEl?.textContent?.trim() || null;

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
