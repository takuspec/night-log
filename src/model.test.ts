import {describe,it,expect,afterEach} from 'vitest';
import 'fake-indexeddb/auto';
import {dayKey,shiftDay,totalNutrition,sampleProducts,validateBackup} from './model';
import {HealthDB,backup,restore,db,importHealth} from './db';
describe('09:00 JST boundary',()=>{
 it('08:59:59 belongs to previous day',()=>expect(dayKey('2026-10-29T08:59:59+09:00')).toBe('2026-10-28'));
 it('09:00:00 belongs to new day',()=>expect(dayKey('2026-10-29T09:00:00+09:00')).toBe('2026-10-29'));
 it('handles year and leap boundaries',()=>{expect(dayKey('2027-01-01T03:00:00+09:00')).toBe('2026-12-31');expect(shiftDay('2024-03-01',-1)).toBe('2024-02-29')});
});
describe('nutrition snapshots',()=>{
 it('sums fractions and multiple products',()=>expect(totalNutrition([{product:sampleProducts[0],quantity:0.5},{product:sampleProducts[1],quantity:2}]).calories).toBe(320));
 it('preserves unknown rather than converting to zero',()=>expect(totalNutrition([{product:{...sampleProducts[0],nutrition:{...sampleProducts[0].nutrition,protein:null}},quantity:1}]).protein).toBeNull());
});
describe('backup and persistence',()=>{
 let database=new HealthDB('test-health');
 afterEach(async()=>{await database.delete();database=new HealthDB('test-health')});
 it('round trips all tables, merges idempotently, replaces atomically',async()=>{await database.products.add(sampleProducts[0]);const b=await backup(database);await restore(b,false,database);expect(await database.products.count()).toBe(1);await database.products.add(sampleProducts[1]);await restore(b,true,database);expect(await database.products.count()).toBe(1);expect(await backup(database)).toMatchObject({data:b.data})});
 it('rejects invalid restore before clearing records',async()=>{await database.products.add(sampleProducts[0]);await expect(restore({schemaVersion:99},true,database)).rejects.toThrow();expect(await database.products.count()).toBe(1)});
 it('keeps meal snapshots when product changes',async()=>{await database.products.add(sampleProducts[0]);const items=[{product:structuredClone(sampleProducts[0]),quantity:1}];await database.meals.add({id:'m',at:'2026-10-29T00:00:00Z',day:'2026-10-29',kind:'食事1',items,total:totalNutrition(items),note:''});await database.products.update(sampleProducts[0].id,{nutrition:{...sampleProducts[0].nutrition,calories:999}});expect((await database.meals.get('m'))?.total.calories).toBe(180)});
 it('rejects duplicate IDs',async()=>{const b=await backup(database);b.data.products=[sampleProducts[0],sampleProducts[0]];expect(()=>validateBackup(b)).toThrow('重複')});
});
describe('health imports',()=>{
 afterEach(async()=>{await db.transaction('rw',db.tables,async()=>{for(const t of db.tables)await t.clear()})});
 const record={type:'steps',startAt:'2026-10-28T09:00:00+09:00',endAt:'2026-10-29T09:00:00+09:00',value:4250,unit:'count'};
 it('deduplicates repeated imports',async()=>{const input={schemaVersion:1,source:'apple-health-shortcuts',records:[record]};expect(await importHealth(input)).toBe(1);expect(await importHealth(input)).toBe(0);expect(await db.stepRecords.count()).toBe(1)});
 it('rolls back entire batch on overlapping periods',async()=>{await expect(importHealth({schemaVersion:1,source:'apple-health-shortcuts',records:[record,{...record,startAt:'2026-10-28T10:00:00+09:00'}]})).rejects.toThrow('重複');expect(await db.stepRecords.count()).toBe(0)});
 it('rejects day-crossing steps without inventing allocation',async()=>{await expect(importHealth({schemaVersion:1,source:'apple-health-shortcuts',records:[{...record,endAt:'2026-10-29T10:00:00+09:00'}]})).rejects.toThrow('またがない')});
 it('attributes cross-midnight sleep to end day',async()=>{await importHealth({schemaVersion:1,source:'apple-health-shortcuts',records:[{type:'sleep',startAt:'2026-10-28T23:00:00+09:00',endAt:'2026-10-29T10:00:00+09:00'}]});const s=(await db.sleepRecords.toArray())[0];expect(s.minutes).toBe(660);expect(s.day).toBe('2026-10-29')});
});
