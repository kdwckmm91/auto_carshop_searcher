# auto_carshop_searcher

中古車自動巡回・通知システム（Honda N-BOX 専用）

複数の中古車サイト（カーセンサー・グーネット・ネクステージ・ガリバー）を定期巡回し、検索条件に合致した車両情報を Google スプレッドシートへ記録、新着・値下げを LINE Notify で通知する。

## 機能

- **複数サイト対応**: カーセンサー / グーネット / ネクステージ / ガリバー
- **検索条件フィルタ**: 年式・走行距離・修復歴・エリア・車体色・グー鑑定・評価書・グー保証
- **重複排除**: 複数サイトで同じ車両が掲載されている場合、1件に名寄せ
- **スプレッドシート連携**: Google Sheets へ新着/値下げ/販売終了/継続を自動更新
- **LINE 通知**: 新着・値下げ発生時に即時通知
- **GitHub Actions 自動実行**: 3時間おとに自動巡回（JST 9:00〜翌 6:00）

## 必要な環境

- Node.js 20 以上
- npm
- Google Cloud サービスアカウント（Sheets API 有効化済み）
- LINE Notify トークン（任意）

## セットアップ

### 1. 依存パッケージのインストール

```bash
cd auto_carshop_searcher
npm ci
npx playwright install chromium
```

### 2. Google 認証情報の作成

1. [Google Cloud Console](https://console.cloud.google.com/) でサービスアカウントを作成し、Google Sheets API を有効化
2. キー（JSON）をダウンロードして `credentials.json` として配置

```bash
cp credentials.json.example credentials.json
# credentials.json を実際の値で編集
```

3. 対象スプレッドシートのサービスアカウントメールアドレスに「編集者」権限を付与

### 3. config.json の作成

```bash
cp config.json.example config.json  # または下記を参考に手動作成
```

```json
{
  "spreadsheet_id": "YOUR_SPREADSHEET_ID",
  "sheet_name": "N-BOX在庫",
  "line_token": "YOUR_LINE_NOTIFY_TOKEN",
  "headless": true,
  "delay_min_ms": 2000,
  "delay_max_ms": 5000,
  "enabled_scrapers": ["carsensor", "goonet"],
  "scraper_config": {
    "yearMin": 2020,
    "mileageMax": 50000,
    "areaCodes": ["35", "34", "33", "36"],
    "prefCodes": ["13", "11", "14", "12"],
    "repairHistory": true,
    "assessment": true,
    "afterWarranty": true,
    "blackColor": true,
    "gooKante": true
  }
}
```

#### config.json フィールド一覧

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `spreadsheet_id` | `string` | 書き込み先スプレッドシートの ID（URL の `/d/〇〇/` 部分） |
| `sheet_name` | `string` | 書き込み先シート名（既存シートが存在する場合は合致させる） |
| `line_token` | `string` | LINE Notify アクセストークン（不要な場合は空文字列） |
| `headless` | `boolean` | `true` で画面非表示モード（本番は `true` 推奨） |
| `delay_min_ms` | `number` | ページ遷移間の待機時間・最小値 (ms) |
| `delay_max_ms` | `number` | ページ遷移間の待機時間・最大値 (ms) |
| `enabled_scrapers` | `string[]` | 有効スクレイパー。順序が巡回優先度。`carsensor` / `goonet` / `nextage` / `gulliver` |

#### scraper_config フィールド一覧

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `yearMin` | `number` | 年式下限（例: `2020`） |
| `mileageMax` | `number` | 走行距離上限（km 単位、例: `50000`） |
| `areaCodes` | `string[]` | カーセンサー用エリアコード |
| `prefCodes` | `string[]` | グーネット用都道府県コード（`13`=東京, `11`=埼玉, `14`=神奈川, `12`=千葉） |
| `repairHistory` | `boolean` | `true` = 修復歴なしのみ |
| `assessment` | `boolean` | `true` = 車両品質評価書付きのみ（グーネット） |
| `afterWarranty` | `boolean` | `true` = グー保証付けられる車両のみ（グーネット） |
| `blackColor` | `boolean` | `true` = ブラック系のみ |
| `gooKante` | `boolean` | `true` = グー鑑定車のみ（グーネット） |

## 実行

### ローカル実行

```bash
npm start
```

### ビルド後に実行

```bash
npm run build
npm run start:built
```

### ログの確認

実行ログは `logs/` ディレクトリに `run_YYYY-MM-DD_HH-MM-SS.log` 形式で保存される（`.gitignore` 対象）。

```bash
tail -f logs/run_*.log
```

## GitHub Actions による自動実行

`.github/workflows/scheduler.yml` で 3 時間おとに自動実行される。

### Secrets の設定

リポジトリの **Settings > Secrets and variables > Actions** で以下を設定する。

| Secret 名 | 値 |
| --- | --- |
| `SPREADSHEET_ID` | Google スプレッドシートの ID |
| `LINE_NOTIFY_TOKEN` | LINE Notify トークン |
| `GOOGLE_CREDENTIALS_JSON` | サービスアカウントキー JSON の中身（ファイルではなく文字列） |

### 手動実行

GitHub リポジトリの **Actions** タブ → 「中古車自動巡回 (N-BOX)」→ **Run workflow**

## スプレッドシートの構造

初回実行時に以下のヘッダー行が自動作成される。

| 列 | 内容 |
| --- | --- |
| ステータス | 新着 / 値下げ / 継続 / 販売終了 |
| 支払総額(万円) | |
| 本体価格(万円) | |
| 年式 | |
| 走行距離(万km) | |
| 車検期限 | |
| 修復歴 | |
| 外装色 | |
| 店舗名 | |
| 在庫場所 | |
| 取得元サイト | カーセンサー / グーネット 等 |
| URL | 車両詳細ページ |
| 車台番号(下3桁) | 重複排除精度向上用 |
| 取得日時 | JST (例: 2026-03-11T14:30:00+09:00) |
