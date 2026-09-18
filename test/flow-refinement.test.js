const {test,assert,assertClose,assertEqual}=require('./harness');
const C=require('../compensation'),F=require('../money-flow');
test('offering ends on the day before the next start, including mid-month schedules',()=>{
  const e={...C.defaults().espp,start:'2026-06-09',periodMonths:6};
  assertEqual(C.offeringDates(e,e.start).purchaseDate,'2026-12-08');
  assertEqual(C.offeringDates({...e,end:'2026-12-08'},'2026-12-09').purchaseDate,'2027-06-08');
});
test('an explicit purchase boundary excludes later payroll from that purchase',()=>{
  const c=C.merge(C.defaults(),{salary:120000,frequency:'monthly',espp:{enabled:true,start:'2026-06-09',end:'2026-12-08',periodMonths:6,holdShares:true,fractional:true,rate:.1,offerPrice:100,purchasePrice:100,enrollments:{'2026-06-09':{end:'2026-11-15'}}}});
  const p=C.calculate(c),lot=p.espp.lots.find(l=>l.grantDate==='2026-06-09');
  assertEqual(lot.purchaseDate,'2026-11-15');assertClose(lot.cost,5000);
});
test('held ESPP stock value appears at purchase while earlier deductions remain pending cash',()=>{
  const c=C.merge(C.defaults(),{salary:120000,frequency:'monthly',espp:{enabled:true,start:'2026-06-09',end:'2026-12-08',periodMonths:6,holdShares:true,fractional:true,rate:.1,offerPrice:16.49,purchasePrice:17}});
  const p=C.calculate(c),f=C.cashFlow(p),sep=F.forMonth(p,f,9),dec=F.forMonth(p,f,12);
  const a=F.buildFlow(sep.payroll,sep.flow),b=F.buildFlow(dec.payroll,dec.flow);
  assertClose(a.summary.esppDiscount,0);assert(a.nodes.some(n=>n.id==='espp-pending-account'));
  assert(!a.links.some(l=>l.target==='equity-account'));
  assert(b.summary.esppDiscount>0);assertClose(p.espp.ordinary,0);assertClose(p.espp.longGain+p.espp.shortGain,0);
});
test('ESPP purchase benefit is compensation at immediate sale, not a capital gain at purchase',()=>{
  const lot={shares:1,cost:14,grantPrice:16.49,purchasePrice:17,discount:.15,grantDate:'2026-06-09',purchaseDate:'2026-12-08'};
  const sale=C.sellLot(lot,'2026-12-08',17);
  assertClose(sale.ordinary,3);assertClose(sale.gain,0);
  const later=C.sellLot(lot,'2029-01-01',20);
  assertClose(later.ordinary,2.4735);assertClose(later.longGain,3.5265);
});
test('regular backdoor and mega remain separate destinations with conserved retirement total',()=>{
  const p=C.calculate(C.merge(C.defaults(),{salary:150000,retirement:{traditional:20000,megaEnabled:true,mega:10000,iraMode:'backdoor',ira:7500}}));
  const g=F.orderFlow(F.buildFlow(p,C.cashFlow(p)));
  assert(g.nodes.some(n=>n.id==='account-mega'));assert(g.nodes.some(n=>n.id==='account-ira'));
  for(const n of g.nodes.filter(n=>n.kind==='hub'))assertClose(g.links.filter(l=>l.target===n.id).reduce((s,l)=>s+l.value,0),g.links.filter(l=>l.source===n.id).reduce((s,l)=>s+l.value,0),.001,n.id);
});
test('deduction ribbons leave cash slots without moving the continuing equity band',()=>{
  const nodes=[{id:'salary',kind:'source',column:0},{id:'rsu-vesting',kind:'source',column:0},{id:'combined',kind:'hub',column:1},{id:'traditional',kind:'sink',column:2},{id:'after-deductions',kind:'sink',column:2}];
  const graph={nodes,links:[{source:'salary',target:'combined',value:100},{source:'rsu-vesting',target:'combined',value:30},{source:'combined',target:'traditional',value:20},{source:'combined',target:'after-deductions',value:110}]};
  const g=F.categoryBands(graph),slots=F.bandLayout(g);
  const deduction=slots.links.find(l=>l.target==='traditional').bands[0];
  assertEqual(deduction.sourceCategory,'cash');assertEqual(deduction.category,'retirement');
  const equity=slots.links.find(l=>l.target==='after-deductions').bands.find(b=>b.category==='equity');
  assertClose(equity.value,30);assertClose(equity.sourceOffset,equity.targetOffset);
});
test('category slots conserve every ribbon and junction, including pending cash and backdoors',()=>{
  const c=C.merge(C.defaults(),{salary:150000,frequency:'monthly',retirement:{traditional:20000,megaEnabled:true,mega:10000,iraMode:'backdoor',ira:7500},grants:[{value:30000,months:12,interval:3,start:'2025-12-31',grantPrice:100,vestPrice:100,saleMode:'cover'}],espp:{enabled:true,start:'2026-06-09',periodMonths:6,holdShares:true,rate:.1,offerPrice:16.49,purchasePrice:17}});
  const p=C.calculate(c),f=C.cashFlow(p);
  for(const month of [0,9,12]){
    const selected=month?F.forMonth(p,f,month):{payroll:p,flow:f};
    const g=F.bandLayout(F.categoryBands(F.orderFlow(F.buildFlow(selected.payroll,selected.flow))));
    for(const l of g.links)assertClose(l.bands.reduce((s,b)=>s+b.value,0),l.value,.001);
    for(const n of g.nodes){
      const incoming=g.links.filter(l=>l.target===n.id).flatMap(l=>l.bands),outgoing=g.links.filter(l=>l.source===n.id).flatMap(l=>l.bands);
      if(n.kind==='hub')assertClose(incoming.reduce((s,b)=>s+b.value,0),outgoing.reduce((s,b)=>s+b.value,0),.001,n.id);
      for(const [bands,key] of [[incoming,'targetOffset'],[outgoing,'sourceOffset']]){
        let end=0;for(const b of [...bands].sort((a,b)=>a[key]-b[key])){assertClose(b[key],end,.001,n.id);end+=b.value;}
      }
    }
    const cover=g.links.find(l=>l.target==='rsu-cover');
    if(cover)assert(cover.bands.every(b=>b.sourceCategory==='equity'&&b.category==='cost'));
  }
});
