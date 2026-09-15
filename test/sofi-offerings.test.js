const {test,assert,assertClose}=require('./harness');
const C=require('../compensation');
const F=require('../money-flow');
const grant={value:12000,grantPrice:100,vestPrice:100,start:'2025-12-31',months:12,interval:3,saleMode:'cover'};
test('RSU sell-to-cover funds withholding from shares rather than paycheck cash',()=>{
 const c=C.merge(C.defaults(),{salary:120000,tax:{state:'none'},grants:[grant]});
 const p=C.calculate(c,2026);
 // Supplemental federal 22% + Social Security 6.2% + Medicare 1.45%.
 assertClose(p.rsuSellToCover,3558,.01);assertClose(p.stockAssets,8442,.01);
 assertClose(p.cashWithholding,p.withholding-3558,.01);
 assertClose(C.cashFlow(p).netCashFlow,C.cashFlow(C.calculate(C.merge(c,{grants:[{...grant,saleMode:'hold'}]}),2026)).netCashFlow+3558,.01);
 const g=F.buildFlow(p,C.cashFlow(p));assertClose(g.links.find(l=>l.source==='rsu-vesting'&&l.target==='rsu-cover')?.value,3558,.001);
});
test('prior covered RSUs do not reappear as retained equity next year',()=>{
 const c=C.merge(C.defaults(),{salary:120000,salaryGrowth:0,tax:{state:'none'},grants:[grant]});
 assertClose(C.calculate(c,2027).openingAssets,8442,.01);
 assertClose(C.calculate(c,2027).stockAssets,8442,.01);
});
test('grant value over three years reconciles shares and vesting prices',()=>{
 const p=C.calculate(C.merge(C.defaults(),{grants:[{...grant,value:95000,months:36,grantPrice:20,vestPrice:18,saleMode:'hold'}]}),2026);
 assertClose(p.rsuGross,28500,.01);assertClose(p.rsuVests.reduce((s,v)=>s+v.shares,0),95000/20/3,.0001);
});
const plan={enabled:true,start:'2025-12-09',periodMonths:6,purchaseTiming:'day-before-next-start',firstEnrollmentDate:'2026-06-09',rate:.1,bonusEligible:true,holdShares:true,shareCap:5000,annualFmvLimit:25000,offerPrice:10,purchasePrice:15,fractional:true,enrollments:{}};
test('skipped first offering has no payroll deductions or purchases',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,frequency:'monthly',firstPayday:'2026-01-15',espp:plan}),2026);
 assertClose(p.espp.contributions,7000,.01);
 assert(p.espp.lots.every(l=>l.grantDate>='2026-06-09'));
 const lot=p.espp.lots.find(l=>l.purchaseDate==='2026-12-08');assert(lot);assertClose(lot.cost,6000,.01);assertClose(lot.shares,6000/8.5,.0001);
});
test('grant-date FMV caps shares, not current market value',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:1000000,frequency:'monthly',espp:{...plan,rate:.15}}),2026);
 const lot=p.espp.lots.find(l=>l.purchaseDate==='2026-12-08');assert(lot);
 assertClose(lot.shares,2500,.0001);assertClose(lot.cost,21250,.01);assertClose(lot.shares*lot.purchasePrice,37500,.01);
});
test('offering opt-out, rate and prices are independently configurable',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,frequency:'monthly',firstPayday:'2026-01-15',espp:{...plan,enrollments:{'2026-06-09':{enrolled:false}}}}),2026);
 assertClose(p.espp.contributions,1000,.01);assert(p.espp.lots.every(l=>l.grantDate!=='2026-06-09'));
});
test('SoFi tax-guide examples distinguish qualifying and disqualifying sales',()=>{
 const lot={shares:1,cost:6.29,purchasePrice:9,grantPrice:7.4,discount:.15,grantDate:'2024-12-09',purchaseDate:'2025-06-08'};
 const early=C.sellLot(lot,'2025-07-01',10),long=C.sellLot(lot,'2026-07-01',10),qualified=C.sellLot(lot,'2026-12-10',10);
 assertClose(early.ordinary,2.71,.001);assertClose(early.shortGain,1,.001);
 assertClose(long.ordinary,2.71,.001);assertClose(long.longGain,1,.001);
 assertClose(qualified.ordinary,1.11,.001);assertClose(qualified.longGain,2.60,.001);
});
test('hidden Sankey rendering preserves its existing geometry',()=>{
 const container={clientWidth:0,innerHTML:'existing layout'};
 F.render(container,{nodes:[],links:[]},String);
 assert(container.innerHTML==='existing layout');
});
test('offering-specific rate and prices override the baseline',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,frequency:'monthly',firstPayday:'2026-01-15',espp:{...plan,enrollments:{'2026-06-09':{enrolled:true,rate:.05,offerPrice:20,purchasePrice:30}}}}),2026);
 const lot=p.espp.lots.find(l=>l.grantDate==='2026-06-09');
 assertClose(lot.cost,3000,.01);assertClose(lot.shares,3000/17,.001);assertClose(lot.purchasePrice,30,.001);
});
test('sell-to-cover preserves yearly net worth and graph conservation',()=>{
 const {LifetimeModel}=require('../model');
 const config={projectionYears:3,marketReturn:0,inflation:0,cash:100000,brokerage:0,pretax401kBal:0,rothAccounts:0,traditionalIRA:0,hsa:0,socialSecurityAnnual:0,retirementAge:90,expenses:{housing:0,dining:0,groceries:0,giving:0,travel:0,entertainment:0,auto:0,other:0}};
 const scenario=mode=>new LifetimeModel({...config,compensation:C.merge(C.defaults(),{salary:120000,salaryGrowth:0,tax:{state:'none'},grants:[{...grant,saleMode:mode}]})}).simulate();
 const cover=scenario('cover'),hold=scenario('hold');
 cover.forEach((row,i)=>assertClose(row.netWorth,hold[i].netWorth,.01));
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,tax:{state:'none'},grants:[grant]}),2026),g=F.buildFlow(p,C.cashFlow(p));
 for(const n of g.nodes.filter(n=>n.kind==='hub'))assertClose(g.links.filter(l=>l.target===n.id).reduce((s,l)=>s+l.value,0),g.links.filter(l=>l.source===n.id).reduce((s,l)=>s+l.value,0),.001);
});
test('SoFi preset limits annual payroll contributions and keeps fractional shares',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:1000000,frequency:'monthly',firstPayday:'2026-01-15',espp:{...plan,...C.planPresets.sofi,rate:.15,offerPrice:13,purchasePrice:15}}),2026);
 assertClose(p.espp.contributions,21250,.01);
 const lot=p.espp.lots.find(l=>l.purchaseDate==='2026-12-08');assertClose(lot.shares,25000/13,.001);
});
test('clearing an offering override restores the plan baseline',()=>{
 const {LifetimeModel}=require('../model');
 const m=new LifetimeModel({compensation:C.merge(C.defaults(),{espp:{...plan,enrollments:{'2026-06-09':{offerPrice:20,enrolled:true}}}})});
 const c=m.getConfig().compensation;delete c.espp.enrollments['2026-06-09'].offerPrice;m.updateConfig({compensation:c});
 assert(m.getConfig().compensation.espp.enrollments['2026-06-09'].offerPrice===undefined);
});
