import * as fs from 'fs';
import * as path from 'path';
import { Config, ScraperConfig } from './types';

const CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');

const DEFAULT_SCRAPER_CONFIG: ScraperConfig = {
  yearMin: 2020,
  mileageMax: 50000,
  areaCodes: ['35', '34', '33', '36'],
  prefCodes: ['13', '11', '14', '12'],
  repairHistory: true,
  assessment: true,
  afterWarranty: true,
  blackColor: true,
  gooKante: true,
};

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`config.json が見つかりません: ${CONFIG_PATH}`);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const cfg = JSON.parse(raw) as Config;

  // 最低限のバリデーション
  if (!Array.isArray(cfg.enabled_scrapers) || cfg.enabled_scrapers.length === 0) {
    throw new Error('config.json の enabled_scrapers が空です');
  }

  return {
    spreadsheet_id: cfg.spreadsheet_id ?? '',
    sheet_name: cfg.sheet_name ?? 'N-BOX在庫',
    line_token: cfg.line_token ?? '',
    headless: cfg.headless ?? true,
    delay_min_ms: cfg.delay_min_ms ?? 2000,
    delay_max_ms: cfg.delay_max_ms ?? 5000,
    enabled_scrapers: cfg.enabled_scrapers,
    scraper_config: { ...DEFAULT_SCRAPER_CONFIG, ...cfg.scraper_config },
  };
}
