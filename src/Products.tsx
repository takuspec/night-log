import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, RefreshCw, Search, Trash2, Database } from 'lucide-react';
import { db, syncCommonProducts, commonDbStatus, commonDbUrl } from './db';
import { type Product, productSchema, jstInput, qualityLabels } from './model';
import { matchesProduct, nutrients } from './foodLogic';
import { numberText } from './NutritionView';
import type { Run } from './Food';

// 個人商品の管理と、共通商品DBの取得状況
export function Products({ products, run, busy }: { products: Product[]; run: Run; busy: boolean }) {
  const [q, setQ] = useState(''), [editing, setEditing] = useState<Product | 'new' | null>(null);
  const personal = products.filter(p => p.origin === 'personal' && matchesProduct(p, q)).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return <>
    <CommonDb products={products} run={run} busy={busy} />
    <section className="card">
      <div className="section-heading"><div><span className="eyebrow">MY PRODUCTS</span><h2>個人商品 <small>{products.filter(p => p.origin === 'personal').length} 件</small></h2></div><button className="primary" disabled={busy} onClick={() => setEditing('new')}><Plus size={17} />商品を登録</button></div>
      <p className="muted">共通商品DBにない商品を、この端末に登録します。食事登録の検索に共通商品と一緒に表示されます。編集・削除しても、登録済みの食事の栄養値は変わりません。</p>
      {editing && <ProductForm key={editing === 'new' ? 'new' : editing.id} product={editing === 'new' ? null : editing} products={products} run={run} busy={busy} onDone={() => setEditing(null)} />}
      <label className="search"><Search size={18} /><input aria-label="個人商品を検索" placeholder="商品名・メーカー" value={q} onChange={e => setQ(e.target.value)} /></label>
      {personal.map(p => <div className="record-row product-row" key={p.id}><div><strong>{p.name}</strong><small> {p.brand || 'メーカー未設定'} / {p.category} / {p.serving.amount}{p.serving.unit}{p.serving.grams ? `（${p.serving.grams}g）` : ''}あたり / {qualityLabels[p.quality]}{p.shops?.length ? ` / ${p.shops.join('・')}` : ''}</small><p className="muted">{nutrients.map(n => `${n.label} ${numberText(p.nutrition[n.key])}${p.nutrition[n.key] == null ? '' : n.unit}`).join(' · ')}</p></div><div className="product-actions"><button className="icon-button" aria-label={p.name + 'を編集'} disabled={busy} onClick={() => setEditing(p)}><Pencil size={16} /></button><button className="icon-button" aria-label={p.name + 'を削除'} disabled={busy} onClick={() => { if (confirm(`「${p.name}」を削除しますか？（登録済みの食事の記録は残ります）`)) run(() => db.products.delete(p.id), '個人商品を削除しました'); }}><Trash2 size={16} /></button></div></div>)}
      {!personal.length && <p className="empty">{q ? '該当する個人商品がありません。' : 'まだ個人商品はありません。'}</p>}
    </section>
  </>;
}

function CommonDb({ products, run, busy }: { products: Product[]; run: Run; busy: boolean }) {
  const status = useLiveQuery(() => commonDbStatus(), []);
  const url = useLiveQuery(() => commonDbUrl(), []);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const common = products.filter(p => p.origin === 'common');
  return <section className="card">
    <div className="section-heading"><div><span className="eyebrow">COMMON DATABASE</span><h2>共通商品DB</h2></div><button disabled={busy} onClick={() => run(async () => { await syncCommonProducts(); }, '共通商品DBを更新しました')}><RefreshCw size={16} />今すぐ更新</button></div>
    {status ? <><p className="muted">最終取得 {new Date(status.fetchedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} / データ更新日 {status.updatedAt}</p>
      <div className="db-stores">{status.stores.map(s => <div key={s.id}><Database size={18} /><strong>{s.name}</strong><span>{s.active}件 販売中{s.count !== s.active ? ` / 全${s.count}件` : ''}</span><small>更新日 {s.updatedAt}{s.skipped ? ` / 形式不正で除外 ${s.skipped}件` : ''}</small></div>)}</div>
      <p className="muted">この端末に保存済みの共通商品 {common.length} 件（販売終了 {common.filter(p => p.status === 'discontinued').length} 件を含む）。通信できないときも、取得済みの商品を検索できます。</p></>
      : <p className="muted">まだ取得していません。「今すぐ更新」で取得します。</p>}
    <details><summary>取得元URL</summary>
      <p className="muted">GitHubに置いた共通商品DBの index.json（raw.githubusercontent.com など）を指定できます。空欄にすると、アプリと一緒に配信している product-db/index.json を使います。</p>
      <div className="url-row"><input aria-label="共通商品DBのURL" type="url" value={draftUrl ?? url ?? ''} onChange={e => setDraftUrl(e.target.value)} placeholder="https://raw.githubusercontent.com/…/product-db/index.json" /><button disabled={busy || draftUrl === null} onClick={() => run(async () => {
        const value = draftUrl!.trim();
        if (value && new URL(value).protocol !== 'https:' && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(value)) throw Error('HTTPSのURLを指定してください');
        await syncCommonProducts(value || undefined);
        if (!value) await db.settings.delete('commonDb:url');
        setDraftUrl(null);
      }, '取得元を変更して共通商品DBを更新しました')}>保存して取得</button></div>
    </details>
  </section>;
}

function ProductForm({ product, products, run, busy, onDone }: { product: Product | null; products: Product[]; run: Run; busy: boolean; onDone: () => void }) {
  const p = product;
  return <form className="import-preview" onSubmit={e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), get = (k: string) => String(f.get(k) ?? '').trim();
    void run(async () => {
      const next = productSchema.parse({
        ...(p ?? {}), id: p?.id ?? 'personal:' + crypto.randomUUID(), origin: 'personal',
        name: get('name'), brand: get('brand'), category: get('category') || 'その他',
        serving: { amount: Number(get('amount')), unit: get('unit'), grams: get('grams') ? Number(get('grams')) : null },
        nutrition: Object.fromEntries(nutrients.map(n => [n.key, get(n.key) === '' ? null : Number(get(n.key))])),
        quality: get('quality'), sourceUrl: get('sourceUrl') || null, updatedAt: jstInput().slice(0, 10),
        shops: [...new Set(get('shops').split(/[,、・\s]+/).filter(Boolean))],
      });
      if (products.some(x => x.id !== next.id && x.origin === 'personal' && x.name === next.name && x.brand === next.brand) && !confirm('同じ名前・メーカーの個人商品があります。別の商品として保存しますか？')) return;
      await db.products.put(next);
      onDone();
    }, p ? '個人商品を更新しました' : '個人商品を登録しました');
  }}>
    <h3>{p ? '個人商品を編集' : '個人商品を登録'}</h3>
    <p className="muted">栄養値は基準量あたりで入力します。わからない項目は空欄（不明）のままにしてください。0とは区別して保存します。</p>
    <label>商品名<input name="name" required maxLength={500} defaultValue={p?.name} /></label>
    <div className="form-grid">
      <label>メーカー・販売店<input name="brand" maxLength={200} defaultValue={p?.brand} placeholder="セブン-イレブン、スーパー名など" /></label>
      <label>カテゴリ<input name="category" list="personal-categories" maxLength={100} defaultValue={p?.category ?? 'その他'} /></label>
      <datalist id="personal-categories">{[...new Set(['おにぎり', '弁当', '惣菜', 'パン', '飲料', '間食', '自炊', '外食', 'その他', ...products.map(x => x.category)])].map(c => <option key={c}>{c}</option>)}</datalist>
      <label>基準量<input name="amount" type="number" min="0.01" step="any" required defaultValue={p?.serving.amount ?? 1} /></label>
      <label>基準量の単位<input name="unit" list="serving-units" required maxLength={20} defaultValue={p?.serving.unit ?? '個'} /></label>
      <datalist id="serving-units">{['個', '食', '包装', '本', '枚', '杯', '皿', 'g', 'ml'].map(u => <option key={u}>{u}</option>)}</datalist>
      <label>基準量の重さ（g・任意。グラム入力に使います）<input name="grams" type="number" min="0.01" step="any" defaultValue={p?.serving.grams ?? ''} /></label>
      <label>買った店（「、」区切り・提案に使います）<input name="shops" maxLength={200} defaultValue={p?.shops?.join('、') ?? ''} placeholder="ローソン、ファミリーマート" /></label>
      <label>栄養値の出典<select name="quality" defaultValue={p?.quality ?? 'label'}><option value="label">パッケージ表示値</option><option value="official">公式サイト</option><option value="estimated">推定値（自炊など）</option></select></label>
      {nutrients.map(n => <label key={n.key}>{n.label}（{n.unit}）<input name={n.key} type="number" min="0" step="any" defaultValue={p?.nutrition[n.key] ?? ''} /></label>)}
    </div>
    <label>情報元URL（公式サイトの場合は必須）<input name="sourceUrl" type="url" defaultValue={p?.sourceUrl ?? ''} /></label>
    <div className="draft-actions"><button className="primary" disabled={busy}>{p ? '変更を保存' : '登録する'}</button><button type="button" onClick={onDone}>閉じる</button></div>
  </form>;
}
