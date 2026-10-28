import { type Goal, type Nutrition, type Product, type Meal } from './model';
import { evaluateNutrition, nutrients, snackSuggestions } from './foodLogic';

export const numberText = (n: number | null | undefined, digits = 1) => n == null ? '不明' : n.toLocaleString('ja-JP', { maximumFractionDigits: digits });
export function NutritionGrid({ value }: { value: Nutrition }) {
  return <dl className="nutrition-grid">{nutrients.map(n => <div key={n.key}><dt>{n.label}</dt><dd>{numberText(value[n.key])}{value[n.key] != null && <small> {n.unit}</small>}</dd></div>)}</dl>;
}

export function Evaluation({ value, targets, title = '今回の食事評価', sample = false }: { value: Nutrition; targets: Nutrition | null; title?: string; sample?: boolean }) {
  const result = evaluateNutrition(value, targets);
  return <section className="evaluation" aria-label={title}>
    <div className="section-heading"><h3>{title}</h3><strong className="score">{result.score == null ? '未評価' : `${result.score} / 100`}<small>{sample ? 'サンプルを含む参考計算' : result.coverage < 6 ? '暫定評価' : '目標への一致度'}</small></strong></div>
    <p className="muted">評価可能な項目 {result.coverage} / 6。未設定の目標・不明な栄養値は採点しません。</p>
    <ul className="evaluation-list">{result.rows.map(r => <li key={r.key}><strong>{r.label}</strong><span>{numberText(r.actual)} / {numberText(r.target)} {r.unit}</span><small>{r.delta == null ? '評価対象外' : r.rule === 'upper' ? r.delta <= 0 ? '上限以内' : `上限より${numberText(r.delta)}${r.unit}多め。量・組み合わせを確認` : r.rule === 'lower' ? r.delta >= 0 ? '目標以上' : `目標まで${numberText(-r.delta)}${r.unit}` : Math.abs(r.delta) < 0.05 ? '目標と一致' : r.delta < 0 ? `目標まで${numberText(-r.delta)}${r.unit}` : `目標より${numberText(r.delta)}${r.unit}多め`}</small></li>)}</ul>
    <details><summary>採点の基準</summary><p>アプリ独自の参考点で、医学的な健康判定ではありません。目標は自分で設定します。カロリー30・たんぱく質25・脂質15・炭水化物15・食塩10・食物繊維5の重みです。</p><p>前4項目は「1−|摂取量÷目標−1|」、食塩は上限以内なら満点、上限を超えた割合だけ減点。食物繊維は目標達成まで比例加点。各項目を0〜1に収め、有効な項目の重み合計で100点換算します。不明項目は除外するため、暫定点同士は単純比較できません。</p><p>食事目標＝1日目標×指定した配分率。食事ごとの不足は、その1食にすべて追加する指示ではありません。1日の合計も確認してください。</p></details>
  </section>;
}

export function Snacks({ products, daily, goal, onAdd }: { products: Product[]; daily: Nutrition; goal?: Partial<Goal>; onAdd?: (p: Product) => void }) {
  const suggestions = snackSuggestions(products, daily, goal);
  return <section className="snacks"><span className="eyebrow">BALANCE FIRST</span><h3>今から間食するなら</h3><p className="muted">1基準量で残りカロリー内に収まり、不足するたんぱく質・食物繊維を補う候補。設定済みの脂質・食塩上限も確認します。サンプル商品は提案しません。</p>
    {!suggestions.length ? <p className="muted">現在の目標・栄養情報・商品では候補がありません。目標の設定や、実商品の栄養値の登録を確認してください。</p> : suggestions.map(s => <div className="snack-item" key={s.product.id}><div><strong>{s.product.name}</strong><p>{numberText(s.product.nutrition.calories)} kcal / {s.product.serving.amount}{s.product.serving.unit}・{s.product.quality === 'estimated' ? '推定値' : s.product.quality === 'official' ? '公式値' : '表示値'}</p><small>{s.reasons.join(' / ')}</small></div>{onAdd && <button type="button" onClick={() => onAdd(s.product)}>追加</button>}</div>)}
    <small className="muted">アレルギーや食事制限には対応していません。原材料・表示内容は商品で確認してください。</small>
  </section>;
}

export function MealEvaluation({ meal }: { meal: Meal }) {
  return <Evaluation value={meal.total} targets={meal.targets ?? null} sample={meal.items.some(i => i.product.quality === 'sample')} />;
}
