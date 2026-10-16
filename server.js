import express from 'express';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const app=express(),source='https://gymexascore.net/jnwg8cb2m',PORT=process.env.PORT||3000;
const cutoff=Date.parse('2026-10-20T00:00:00+03:00');
let state={standings:[],updated:null,error:'Veriler bekleniyor'};
const roster=JSON.parse(await fs.readFile('./public/roster.json','utf8'));
const startOrder=JSON.parse(await fs.readFile('./public/start_order.json','utf8'));
const firstStart=new Map();
const norm=s=>String(s||'').toLocaleUpperCase('tr-TR').normalize('NFKD').replace(/[.]/g,'').replace(/\s+/g,' ').trim();
const aliases={'ULUSLARARASI ZİRVE G.S.K.':'ULUSLARARASI ZİRVE S.K.','ENDA LİYA KARAN':'ENDA LİA KARAN'};
const drawnNames=new Map(Object.entries(roster).flatMap(([club,lists])=>[...new Set([...(lists.top||[]),...(lists.labut||[])])].map(name=>[norm(name),club])));
for(const item of startOrder){const club=drawnNames.get(norm(item.athlete));if(!club)continue;const key=[item.day,item.group,item.rotation,item.position].join(':');if(!firstStart.has(club)||key.localeCompare(firstStart.get(club))<0)firstStart.set(club,key)}
async function cached(){try{let response=await fetch('https://raw.githubusercontent.com/escorpin/gymexa-club-live/scores/standings.json',{signal:AbortSignal.timeout(5000)});if(response.ok){let data=await response.json();if(data.standings?.length)state={...data,error:null}}}catch(e){console.log('No existing snapshot:',e.message)}}
function combinePrevious(current){
  const oldByClub=new Map((state.standings||[]).map(c=>[norm(c.club),c]));
  const scoreOf=x=>{
    if(x==null||x==='—')return null;
    const n=Number(String(x).replace(',','.'));
    return Number.isFinite(n)?Math.round(n*1000):null;
  };
  const fmt=n=>(n/1000).toFixed(3);
  const mergeRows=(club,apparatus,fresh,old)=>{
    const expected=roster[club]?.[apparatus]||[];
    const names=new Map(expected.map(a=>[norm(a),a]));
    const rows=new Map();
    for(const athlete of expected)rows.set(norm(athlete),{athlete,score:null});
    // A value from the current source supersedes a stale backup, even if corrected downwards.
    // Legacy backup zeroes may represent missing values, so never use them to certify completion.
    for(const a of old||[]){
      const key=norm(a.athlete),n=scoreOf(a.score);
      if(!rows.has(key))rows.set(key,{athlete:names.get(key)||a.athlete,score:null});
      if(n!==null&&n>0)rows.get(key).score=fmt(n);
    }
    for(const a of fresh||[]){
      const key=norm(a.athlete),n=scoreOf(a.score);
      if(!rows.has(key))rows.set(key,{athlete:names.get(key)||a.athlete,score:null});
      if(n!==null)rows.get(key).score=fmt(n);
    }
    return [...rows.values()].sort((a,b)=>(scoreOf(b.score)??-1)-(scoreOf(a.score)??-1)||a.athlete.localeCompare(b.athlete,'tr'))
      .map((a,i)=>({...a,counted:a.score!==null&&i<3}));
  };
  const total=rows=>rows.filter(a=>a.score!==null).slice(0,3).reduce((n,a)=>n+scoreOf(a.score),0);
  const complete=(club,top,labut)=>{
    const expected=roster[club];
    if(!expected?.top?.length||!expected?.labut?.length)return false;
    const received=rows=>new Set(rows.filter(a=>a.score!==null).map(a=>norm(a.athlete)));
    const doneTop=received(top),doneLabut=received(labut);
    return expected.top.every(a=>doneTop.has(norm(a)))&&expected.labut.every(a=>doneLabut.has(norm(a)));
  };
  const combined=current.map(c=>{
    const previous=oldByClub.get(norm(c.club));
    const top=mergeRows(c.club,'top',c.top,previous?.top),labut=mergeRows(c.club,'labut',c.labut,previous?.labut);
    const topScore=total(top),labutScore=total(labut);
    return {...c,top,labut,topTotal:fmt(topScore),labutTotal:fmt(labutScore),
      total:fmt(topScore+labutScore),complete:complete(c.club,top,labut),
      hasScore:top.some(a=>a.score!==null)||labut.some(a=>a.score!==null)};
  });
  combined.sort((a,b)=>a.hasScore!==b.hasScore?(a.hasScore?-1:1):
    a.hasScore?(Number(b.total)-Number(a.total)||a.club.localeCompare(b.club,'tr')):
    ((firstStart.get(a.club)||'9999').localeCompare(firstStart.get(b.club)||'9999')||a.club.localeCompare(b.club,'tr')));
  let rank=0;return combined.map(c=>({...c,rank:c.hasScore?++rank:'—'}));
}
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
  for(const [club,lists] of Object.entries(roster))clubs.set(club,{club,top:new Map(),labut:new Map(),expected:lists});
  for(const r of results){
   if(!r.club||!r.athlete||!/^\d+(?:[.,]\d+)?$/.test(r.score))continue;
   let name=clean(r.club);name=aliases[name]||name;
   let found=[...clubs.keys()].find(c=>norm(c)===norm(name));if(found)name=found;
   if(!clubs.has(name))clubs.set(name,{club:name,top:new Map(),labut:new Map(),expected:{top:[],labut:[]}});
   const target=clubs.get(name)[r.apparatus],value=Math.round(Number(r.score.replace(',','.'))*1000);
   const athlete=aliases[r.athlete]||r.athlete;const expected=clubs.get(name).expected[r.apparatus]||[];
   const resolved=expected.find(n=>norm(n)===norm(athlete))||athlete;
   target.set(resolved,Math.max(target.get(resolved)||0,value));
  }
  const fmt=x=>(x/1000).toFixed(3);
  const standings=[...clubs.values()].map(c=>{
   const items=kind=>{const m=new Map(c[kind]);for(const athlete of (c.expected[kind]||[]))if(!m.has(athlete))m.set(athlete,null);
    return [...m].map(([athlete,points])=>({athlete,points})).sort((a,b)=>(b.points??-1)-(a.points??-1)||a.athlete.localeCompare(b.athlete,'tr'))};
   const top=items('top'),labut=items('labut'),score=x=>x.filter(r=>r.points!==null).slice(0,3).reduce((s,r)=>s+r.points,0);
   return {club:c.club,top:top.map((r,i)=>({athlete:r.athlete,score:r.points===null?null:fmt(r.points),counted:r.points!==null&&i<3})),labut:labut.map((r,i)=>({athlete:r.athlete,score:r.points===null?null:fmt(r.points),counted:r.points!==null&&i<3})),topTotal:fmt(score(top)),labutTotal:fmt(score(labut)),total:fmt(score(top)+score(labut)),complete:top.filter(x=>x.points!==null).length>=Math.min(4,c.expected.top?.length||4)&&labut.filter(x=>x.points!==null).length>=Math.min(4,c.expected.labut?.length||4),hasScore:top.some(x=>x.points!==null)||labut.some(x=>x.points!==null)};
  }).sort((a,b)=>a.hasScore!==b.hasScore?(a.hasScore?-1:1):a.hasScore?(Number(b.total)-Number(a.total)||a.club.localeCompare(b.club,'tr')):((firstStart.get(a.club)||'9999').localeCompare(firstStart.get(b.club)||'9999')||a.club.localeCompare(b.club,'tr'))).map((c,i)=>({...c,rank:c.hasScore?i+1:null}));
  if(!standings.length)throw Error('Kaynakta puan bulunamadı');
  state={standings:combinePrevious(standings),updated:new Date().toISOString(),error:null};
  console.log('Updated',standings.length,'clubs');
 }finally{await b.close()}
}
let busy=false;async function refresh(){if(Date.now()>=cutoff)return;if(busy)return;busy=true;try{await read()}catch(e){state.error=e.message;console.error(e)}finally{busy=false}}
app.get('/api/standings',(_,res)=>res.set('Cache-Control','no-store').json(state));
app.get('/health',(_,res)=>res.json({ok:true,hasData:!!state.updated,error:state.error}));
app.use(express.static('public'));
async function init(){
 await cached();
 if(Date.now()>=cutoff){
  try{
   const snapshot=state;
   if(snapshot.standings?.length)state={...snapshot,error:null};
   else state.error='Final sonuçlar henüz arşivlenmedi';
  }catch{state.error='Final sonuç arşivi bulunamadı';}
  app.listen(PORT,'0.0.0.0',()=>console.log('Listening',PORT));
  return;
 }
 await refresh();
 app.listen(PORT,'0.0.0.0',()=>console.log('Listening',PORT));
 const timer=setInterval(()=>{if(Date.now()>=cutoff){clearInterval(timer);console.log('Championship ended: polling stopped');return;}refresh()},30000);
 timer.unref();
}
init();
