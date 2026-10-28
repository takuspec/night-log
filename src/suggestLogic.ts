import { type Nutrition, type Product, totalNutrition } from './model';
import { defaultQuantity } from './foodLogic';

// 組み合わせの提案。登録とは別で、ここでは何も保存しない。
// 候補: 店の公式商品 / その店で買って登録した個人商品 / 食品成分表の一般食品（目安量つきのものだけ）
export type Source = 'official' | 'mine' | 'standard';
export type Role = 'main' | 'staple' | 'protein' | 'side';
export type Candidate = { product: Product; quantity: number; source: Source; role: Role; n: Nutrition };
export type Combo = { items: Candidate[]; total: Nutrition; score: number };
export type Targets = { calories: number; protein: number; salt: number };
export type Preferences = { staple?: 'rice' | 'bread' | 'noodle' | ''; noFried?: boolean };

export const storeBrands: Record<string, string> = { lawson: 'ローソン', familymart: 'ファミリーマート' };
const notMeal = /カフェ|お酒|デザート|調味料|油脂|し好飲料|砂糖|菓子|地域限定/;
const fried = /揚げ|フライ|カツ|唐揚|からあげ|天ぷら|コロッケ|チキン南蛮/;
// お菓子・甘いパン・おつまみは食事の提案に使わない（ローソンセレクトなどに多く含まれるため名前で除く）
const sweetsOrSnack = /スナック|ビスケット|クッキー|チョコ|キャンディ|グミ|ガム|カヌレ|ケーキ|カステラ|ドーナ|ワッフル|バウム|プリン|ゼリー|アイス|せんべい|煎餅|あられ|ポテトチップ|いかスティック|おしゃぶり|都こんぶ|ナッツ|ベリー|レーズン|ドライ|メロンパン|あんぱん|デニッシュ|クリームパン|ジャム|マシュマロ|羊羹|ようかん|大福|だんご|団子|まんじゅう|饅頭|あんまん|粒あん|こしあん|プロテインバー|シリアルバー/;
// 副菜として出してよいもの（サラダ・スープ・卵・惣菜など）
const sideDish = /サラダ|スープ|汁|たまご|卵|玉子|ひじき|きんぴら|和え|煮|豆腐|納豆|ヨーグルト|枝豆|野菜|ブロッコリー|おひたし|漬|こんにゃく|おから|卯の花|切干|切り干し|もずく|めかぶ|わかめ/;
const staples = { rice: /おにぎり|むすび|ごはん|ご飯|寿司|巻|丼|チャーハン|ピラフ|ドリア/, bread: /パン|サンド|バーガー|ロール|トースト|ブレッド/, noodle: /麺|そば|うどん|パスタ|ラーメン|焼そば|焼きそば|スパゲ|冷やし中華/ };

const scaled = (p: Product, q: number) => totalNutrition([{ product: p, quantity: q }]);
// 1回分の栄養値から役割を決める（カテゴリ名に頼らないので、個人商品にも使える）
export function roleOf(n: Nutrition): Role | null {
  const { calories: k, protein: p, carbs: c } = n;
  if (k == null || p == null || c == null || k <= 0) return null;
  if (k >= 450 && p >= 15) return 'main';
  if (p >= 10 && (p * 4) / k >= 0.3) return 'protein';
  if (k >= 150 && (c * 4) / k >= 0.5) return 'staple';
  if (k <= 200) return 'side';
  return null;
}

export function candidates(products: Product[], shop: string, prefs: Preferences = {}): Candidate[] {
  const brand = storeBrands[shop] ?? shop;
  return products.flatMap(product => {
    if (product.status === 'discontinued' || notMeal.test(product.category)) return [];
    let source: Source;
    if (product.origin === 'personal') {
      if (brand && !(product.shops ?? []).includes(brand)) return [];
      source = 'mine';
    } else if (product.store === 'mext') {
      if (!product.portion) return [];
      source = 'standard';
    } else {
      if (product.quality !== 'official' || (brand && product.brand !== brand)) return [];
      source = 'official';
    }
    if (sweetsOrSnack.test(product.name)) return [];
    if (source === 'official' && /\d+\s*(個|枚|食|本|袋)入/.test(product.name)) return []; // まとめ売りは1回の食事に向かない
    if (prefs.noFried && (fried.test(product.name) || /揚げ物/.test(product.category))) return [];
    const quantity = defaultQuantity(product), n = scaled(product, quantity), role = roleOf(n);
    if (!role || n.salt == null) return [];
    // ローソンセレクトの乾麺・ゆで麺などは調理が必要なので、そのまま食べる主食としては出さない
    if (role === 'staple' && product.category === 'ローソンセレクト' && /スパゲッティ|うどん|そば|ラーメン|麺|パスタ|米/.test(product.name)) return [];
    if (role === 'side' && source === 'official' && !/サラダ|スープ|おでん/.test(product.category) && !sideDish.test(product.name)) return [];
    if (prefs.staple && (role === 'staple' || role === 'main') && !staples[prefs.staple].test(product.name + product.category)) return [];
    return [{ product, quantity, source, role, n }];
  });
}

const kinds = /納豆|豆腐|厚揚|サラダチキン|ささみ|たまご|卵|玉子|ヨーグルト|おにぎり|むすび|そば|うどん|パスタ|ラーメン|サンド|弁当|丼|から揚げ|からあげ|唐揚|ブロッコリー|ひじき|きんぴら|ポテトサラダ|肉まん|おでん/g;
const kindOf = (p: Product) => [...new Set((p.name.match(kinds) ?? []).map(k => 'kind:' + k.replace(/むすび/, 'おにぎり').replace(/からあげ|唐揚/, 'から揚げ').replace(/卵|玉子/, 'たまご')))];
// 乱数の種を変えると別の案になる（「別の案」ボタン用）
function random(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

function score(total: Nutrition, items: Candidate[], t: Targets, jitter: number) {
  const k = total.calories!, p = total.protein!, s = total.salt!;
  if (s > t.salt || k > t.calories * 1.1 || k < t.calories * 0.7) return null;
  let v = -Math.abs(k - t.calories) / t.calories * 3;
  v += Math.min(p / Math.max(t.protein, 1), 1.3) * 1.5 - (p < t.protein ? 1 : 0);
  v += Math.min((total.fiber ?? 0) / 6, 1) * 0.5;
  v -= Math.max(0, (total.fat ?? 0) - (t.calories * 0.3) / 9) / 15;
  v += items.filter(i => i.source === 'mine').length * 0.2; // 自分で買って登録した商品を少し優先する
  v -= items.filter(i => i.source === 'standard').length * 0.1; // 目安値の一般食品は少しだけ控えめに
  return v + jitter;
}

export function suggest(cands: Candidate[], t: Targets, seed = 1, count = 5): Combo[] {
  const rnd = random(seed);
  // 役割ごとに候補をしぼる（全部の組み合わせは多すぎるため、毎回少しずつ違う顔ぶれにする）
  const pool = (role: Role, size: number) => cands.filter(c => c.role === role).map(c => ({ c, r: rnd() + (c.source === 'mine' ? 0.5 : 0) })).sort((a, b) => b.r - a.r).slice(0, size).map(x => x.c);
  const main = pool('main', 40), staple = pool('staple', 45), protein = pool('protein', 35), side = pool('side', 35);
  const combos: Combo[] = [];
  const tryItems = (items: Candidate[]) => {
    const total = totalNutrition(items.map(i => ({ product: i.product, quantity: i.quantity })));
    const v = score(total, items, t, rnd() * 0.3);
    if (v != null) combos.push({ items, total, score: v });
  };
  for (const m of main) { tryItems([m]); for (const s of side) tryItems([m, s]); }
  for (const a of staple) for (const b of protein) { tryItems([a, b]); for (const s of side) tryItems([a, b, s]); }
  combos.sort((a, b) => b.score - a.score);
  // 同じ商品・同じ種類の食品（納豆が何種類もある、など）が何度も出ないように、使ったものは次の案では使わない
  const used = new Set<string>(), picked: Combo[] = [];
  for (const c of combos) {
    const keys = c.items.flatMap(i => [i.product.id, ...kindOf(i.product)]);
    if (keys.some(k => used.has(k))) continue;
    picked.push(c); keys.forEach(k => used.add(k));
    if (picked.length >= count) break;
  }
  return picked;
}

// 今回の食事の目安。1日の目標から、その集計日に食べた分を引いた残りを上限にする
export function suggestTargets(goal: { calories?: number; protein?: number; salt?: number | null } | undefined, eaten: Nutrition, share = 1 / 3): Targets {
  const daily = goal?.calories ?? 1800;
  const left = daily - (eaten.calories ?? 0);
  const calories = Math.round(Math.max(250, Math.min(daily * share, left > 0 ? left : daily * share)) / 10) * 10;
  const protein = Math.round((goal?.protein ?? 60) * share);
  const salt = Math.round(((goal?.salt ?? 7.5) * share) * 10) / 10 + 0.5;
  return { calories, protein, salt };
}
