const {test,assert,assertClose}=require('./harness');
const F=require('../money-flow'),C=require('../compensation');
const balanced=g=>{for(const n of g.nodes.filter(n=>n.kind==='hub'))assertClose(g.links.filter(l=>l.target===n.id).reduce((s,l)=>s+l.value,0),g.links.filter(l=>l.source===n.id).reduce((s,l)=>s+l.value,0),.001,n.id);};
test('visual allocation spends cash then ESPP, RSU and retirement without changing inputs',()=>{
 const accounts={cash:100,espp:200,rsu:300,retirement:400,hsa:50},original=JSON.stringify(accounts);
 const a=F.allocateCosts(accounts,750);
 assert(JSON.stringify(accounts)===original);
 assertClose(a.used.cash,100);assertClose(a.used.espp,200);assertClose(a.used.rsu,300);assertClose(a.used.retirement,150);
 assertClose(a.remaining.retirement,250);assertClose(a.remaining.hsa,50);assertClose(a.shortfall,0);
 const b=F.allocateCosts(accounts,1500);assertClose(b.shortfall,500);assertClose(b.remaining.hsa,50);
});
test('six column flow separates deductions, taxes, assets and costs without invented funding',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,bonusPercent:0,retirement:{traditional:12000},hsa:{employee:2400},espp:{enabled:false},tax:{state:'none'},grants:[{value:12000,grantPrice:100,start:'2025-12-31',months:12,interval:3,saleMode:'hold'}]}));
 const f=C.cashFlow(p,{expenses:180000}),base=F.buildFlow(p,f),snapshot=JSON.stringify(base),g=F.orderFlow(base);
 assert(g.columnCount===6);assert(JSON.stringify(base)===snapshot);
 assert(!g.nodes.some(n=>['budget-funding','payroll-funding'].includes(n.id)));
 assert(g.nodes.find(n=>n.id==='traditional').column===2);
 assert(g.nodes.filter(n=>/^(withholding|tax-reserve|tax-payments|rsu-cover)/.test(n.id)).every(n=>n.column===3));
 assert(g.nodes.find(n=>n.id==='costs').column===5);
 assert(g.visualAllocation.shortfall>0);balanced(g);
 assertClose(g.summary.netCashFlow,base.summary.netCashFlow);
});
test('visual allocation handles zero income and over-elected accounts with no phantom sources',()=>{
 for(const salary of [0,1000,50000]){
  const p=C.calculate(C.merge(C.defaults(),{salary,grants:[],bonusPercent:0,espp:{enabled:false}}));
  const g=F.orderFlow(F.buildFlow(p,C.cashFlow(p,{expenses:72000})));
  balanced(g);assert(g.links.every(l=>Number.isFinite(l.value)&&l.value>0));
  assert(g.visualAllocation.shortfall>=0);
 }
});
test('tax comparison bars use gross minus deductions and never subtract tax',()=>{
 const {taxIncomeComparison}=require('../tax-ui');
 const x={sources:[{id:'salary',gross:120000,taxable:80000,total:17000},{id:'rsu',gross:20000,taxable:15000,total:5000}],beforeOrdinary:140000,afterOrdinary:95000};
 const v=taxIncomeComparison(x);
 assertClose(v.gross,140000);assertClose(v.deductions,45000);assertClose(v.taxable,95000);
 assertClose(v.sources.reduce((sum,s)=>sum+s.taxable,0),95000);
 x.sources.forEach(s=>s.total*=2);assertClose(taxIncomeComparison(x).taxable,95000);
});

test('pre-tax benefits precede tax payments and are not charged again as final costs',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,frequency:'monthly',grants:[],benefits:{health:100,otherPosttax:50}})),f=C.cashFlow(p,{expenses:12000});
 for(const selected of [{payroll:p,flow:f},F.forMonth(p,f,9)]){
  const g=F.orderFlow(F.buildFlow(selected.payroll,selected.flow)),divisor=selected.payroll.periodMonth?12:1;
  assert(g.nodes.find(n=>n.id==='benefits-pretax').column===2);
  assertClose(g.links.find(l=>l.target==='benefits-pretax').value,1200/divisor);
  assertClose(g.visualAllocation.costs,12600/divisor);balanced(g);
 }
});
test('known annual example preserves tax and contribution amounts while allocating a cash deficit',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,bonusPercent:0,tax:{state:'none'},retirement:{traditional:12000},espp:{enabled:false},grants:[{value:12000,grantPrice:100,start:'2025-12-31',months:12,interval:3,saleMode:'hold'}]}));
 const f=C.cashFlow(p,{expenses:90000}),g=F.orderFlow(F.buildFlow(p,f));
 // Federal: 1,240 + 4,560 + 11,770. Payroll: 132,000 x 7.65%.
 assertClose(f.taxes.total,27668,.001);
 assertClose(g.visualAllocation.used.cash,80332,.001);
 assertClose(g.visualAllocation.used.rsu,9668,.001);
 assertClose(g.visualAllocation.used.retirement,0,.001);
 assertClose(g.visualAllocation.remaining.rsu,2332,.001);
 assertClose(g.visualAllocation.remaining.retirement,12000,.001);
 assertClose(f.netCashFlow,-9668,.001);balanced(g);
});
