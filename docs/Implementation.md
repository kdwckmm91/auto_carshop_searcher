# 変更要望書

#　カーセンサーの検索URL生成ロジック
URL作成時に、に追加するパラメータを関数で組み立てるようにしてください
Configで検索条件を指定できるようにするため、URLのクエリパラメータを動的に生成するロジックが必要です。
例えば、以下のような関数を実装して、必要なパラメータを組み立てることができます。
```typescript
function buildSearchUrl(config: ScraperConfig): string {
  const baseUrl = 'https://www.carsensor.net/usedcar/search.php';
  const params = new URLSearchParams({
    STID: 'CS210610',
    CARC: 'HO_S094',
    YMIN: config.yearMin.toString(),
    AR: config.areaCodes.join('*'),
    SMAX: config.mileageMax.toString(),
    OPTCD: config.repairHistory ? 'REP0' : 'REP1',
    ASSESS: config.assessment ? '1' : '0',
    CSHOSHO: config.afterWarranty ? '1' : '0',
  });
  return `${baseUrl}?${params.toString()}`;
}
```
この関数は、`ScraperConfig` というインターフェースを受け取り、そこから必要なクエリパラメータを組み立ててURLを生成します。これにより、将来的に検索条件を変更する際も、コードの修正が容易になります。

#　グーネットの検索条件追加
グーネットで検索する際の条件を追加します
/Users/kuwekcm91/Documents/GitHub/auto_carshop_searcher/docs/site_architecture/goonet.md
で定義されている検索条件入力のステージ1に、以下の条件を追加し、実装してください。
- **ブラック系(車体色):** `input#check_color_30` を `check()` して選択する。これにより、車体色が黒の車両のみを検索対象とすることができます。
- **グー鑑定:** `input#check_goo_hosho` を `check()` して選択する。これにより、グー鑑定（車両品質評価書）がある車両のみを検索対象とすることができます。
- **評価書付き:** `input#check_certificate` を `check()` して選択する。これにより、車両品質評価書がある車両のみを検索対象とすることができます。
- **グー保証:** `input#check_goo_hosho_flg` を `check()` して選択する。これにより、グー保証がある車両のみを検索対象とすることができます。

# グーネットの検索ロジックの修正
グーネットの検索条件もカーネットと同じように、検索条件をConfigで指定できるようにしてください
グーネットの検索条件も、カーセンサーと同様にConfigで指定できるようにするため、検索条件の入力ロジックを関数化し、Configから条件を読み取って動的に入力するようにしてください。これにより、将来的に検索条件を変更する際も、コードの修正が容易になります。
例えば、以下のような関数を実装して、検索条件の入力を行うことができます。
```typescript
    function inputSearchConditions(page: Page, config: ScraperConfig): Promise<void> {
      // 年式設定
      await page.selectOption('select#select_nen1', config.yearMin.toString());
      // 走行距離設定
      await page.selectOption('select[name="select_so_max"]', config.mileageMax.toString());
      // 修復歴設定
      await page.selectOption('select#check_restored', config.repairHistory ? '1' : '0');
      // 車両品質評価書あり
      if (config.assessment) {
        await page.check('input#check_certificate');
      }
      // グー保証
      if (config.afterWarranty) {
        await page.check('input#check_goo_hosho_flg');
      }
      // ブラック系(車体色)
      if (config.blackColor) {
        await page.check('input#check_color_30');
      }
    }
```
この関数は、Playwrightの `Page` オブジェクトと `ScraperConfig` を受け取り、そこから必要な検索条件を入力します。これにより、検索条件の管理が一元化され、コードの可読性と保守性が向上します。

#　グーネットの検索結果のページネーションロジック
グーネットの検索結果ページで、複数ページにわたる結果を取得するためのページネーションロジックを追加してください。
グーネットの検索結果ページには、複数ページにわたる結果が表示されることがあります。これらのすべての結果を取得してください
- **次へ:** 検索結果のページネーションを実装するため、検索結果ページの下部にある「次へ」ボタン（セレクタ: `div.paging a:has-text("次へ")`）をクリックして、次のページに遷移するロジックを追加してください。これにより、複数ページにわたる検索結果をすべて取得できるようになります。
  - **次へ** の実装は、検索結果が表示された後に、ページ下部の「次へ」ボタンが存在するかを確認し、存在する場合はクリックして次のページに遷移するロジックを追加してください。これにより、複数ページにわたる検索結果をすべて取得できるようになります。

# HTML構造のセレクタ定義（整理済）

実装の際は、以下の定義表を定数クラスまたはConfigファイルとして切り出し、メンテナンス性を確保してください。

| 項目 | グーネット セレクタ | カーセンサー セレクタ |
| --- | --- | --- |
| **Container** | `div.box_item_detail` | `div.cassette.js_listTableCassette` |
| **支払総額** | `.payment-amount + .num-red em` | `.totalPrice__mainPriceNum` |
| **店舗住所** | `.dealerDetailShopInfo address p` | `.cassetteSub__area p` |
| **次へボタン** | `div.paging a:has-text("次へ")` | `button.pager__btn__next` |

※グーネットの住所取得時は「住所：」の文字列置換処理を共通関数として実装してください。

### 実装時の技術的注意点

実装にあたっては、各サイトの動的挙動によるエラーを防ぐため、以下の4点を必ず考慮してください。

1. **カーセンサー：URLパラメータのエンコード処理**
   `URLSearchParams` を使用してエリアコード（AR）を組み立てる際、区切り文字の `*` が `%2A` にエンコードされる場合があります。サイトの仕様により検索エラーとなる可能性があるため、必要に応じて以下のように生の `*` に戻す処理を検討してください。
   `const url = baseUrl + '?' + params.toString().replace(/%2A/g, '*');`

2. **グーネット：動的要素の表示待機（アコーディオン）**
   「車体色（ブラック系）」や「グー鑑定」などのチェックボックスは、ページ読み込み直後に非表示、あるいはJSで動的に生成される場合があります。
   操作前に「さらに詳しい条件を指定する」ボタン等のクリック、および `page.waitForSelector('#check_color_30', { state: 'visible' })` による待機処理を必ず挟んでください。

3. **グーネット：ページネーション後の状態確定**
   グーネットの「次へ」ボタンはJavaScript（`JumpPage`関数）による遷移です。クリック後はURLの書き換えを待つのではなく、`page.waitForLoadState('networkidle')` か、新しいページの車両コンテナ（`div.box_item_detail`）がDOMに再描画されるのを待機してください。

4. **セレクタ定義の共通化とデータクレンジング**
   - セレクタは文字列定数として定義し、属性取得（`getAttribute`）やテキスト加工ロジックはスクレイパーの共通メソッドとして分離してください。
   - 特にグーネットの店舗住所（`innerText`）に含まれる「住所：」などの不要なラベル文字列は、取得時に `.replace()` で除去する処理を共通化してください。