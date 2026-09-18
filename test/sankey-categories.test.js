const {test,assert,assertClose}=require('./harness');
const F=require('../money-flow');
test('flow categories use cash for bonus, shared equity, retirement and red tax destinations',()=>{
 for(const id of ['salary','bonus'])assert(F.flowCategory(id)==='cash');
 for(const id of ['rsu-vesting','espp-discount','account-espp','account-rsu'])assert(F.flowCategory(id)==='equity');
 for(const id of ['traditional','hsa','account-retirement','account-hsa'])assert(F.flowCategory(id)==='retirement');
 for(const id of ['rsu-cover','withholding-cash','tax-reserve-rsu','costs'])assert(F.flowCategory(id)==='cost');
});
test('filled ribbons have two smooth boundaries and close without thick strokes',()=>{
 const d=F.ribbonPath(10,210,20,80,30);
 assert(d.includes('C'));assert(d.endsWith('Z'));assert(d.includes('50'));assert(d.includes('110'));
});
test('display bands merge cash salary and bonus, while tax and account transfers change category',()=>{
 const graph={nodes:[{id:'salary',label:'Salary',kind:'source',column:0,color:'blue'},{id:'bonus',label:'Bonus',kind:'source',column:0,color:'blue'},{id:'rsu-vesting',label:'RSU',kind:'source',column:0,color:'gold'},{id:'combined',kind:'hub',column:1},{id:'withholding-cash',kind:'sink',column:2},{id:'after-tax',kind:'sink',column:2}],links:[{source:'salary',target:'combined',value:100},{source:'bonus',target:'combined',value:20},{source:'rsu-vesting',target:'combined',value:30},{source:'combined',target:'withholding-cash',value:10},{source:'combined',target:'after-tax',value:140}]};
 const g=F.categoryBands(graph),tax=g.links.find(l=>l.target==='withholding-cash'),mixed=g.links.find(l=>l.target==='after-tax');
 assert(tax.bands.length===1&&tax.bands[0].category==='cost');
 assert(mixed.bands.length===2);assertClose(mixed.bands.reduce((s,b)=>s+b.value,0),140);
});
test('weekly and biweekly payday anchors are equivalent anywhere on the same schedule',()=>{
 const C=require('../compensation');
 for(const frequency of ['weekly','biweekly']){
  const a=C.calculate(C.merge(C.defaults(),{frequency,firstPayday:'2026-01-08'}));
  const b=C.calculate(C.merge(C.defaults(),{frequency,firstPayday:'2026-09-03'}));
  assert(a.months.every((m,i)=>m.checks===b.months[i].checks));
 }
});
