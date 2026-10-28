// 共通商品DBの収集スクリプト（アプリ本体とは別に実行する）
//   node tools/collect-products/collect.mjs [familymart] [lawson] [--limit=N]
// 公式サイトに掲載されている栄養成分だけを取り込み、public/product-db/ に書き出す（アプリと一緒に配信され、GitHubでも管理する）。
// 掲載のない項目は null。前回のファイルにあって今回見つからない商品は削除せず status: 'discontinued' にする。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'public', 'product-db');
const UA = 'night-log-product-collector/1.0 (personal nutrition log; low-frequency)';
const WAIT_MS = 800;
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const args = process.argv.slice(2);
const limit = Number(args.find(a => a.startsWith('--limit='))?.slice(8) ?? Infinity);
const only = args.filter(a => !a.startsWith('--'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    await sleep(WAIT_MS);
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) return null;
      if (!r.ok) throw Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (attempt >= 3) { console.warn('  取得失敗', url, e.message); return null; }
    }
  }
}
const entities = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', reg: '®', copy: '©', trade: '™', eacute: 'é', egrave: 'è', agrave: 'à', ocirc: 'ô', times: '×', hellip: '…' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : entities[e] ?? m);
const text = s => decode(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/[\s　]+/g, ' ').trim();
const hash = s => createHash('sha1').update(s.normalize('NFKC')).digest('hex').slice(0, 8);
// "251.7" "1.50g" "204kcal" → number。"-" や "不明" などは null（推測で埋めない）
function num(s) {
  if (s == null) return null;
  const m = text(s).normalize('NFKC').replace(/,/g, '').match(/^(?:約)?(\d+(?:\.\d+)?)\s*(?:kcal|g|mg)?$/i);
  return m ? Number(m[1]) : null;
}
const nutritionKeys = { '熱量': 'calories', 'エネルギー': 'calories', 'たんぱく質': 'protein', '脂質': 'fat', '炭水化物': 'carbs', '食塩相当量': 'salt', '食物繊維': 'fiber' };
const emptyNutrition = () => ({ calories: null, protein: null, fat: null, carbs: null, salt: null, fiber: null });
const hasNutrition = n => Object.values(n).some(v => v != null);

// ---------- ファミリーマート ----------
// 商品詳細ページには栄養成分がほぼ無く、「アレルゲン・栄養成分」ページ（カテゴリ別）にのみ掲載されている。
const famimaPages = [
  ['goods010', 'おむすび'], ['goods020', 'お弁当'], ['goods030', 'お寿司'], ['goods040', 'サンドイッチ・パン'],
  ['goods060', '麺'], ['goods070', 'パスタ'], ['goods080', 'サラダ'], ['goods090', 'チルド惣菜'], ['goods100', 'スープ・グラタン'],
  ['friedfoods', '揚げ物・惣菜'], ['chukaman', '中華まん'], ['oden', 'おでん'], ['cafe', 'カフェ'],
];
function famimaServing(name, category) {
  // 「キャラメルシュガー（1gあたり）」のように名前に基準量が書かれている場合はそれを使う
  const m = name.normalize('NFKC').match(/\((\d+(?:\.\d+)?)\s*(g|ml)\s*(?:あたり|当たり)\)/i);
  if (m) return { amount: Number(m[1]), unit: m[2].toLowerCase(), grams: null };
  return { amount: 1, unit: category === 'カフェ' ? '杯' : '個', grams: null };
}
async function collectFamilyMart() {
  const products = [], sources = [];
  for (const [page, category] of famimaPages) {
    const url = `https://www.family.co.jp/goods/safety/${page}.html`;
    const html = await get(url);
    if (!html) { console.warn('  ページなし', url); continue; }
    sources.push(url);
    const parts = html.split('<div class="item_basic_info">'), blocks = parts.slice(1);
    for (const [i, block] of blocks.entries()) {
      const before = parts[i];
      const img = [...before.matchAll(/<img src="(\/content\/dam\/family\/goods\/(\d+)[^"]*)"/g)].at(-1);
      const nameBlock = block.match(/<p class="name">([\s\S]*?)<\/p>/)?.[1] ?? '';
      const link = nameBlock.match(/href="([^"]+)"/)?.[1] ?? null;
      const name = text(nameBlock);
      if (!name) continue;
      const ths = [...block.matchAll(/<th class="tit_nut">([\s\S]*?)<\/th>/g)].map(m => text(m[1]).replace(/[（(].*$/, '').trim());
      const tds = [...block.matchAll(/<td class="con_nut">([\s\S]*?)<\/td>/g)].map(m => m[1]);
      const nutrition = emptyNutrition();
      ths.forEach((th, j) => { const key = nutritionKeys[th]; if (key) nutrition[key] = num(tds[j]); });
      if (!hasNutrition(nutrition)) continue; // 栄養成分の掲載がない商品は登録しない
      const code = link?.match(/\/(\d+)\.html/)?.[1] ?? img?.[2] ?? null;
      const areas = [...block.matchAll(/ly-mod-tag-area-on"><em>([^<]+)/g)].map(m => m[1]);
      const aten = text(block.match(/<dd class="aten">([\s\S]*?)<\/dd>/)?.[1] ?? '');
      products.push({
        id: `familymart:${link && code ? code : (code ?? 'x') + '-' + hash(name)}`,
        name, brand: 'ファミリーマート', store: 'familymart', category,
        serving: famimaServing(name, category),
        nutrition,
        imageUrl: img ? 'https://www.family.co.jp' + img[1] : null,
        sourceUrl: url, productUrl: link, updatedAt: today, quality: 'official', origin: 'common', status: 'active',
        note: [areas.length ? '対象地域: ' + areas.join('・') : '', aten].filter(Boolean).join(' / '),
      });
    }
    console.log(`  ${category}: 累計 ${products.length}件`);
  }
  // 同じIDが複数ページに載っている場合は最初の掲載を採用。リンクの重複は名前で区別する
  const seen = new Map();
  for (const p of products) {
    if (seen.has(p.id) && seen.get(p.id).name !== p.name) p.id = p.id + '-' + hash(p.name);
    if (!seen.has(p.id)) seen.set(p.id, p);
  }
  return { store: 'familymart', storeName: 'ファミリーマート', sources, products: [...seen.values()] };
}

// ---------- ローソン ----------
const lawsonCategories = {
  rice: 'おにぎり・ごはん', bento: 'お弁当', chilledbento: 'チルド弁当', sushi: 'お寿司', sandwich: 'サンドイッチ', bakery: 'パン',
  noodle: '麺', pasta: 'パスタ', gratin: 'グラタン・ドリア', konamono: '粉もの', soup: 'スープ', salad: 'サラダ',
  fry: '揚げ物・ホットスナック', chukaman: '中華まん', oden: 'おでん', dessert: 'デザート', coffee: 'カフェ',
  kenkosnack: '健康志向スナック', select: 'ローソンセレクト', machikadochubo: 'まちかど厨房', gentei: '地域限定', liquor: 'お酒',
};
function lawsonServing(basis) {
  // 例: "1包装当たり" "100g当たり" "1包装(65g)当たり" "1個(標準7g)当たり" "可食部(9g)当たり" "コップ1杯(200ml)当たり" "1杯"
  const base = (basis || '1包装').normalize('NFKC').split(/当たり|あたり/)[0].trim();
  const paren = base.match(/\(([^)]*)\)?/)?.[1] ?? '';
  const main = base.replace(/\(.*$/, '').trim();
  const grams = paren.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  const m = main.match(/(\d+(?:\.\d+)?)\s*([^\d\s]+)$/);
  if (m && !(grams && m[2].includes('の'))) {
    const amount = Number(m[1]), unit = m[2];
    return { amount, unit, grams: unit === 'g' || !grams || amount !== 1 ? null : Number(grams[1]) };
  }
  if (grams) return { amount: Number(grams[1]), unit: 'g', grams: null };
  return { amount: 1, unit: main || '包装', grams: null };
}
async function collectLawson() {
  const products = [], sources = [];
  let n = 0;
  for (const [slug, category] of Object.entries(lawsonCategories)) {
    const listUrl = `https://www.lawson.co.jp/recommend/original/${slug}/`;
    const list = await get(listUrl);
    if (!list) { console.warn('  ページなし', listUrl); continue; }
    sources.push(listUrl);
    const links = [...new Set([...list.matchAll(/href="(\/recommend\/original\/detail\/(\d+)_\d+\.html)"/g)].map(m => m[1]))];
    for (const path of links) {
      if (n++ >= limit) break;
      const code = path.match(/detail\/(\d+)_/)[1];
      if (products.some(p => p.id === 'lawson:' + code)) continue;
      const url = 'https://www.lawson.co.jp' + path;
      const html = await get(url);
      if (!html) continue;
      const name = text(html.match(/<h2 class="ttl">([\s\S]*?)<\/h2>/)?.[1] ?? '');
      const table = html.match(/<div class="nutritionFacts_table">([\s\S]*?)<div class="allergie_table/)?.[1];
      if (!name || !table) continue;
      const basis = text(table.match(/<h3>[\s\S]*?<span>([\s\S]*?)<\/span>/)?.[1] ?? '').replace(/[【】]/g, '');
      const nutrition = emptyNutrition();
      for (const m of table.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) {
        const key = nutritionKeys[text(m[1])];
        if (key) nutrition[key] = num(m[2]);
      }
      if (!hasNutrition(nutrition)) continue;
      const spec = text(html.match(/<dt>規格（内容量）<\/dt><dd>([\s\S]*?)<\/dd>/)?.[1] ?? '');
      const img = html.match(/<div class="leftBlock">[\s\S]*?<img src="([^"]+)"/)?.[1];
      const notes = [...html.matchAll(/<div class="smalltxt"[^>]*><ul>([\s\S]*?)<\/ul><\/div>/g)].map(m => text(m[1]));
      products.push({
        id: 'lawson:' + code, name, brand: 'ローソン', store: 'lawson', category,
        serving: lawsonServing(basis || spec), nutrition,
        imageUrl: img ? new URL(img, url).href : null,
        // 公式ページ上で「推定値」と書かれているものは official にしない
        sourceUrl: url, productUrl: url, updatedAt: today, quality: basis.includes('推定') ? 'estimated' : 'official', origin: 'common', status: 'active',
        note: [spec && '規格: ' + spec, basis && '栄養成分: ' + basis, notes[0]].filter(Boolean).join(' / '),
      });
    }
    console.log(`  ${category}: 累計 ${products.length}件`);
  }
  return { store: 'lawson', storeName: 'ローソン', sources, products };
}

// ---------- 書き出し（ID維持・販売終了の扱い） ----------
async function readJson(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
function merge(previous, fresh) {
  const old = new Map((previous?.products ?? []).map(p => [p.id, p]));
  const out = fresh.products.map(p => {
    const o = old.get(p.id);
    // 内容に変化がなければ前回の更新日を維持し、変化があれば（リニューアル等）今日の日付にする
    if (o && JSON.stringify({ ...o, updatedAt: 0, status: 0, discontinuedAt: 0 }) === JSON.stringify({ ...p, updatedAt: 0, status: 0, discontinuedAt: 0 })) return { ...p, updatedAt: o.updatedAt };
    return p;
  });
  const freshIds = new Set(out.map(p => p.id));
  for (const o of old.values()) if (!freshIds.has(o.id)) out.push({ ...o, status: 'discontinued', discontinuedAt: o.discontinuedAt ?? today });
  return out.sort((a, b) => a.category.localeCompare(b.category, 'ja') || a.name.localeCompare(b.name, 'ja'));
}
const collectors = { familymart: collectFamilyMart, lawson: collectLawson };
await mkdir(join(outDir, 'stores'), { recursive: true });
const manifestPath = join(outDir, 'index.json');
const manifest = (await readJson(manifestPath)) ?? { schemaVersion: 1, name: '夜勤の減量ノート 共通商品DB', stores: [] };
for (const [store, collect] of Object.entries(collectors)) {
  if (only.length && !only.includes(store)) continue;
  console.log(`[${store}] 収集開始`);
  const fresh = await collect();
  if (!fresh.products.length) { console.warn(`[${store}] 0件のため書き出しを中止（前回のデータを維持）`); continue; }
  const file = `stores/${store}.json`, path = join(outDir, file);
  const products = merge(await readJson(path), fresh);
  const active = products.filter(p => p.status === 'active').length;
  await writeFile(path, JSON.stringify({ schemaVersion: 1, store, storeName: fresh.storeName, updatedAt: today, sources: fresh.sources, products }, null, 1) + '\n');
  const entry = { id: store, name: fresh.storeName, file, updatedAt: today, count: products.length, active };
  manifest.stores = [...manifest.stores.filter(s => s.id !== store), entry].sort((a, b) => a.id.localeCompare(b.id));
  console.log(`[${store}] ${products.length}件（販売中 ${active}件）→ ${file}`);
}
manifest.updatedAt = manifest.stores.map(s => s.updatedAt).sort().at(-1) ?? today;
await writeFile(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
