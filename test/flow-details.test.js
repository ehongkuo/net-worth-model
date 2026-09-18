const {test,assert,assertClose}=require('./harness');
const C=require('../compensation'),F=require('../money-flow'),S=require('../compact-flow');
const setup=()=>{const c=C.merge(C.defaults(),{salary:160000,bonusPercent:0,espp:{enabled:true,start:'2026-01-01',periodMonths:6,rate:.15,offerPrice:14/.85,purchasePrice:17,holdShares:true},payroll:{enabled:true,elections:{traditional:{mode:'percent',value:.19},mega:{mode:'percent',value:.15}}},retirement:{megaEnabled:true}});const p=C.calculate(c),m=F.forMonth(p,C.cashFlow(p),2),g=S.build(m.payroll,m.flow,c);return {g,scene:S.layout(g,1000)};};
test('ESPP detail uses eligible gross pay, not the cash node, and isolates valuation',()=>{
 const {g,scene}=setup(),link=scene.links.find(l=>l.a.id==='cash2'&&l.b.id==='equity'),d=S.details(g,scene,{link});
 assertClose(d.rows[0].basisAmount,g.payroll.salary);assertClose(d.rows[0].rate,.15,.00001);
 assertClose(d.rows.filter(r=>!r.total).reduce((s,r)=>s+r.amount,0),link.output);
});
test('remainder detail reconciles starting value and every deduction to the ribbon',()=>{
 const {g,scene}=setup(),link=scene.links.find(l=>l.a.id==='cash2'&&l.b.id==='cash'),d=S.details(g,scene,{link});
 assertClose(d.rows.filter(r=>!r.total).reduce((s,r)=>s+r.amount,0),link.output);
 assert(d.rows.at(-1).rateKind==='remaining');
});
test('every node and ribbon has standardized finite table rows',()=>{
 const {g,scene}=setup();for(const selection of [...scene.links.map(link=>({link})),...scene.nodes.filter(n=>!n.hidden).map(node=>({node}))]){
 const d=S.details(g,scene,selection);assert(d.rows.length>0);for(const r of d.rows){assert(typeof r.component==='string');assert(Number.isFinite(r.amount));assert(r.rate==null||Number.isFinite(r.rate));}
 }
});
