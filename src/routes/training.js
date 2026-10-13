import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { sessionRoutes } from './training-sessions.js';
import { validateExercise, validateWorkout, validateRoutine, validateVersion, isAdmin, canManage, canRead, present, invalid } from '../services/training.js';
export const trainingRoutes = Router();
trainingRoutes.use(requireAuth,(req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(req.identity.email_verified !== true) return res.status(403).json({error:{code:'EMAIL_NOT_VERIFIED',message:'Verificá tu correo para continuar.'}});
  req.trainingUser=req.app.locals.firebase.db.collection('users').doc(req.identity.uid);
  next();
});
trainingRoutes.use(sessionRoutes);
async function visible(req,kind){
  const collection=req.app.locals.firebase.db.collection(kind);
  const snapshots=isAdmin(req.identity)?[await collection.get()]:await Promise.all([collection.where('visibility','==','public').get(),collection.where('ownerId','==',req.identity.uid).get()]);
  const items=new Map();
  for(const snapshot of snapshots) for(const doc of snapshot.docs){const item={...doc.data(),id:doc.id};if(!item.archived && canRead(req.identity,item)) items.set(item.id,present(req.identity,item));}
  return [...items.values()];
}
async function catalog(req){const [exercises,workouts,routines]=await Promise.all(['exercises','workouts','routines'].map(kind=>visible(req,kind)));return {exercises,workouts,routines};}
trainingRoutes.get('/catalog',async(req,res)=>{
  const [data,profile]=await Promise.all([catalog(req),req.trainingUser.get()]);
  const goal=profile.exists?profile.data().goal:null;
  res.json({exercises:data.exercises,workouts:data.workouts,userGoal:goal,routineTemplates:data.routines.filter(r=>r.visibility==='public').map(r=>({...r,recommended:(r.goals||[]).includes(goal)})).sort((a,b)=>Number(b.recommended)-Number(a.recommended))});
});
trainingRoutes.get('/routines',async(req,res)=>{
  const [items,settings]=await Promise.all([visible(req,'routines'),req.trainingUser.collection('settings').doc('training').get()]);
  const active=settings.exists?settings.data().activeRoutineId:null;
  res.json({routines:items.filter(r=>r.visibility==='private'),activeRoutineId:items.some(r=>r.id===active)?active:null});
});
function responseError(res,status,message){return res.status(status).json({error:{code:status===403?'FORBIDDEN':status===409?'VERSION_CONFLICT':'NOT_FOUND',message}});}
for(const kind of ['exercises','workouts','routines']){
  const singular=kind==='exercises'?'exercise':kind==='workouts'?'workout':'routine';
  async function input(req,update){
    const data=await catalog(req);
    if(kind==='exercises') return validateExercise(req.body,update);
    if(kind==='workouts') return validateWorkout(req.body,data.exercises,update);
    return validateRoutine(req.body,data.workouts,data.exercises,update);
  }
  trainingRoutes.post(`/${kind}`,async(req,res)=>{
    const fields=await input(req,false);const id=randomUUID();const now=new Date().toISOString();
    const item={...fields,id,ownerId:req.identity.uid,visibility:isAdmin(req.identity)?'public':'private',source:isAdmin(req.identity)?'catalog':'personal',version:1,archived:false,createdAt:now,updatedAt:now,...(kind==='routines'?{goals:fields.goals||[],description:fields.description || 'Rutina personalizable.',rationale:fields.rationale || 'Elegí la distribución según tu experiencia y disponibilidad.',level:fields.level || 'Personalizable'}:{})};
    const ref=req.app.locals.firebase.db.collection(kind).doc(id);const batch=req.app.locals.firebase.db.batch();
    batch.set(ref,item);batch.set(ref.collection('revisions').doc('1'),item);await batch.commit();
    res.status(201).json({[singular]:present(req.identity,item)});
  });
  for(const method of ['put','delete']) trainingRoutes[method](`/${kind}/:id`,async(req,res)=>{
    if(!/^[a-zA-Z0-9-]{1,80}$/.test(req.params.id)) return responseError(res,404,'Contenido no encontrado.');
    const ref=req.app.locals.firebase.db.collection(kind).doc(req.params.id);
    const before=await ref.get();
    if(!before.exists || before.data().archived || !canRead(req.identity,before.data())) return responseError(res,404,'Contenido no encontrado.');
    if(!canManage(req.identity,before.data())) return responseError(res,403,'Solo el propietario o un administrador puede modificar este contenido.');
    if(method==='delete' && (!req.body || Object.keys(req.body).some(k=>k!=='expectedVersion'))) invalid('Campos inválidos.');
    validateVersion(req.body||{});
    const fields=method==='put'?await input(req,true):null;
    const result=await req.app.locals.firebase.db.runTransaction(async transaction=>{
      const snapshot=await transaction.get(ref);
      if(!snapshot.exists || snapshot.data().archived || !canRead(req.identity,snapshot.data())) return {status:404,message:'Contenido no encontrado.'};
      const current=snapshot.data();
      if(!canManage(req.identity,current)) return {status:403,message:'No tenés permisos para modificar este contenido.'};
      if(current.version!==req.body.expectedVersion) return {status:409,message:'El contenido cambió. Recargá antes de continuar.'};
      const item={...current,...fields,version:current.version+1,updatedAt:new Date().toISOString(),...(method==='delete'?{archived:true}:{} )};
      // ownerId y visibilidad provienen del documento, no del formulario.
      transaction.set(ref,item);transaction.set(ref.collection('revisions').doc(String(item.version)),item);return {item};
    });
    if(result.status) return responseError(res,result.status,result.message);
    res.json({[singular]:present(req.identity,result.item)});
  });
}
trainingRoutes.put('/active-routine',async(req,res)=>{
  const id=req.body?.routineId;
  if(Object.keys(req.body||{}).length!==1 || typeof id!=='string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) invalid('Elegí una rutina válida.');
  const ref=req.app.locals.firebase.db.collection('routines').doc(id);
  const success=await req.app.locals.firebase.db.runTransaction(async transaction=>{
    const snapshot=await transaction.get(ref);
    if(!snapshot.exists || snapshot.data().archived || !canRead(req.identity,snapshot.data())) return false;
    transaction.set(req.trainingUser.collection('settings').doc('training'),{activeRoutineId:id,updatedAt:new Date().toISOString()});return true;
  });
  if(!success) return responseError(res,404,'Rutina no encontrada.');
  res.json({activeRoutineId:id});
});
