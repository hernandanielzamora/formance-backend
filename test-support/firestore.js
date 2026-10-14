import {exercises,workouts,routineTemplates} from '../scripts/fixtures/training.js';
export function fixture(){
  const store=new Map([['users/user',{goal:'fat_loss'}]]);
  for(const e of exercises) store.set(`exercises/${e.id}`,{...e,ownerId:'admin',visibility:'public',archived:false});
  for(const w of workouts) store.set(`workouts/${w.id}`,{...w,ownerId:'admin',visibility:'public',archived:false});
  for(const r of routineTemplates) store.set(`routines/${r.id}`,{...r,ownerId:'admin',visibility:'public',archived:false,version:1,sourceTemplateId:null});
  function ref(path){return{path,collection:name=>collection(`${path}/${name}`),async get(){return{id:path.split('/').pop(),exists:store.has(path),data:()=>structuredClone(store.get(path))};},async set(data){store.set(path,structuredClone(data));}};}
  function collection(path,filters=[]){const query={doc:id=>ref(`${path}/${id}`),where:(key,op,value)=>collection(path,[...filters,[key,op,value]]),limit:count=>({get:async()=>{const snapshot=await collection(path,filters).get();return {docs:snapshot.docs.slice(0,count)};}}),async get(){return{docs:[...store.entries()].filter(([key,value])=>key.startsWith(`${path}/`)&&!key.slice(path.length+1).includes('/')&&filters.every(([k,op,v])=>op==='>='?value[k]>=v:op==='<='?value[k]<=v:value[k]===v)).map(([key,value])=>({id:key.split('/').pop(),data:()=>structuredClone(value)}))};}};return query;}
  const db={collection,batch(){const writes=[];return{set:(r,v)=>writes.push([r.path,v]),async commit(){for(const[p,v]of writes)store.set(p,structuredClone(v));}};},async runTransaction(callback){const batch=db.batch();const result=await callback({get:r=>r.get(),set:batch.set});await batch.commit();return result;}};
  return{db,store};
}
