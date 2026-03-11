# ARCHITECTURE.md

中古車自動巡回・通知システム（N-BOX）のコード構造と設計方針を記述する。

## ディレクトリ構成

```
auto_carshop_searcher/
├── src/                          # TypeScript ソース
│   ├── index.ts                  # エントリーポイント・メイン処理フロー
│   ├── config.ts                 # config.json 読み込み・バリデーション
│   ├── types.ts                  # 型定義 (CarListing, Config, ScraperConfig 等)
│   ├── deduplicator.ts           # 重複排除（名寄せ）ロジック
│   ├── sheets.ts                 # Google Sheets への読み書き
│   ├── notifier.ts               # LINE Notify 通知
│   ├── logger.ts                 # ログ出力（コンソール + ファイル）
│   └── scrapers/
│       ├── index.ts              # スクレイパー一覧の re-export
│       ├── base.ts               # SiteScraper インターフェース + 共通ユーティリティ
│       ├── carsensor.ts          # カーセンサー スクレイパー
│       ├── goonet.ts             # グーネット スクレイパー
│       ├── nextage.ts            # ネクステージ スクレイパー
│       └── gulliver.ts           # ガリバー スクレイパー
├── dist/                         # tsc ビルド出力（.gitignore 対象）
├── logs/                         # 実行ログ（.gitignore 対象）
├── docs/
│   ├── REQUIREMENTS.md           # 要件定義
│   ├── Implementation.md         # 実装メモ
│   └── site_architecture/        # 巡回対象サイトの HTML 構造定義
│       ├── goonet.md
│       └── carsensor.md
├── .github/workflows/
│   └── scheduler.yml             # GitHub Actions 定期実行ワークフロー
├── config.json                   # 実行設定（.gitignore 対象）
├── credentials.json              # Google 認証情報（.gitignore 対象）
├── credentials.json.example      # credentials.json テンプレート
├── package.json
└── tsconfig.json
```

## 処理フロー

```
index.ts (main)
  │
  ├─ 1. loadConfig()               config.json を読み込む
  │
  ├─ 2. Scraper インスタンス生成    enabled_scrapers の順に生成
  │
  ├─ 3. chromium.launch()          Playwright ブラウザ起動
  │
  ├─ 4. scraper.scrape() × N サイト
  │       └─ 各サイト: URL遷移 → チェックボックス操作 → ページネーション → 抽出
  │
  ├─ 5. deduplicateListings()      複数サイト間の重複排除
  │
  ├─ 6. writeListings()            Google Sheets へ書き込み・差分検出
  │       └─ 既存URLと突合して 新着/値下げ/継続/販売終了 を判定
  │
  └─ 7. sendLineNotify()           新着・値下げを LINE Notify で通知
```

## モジュール詳細

### `src/scrapers/base.ts` — 共通インターフェース・ユーティリティ

| 識別子 | 種別 | 説明 |
| --- | --- | --- |
| `SiteScraper` | interface | 全スクレイパーが実装するアダプターインターフェース |
| `sleep(min, max)` | function | ランダム待機（ボット検知回避） |
| `parsePrice(main, sub)` | function | 価格文字列 → 万円数値変換 |
| `parseMileage(text)` | function | 走行距離文字列 → 万km数値変換 |
| `toAbsoluteUrl(href, base)` | function | 相対URLを絶対URLへ変換 |
| `nowJst()` | function | 現在時刻をJST (`+09:00`) で返す |
| `clickNextPageIfExists(page, selector)` | function | 「次へ」ボタンが存在すればクリック |

### `src/scrapers/goonet.ts` — グーネット スクレイパー

#### 検索条件適用方式

年式・走行距離・修復歴・エリア・車体色はクエリパラメータ付き URL を直接生成して遷移。
グー鑑定・評価書付き・グー保証の 3 項目のみ、結果表示後にチェックボックスを操作して再絞り込みする。

```
buildSearchUrl()          URLパラメータ構築
↓
page.goto(url)            検索結果ページへ直接遷移
↓
applyOptionalFilters()    グー鑑定/評価書/グー保証のチェックボックス操作 → a.red_btn_search クリック
↓
extractPage() × N ページ  div.box_item_detail を走査して車両情報を抽出
```

#### URL パラメータ対応表

| パラメータ | `ScraperConfig` フィールド | 備考 |
| --- | --- | --- |
| `maker_cd=1020` | 固定値 | Honda |
| `integration_car_cd=10202038\|` | 固定値 | N-BOX |
| `color=30` | `blackColor: true` | ブラック系 |
| `distance2` | `mileageMax` | km 単位 |
| `pref_c` | `prefCodes` | カンマ区切り（エンコードなし） |
| `restored=1` | `repairHistory: true` | 修復歴なし |
| `nen1` | `yearMin` | 年式下限 |
| `lite_top=true` | 固定値 | 検索結果を直接表示 |

### `src/deduplicator.ts` — 重複排除ロジック

複数サイトに同じ車両が掲載されている場合に 1 件に名寄せする。

**同一車両の判定条件（全て AND）:**

1. 年式が一致
2. 走行距離が ±0.5万km 以内
3. 外装色が一致

上記 1〜3 を満たした上で、以下のいずれかを満たす場合に統合:

- **4a**: 店舗名の類似度（Levenshtein距離 ≤ 3）かつ支払総額 ±5万円以内
- **4b**: 車台番号下3桁が一致（両方 non-null の場合のみ）

統合時は `source` フィールドに両サイト名を連結（例: `カーセンサー / グーネット`）。

### `src/sheets.ts` — Google Sheets 連携

認証は `credentials.json`（ローカル）または `GOOGLE_CREDENTIALS_JSON` 環境変数（GitHub Actions）から取得。

**ステータス判定ロジック:**

| 条件 | ステータス |
| --- | --- |
| 既存シートに URL が存在しない | `新着` |
| 既存シートに URL が存在し、支払総額が下がった | `値下げ` |
| 既存シートに URL が存在し、価格変化なし | `継続` |
| 前回あった URL が今回の結果に存在しない | `販売終了` |

### `src/logger.ts` — ログ出力

- コンソール出力とファイル出力（`logs/run_YYYY-MM-DD_HH-MM-SS.log`）を同時実施
- タイムスタンプは JST（`+09:00`）で記録
- レベル: `INFO` / `WARN` / `DEBUG`（`DEBUG` はファイルのみ。`NODE_DEBUG=1` 時はコンソールにも出力）

## 設定と認証

### config.json

`.gitignore` 対象。GitHub Actions では Secrets から `scheduler.yml` 内の `cat > config.json` ヒアドキュメントで動的生成。

### credentials.json

`.gitignore` 対象。GitHub Actions では Secret `GOOGLE_CREDENTIALS_JSON` を環境変数として渡し、`sheets.ts` 内で `process.env.GOOGLE_CREDENTIALS_JSON` から読み取る。

## GitHub Actions

`.github/workflows/scheduler.yml`

- **トリガー**: `cron: '0 */3 * * *'`（UTC 毎 3 時間 = JST 9:00〜翌 6:00）+ `workflow_dispatch`（手動）
- **実行環境**: `ubuntu-latest`、タイムアウト 30 分
- **ステップ**: checkout → Node.js 20 セットアップ → `npm ci` → Playwright Chromium インストール → config.json 生成 → `npm start`

## 依存ライブラリ

| パッケージ | 用途 |
| --- | --- |
| `playwright` | Chromium ブラウザ操作・スクレイピング |
| `googleapis` | Google Sheets API 連携 |
| `axios` | LINE Notify への HTTP POST |
| `typescript` / `ts-node` | TypeScript 実行・ビルド |
