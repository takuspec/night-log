import { useEffect, useRef, useState } from 'react';
import { Plus, Minus, Search, Star, Leaf, Trash2, Check, ExternalLink } from 'lucide-react';
import { db, saveMeal, toggleFavorite, saveDraft, type MealDraft } from './db';
import { type Product, type Meal, type Goal, productSchema, dayKey, jstInput, fromInput, totalNutrition, qualityLabels, boundaryLabel } from './model';
import { matchesProduct, mealKind, mealTargets, portionGrams, quantityFromAmount, combineNutrition, nutrients } from './foodLogic';
import { NutritionGrid, Evaluation, Snacks, numberText } from './NutritionView';

export type Run = (action: () => Promise<unknown>, message?: string) => Promise<void>;
type Props = { products: Product[]; meals: Meal[]; goal?: Goal; favorites: string[]; run: Run; busy: boolean; initial?: { meal: Meal; edit: boolean }; draft?: MealDraft | null; onSaved: (day: string) => void; onCancel: () => void };
const PAGE = 40;
export function Food({ products, meals, goal, favorites, run, busy, initial, draft, onSaved, onCancel }: Props) {
  // 編集でないときは、前回保存しなかったカート（下書き）から再開する
  const resume = !initial && draft ? draft : null;
  const start = initial?.edit ? jstInput(new Date(initial.meal.at)) : resume?.at || jstInput();
  const [q, setQ] = useState(''), [category, setCategory] = useState(''), [store, setStore] = useState(''), [showEnded, setShowEnded] = useState(false), [shown, setShown] = useState(PAGE), [source, setSource] = useState('products');
  const [cart, setCart] = useState<Meal['items']>(structuredClone(initial?.meal.items ?? resume?.items ?? []));
  const [at, setAt] = useState(start), [kind, setKind] = useState(initial?.edit ? initial.meal.kind : resume?.kind || mealKind(fromInput(start)));
  const [manualKind, setManualKind] = useState(!!initial?.edit || !!resume?.manualKind), [note, setNote] = useState(initial?.meal.note ?? resume?.note ?? '');
  const saved = useRef(false);
  useEffect(() => {
    if (initial?.edit || saved.current) return;
    const timer = setTimeout(() => { void saveDraft({ items: cart, at, kind, manualKind, note }); }, 300);
    return () => clearTimeout(timer);
  }, [initial, cart, at, kind, manualKind, note]);
  const [share, setShare] = useState(Number(((initial?.meal.targetShare ?? 1 / 3) * 100).toFixed(1)));
  const [units, setUnits] = useState<Record<number, 'portion' | 'grams'>>({});
  const [copied, setCopied] = useState(false);
  const saving = useRef(false);
  let iso = ''; try { iso = fromInput(at); } catch { /* Incomplete native date field. */ }
  const day = iso ? dayKey(iso) : '';
  const total = totalNutrition(cart), targets = mealTargets(goal, share / 100);
  const daily = combineNutrition(meals, day, cart, initial?.edit ? initial.meal.id : undefined);
  const stores = [...new Set(products.map(p => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
  const inStore = (p: Product) => !store || (store === '__personal' ? p.origin === 'personal' : p.brand === store);
  const list = products.filter(p => matchesProduct(p, q, category) && inStore(p) && (showEnded || p.status !== 'discontinued') && (source !== 'favorites' || favorites.includes(p.id)))
    .sort((a, b) => Number(b.origin === 'personal') - Number(a.origin === 'personal') || Number(a.status === 'discontinued') - Number(b.status === 'discontinued') || a.name.localeCompare(b.name, 'ja'));

  function add(product: Product) {
    setCart(old => {
      const index = old.findIndex(i => JSON.stringify(i.product) === JSON.stringify(product));
      return index < 0 ? [...old, { product: structuredClone(product), quantity: 1 }] : old.map((i, n) => n === index ? { ...i, quantity: i.quantity + 1 } : i);
    });
  }
  function loadHistory(meal: Meal) {
    // History adds snapshots to the draft; it does not silently erase selected items.
    setCart(old => [...old, ...structuredClone(meal.items)]);
    setUnits({});
  }
  const sample = cart.some(i => i.product.quality === 'sample');
  return <div className="food-layout">
    <div><section className="card"><div className="section-heading"><h2>商品を追加</h2><small className="muted">コンビニ・スーパー・外食・自炊</small></div>
      <div className="pills food-tabs">{[['products', '商品検索'], ['favorites', 'お気に入り'], ['history', '食事履歴'], ['manual', '手動登録'], ['ai', 'AI貼り付け']].map(([v, label]) => <button type="button" key={v} aria-pressed={source === v} className={source === v ? 'selected' : ''} onClick={() => setSource(v)}>{label}</button>)}</div>
      {(source === 'products' || source === 'favorites') && <><label className="search"><Search size={18} /><input aria-label="商品検索" placeholder="ファミマ 納豆、商品名など" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }} /></label><div className="form-grid"><label>メーカー・販売店<select value={store} onChange={e => { setStore(e.target.value); setCategory(''); setShown(PAGE); }}><option value="">すべて</option><option value="__personal">個人商品のみ</option>{stores.map(s => <option key={s}>{s}</option>)}</select></label><label>カテゴリ<select value={category} onChange={e => { setCategory(e.target.value); setShown(PAGE); }}><option value="">すべて</option>{[...new Set(products.filter(inStore).map(p => p.category))].sort((a, b) => a.localeCompare(b, 'ja')).map(c => <option key={c}>{c}</option>)}</select></label></div><label className="check"><input type="checkbox" checked={showEnded} onChange={e => setShowEnded(e.target.checked)} />販売終了の商品も表示</label><p className="muted">{list.length}件。共通商品は公式サイト掲載の栄養成分（地域・時期により実物の表示と異なる場合があります）。星はこの端末のお気に入りです。</p>
        <div className="products">{list.slice(0, shown).map(p => <div className="product" key={p.id}><div className="product-icon"><Leaf size={22} /></div><div><span className={'badge ' + p.quality}>{qualityLabels[p.quality]}</span> <span className={'badge ' + p.origin}>{p.origin === 'personal' ? '個人' : '共通'}</span>{p.status === 'discontinued' && <span className="badge ended">販売終了</span>}<h3>{p.name}</h3><small>{p.brand || 'メーカー未設定'} / {p.category}{p.sourceUrl && <> · <a href={p.productUrl ?? p.sourceUrl} target="_blank" rel="noreferrer">情報元 <ExternalLink size={11} /></a></>} · 更新 {p.updatedAt}</small><p>{p.serving.amount}{p.serving.unit}あたり · {numberText(p.nutrition.calories)} kcal</p><p>P {numberText(p.nutrition.protein)} / F {numberText(p.nutrition.fat)} / C {numberText(p.nutrition.carbs)} g</p></div><div className="product-actions"><button type="button" className="icon-button" aria-label={p.name + 'のお気に入り'} aria-pressed={favorites.includes(p.id)} disabled={busy} onClick={() => run(() => toggleFavorite(p.id), favorites.includes(p.id) ? 'お気に入りから外しました' : 'お気に入りに追加しました')}><Star size={19} fill={favorites.includes(p.id) ? 'currentColor' : 'none'} /></button><button type="button" aria-label={p.name + 'を追加'} className="add-button" onClick={() => add(p)}><Plus size={19} /></button></div></div>)}</div>{list.length > shown && <button type="button" className="wide" onClick={() => setShown(n => n + PAGE)}>さらに表示（残り{list.length - shown}件）</button>}{!list.length && <p className="empty">該当する商品がありません。検索条件を変えるか、手動登録をご利用ください。</p>}</>}
      {source === 'history' && <><p className="muted">過去の分量・栄養値をそのまま、今回の食事に追加します。日時は今回の入力欄で指定してください。</p>{[...meals].sort((a, b) => b.at.localeCompare(a.at)).map(m => <article className="history-item" key={m.id}><small>{jstInput(new Date(m.at)).replace('T', ' ')} / {m.kind}</small><h3>{m.items.map(i => `${i.product.name} ×${i.quantity}`).join('、')}</h3><p>{numberText(m.total.calories)} kcal</p><button type="button" onClick={() => loadHistory(m)}>この食事をまとめて追加</button></article>)}{!meals.length && <p className="empty">保存した食事がここに表示されます。</p>}</>}
      {source === 'manual' && <ManualProduct products={products} run={run} busy={busy} onAdded={p => { add(p); setSource('products'); }} />}
      {source === 'ai' && <ProductPaste products={products} run={run} busy={busy} onAdded={ps => { ps.forEach(add); setSource('products'); }} />}
    </section><section className="card"><Snacks products={products} daily={daily} goal={goal} onAdd={add} /><p className="muted">選択した集計日の保存済み食事＋今回の食事で計算します。編集中の元の食事は二重計上しません。</p></section></div>
    <form className="card basket" onSubmit={e => {
      e.preventDefault(); if (saving.current) return;
      const form = new FormData(e.currentTarget), actualAt = fromInput(String(form.get('at')));
      const finalKind = manualKind ? kind : mealKind(actualAt);
      saving.current = true;
      void run(async () => {
        if (cart.some(i => !Number.isFinite(i.quantity) || i.quantity <= 0 || i.quantity > 1000)) throw Error('分量は0より大きく、基準量の1000倍以下で入力してください');
        const meal = await saveMeal(actualAt, finalKind, cart, note, { id: initial?.edit ? initial.meal.id : undefined, targetShare: share / 100, targets });
        if (!initial?.edit) { saved.current = true; await saveDraft(null); }
        onSaved(meal.day);
      }, initial?.edit ? '食事を更新しました' : '食事をまとめて保存しました').finally(() => { saving.current = false; });
    }}><span className="eyebrow">ONE MEAL, TOGETHER</span><h2>{initial?.edit ? '食事を編集' : '今回の食事'} <small>{cart.length}品</small></h2>
      <label>実際の日時（日本時間）<input name="at" type="datetime-local" required value={at} onInput={e => { const value = e.currentTarget.value; setAt(value); if (!manualKind && value) { try { setKind(mealKind(fromInput(value))); } catch { /* incomplete */ } } }} onChange={e => setAt(e.target.value)} /></label><p className="muted">集計日：{day || '日時を入力してください'}（{boundaryLabel()}区切り）</p>
      <label>食事区分<select value={kind} onChange={e => { setKind(e.target.value); setManualKind(true); }}>{[...new Set(['朝食', '昼食', '夕食', '夜食', '間食', kind])].map(k => <option key={k}>{k}</option>)}</select></label><button type="button" className="small-button" onClick={() => { setManualKind(false); if (iso) setKind(mealKind(iso)); }}>時刻からの自動提案に戻す</button>
      {cart.map((item, index) => { const unit = units[index] ?? 'portion', grams = portionGrams(item.product); return <div className="portion-row" key={index}><div className="section-heading"><strong>{item.product.name}</strong><button type="button" aria-label={item.product.name + 'を選択解除'} className="icon-button" onClick={() => { setCart(c => c.filter((_, j) => index !== j)); setUnits({}); }}><Trash2 size={16} /></button></div><small>{qualityLabels[item.product.quality]} · 基準量 {item.product.serving.amount}{item.product.serving.unit}{grams && item.product.serving.unit !== 'g' ? `（${grams}g）` : ''}</small><div className="portion-input"><label>分量<input aria-label={item.product.name + 'の分量'} type="number" min="0.001" step="any" required value={Number.isFinite(item.quantity) ? Number((unit === 'grams' ? item.quantity * grams! : item.quantity).toFixed(4)) : ''} onChange={e => { const amount = e.target.valueAsNumber; setCart(c => c.map((x, j) => j === index ? { ...x, quantity: unit === 'grams' ? amount / grams! : amount } : x)); }} /></label><label>入力単位<select aria-label={item.product.name + 'の入力単位'} value={unit} onChange={e => setUnits(u => ({ ...u, [index]: e.target.value as 'portion' | 'grams' }))}><option value="portion">基準量の倍数</option>{grams && <option value="grams">グラム</option>}</select></label><div className="stepper"><button type="button" className="icon-button" aria-label={item.product.name + 'を0.5減らす'} disabled={!(item.quantity > 0.5)} onClick={() => setCart(c => c.map((x, j) => j === index ? { ...x, quantity: Math.max(0.5, x.quantity - 0.5) } : x))}><Minus size={15} /></button><button type="button" className="icon-button" aria-label={item.product.name + 'を0.5増やす'} onClick={() => setCart(c => c.map((x, j) => j === index ? { ...x, quantity: (Number.isFinite(x.quantity) ? x.quantity : 0) + 0.5 } : x))}><Plus size={15} /></button></div></div><small>{numberText(item.quantity)} ×基準量 / {numberText(item.product.nutrition.calories == null || !Number.isFinite(item.quantity) ? null : item.product.nutrition.calories * item.quantity)} kcal</small></div>; })}
      {!cart.length && <p className="empty">商品を選んで追加してください。</p>}
      <label>メモ<textarea value={note} maxLength={5000} onChange={e => setNote(e.target.value)} placeholder="食事のメモ（任意）" /></label>
      <NutritionGrid value={total} />
      <label>今回の食事への目標配分（1日の%）<input type="number" min="0.1" max="100" step="any" value={share} onChange={e => setShare(e.target.valueAsNumber)} required /></label><p className="muted">初期値は1日目標の1/3。夜勤の食事回数や間食に合わせて調整できます。採点には保存時の目標値を固定して使用します。</p>
      {cart.length > 0 && <Evaluation value={total} targets={targets} sample={sample} />}
      <button className="primary wide" disabled={busy || !cart.length || !iso}><Check size={17} />{initial?.edit ? '変更を保存' : 'この食事を保存'}</button>
      <div className="draft-actions"><button type="button" disabled={!cart.length} onClick={() => run(async () => { cart.forEach(i => quantityFromAmount(i.product, i.quantity, 'portion')); await navigator.clipboard.writeText(JSON.stringify({ at: iso, day, kind, items: cart, total, note }, null, 2)); setCopied(true); }, '登録内容をコピーしました')}>{copied ? 'コピー済み' : '登録内容をコピー'}</button>{!initial?.edit && <button type="button" disabled={!cart.length} onClick={() => { setCart([]); setUnits({}); setNote(''); }}>カートを空にする</button>}<button type="button" onClick={onCancel}>{initial?.edit ? 'キャンセル' : '一覧に戻る（カートは保持）'}</button></div>
    </form>
  </div>;
}

function ManualProduct({ products, run, busy, onAdded }: { products: Product[]; run: Run; busy: boolean; onAdded: (p: Product) => void }) {
  const [draft, setDraft] = useState<Product | null>(null);
  return <><p className="muted">栄養値は下記の基準量あたりで入力。不明な項目は空欄にします。</p><form onSubmit={e => {
    e.preventDefault(); const f = new FormData(e.currentTarget), get = (k: string) => String(f.get(k) ?? '').trim();
    void run(async () => { const p = productSchema.parse({ id: crypto.randomUUID(), name: get('name'), brand: get('brand'), category: get('category'), serving: { amount: Number(get('amount')), unit: get('unit'), grams: get('grams') ? Number(get('grams')) : null }, nutrition: Object.fromEntries(nutrients.map(n => [n.key, get(n.key) === '' ? null : Number(get(n.key))])), quality: get('quality'), sourceUrl: get('sourceUrl') || null, updatedAt: jstInput().slice(0, 10), origin: 'personal', ingredients: get('ingredients') }); setDraft(p); }, '内容を確認して商品を保存してください');
  }}><label>商品名<input name="name" required maxLength={500} /></label><div className="form-grid"><label>ブランド・店舗<input name="brand" placeholder="コンビニ、スーパー、飲食店など" maxLength={200} /></label><label>カテゴリ<input name="category" list="food-categories" defaultValue="その他" required maxLength={100} /></label><datalist id="food-categories">{['おにぎり', '弁当', '惣菜', '飲料', '間食', '自炊', '外食', 'その他'].map(c => <option key={c}>{c}</option>)}</datalist><label>基準量<input name="amount" type="number" min="0.01" step="any" defaultValue="1" required /></label><label>基準量の単位<select name="unit">{['食', '個', '包装', 'g', 'ml', '本', '皿'].map(u => <option key={u}>{u}</option>)}</select></label><label>基準量の重量（g・任意）<input name="grams" type="number" min="0.01" step="any" /></label><label>栄養値の出典区分<select name="quality"><option value="label">パッケージ表示値</option><option value="estimated">推定値（自炊など）</option><option value="official">公式値</option><option value="sample">サンプル</option></select></label>{nutrients.map(n => <label key={n.key}>{n.label}（{n.unit}）<input name={n.key} type="number" min="0" step="any" /></label>)}</div><label>出典URL（公式値は必須）<input name="sourceUrl" type="url" /></label><label>材料・分量（自炊など）<textarea name="ingredients" maxLength={5000} /></label><button disabled={busy}>登録内容を確認</button></form>{draft && <div className="import-preview"><h3>{draft.name} / {qualityLabels[draft.quality]}</h3><p>基準量：{draft.serving.amount}{draft.serving.unit}</p><NutritionGrid value={draft.nutrition} />{products.some(p => p.name === draft.name) && <p role="alert">同名の商品が登録されています。別商品として追加します。</p>}<button className="primary" disabled={busy} onClick={() => run(async () => { await db.products.add(draft); onAdded(draft); setDraft(null); }, '個人商品を保存し、今回の食事に追加しました')}>商品を保存して食事に追加</button><button onClick={() => setDraft(null)}>戻る</button></div>}</>;
}

function ProductPaste({ products, run, busy, onAdded }: { products: Product[]; run: Run; busy: boolean; onAdded: (p: Product[]) => void }) {
  const [raw, setRaw] = useState(''), [preview, setPreview] = useState<Product[]>([]);
  return <><p className="muted">ChatGPTで読み取った商品のJSONを貼り付けます。products配列に複数商品を指定できます。不明な栄養項目はnull、推定値はquality: estimated、表示値はlabel。</p><label>商品JSON<textarea className="json-input" value={raw} onChange={e => { setRaw(e.target.value); setPreview([]); }} /></label><button disabled={busy || !raw} onClick={() => run(async () => { if (raw.length > 5_000_000) throw Error('5MB以下にしてください'); const value = JSON.parse(raw), array = Array.isArray(value) ? value : value.products; if (!Array.isArray(array) || !array.length || array.length > 10000) throw Error('1〜10000件のproducts配列を指定してください'); const ps = array.map(x => productSchema.parse({ ...x, origin: 'personal' })); if (new Set(ps.map(p => p.id)).size !== ps.length) throw Error('入力内のIDが重複しています'); setPreview(ps); }, '検証しました。内容を確認してください')}>内容を検証</button>{preview.length > 0 && <div className="import-preview">{preview.map(p => <div key={p.id}><h3>{p.name} / {qualityLabels[p.quality]}</h3><p>{p.serving.amount}{p.serving.unit}あたり</p><NutritionGrid value={p.nutrition} />{products.some(x => x.id === p.id || x.name === p.name) && <p role="alert">既存の商品とIDまたは名前が重複。同じIDは更新します。</p>}</div>)}<button disabled={busy} className="primary" onClick={() => run(async () => { await db.transaction('rw', db.products, db.importHistory, async () => { await db.products.bulkPut(preview); await db.importHistory.add({ id: crypto.randomUUID(), at: new Date().toISOString(), kind: 'ai-products', count: preview.length }); }); onAdded(preview); setRaw(''); setPreview([]); }, '商品を保存し、今回の食事に追加しました')}>確認して保存・食事に追加</button></div>}</>;
}
