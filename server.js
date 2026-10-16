import express from 'express';
import { chromium } from 'playwright';
const app=express(),source='https://gymexascore.net/jnwg8cb2m',PORT=process.env.PORT||3000;
const cutoff=Date.parse('2026-10-20T00:00:00+03:00');
let state={standings:[],updated:null,error:'Veriler bekleniyor'};
const clean=x=>(x||'').replace(/\s+/g,' ').trim();
async function read(){
 const b=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const p=await b.newPage({locale:'tr-TR',timezoneId:'Europe/Istanbul'});
  await p.goto(source,{waitUntil:'domcontentloaded',timeout:45000});
  const cat=p.getByRole('button',{name:'Küçükler',exact:true});
  if(await cat.count())await cat.first().click();
  const results=[];
  for(const [key,label] of [['top','Top'],['labut','Labut']]){
   await p.getByRole('button',{name:label,exact:true}).first().click();
   await p.getByText(new RegExp('Küçükler\\s*[·•-]\\s*'+label)).first().waitFor({timeout:15000});
   await p.waitForTimeout(350);
   const rows=await p.locator('table').first().locator('tr').evaluateAll(trs=>trs.map(tr=>{
     const t=[...tr.querySelectorAll('td')];if(t.length<3)return null;
     const a=(t[1].innerText||'').split(/\n+/).map(s=>s.trim()).filter(Boolean);
     return {athlete:a[0],club:a.slice(1).join(' '),score:t.at(-1).textContent.trim()};
   }).filter(Boolean));
   results.push(...rows.map(r=>({...r,apparatus:key})));
  }
  const clubs=new Map();
  for(const r of results){
   if(!r.club||!r.athlete||!/^\d+(?:[.,]\d+)?$/.test(r.score))continue;
   const name=clean(r.club);if(!clubs.has(name))clubs.set(name,{club:name,top:new Map(),labut:new Map()});
   const target=clubs.get(name)[r.apparatus],value=Math.round(Number(r.score.replace(',','.'))*1000);
   if(!target.has(r.athlete)||target.get(r.athlete)>value===false)target.set(r.athlete,Math.max(target.get(r.athlete)||0,value));
  }
  const fmt=x=>(x/1000).toFixed(3);
  const standings=[...clubs.values()].map(c=>{
   const items=kind=>[...c[kind]].map(([athlete,points])=>({athlete,points})).sort((a,b)=>b.points-a.points||a.athlete.localeCompare(b.athlete,'tr'));
   const top=items('top'),labut=items('labut'),score=x=>x.slice(0,3).reduce((s,r)=>s+r.points,0);
   return {club:c.club,top:top.map((r,i)=>({athlete:r.athlete,score:fmt(r.points),counted:i<3})),labut:labut.map((r,i)=>({athlete:r.athlete,score:fmt(r.points),counted:i<3})),topTotal:fmt(score(top)),labutTotal:fmt(score(labut)),total:fmt(score(top)+score(labut)),complete:top.length>=4&&labut.length>=4};
  }).sort((a,b)=>Number(b.total)-Number(a.total)||a.club.localeCompare(b.club,'tr')).map((c,i)=>({...c,rank:i+1}));
  if(!standings.length)throw Error('Kaynakta puan bulunamadı');
  state={standings,updated:new Date().toISOString(),error:null};
  console.log('Updated',standings.length,'clubs');
 }finally{await b.close()}
}
let busy=false;async function refresh(){if(Date.now()>=cutoff)return;if(busy)return;busy=true;try{await read()}catch(e){state.error=e.message;console.error(e)}finally{busy=false}}
app.get('/api/standings',(_,res)=>res.set('Cache-Control','no-store').json(state));
app.get('/health',(_,res)=>res.json({ok:true,hasData:!!state.updated,error:state.error}));
app.use(express.static('public'));
app.listen(PORT,'0.0.0.0',()=>console.log('Listening',PORT));
async function init(){
 if(Date.now()>=cutoff){
  try{
   const fs=await import('node:fs/promises');
   const snapshot=JSON.parse(await fs.readFile('./public/final.json','utf8'));
   if(snapshot.standings?.length)state={...snapshot,error:null};
   else state.error='Final sonuçlar henüz arşivlenmedi';
  }catch{state.error='Final sonuç arşivi bulunamadı';}
  return;
 }
 refresh();
 const timer=setInterval(()=>{if(Date.now()>=cutoff){clearInterval(timer);console.log('Championship ended: polling stopped');return;}refresh()},30000);
 timer.unref();
}
init();
