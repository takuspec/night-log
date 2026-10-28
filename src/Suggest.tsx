import { useState } from 'react';
import { Sparkles, RefreshCw, ShoppingBasket } from 'lucide-react';
import { type Goal, type Meal, type Product, totalNutrition, fromInput, jstInput } from './model';
import { mealKind } from './foodLogic';
import { candidates, suggest, suggestTargets, storeBrands, type Combo, type Preferences } from './suggestLogic';
import { NutritionGrid, ProductPhoto, numberText } from './NutritionView';

const sourceLabels = { official: '公式値', mine: '登録済み', standard: '目安' } as const;
const shares: Record<string, number> = { 朝食: 0.25, 昼食: 1 / 3, 夕食: 1 / 3, 夜食: 0.25, 間食: 0.1 };

// 組み合わせの提案。ここでは保存しない。使う案を選ぶと、公式値・登録済みの商品だけをカートに入れる
export function Suggest({ products, meals, day, goal, onUse }: { products: Product[]; meals: Meal[]; day: string; goal?: Goal; onUse: (items: Meal['items'], kind: string) => void }) {
  const eaten = totalNutrition(meals.filter(m => m.day === day).flatMap(m => m.items));
  const [shop, setShop] = useState('lawson'), [kind, setKind] = useState(() => mealKind(fromInput(jstInput())));
  const initial = suggestTargets(goal, eaten, shares[kind]);
  const [kcal, setKcal] = useState(initial.calories), [protein, setProtein] = useState(initial.protein), [salt, setSalt] = useState(initial.salt);
  const [prefs, setPrefs] = useState<Preferences>({ staple: '', noFried: false }), [seed, setSeed] = useState(0), [result, setResult] = useState<Combo[] | null>(null);
  const shops = [...new Set(products.flatMap(p => p.origin === 'personal' ? p.shops ?? [] : []))].filter(s => !Object.values(storeBrands).includes(s));
  function run(nextSeed: number) {
    setSeed(nextSeed);
    setResult(suggest(candidates(products, shop, prefs), { calories: kcal, protein, salt }, nextSeed + 1));
  }
  function changeKind(k: string) {
    setKind(k);
    const t = suggestTargets(goal, eaten, shares[k]);
    setKcal(t.calories); setProtein(t.protein); setSalt(t.salt); setResult(null);
  }
  return <>
    <section className="card">
      <div className="section-heading"><div><span className="eyebrow">WHAT TO BUY</span><h2>組み合わせの提案</h2></div></div>
      <p className="muted">店の公式商品・その店で買って登録した商品・食品成分表の一般食品から、目安に近い組み合わせを選びます。提案するだけで、記録はされません。</p>
      <div className="form-grid">
        <label>お店<select value={shop} onChange={e => { setShop(e.target.value); setResult(null); }}><option value="lawson">ローソン</option><option value="familymart">ファミリーマート</option>{shops.map(s => <option key={s} value={s}>{s}（登録した商品＋一般食品）</option>)}<option value="">どこでも</option></select></label>
        <label>食事<select value={kind} onChange={e => changeKind(e.target.value)}>{['朝食', '昼食', '夕食', '夜食', '間食'].map(k => <option key={k}>{k}</option>)}</select></label>
        <label>カロリーの目安（kcal）<input type="number" min="100" max="3000" step="10" value={kcal} onChange={e => setKcal(e.target.valueAsNumber || 0)} /></label>
        <label>たんぱく質（g以上）<input type="number" min="0" max="200" step="1" value={protein} onChange={e => setProtein(e.target.valueAsNumber || 0)} /></label>
        <label>食塩（g以下）<input type="number" min="0.5" max="20" step="0.1" value={salt} onChange={e => setSalt(e.target.valueAsNumber || 0)} /></label>
        <label>主食<select value={prefs.staple} onChange={e => setPrefs(p => ({ ...p, staple: e.target.value as Preferences['staple'] }))}><option value="">おまかせ</option><option value="rice">ごはん・おにぎり</option><option value="bread">パン・サンド</option><option value="noodle">麺</option></select></label>
      </div>
      <label className="check"><input type="checkbox" checked={!!prefs.noFried} onChange={e => setPrefs(p => ({ ...p, noFried: e.target.checked }))} />揚げ物なし</label>
      <p className="muted">{goal ? `1日の目標 ${goal.calories}kcal から、この集計日に食べた ${numberText(eaten.calories, 0)}kcal を引いた残りで目安を出しています。` : '1日の目標が未設定のため、1800kcal・たんぱく質60gとして目安を出しています（設定で変更できます）。'}</p>
      <div className="draft-actions"><button type="button" className="primary" disabled={!kcal} onClick={() => run(seed)}><Sparkles size={17} />提案する</button>{result && <button type="button" onClick={() => run(seed + 1)}><RefreshCw size={16} />別の案</button>}</div>
    </section>
    {result && !result.length && <section className="card"><p className="empty">条件に合う組み合わせが見つかりませんでした。カロリーや食塩の目安を少しゆるめるか、主食を「おまかせ」にしてください。</p></section>}
    {result?.map((c, n) => {
      const usable = c.items.filter(i => i.source !== 'standard');
      return <section className="card combo" key={c.items.map(i => i.product.id).join()}>
        <div className="section-heading"><h3>案{n + 1}</h3><strong>{numberText(c.total.calories, 0)} kcal</strong></div>
        <ul className="combo-items">{c.items.map(i => <li key={i.product.id}><ProductPhoto product={i.product} size="small" /><span><strong>{i.product.name}</strong><small>{i.product.brand} · {i.source === 'standard' ? `${i.product.portion!.label}（${i.product.portion!.grams}g）` : `${i.product.serving.amount}${i.product.serving.unit}`} · {numberText(i.n.calories, 0)}kcal</small></span><span className={'badge ' + i.source}>{sourceLabels[i.source]}</span></li>)}</ul>
        <NutritionGrid value={c.total} />
        {usable.length < c.items.length && <p className="muted">「目安」は食品成分表の一般的な値です。買ったら、食事登録の「GPTのJSON」で実際の値を登録してください（次からは登録済みの商品として提案されます）。</p>}
        <button type="button" disabled={!usable.length} onClick={() => onUse(usable.map(i => ({ product: structuredClone(i.product), quantity: i.quantity })), kind)}><ShoppingBasket size={16} />{usable.length < c.items.length ? '公式値・登録済みの商品をカートへ' : 'この組み合わせをカートへ'}</button>
      </section>;
    })}
  </>;
}
