## `goonet.md` (Goo-net Scraping Specification - 2026 Rev.)

### 1. ターゲットURL構造（エントリーポイント）

年式・走行距離・修復歴・エリア・車体色はクエリパラメータ付き URL を直接生成して検索結果ページへ遷移する。

* **検索URL（例）:**

```
https://www.goo-net.com/php/search/summary.php?maker_cd=1020&integration_car_cd=10202038%7C&color=30&distance2=50000&pref_c=11,12,13,14&restored=1&nen1=2020&lite_top=true
```

#### URLクエリパラメータ一覧

| パラメータ | 値（例） | 意味 | `ScraperConfig` フィールド |
| --- | --- | --- | --- |
| `maker_cd` | `1020` | メーカー: Honda | 固定値 |
| `integration_car_cd` | `10202038%7C` | 車種: N-BOX | 固定値 |
| `color` | `30` | 車体色: ブラック系 | `blackColor: true` の場合に付与 |
| `distance2` | `50000` | 走行距離上限 (km) | `mileageMax` |
| `pref_c` | `11,12,13,14` | 都道府県: 埼玉・千葉・東京・神奈川 | `prefCodes`（カンマ区切り） |
| `restored` | `1` | 修復歴なし | `repairHistory: true` → `1` |
| `nen1` | `2020` | 年式下限 | `yearMin` |
| `lite_top` | `true` | 検索結果ページを直接表示 | 固定値 |

### 2. スクレイピング・フロー

Playwright を用いたブラウザ操作の順序を以下の通り定義する。

#### ステージ1：オプション条件の適用（チェックボックス操作）

グー鑑定・評価書付き・グー保証の 3 条件はクエリパラメータで指定できないため、
検索結果ページが表示された後にチェックボックスを操作し、絞り込みボタンをクリックする。

1. **検索結果の表示待機:** `div.box_item_detail` が表示されるまで待機。
2. **チェックボックス操作（`config` の設定に応じて）:**
   - `gooKante: true` → `input#check_goo_hosho` を `check()`
   - `assessment: true` → `input#check_certificate` を `check()`
   - `afterWarranty: true` → `input#check_goo_hosyou_flg` を `check()`
3. **再絞り込み:** いずれかの条件を有効化した場合、`a.red_btn_search`（絞り込みボタン）をクリックし、`div.box_item_detail` の再表示を待機する。

#### ステージ2：データ抽出

1. **ループ実行:** コンテナ要素（`div.box_item_detail`）を走査し、各項目のテキストを抽出する。
2. **ページネーション:** `div.page_ctrl` 内の「次へ」リンクが存在する限りクリックし、ステージ2を繰り返す。

### 3. HTML構造定義 (Selector List)

| 項目 | セレクタ / 取得方法 | 抽出・実装のコツ |
| --- | --- | --- |
| **Container** | `div.box_item_detail` | 車両・店舗情報を包含する最上位親要素。ループの起点 |
| **ID** | `input[name="id"]` | `getAttribute('value')` で物件固有IDを取得 |
| **車種名** | `.heading h3 p.ttl` | `innerText` を取得し結合（例：「ホンダ Ｎ－ＢＯＸ」） |
| **グレード/詳細** | `.heading h3 p.txt` | 長文の装備詳細テキスト。検索キーワード含有チェックに有効 |
| **支払総額** | `.payment-amount + .num-red em` | 数値以外を置換して `parseFloat`（例: 119.9） |
| **本体価格** | `.hontai-price:has-text("車両本体価格") .num em` | 同上。諸費用との差分確認に使用 |
| **年式** | `ul > li:has-text("年式")` | テキストから「20XX」を正規表現で抽出 |
| **走行距離** | `ul > li:has-text("走行距離")` | 「4.0万km」等を取得。数値化には加工が必要 |
| **修復歴** | `ul > li:has-text("修復歴")` | 「なし」「あり」を判定 |
| **車体色** | `.sub p:has-text("カラー")` | 「カラー」以降の文字列を取得（例: ブラックパール） |
| **詳細URL** | `.heading h3 a` | `href` を取得し、ドメイン `https://www.goo-net.com` を付加 |
| **評価書(表示)** | `.evaluation_wrap` | 要素の有無で「グー鑑定/評価書あり」を判定 |
| **店舗名** | `.dealer-name a span` | `innerText` を取得。販売店名を特定 |
| **店舗住所** | `.dealerDetailShopInfo address p` | `replace('住所：', '').trim()` でクリーンアップ |
| **店舗URL** | `.dealer-name a` | `href` 属性を取得（例: `/usedcar_shop/...`） |
| **ブラック系(入力)** | `input#check_color_30` | 検索条件設定時に `check()` を実行 |
| **グー鑑定(入力)** | `input#check_goo_hosho` | 同上 |
| **評価書付き(入力)** | `input#check_certificate` | 同上 |
| **グー保証(入力)** | `input#check_goo_hosyou_flg` | `hosyou` (yあり) である点に注意して `check()` |
| **絞り込みボタン** | `a.red_btn_search` | チェックボックス操作後にクリックして一覧を更新 |
| **次へボタン** | `div.page_ctrl li.next a` | `href` への遷移またはクリック。存在しない場合は最終ページ |