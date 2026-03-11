## 1. カーセンサー検索URL解析
* URL: https://www.carsensor.net/usedcar/search.php?STID=CS210610&CARC=HO_S094&YMIN=2020&AR=35*34*33*36&SMAX=50000&CL=BK

* `CARC=HO_S094`: 車種コード（ホンダ N-BOX）
* `YMIN=2020`: 年式下限（2020年）
* `SMAX=50000`: 走行距離上限（50,000km）
* `AR=35*34*33*36`: 地域コード（関東圏など複数指定）
* `CL=BK`: ボディカラー（ブラック系）
* `OPTCD=REP0`: 修復歴なし（Repair 0）
* `ASSESS=1`: 車両品質評価書付き（第三者機関によるチェック済み）
* `CSHOSHO=1`: カーセンサーアフター保証対象車
---

## 2. 抽出データ・セレクタ一覧

### コンテナ (1台分の枠)

* `div.cassette.js_listTableCassette`

### 項目別詳細

| 項目名 | セレクタ (Container内からの相対パス) | 抽出のポイント |
| --- | --- | --- |
| **商品ID** | `(attr: id)` | `AU6853316287_cas` からID部分のみ抽出可能 |
| **車種・グレード** | `h3.cassetteMain__title a` | `innerText` を取得 |
| **詳細URL** | `h3.cassetteMain__title a` | `href` 属性を取得。絶対パスへの変換が必要 |
| **支払総額** | `.totalPrice__mainPriceNum` + `.totalPrice__subPriceNum` | 整数部と小数部を結合して数値化（例: `116` + `.8`） |
| **車両本体価格** | `.basePrice__mainPriceNum` + `.basePrice__subPriceNum` | 同上（例: `109` + `.0`） |
| **年式** | `dt:has-text("年式") + dd .specList__emphasisData` | `2023` などの数値を取得 |
| **走行距離** | `dt:has-text("走行距離") + dd .specList__emphasisData` | `2.4` などの数値を取得 |
| **車検期限** | `dt:has-text("車検") + dd` | `2026(R08)年09月` などの文字列を取得 |
| **修復歴** | `dt:has-text("修復歴") + dd` | `なし` などの文字列を取得 |
| **在庫場所** | `.cassetteSub__area p` | 配列で取得（例: `["神奈川県", "横浜市都筑区"]`） |
| **販売店名** | `.cassetteSub__shop p.js_shop a` | `innerText` を取得 |
| **次へ** | `button.pager__btn__next` | 新しいURLへの遷移 |
---

## 3. 実装上の注意点（ライブコーディング用メモ）

> [!IMPORTANT]
> **価格の結合ロジック**
> カーセンサーの価格表示は、整数部分（116）と小数部分（.8）が別々のタグに分かれています。
> ```typescript
> const main = el.querySelector('.totalPrice__mainPriceNum')?.textContent || "0";
> const sub = el.querySelector('.totalPrice__subPriceNum')?.textContent || "";
> const totalPrice = parseFloat(main + sub); // 116.8
> 
> ```
> 
> 

> [!NOTE]
> **スペック情報の取得方法**
> 年式や走行距離は `dl > dt + dd` の構造になっています。
> Playwrightの `page.evaluate` 内で `dt` のテキストを判定して、その次の `dd` を取る「キー・バリュースキャン」が最も堅牢です。