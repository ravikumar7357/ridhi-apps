/* WILL EVERYBODY'S SCREENS STILL OPEN? Asked from the other direction to rules-tool.js: not "may this
 * person read this node", but "this person holds this tab — can they read EVERY node that tab's code
 * reaches?". A refusal here is a screen that would fail to load. Read-only; plays each account through
 * auth_variable_override. Also prints who can now read the payroll nodes. */
const fs=require('fs'),https=require('https'),pathm=require('path');
const FTL='C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const HOST='price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const MAP=JSON.parse(fs.readFileSync(pathm.join(__dirname,'read-map.json'),'utf8'));
(async()=>{const cfg=JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE,'.config/configstore/firebase-tools.json'),'utf8'));
const tok=await require(FTL+'auth').getAccessToken(cfg.tokens.refresh_token,[]);const at=tok.access_token||tok;
const get=(p,as)=>new Promise((res,rej)=>https.get({host:HOST,path:'/'+p+'.json'+(as?'?auth_variable_override='+encodeURIComponent(JSON.stringify(as)):''),headers:{Authorization:'Bearer '+at}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode,body:d}))}).on('error',rej));
const perms=JSON.parse((await get('pt_perms')).body), vbe=JSON.parse((await get('pt_vendorByEmail')).body)||{};
const people=Object.keys(perms).filter(k=>!vbe[k]).map(k=>({k,email:k.split(',').join('.'),p:perms[k]}));
const jobs=[];people.forEach(w=>Object.keys(w.p.t||{}).forEach(t=>((MAP.tabs[t]||{}).nodes||[]).forEach(n=>jobs.push({w,t,n}))));
let bad=[],done=0;for(let i=0;i<jobs.length;i+=24)await Promise.all(jobs.slice(i,i+24).map(async j=>{const r=await get(j.n+'/zz_ruletest',{uid:'screens',token:{email:j.w.email}});done++;if(r.status!==200)bad.push(j.w.email.split('@')[0]+' · tab '+j.t+' · '+j.n+' → '+r.status);}));
console.log(done+' reads, one for every node behind every tab that '+people.length+' staff accounts hold.');
console.log(bad.length?'WOULD BREAK — '+bad.length+':\n  '+bad.slice(0,30).join('\n  '):'Every screen anybody holds can read everything its code reaches.');
const unknownTabs=new Set();people.forEach(w=>Object.keys(w.p.t||{}).forEach(t=>{if(!MAP.tabs[t])unknownTabs.add(t);}));
console.log('tabs people hold that read nothing from this database (Firestore / backend screens): '+([...unknownTabs].sort().join(', ')||'none'));
console.log('\nWHO CAN READ, now:');
for(const n of ['pt_rateList','pt_printerRates','pt_advances','pt_payoutFreezes','pt_extraHours','pt_empList','pt_attend','pt_salesOrders','pt_vendorOrders','pt_perms']){
 const who=[];for(const w of people){const r=await get(n+'/zz_ruletest',{uid:'screens',token:{email:w.email}});if(r.status===200)who.push(w.email.split('@')[0]);}
 console.log('  '+n.replace('pt_','').padEnd(15)+String(who.length).padStart(2)+' of '+people.length+'   '+who.join(', ').slice(0,150));}
})().catch(e=>{console.error(e.message||e);process.exit(1)});
