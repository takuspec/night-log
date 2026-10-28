import Dexie,{type Table} from 'dexie';
import {z} from 'zod';
import {type Backup,type Product,type Meal,mealSchema,nutritionSchema,exerciseSchema,bodySchema,sleepSchema,stepSchema,goalSchema,settingSchema,historySchema,validateBackup,dayKey,totalNutrition,productSchema,parseBoundary,boundaryValue,setBoundary} from './model';
export class HealthDB extends Dexie{
 products!:Table<Product,string>;meals!:Table<Meal,string>;exercises!:Table<z.infer<typeof exerciseSchema>,string>;stepRecords!:Table<z.infer<typeof stepSchema>,string>;bodyMeasurements!:Table<z.infer<typeof bodySchema>,string>;sleepRecords!:Table<z.infer<typeof sleepSchema>,string>;goals!:Table<z.infer<typeof goalSchema>,string>;settings!:Table<z.infer<typeof settingSchema>,string>;importHistory!:Table<z.infer<typeof historySchema>,string>;
 constructor(name='health-tracker-db'){super(name);this.version(1).stores({products:'id,name,origin',meals:'id,day,at',exercises:'id,day,at',stepRecords:'id,day',bodyMeasurements:'id,day,at',sleepRecords:'id,day',goals:'id,at',settings:'id',importHistory:'id,at'});this.version(2).stores({}).upgrade(async tx=>{await tx.table('products').toCollection().modify(p=>{p.nutrition.fiber??=null});await tx.table('meals').toCollection().modify(m=>{m.targetShare??=1/3;for(const i of m.items)i.product.nutrition.fiber??=null;m.total=totalNutrition(m.items)})});}
}
export const db=new HealthDB();
export async function initialize(database=db){await database.transaction('rw',database.products,database.settings,async()=>{if(!await database.settings.get('initialized'))await database.settings.bulkPut([{id:'initialized',value:'1'},{id:'dayBoundary',value:boundaryValue(540)}]);
 // 旧版で同梱していた形式確認用サンプル商品は、実データの共通商品DBに置き換える（過去の食事はスナップショットなので影響しない）
 await database.products.filter(p=>p.origin==='common'&&p.quality==='sample').delete()});
 setBoundary(parseBoundary((await database.settings.get('dayBoundary'))?.value))}
export async function backup(database=db):Promise<Backup>{return database.transaction('r',database.tables,async()=>{const data:Record<string,unknown>={};for(const t of database.tables)data[t.name]=await t.toArray();return validateBackup({schemaVersion:1,app:'night-log',createdAt:new Date().toISOString(),data})})}
export async function restore(input:unknown,replace:boolean,database=db){const b=validateBackup(input);await database.transaction('rw',database.tables,async()=>{for(const t of database.tables){if(replace)await t.clear();await t.bulkPut(b.data[t.name as keyof Backup['data']])}});setBoundary(parseBoundary((await database.settings.get('dayBoundary'))?.value))}
export async function saveMeal(at:string,kind:string,items:Meal['items'],note:string,options:{id?:string;targetShare?:number;targets?:unknown}={},database=db){
 const m=mealSchema.parse({id:options.id??crypto.randomUUID(),at,day:dayKey(at),kind,items,total:totalNutrition(items),note,targetShare:options.targetShare??1/3,targets:options.targets?nutritionSchema.parse(options.targets):null});
 await database.transaction('rw',database.meals,async()=>{if(options.id&&!await database.meals.get(options.id))throw Error('編集元の食事が見つかりません');await database.meals.put(m)});return m;
}
export async function toggleFavorite(id:string){await db.transaction('rw',db.settings,async()=>{const key='favorite:'+id;if(await db.settings.get(key))await db.settings.delete(key);else await db.settings.put({id:key,value:'1'})})}
export const healthSchema=z.object({schemaVersion:z.literal(1),source:z.literal('apple-health-shortcuts'),records:z.array(z.discriminatedUnion('type',[
 z.object({type:z.literal('steps'),id:z.string().optional(),startAt:z.string().datetime({offset:true}),endAt:z.string().datetime({offset:true}),value:z.number().int().min(0),unit:z.literal('count')}),
 z.object({type:z.literal('body'),id:z.string().optional(),at:z.string().datetime({offset:true}),weight:z.number().positive().max(500),bodyFat:z.number().min(0).max(100).nullable().default(null)}),
 z.object({type:z.literal('sleep'),id:z.string().optional(),startAt:z.string().datetime({offset:true}),endAt:z.string().datetime({offset:true}),stages:z.string().default('')})])).max(10000)});
export async function importHealth(input:unknown){const h=healthSchema.parse(input);let count=0;await db.transaction('rw',[db.stepRecords,db.bodyMeasurements,db.sleepRecords,db.importHistory],async()=>{for(const r of h.records){const at=r.type==='body'?r.at:r.startAt;const end=r.type==='body'?'':new Date(r.endAt).toISOString();const id=`${h.source}:${r.type}:${r.id??new Date(at).toISOString()+':'+end}`;const source=h.source;
 if(r.type==='steps'){if(Date.parse(r.endAt)<=Date.parse(r.startAt))throw Error('歩数の期間が不正です');if(dayKey(r.startAt)!==dayKey(new Date(Date.parse(r.endAt)-1)))throw Error('歩数は09:00をまたがない区間に分けてください。日別への比例配分は行いません。');const overlaps=await db.stepRecords.filter(s=>s.id!==id&&s.source===source&&Date.parse(s.startAt)<Date.parse(r.endAt)&&Date.parse(s.endAt)>Date.parse(r.startAt)).count();if(overlaps)throw Error('既存の歩数と期間が重複しています');if(!await db.stepRecords.get(id)){await db.stepRecords.add({id,source,startAt:r.startAt,endAt:r.endAt,day:dayKey(at),value:r.value});count++}}
 if(r.type==='body'&&!await db.bodyMeasurements.get(id)){await db.bodyMeasurements.add({id,source,at:r.at,day:dayKey(at),weight:r.weight,bodyFat:r.bodyFat,correction:''});count++}
 if(r.type==='sleep'&&!await db.sleepRecords.get(id)){const minutes=(Date.parse(r.endAt)-Date.parse(r.startAt))/60000;if(minutes<=0||minutes>2880)throw Error('睡眠時間が不正です');await db.sleepRecords.add({id,source,startAt:r.startAt,endAt:r.endAt,day:dayKey(r.endAt),minutes,stages:r.stages,correction:''});count++}
 }await db.importHistory.add({id:crypto.randomUUID(),at:new Date().toISOString(),kind:'apple-health-shortcuts',count})});return count}

// ---------- 共通商品DB（GitHub上のJSON） ----------
// index.json（店舗ごとのファイル一覧）を取得し、各店舗のファイルを取り込む。取り込んだ商品はIndexedDBに残るため、通信できなくても検索できる。
export const defaultCommonDbUrl=()=>new URL('product-db/index.json',document.baseURI).href;
const manifestSchema=z.object({schemaVersion:z.literal(1),updatedAt:z.string().optional(),stores:z.array(z.object({id:z.string().min(1),name:z.string(),file:z.string().min(1),updatedAt:z.string().optional(),count:z.number().optional()})).min(1)});
const storeFileSchema=z.object({schemaVersion:z.literal(1),store:z.string().min(1),storeName:z.string(),updatedAt:z.string(),products:z.array(z.unknown()).max(50000)});
export type CommonDbStatus={url:string;fetchedAt:string;updatedAt:string;stores:{id:string;name:string;updatedAt:string;count:number;active:number;skipped:number}[]};
export async function commonDbStatus(database=db):Promise<CommonDbStatus|null>{const v=(await database.settings.get('commonDb:status'))?.value;return v?JSON.parse(v):null}
export async function commonDbUrl(database=db){return (await database.settings.get('commonDb:url'))?.value||defaultCommonDbUrl()}
async function getJson(url:string,fetcher:typeof fetch){let r:Response;try{r=await fetcher(url,{credentials:'omit',cache:'no-cache',signal:AbortSignal.timeout(30000)})}catch{throw Error('共通商品DBに接続できません。通信状態とURLを確認してください。取得済みの商品はそのまま検索できます: '+url)}if(!r.ok)throw Error(`取得に失敗しました（${r.status}）: ${url}`);return r.json()}
export async function syncCommonProducts(url?:string,database=db,fetcher:typeof fetch=fetch){
 const base=url||await commonDbUrl(database);const manifest=manifestSchema.parse(await getJson(base,fetcher));
 const files:z.infer<typeof storeFileSchema>[]=[];for(const s of manifest.stores){const f=storeFileSchema.parse(await getJson(new URL(s.file,base).href,fetcher));if(f.store!==s.id)throw Error('店舗ファイルの内容が一覧と一致しません: '+s.file);files.push(f)}
 const status:CommonDbStatus={url:base,fetchedAt:new Date().toISOString(),updatedAt:manifest.updatedAt??files.map(f=>f.updatedAt).sort().at(-1)??'',stores:[]};
 await database.transaction('rw',database.products,database.settings,async()=>{
  for(const f of files){
   // 形式に合わない商品は取り込まずに件数だけ記録する（値を補ったり推測したりしない）
   const products:Product[]=[];let skipped=0;
   for(const raw of f.products){const r=productSchema.safeParse({...(raw as object),origin:'common',store:f.store});if(r.success&&r.data.id.startsWith(f.store+':'))products.push(r.data);else skipped++}
   const ids=new Set(products.map(p=>p.id));
   // 一覧から消えた商品は削除せず販売終了扱いにする（IDは維持）
   const gone=await database.products.filter(p=>p.origin==='common'&&p.store===f.store&&!ids.has(p.id)&&p.status!=='discontinued').toArray();
   await database.products.bulkPut([...products,...gone.map(p=>({...p,status:'discontinued' as const,discontinuedAt:p.discontinuedAt??f.updatedAt}))]);
   status.stores.push({id:f.store,name:f.storeName,updatedAt:f.updatedAt,count:products.length,active:products.filter(p=>p.status==='active').length,skipped});
  }
  // 取得元URLは利用者が指定したときだけ保存する（未指定ならアプリと同じ場所の product-db/ を使い続ける）
  await database.settings.bulkPut([{id:'commonDb:status',value:JSON.stringify(status)},...(url?[{id:'commonDb:url',value:base}]:[])]);
 });
 return status;
}

// ---------- 集計開始時刻の変更 ----------
// 保存済みの記録の集計日を新しい開始時刻で付け直す。歩数は開始時刻、睡眠は終了時刻の集計日に計上する。
export async function changeDayBoundary(min:number,database=db){
 const value=boundaryValue(min),key=(v:string)=>dayKey(v,min);
 await database.transaction('rw',[database.meals,database.exercises,database.bodyMeasurements,database.sleepRecords,database.stepRecords,database.settings],async()=>{
  await database.meals.toCollection().modify(m=>{m.day=key(m.at)});
  await database.exercises.toCollection().modify(r=>{r.day=key(r.at)});
  await database.bodyMeasurements.toCollection().modify(r=>{r.day=key(r.at)});
  await database.sleepRecords.toCollection().modify(r=>{r.day=key(r.endAt)});
  await database.stepRecords.toCollection().modify(r=>{r.day=key(r.startAt)});
  await database.settings.put({id:'dayBoundary',value});
 });
 setBoundary(min);
}

// ---------- 未保存の食事（カート）の一時保持 ----------
export type MealDraft={items:Meal['items'];at:string;kind:string;manualKind:boolean;note:string};
export async function loadDraft(database=db):Promise<MealDraft|null>{const v=(await database.settings.get('draft:meal'))?.value;if(!v)return null;try{return JSON.parse(v)}catch{return null}}
export async function saveDraft(draft:MealDraft|null,database=db){if(!draft||!draft.items.length)await database.settings.delete('draft:meal');else await database.settings.put({id:'draft:meal',value:JSON.stringify(draft)})}
