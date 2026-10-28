import { describe, it, expect } from 'vitest';
import { productSchema } from './model';
import { candidates, suggest, suggestTargets, roleOf } from './suggestLogic';
import lawson from '../public/product-db/stores/lawson.json';
import mext from '../public/product-db/stores/mext.json';

const load = (f: { products: unknown[] }) => f.products.map(p => productSchema.parse({ ...(p as object), origin: 'common' }));
const products = [...load(lawson), ...load(mext)];

describe('組み合わせの提案', () => {
  const t = { calories: 600, protein: 25, salt: 3 };
  it('ローソンの商品と一般食品から、条件を満たす案を重複なく出す', () => {
    const combos = suggest(candidates(products, 'lawson'), t, 1);
    expect(combos.length).toBeGreaterThanOrEqual(3);
    for (const c of combos) {
      expect(c.total.calories!).toBeLessThanOrEqual(660);
      expect(c.total.calories!).toBeGreaterThanOrEqual(420);
      expect(c.total.salt!).toBeLessThanOrEqual(3);
      expect(c.items.every(i => i.product.brand === 'ローソン' || i.product.store === 'mext')).toBe(true);
    }
    const ids = combos.flatMap(c => c.items.map(i => i.product.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('乱数の種を変えると別の案になり、好みで絞り込める', () => {
    const a = suggest(candidates(products, 'lawson'), t, 1).map(c => c.items.map(i => i.product.id).join());
    const b = suggest(candidates(products, 'lawson'), t, 2).map(c => c.items.map(i => i.product.id).join());
    expect(a).not.toEqual(b);
    const noodle = suggest(candidates(products, 'lawson', { staple: 'noodle', noFried: true }), t, 3);
    for (const c of noodle) for (const i of c.items) expect(i.product.name).not.toMatch(/揚げ|フライ|からあげ/);
  });
  it('その店で買って登録した個人商品も候補になる', () => {
    const mine = productSchema.parse({ id: 'personal:egg', name: 'テスト用 ゆでたまご2個', brand: 'テスト', serving: { amount: 1, unit: 'パック' }, nutrition: { calories: 140, protein: 12, fat: 10, carbs: 0.5, salt: 0.8, fiber: 0 }, updatedAt: '2026-10-29', quality: 'label', origin: 'personal', shops: ['ローソン'] });
    expect(candidates([mine], 'lawson').map(c => c.source)).toEqual(['mine']);
    expect(candidates([mine], 'familymart')).toEqual([]);
  });
  it('1日の目標と食べた分から今回の目安を決める', () => {
    expect(suggestTargets({ calories: 1800, protein: 90 }, { calories: 1500 } as never)).toMatchObject({ calories: 300, protein: 30 });
    expect(suggestTargets(undefined, { calories: 0 } as never).calories).toBe(600);
    expect(roleOf({ calories: 600, protein: 20, fat: 20, carbs: 80, salt: 3, fiber: 2 })).toBe('main');
  });
});
