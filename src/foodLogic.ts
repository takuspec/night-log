import { type Goal, type Nutrition, type Product, type Meal, totalNutrition } from './model';

export const nutrients = [
  { key: 'calories', label: 'カロリー', unit: 'kcal', weight: 30, rule: 'match' },
  { key: 'protein', label: 'たんぱく質', unit: 'g', weight: 25, rule: 'match' },
  { key: 'fat', label: '脂質', unit: 'g', weight: 15, rule: 'match' },
  { key: 'carbs', label: '炭水化物', unit: 'g', weight: 15, rule: 'match' },
  { key: 'salt', label: '食塩相当量', unit: 'g', weight: 10, rule: 'upper' },
  { key: 'fiber', label: '食物繊維', unit: 'g', weight: 5, rule: 'lower' },
] as const;

export function mealKind(at: string) {
  const hour = new Date(Date.parse(at) + 9 * 3600000).getUTCHours();
  if (hour >= 5 && hour < 11) return '朝食';
  if (hour >= 11 && hour < 15) return '昼食';
  if (hour >= 15 && hour < 17) return '間食';
  if (hour >= 17 && hour < 22) return '夕食';
  return '夜食';
}

const normalize = (s: string) => s.normalize('NFKC').toLowerCase()
  .replace(/ファミマ|familymart/g, 'ファミリーマート')
  .replace(/セブンイレブン|セブン-イレブン|7-eleven/g, 'セブン')
  .replace(/lawson/g, 'ローソン');
export function matchesProduct(p: Product, query: string, category = '') {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const haystack = normalize(`${p.name} ${p.brand} ${p.category} ${p.keywords ?? ''} ${(p.shops ?? []).join(' ')}`);
  return (!category || p.category === category) && terms.every(t => haystack.includes(t));
}

export function portionGrams(p: Product) {
  return p.serving.unit === 'g' || p.serving.unit === 'グラム' ? p.serving.amount : p.serving.grams ?? null;
}
export function quantityFromAmount(p: Product, amount: number, unit: 'portion' | 'grams') {
  if (!Number.isFinite(amount) || amount <= 0) throw Error('分量は0より大きい数で入力してください');
  const grams = portionGrams(p);
  if (unit === 'grams' && !grams) throw Error('グラム換算には基準量の重量が必要です');
  const quantity = unit === 'grams' ? amount / grams! : amount;
  if (quantity > 1000) throw Error('基準量の1000倍以下で入力してください');
  return quantity;
}

export function goalNutrition(goal?: Partial<Goal>): Nutrition | null {
  if (!goal) return null;
  return Object.fromEntries(nutrients.map(n => [n.key, goal[n.key] ?? null])) as Nutrition;
}
export function mealTargets(goal: Partial<Goal> | undefined, share: number): Nutrition | null {
  const daily = goalNutrition(goal);
  if (!daily) return null;
  return Object.fromEntries(nutrients.map(n => [n.key, daily[n.key] == null ? null : daily[n.key]! * share])) as Nutrition;
}

export function evaluateNutrition(actual: Nutrition, target: Nutrition | null) {
  const rows = nutrients.map(n => {
    const a = actual[n.key], t = target?.[n.key];
    if (a == null || t == null || t <= 0) return { ...n, actual: a, target: t, points: null, delta: null };
    const ratio = a / t;
    const points = n.rule === 'upper' ? Math.max(0, 1 - Math.max(0, ratio - 1))
      : n.rule === 'lower' ? Math.min(1, ratio) : Math.max(0, 1 - Math.abs(ratio - 1));
    return { ...n, actual: a, target: t, points, delta: a - t };
  });
  const known = rows.filter(r => r.points !== null);
  const max = known.reduce((sum, r) => sum + r.weight, 0);
  return { rows, coverage: known.length, score: max ? Math.round(known.reduce((sum, r) => sum + r.points! * r.weight, 0) / max * 100) : null };
}

export function snackSuggestions(products: Product[], daily: Nutrition, goal?: Partial<Goal>) {
  const target = goalNutrition(goal);
  if (!target?.calories || daily.calories == null || daily.calories >= target.calories) return [];
  const remaining = target.calories - daily.calories;
  return products.flatMap(product => {
    const n = product.nutrition;
    // Never recommend sample/unknown-energy products as actual food guidance.
    if (product.quality === 'sample' || n.calories == null || n.calories <= 0 || n.calories > remaining) return [];
    if (target.salt != null && (daily.salt == null || n.salt == null || daily.salt + n.salt > target.salt)) return [];
    if (target.fat != null && (daily.fat == null || n.fat == null || daily.fat + n.fat > target.fat)) return [];
    const reasons: string[] = [];
    let benefit = 0;
    for (const k of ['protein', 'fiber'] as const) {
      if (target[k] != null && daily[k] != null && n[k] != null && daily[k]! < target[k]!) {
        const gain = Math.min(n[k]!, target[k]! - daily[k]!);
        if (gain > 0) {
          benefit += gain / target[k]!;
          reasons.push(`${k === 'protein' ? 'たんぱく質' : '食物繊維'}を${n[k]!.toFixed(1)}g補える`);
        }
      }
    }
    if (!benefit) return [];
    return [{ product, reasons, benefit }];
  }).sort((a, b) => b.benefit - a.benefit || a.product.id.localeCompare(b.product.id)).slice(0, 3);
}

export function dayItems(meals: Meal[], day: string, excludingId?: string) {
  return meals.filter(m => m.day === day && m.id !== excludingId).flatMap(m => m.items);
}
export function combineNutrition(meals: Meal[], day: string, cart: Meal['items'], excludingId?: string) {
  return totalNutrition([...dayItems(meals, day, excludingId), ...cart]);
}

// 商品をカートに入れるときの初期の分量（基準量の倍数）。目安量（ゆで卵1個=50g など）があればそれを使う
export function defaultQuantity(p: Product) {
  const grams = portionGrams(p);
  return p.portion && grams ? p.portion.grams / grams : 1;
}
