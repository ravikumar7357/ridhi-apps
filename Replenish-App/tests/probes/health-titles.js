const fs=require('fs'),https=require('https'),pathm=require('path');
const FTL='C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS='https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
(async()=>{const cfg=JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE,'.config/configstore/firebase-tools.json'),'utf8'));
const tok=await require(FTL+'auth').getAccessToken(cfg.tokens.refresh_token,[]);const at=tok.access_token||tok;
const req=u=>new Promise((res,rej)=>{https.get(u,{headers:{Authorization:'Bearer '+at},timeout:300000},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,200)))}})}).on('error',rej)});
const dec=v=>v==null?null:'stringValue'in v?v.stringValue:'integerValue'in v?Number(v.integerValue):'doubleValue'in v?v.doubleValue:'booleanValue'in v?v.booleanValue:'timestampValue'in v?v.timestampValue:'nullValue'in v?null:'arrayValue'in v?(v.arrayValue.values||[]).map(dec):'mapValue'in v?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,w])=>[k,dec(w)])):null;
for(const b of ['SP','CPC']){const head=await req(FS+'health/'+b);const f=Object.fromEntries(Object.entries(head.fields).map(([k,v])=>[k,dec(v)]));
let rows=[];for(let i=0;i<(f.chunks||0);i++){const c=await req(FS+'healthrows/'+b+'_'+i);if(c.fields)rows=rows.concat(dec(c.fields.r)||[]);}
const c=rows.filter(r=>r.c);
const bands={'<60':0,'60-99':0,'100-149':0,'150-199':0,'200':0};
c.forEach(r=>{const L=r.c[0]||0;if(L<60)bands['<60']++;else if(L<100)bands['60-99']++;else if(L<150)bands['100-149']++;else if(L<200)bands['150-199']++;else bands['200']++;});
console.log(b,'titleLen bands',JSON.stringify(bands));
console.log('  sample:',c.slice(0,3).map(r=>r.c[0]+' chars :: '+String(r.c[4]).slice(0,70)).join('\n          '));
}})().catch(e=>{console.error(e.message);process.exit(1)});
