import { describe, it, expect, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { dayKey, setBoundary, totalNutrition } from './model';
import { HealthDB, syncCommonProducts, changeDayBoundary, saveMeal, saveDraft, loadDraft } from './db';
import { matchesProduct, quantityFromAmount } from './foodLogic';

const base = 'https://example.test/product-db/index.json';
const product = (id: string, name: string, calories: number) => ({
  id, name, brand: 'ローソン', category: 'おにぎり', serving: { amount: 1, unit: '包装', grams: 110 },
  nutrition: { calories, protein: 5, fat: 2, carbs: 30, salt: 1, fiber: null }, imageUrl: null,
  sourceUrl: 'https://www.lawson.co.jp/x.html', updatedAt: '2026-10-29', quality: 'official', status: 'active',
});
function server(files: Record<string, unknown>): typeof fetch {
  return (async (url: string) => url in files ? new Response(JSON.stringify(files[url])) : new Response('', { status: 404 })) as typeof fetch;
}
const manifest = { schemaVersion: 1, updatedAt: '2026-10-29', stores: [{ id: 'lawson', name: 'ローソン', file: 'stores/lawson.json' }] };
const storeFile = (products: unknown[], updatedAt = '2026-10-29') => ({ schemaVersion: 1, store: 'lawson', storeName: 'ローソン', updatedAt, products });

let database = new HealthDB('test-common');
afterEach(async () => { await database.delete(); database = new HealthDB('test-common'); setBoundary(540); });

describe('共通商品DB', () => {
  it('取得した商品を保存し、オフラインでも検索できる', async () => {
    const fetcher = server({ [base]: manifest, 'https://example.test/product-db/stores/lawson.json': storeFile([product('lawson:1', '焼さけおにぎり', 200)]) });
    const status = await syncCommonProducts(base, database, fetcher);
    expect(status.stores[0]).toMatchObject({ count: 1, active: 1, skipped: 0 });
    // 通信不可でも IndexedDB に残った商品で検索できる
    await expect(syncCommonProducts(base, database, server({}))).rejects.toThrow();
    const all = await database.products.toArray();
    expect(all.filter(p => matchesProduct(p, 'ローソン さけ'))).toHaveLength(1);
    expect(all[0].origin).toBe('common');
  });
  it('一覧から消えた商品はIDを維持して販売終了にし、形式不正は除外する', async () => {
    const file = 'https://example.test/product-db/stores/lawson.json';
    await syncCommonProducts(base, database, server({ [base]: manifest, [file]: storeFile([product('lawson:1', 'A', 200), product('lawson:2', 'B', 300)]) }));
    const s = await syncCommonProducts(base, database, server({ [base]: manifest, [file]: storeFile([product('lawson:1', 'A', 210), { id: 'lawson:3', name: '' }], '2026-11-05') }));
    expect(s.stores[0]).toMatchObject({ count: 1, skipped: 1 });
    expect(await database.products.get('lawson:2')).toMatchObject({ status: 'discontinued', discontinuedAt: '2026-11-05' });
    expect((await database.products.get('lawson:1'))?.nutrition.calories).toBe(210);
  });
  it('共通商品DBの更新後も過去の食事の栄養値は変わらない', async () => {
    const file = 'https://example.test/product-db/stores/lawson.json';
    await syncCommonProducts(base, database, server({ [base]: manifest, [file]: storeFile([product('lawson:1', 'A', 200)]) }));
    const p = (await database.products.get('lawson:1'))!;
    const meal = await saveMeal('2026-10-29T03:00:00Z', '夜食', [{ product: structuredClone(p), quantity: 1.5 }], '', {}, database);
    await syncCommonProducts(base, database, server({ [base]: manifest, [file]: storeFile([product('lawson:1', 'A', 999)]) }));
    expect((await database.meals.get(meal.id))?.total.calories).toBe(300);
  });
});

describe('分量・集計開始時刻・下書き', () => {
  it('グラム指定と小数数量で栄養値を計算する', () => {
    const p = { ...product('lawson:1', 'A', 200), origin: 'common' } as never;
    const q = quantityFromAmount(p, 55, 'grams');
    expect(q).toBe(0.5);
    expect(totalNutrition([{ product: p, quantity: q }, { product: p, quantity: 0.25 }]).calories).toBe(150);
  });
  it('集計開始時刻を変えると集計日が変わり、保存済みの記録も付け直す', async () => {
    expect(dayKey('2026-10-29T05:30:00+09:00', 300)).toBe('2026-10-29');
    expect(dayKey('2026-10-29T04:59:00+09:00', 300)).toBe('2026-10-28');
    const items = [{ product: { ...product('lawson:1', 'A', 200), origin: 'common' } as never, quantity: 1 }];
    const m = await saveMeal(new Date('2026-10-29T06:00:00+09:00').toISOString(), '朝食', items, '', {}, database);
    expect(m.day).toBe('2026-10-28');
    await changeDayBoundary(300, database);
    expect((await database.meals.get(m.id))?.day).toBe('2026-10-29');
    expect((await database.settings.get('dayBoundary'))?.value).toBe('05:00 Asia/Tokyo');
  });
  it('未保存のカートを保持し、空になったら消す', async () => {
    const items = [{ product: { ...product('lawson:1', 'A', 200), origin: 'common' } as never, quantity: 2 }];
    await saveDraft({ items, at: '2026-10-29T06:00', kind: '朝食', manualKind: false, note: '' }, database);
    expect((await loadDraft(database))?.items[0].quantity).toBe(2);
    await saveDraft({ items: [], at: '', kind: '', manualKind: false, note: '' }, database);
    expect(await loadDraft(database)).toBeNull();
  });
});
