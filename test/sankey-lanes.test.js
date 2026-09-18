const {test,assert,assertClose}=require('./harness');
const F=require('../money-flow'),C=require('../compensation');
function scenario(){const p=C.calculate(C.merge(C.defaults(),{salary:120000,retirement:{traditional:20000,megaEnabled:true,mega:10000,ira:7500},grants:[{value:30000,months:12,interval:3,start:'2025-12-31',grantPrice:100,vestPrice:100,saleMode:'cover'}]}));p.cashAllowance=480;return F.orderFlow(F.buildFlow(p,C.cashFlow(p)));}
test('salary and allowances share one source while preserving their breakdown',()=>{
 const g=scenario();assert(!g.nodes.some(n=>n.id==='allowance'));const salary=g.nodes.find(n=>n.id==='salary');assertClose(salary.components.reduce((s,c)=>s+c.value,0),120480);assertClose(g.links.find(l=>l.source==='salary').value,120480);
});
test('lane layout keeps continuing cash and equity horizontal and cash above equity',()=>{
 const g=F.laneGeometry(F.bandLayout(F.categoryBands(scenario())),1260);
 for(const l of g.links.filter(l=>l.source==='combined'||l.source==='after-deductions')){
  if(!l.target.startsWith('after-'))continue;
  for(const b of l.bands)assertClose(b.sourceY,b.targetY,.001);
  const cash=l.bands.find(b=>b.category==='cash'),equity=l.bands.find(b=>b.category==='equity');
  if(cash&&equity)assert(cash.sourceY<equity.sourceY);
 }
 assert(g.nodes.filter(n=>n.column===5).every(n=>n.id==='costs'));
 assert(g.nodes.filter(n=>n.id.startsWith('account-')).every(n=>Number.isFinite(n.remaining)));
});
test('layout is deterministic, finite and leaves financial graph untouched',()=>{
 const graph=F.bandLayout(F.categoryBands(scenario())),before=JSON.stringify(graph),a=F.laneGeometry(graph,1260),b=F.laneGeometry(graph,1260);
 assert(JSON.stringify(a)===JSON.stringify(b));assert(JSON.stringify(graph)===before);
 for(const l of a.links)for(const band of l.bands)assert(Number.isFinite(band.sourceY)&&Number.isFinite(band.targetY));
});
test('ESPP purchases use contributed cash without borrowing RSU ribbon provenance',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,frequency:'monthly',grants:[{value:30000,months:12,interval:3,start:'2025-12-31',grantPrice:100,vestPrice:100,saleMode:'cover'}],espp:{enabled:true,start:'2026-06-09',periodMonths:6,rate:.1,holdShares:true,offerPrice:16.49,purchasePrice:17}}));
 const graph=F.sourceBands(F.orderFlow(F.buildFlow(p,C.cashFlow(p))));
 const espp=graph.links.find(l=>l.target==='account-espp');assert(espp);assert(!espp.bands.some(b=>b.id==='rsu-vesting'));
});
test('liquidity order and remaining labels reconcile across expense levels',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,retirement:{traditional:20000,megaEnabled:true,mega:10000,iraMode:'backdoor',ira:7500},grants:[{value:30000,months:12,interval:3,start:'2025-12-31',grantPrice:100,vestPrice:100,saleMode:'cover'}]}));
 for(const expenses of [0,30000,100000,300000]){
  const ordered=F.orderFlow(F.buildFlow(p,C.cashFlow(p,{expenses}))),g=F.laneGeometry(F.bandLayout(F.categoryBands(ordered)),1260);
  const cash=g.nodes.find(n=>n.id==='account-cash'),equity=g.nodes.find(n=>n.id==='account-rsu');if(cash&&equity)assert(cash.y<equity.y);
  for(const n of g.nodes.filter(n=>n.id.startsWith('account-'))){const out=g.links.filter(l=>l.source===n.id).reduce((s,l)=>s+l.value,0);assertClose(out+n.remaining,n.value,.001,n.id);}
  assertClose(g.links.filter(l=>l.target==='costs').reduce((s,l)=>s+l.value,0)+ordered.visualAllocation.shortfall,ordered.visualAllocation.costs,.001);
 }
});
