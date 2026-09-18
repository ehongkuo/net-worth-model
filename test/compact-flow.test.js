const {test,assert,assertClose}=require('./harness');
const C=require('../compensation'),F=require('../money-flow');
let Compact;try{Compact=require('../compact-flow');}catch{}
const make=price=>C.merge(C.defaults(),{salary:165000,bonusPercent:.1,grants:[{value:95000,months:36,interval:1,start:'2025-12-31',grantPrice:19.25,vestPrice:price,saleMode:'cover'}],retirement:{traditional:24500,megaEnabled:true,mega:20000,ira:7500,iraMode:'backdoor'},espp:{enabled:true,start:'2026-01-01',periodMonths:6,rate:.1,holdShares:true,fractional:true,offerPrice:20,purchasePrice:20,discount:.15}});
test('compact RSU ribbons start at grant value and end at configured vest value',()=>{
 for(const price of [15,19.25,25]){const c=make(price),p=C.calculate(c),g=Compact.build(p,C.cashFlow(p),c);assertClose(g.rsuBaseline,95000/3,.01);assertClose(g.rsuGross,95000/3/19.25*price,.01);}
});
test('compact assets preserve existing cash, equity and retirement totals',()=>{
 const c=make(25),p=C.calculate(c),f=C.cashFlow(p,{expenses:36000}),g=Compact.build(p,f,c),old=F.orderFlow(F.buildFlow(p,f));
 const incoming=id=>old.links.filter(l=>l.target==='account-'+id).reduce((s,l)=>s+l.value,0);
 assert(g.buckets.map(b=>b.id).join(',')==='cash,equity,retirement');
 assertClose(g.buckets[0].value,incoming('cash')+incoming('pending')+incoming('reserve'));
 assertClose(g.buckets[1].value,incoming('espp')+incoming('rsu'));
 assertClose(g.buckets[2].value,['retirement','mega','ira','hsa'].reduce((s,k)=>s+incoming(k),0));
 assertClose(g.esppCost,16500);assertClose(g.esppValue,16500/.85);
 assertClose(g.postRetirement,27500);
});
test('nonpurchase months show pending ESPP as projected equity and include only scheduled RSUs',()=>{
 const c=make(15),p=C.calculate(c),f=C.cashFlow(p),m=F.forMonth(p,f,2),g=Compact.build(m.payroll,m.flow,c);
 assertClose(g.esppCost,m.payroll.espp.contributions);assertClose(g.esppValue,g.esppCost/.85);assert(!g.buckets[0].parts.some(p=>p.label==='Pending ESPP contributions')); assertClose(g.rsuBaseline,95000/36,.01);
});
test('tapered ribbons preserve independent widths at both ends',()=>{
 const d=Compact.ribbon(0,100,10,20,30,50);assert(d.includes('70'));assert(d.includes('40'));assert(d.endsWith('Z'));
});
test('future ESPP offerings repeat configured prices instead of extrapolating company growth',()=>{
 const c=C.merge(make(19.25),{stockGrowth:.1});
 const p=C.calculate(c,2027),lot=p.espp.lots.find(l=>l.grantDate==='2027-01-01');
 assertClose(lot.grantPrice,20);assertClose(lot.purchasePrice,20);
});
test('sold RSUs can fund contributions without overfilling the cash bucket',()=>{
 const c=C.merge(make(25),{salary:10000,bonusPercent:0,grants:[{value:95000,months:36,interval:1,start:'2025-12-31',grantPrice:19.25,vestPrice:25,saleMode:'sell'}],espp:{enabled:false}});
 const p=C.calculate(c),g=Compact.build(p,C.cashFlow(p),c),scene=Compact.layout(g,1000);
 for(const id of ['cash2','cash','equity','retirement']){
  const n=scene.nodes.find(n=>n.id===id),incoming=scene.links.filter(l=>l.b.id===id).reduce((s,l)=>s+l.output,0);
  assertClose(incoming,n.value,.01,`${id} incoming matches value`);
 }
});
test('compact output breakdowns sum to bucket values across sales and zero income',()=>{
 for(const c of [make(15),make(25),C.merge(C.defaults(),{salary:0,bonusPercent:0,grants:[],espp:{enabled:false}})]){
  const p=C.calculate(c),g=Compact.build(p,C.cashFlow(p),c);
  for(const b of g.buckets)assertClose(b.parts.reduce((s,r)=>s+r.value,0),b.value,.01,b.id);
  const scene=Compact.layout(g,700);assert(scene.nodes.every(n=>Number.isFinite(n.h)&&n.h>=0));
 }
});
test('compact layout keeps post-tax nodes separated when cash dominates',()=>{
 const c=C.merge(make(19.25),{salary:1000000,bonusPercent:0,grants:[],espp:{enabled:true,rate:.01}}),p=C.calculate(c),g=Compact.build(p,C.cashFlow(p),c),scene=Compact.layout(g,1000);
 const column=scene.nodes.filter(n=>!n.hidden&&n.value>.005&&n.x===scene.nodes.find(n=>n.id==='cash2').x).sort((a,b)=>a.y-b.y);
 for(let i=1;i<column.length;i++)assert(column[i].y-column[i-1].y-column[i-1].h>=45,'post-tax labels have clear space');
});
test('deductions and taxes branch out from their named stage to the next column',()=>{
 const c=make(25),p=C.calculate(c),scene=Compact.layout(Compact.build(p,C.cashFlow(p),c),1000),x=i=>18+i*(1000-170)/5;
 const edge=(a,b)=>scene.links.find(l=>l.a.id===a&&l.b.id===b);
 for(const [a,b,from,to] of [['gross','pretax',1,2],['cash1','tax',2,3],['rsu1','cover',2,3],['cash2','retirement',3,4],['cash2','equity',3,4]]){
  const l=edge(a,b);assert(l,`${a} to ${b} exists`);assertClose(l.a.x,x(from));assertClose(l.b.x,x(to));
 }
 assert(scene.links.every(l=>l.b.x>l.a.x),'every ribbon travels right');
});

test('pending ESPP preview values 2000 at 14 purchase and 17 market without changing ledger',()=>{
 const c=C.merge(make(19.25),{salary:160000,bonusPercent:0,payFrequency:24,espp:{rate:.15,offerPrice:14/.85,purchasePrice:17}}),p=C.calculate(c),m=F.forMonth(p,C.cashFlow(p),2);
 m.payroll.espp.contributions=2000;
 const before=JSON.stringify(m),g=Compact.build(m.payroll,m.flow,c);
 assertClose(g.projectedEspp.cost,2000);assertClose(g.projectedEspp.value,2000/14*17);
 assertClose(g.projectedEspp.shares,2000/14);assert(JSON.stringify(m)===before,'ledger unchanged');
 assertClose(g.buckets[1].parts.reduce((s,r)=>s+r.value,0),g.buckets[1].value);
 const purchase=F.forMonth(p,C.cashFlow(p),6),actual=Compact.build(purchase.payroll,purchase.flow,c);
 assertClose(actual.projectedEspp.cost,0);assertClose(actual.esppValue,actual.original.links.filter(l=>l.target==='account-espp').reduce((s,l)=>s+l.value,0));
 assert(Compact.layout(g,1000).nodes.some(n=>n.label==='Pre-tax contributions'));
});
