# 日本食品標準成分表（八訂）増補2023年 を共通商品DB（public/product-db/stores/mext.json）に変換する
#   python tools/collect-products/mext.py [本表のxlsx]
# xlsx を省略すると文部科学省のサイトから取得する。値は可食部100gあたり。
# 「Tr」（微量）は0、「-」（未測定）や空欄は null。「(1.2)」のような推定値はそのまま数値として使う。
import json
import os
import re
import sys
import tempfile
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from xlsx import read_sheet  # noqa: E402

PAGE = 'https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html'
XLSX = 'https://www.mext.go.jp/content/20260327-mxt_kagsei-mext-000029402_02.xlsx'  # 第2章（データ）
UPDATED = '2026-03-27'  # 表の更新日（シート1行目に記載）
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'product-db')
GROUPS = {'01': '穀類', '02': 'いも・でん粉', '03': '砂糖・甘味', '04': '豆類', '05': '種実類', '06': '野菜類', '07': '果実類',
          '08': 'きのこ類', '09': '藻類', '10': '魚介類', '11': '肉類', '12': '卵類', '13': '乳類', '14': '油脂類', '15': '菓子類',
          '16': 'し好飲料', '17': '調味料・香辛料', '18': '調理済み流通食品'}
# 成分識別子 → アプリの栄養項目
COLUMNS = {'ENERC_KCAL': 'calories', 'PROT-': 'protein', 'FAT-': 'fat', 'CHOCDF-': 'carbs', 'NACL_EQ': 'salt', 'FIB-': 'fiber'}
# コンビニで買うことの多い一般食品。検索用の別名と、よくある1回分の量（想定。食事登録で変更できる）
COMMON = {
    '12005': ('ゆで卵 ゆでたまご 味付け卵', '1個', 50), '12019': ('だし巻き卵 だし巻たまご', '1パック', 80),
    '12018': ('厚焼き卵 玉子焼き', '1パック', 80), '18033': ('きんぴら', '1パック', 80),
    '18037': ('ひじき煮 ひじきの煮物', '1パック', 70), '18032': ('切干大根', '1パック', 70),
    '18024': ('白和え', '1パック', 70), '18025': ('ごま和え', '1パック', 70), '18029': ('おから 卯の花', '1パック', 70),
    '18035': ('筑前煮', '1パック', 120), '18036': ('肉じゃが', '1パック', 150), '18028': ('豚汁', '1杯', 200),
    '04046': ('納豆', '1パック', 45), '04033': ('豆腐 冷奴', '1パック', 150), '13003': ('牛乳', '1本（200ml）', 206),
    '13025': ('ヨーグルト プレーン', '1個', 100), '07107': ('バナナ', '1本（可食部）', 100), '06016': ('枝豆', '1袋（可食部）', 60),
}


def number(raw):
    s = (raw or '').strip().strip('()（）')
    if s in ('', '-', '*', '…'):
        return None
    if s == 'Tr':
        return 0
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def clean(name, group):
    # 「＜鳥肉類＞ にわとり ［若どり・主品目］ むね…」の分類見出しを除いて読みやすくする
    words = [w for w in re.sub(r'＜[^＞]*＞|［[^］]*］', ' ', name.replace('　', ' ')).split() if not re.fullmatch(r'（[^）]*）', w)]
    # 調理済み流通食品は「和風料理 煮物類 きんぴらごぼう」の先頭2語が分類なので除く
    return ' '.join(words[2:] if group == '18' and len(words) > 2 else words)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if not path:
        path = os.path.join(tempfile.mkdtemp(), 'mext.xlsx')
        req = urllib.request.Request(XLSX, headers={'User-Agent': 'night-log-product-collector/1.0'})
        with urllib.request.urlopen(req, timeout=60) as r, open(path, 'wb') as f:
            f.write(r.read())
    rows = read_sheet(path, '表全体')
    ids = rows[11]
    col = {key: ids.index(code) for code, key in COLUMNS.items()}
    products = []
    for r in rows[12:]:
        if len(r) < 61 or not re.fullmatch(r'\d{5}', r[1] or ''):
            continue
        nutrition = {k: number(r[i]) for k, i in col.items()}
        if nutrition['calories'] is None:
            continue
        alias, portion_label, grams = COMMON.get(r[1], (None, None, None))
        p = {
            'id': 'mext:' + r[1], 'name': clean(r[3], r[0]), 'brand': '食品成分表', 'store': 'mext', 'category': GROUPS.get(r[0], 'その他'),
            'serving': {'amount': 100, 'unit': 'g', 'grams': None}, 'nutrition': nutrition,
            'imageUrl': None, 'sourceUrl': PAGE, 'updatedAt': UPDATED, 'quality': 'standard', 'origin': 'common', 'status': 'active',
            'note': '食品番号 ' + r[1],
        }
        if alias:
            p['keywords'] = alias
            p['portion'] = {'label': portion_label, 'grams': grams}
        products.append(p)
    out = {'schemaVersion': 1, 'store': 'mext', 'storeName': '一般食品（食品成分表）', 'updatedAt': UPDATED, 'sources': [PAGE],
           'note': '日本食品標準成分表（八訂）増補2023年（文部科学省）。可食部100gあたりの一般的な値で、商品ごとの値ではありません'}
    # 1商品1行で書き出す（差分が見やすく、ファイルも小さい）
    with open(os.path.join(ROOT, 'stores', 'mext.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(out, ensure_ascii=False)[:-1] + ', "products": [\n')
        f.write(',\n'.join(json.dumps(p, ensure_ascii=False, separators=(',', ':')) for p in products) + '\n]}\n')
    # index.json の他店舗の行は残し、mext の行だけ差し替える
    index_path = os.path.join(ROOT, 'index.json')
    with open(index_path, encoding='utf-8') as f:
        index = json.load(f)
    entry = {'id': 'mext', 'name': out['storeName'], 'file': 'stores/mext.json', 'updatedAt': UPDATED, 'count': len(products), 'active': len(products)}
    index['stores'] = sorted([s for s in index['stores'] if s['id'] != 'mext'] + [entry], key=lambda s: s['id'])
    index['updatedAt'] = max(s['updatedAt'] for s in index['stores'])
    with open(index_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(index, ensure_ascii=False, indent=1) + '\n')
    print(f'mext: {len(products)}件（目安量つき {sum(1 for p in products if "portion" in p)}件）')


if __name__ == '__main__':
    main()
