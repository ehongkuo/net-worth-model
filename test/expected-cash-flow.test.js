const {test,assert,assertClose}=require('./harness');
const C=require('../compensation');
const {buildFlow}=require('../money-flow');
// Expected values are worked from IRS 2026 brackets, not engine output.
// Single: 12,400*10% + 38,000*12% + 29,500*22% = 12,290.
// MFJ: 24,800*10% + 76,000*12% + 17,000*22% = 15,340.
// Equity case: 17,966 + (115,900-105,700)*24% = 20,414.
const base={taxYear:2026,age:35,salary:120000,bonusPercent:0,frequency:'monthly',
  tax:{state:'none',filing:'single'},retirement:{traditional:24000},hsa:{employee:0}};
const cases=[
 {name:'Single salary and traditional 401k',patch:{},expected:{federal:12290,fica:9180,net:74530,takeHome:74529.96,rsu:0,discount:0}},
 {name:'Married household with payroll HSA',patch:{tax:{filing:'married',spouseIncome:60000},hsa:{coverage:'family',employee:6000}},expected:{federal:15340,fica:13311,net:121349,takeHome:130248.96,rsu:0,discount:0}},
 {name:'Bonus, held RSUs and held discounted ESPP',patch:{bonusPercent:.1,grants:[{value:24000,grantPrice:100,vestPrice:100,start:'2025-12-31',months:12,interval:3,sell:false}],espp:{enabled:true,rate:.1,holdShares:true,fractional:true,periodMonths:6,offerPrice:100,purchasePrice:100}},expected:{federal:20414,fica:11934,net:63652,takeHome:63855.96,rsu:24000,discount:12000/85*15}}
];
cases.push({name:'Held RSUs and immediately sold ESPP',patch:{...cases[2].patch,espp:{...cases[2].patch.espp,holdShares:false,holdMonths:0,salePrice:100}},expected:{federal:20922.2352941176,fica:11934,net:77261.4117647059,takeHome:63855.96,rsu:24000,discount:2117.6470588235}});
cases.push({name:'RSUs sold and ESPP held',patch:{...cases[2].patch,grants:cases[2].patch.grants.map(g=>({...g,sell:true}))},expected:{federal:20414,fica:11934,net:87652,takeHome:87855.96,rsu:24000,discount:2117.6470588235}});
cases.push({name:'California projected with zero bracket uplift',patch:{tax:{state:'CA',caGrowth2026:0}},expected:{federal:12290,fica:9180,net:68287.02,takeHome:68286.96,rsu:0,discount:0}});
cases.push({name:'Max 401k, mega backdoor, HSA and backdoor IRA',patch:{salary:240000,bonusPercent:.1,grants:[{value:48000,grantPrice:100,vestPrice:100,start:'2025-12-31',months:12,interval:3,sell:false}],retirement:{max401k:true,megaEnabled:true,maxMega:true,employerAnnual:12000,maxIra:true,iraMode:'backdoor'},hsa:{maxContribution:true,employer:1000}},expected:{federal:62569.25,fica:16891.1,net:113639.65,takeHome:128158.07,rsu:48000,discount:0}});
// Withholding fixtures use cent-rounded dated paychecks. Household liability is
// reconciled separately; spouse federal withholding is modeled explicitly only in W-4 mode.
// Direct HSA funding does not reduce payroll withholding.
// Bonus withholding excludes its share of traditional deferrals:
// (24,000 - 24,500 * 24,000 / 264,000) * 22% = 4,790.
cases.push({name:'Roth 401k, pretax benefits and direct HSA',patch:{retirement:{traditional:0,roth:12000},benefits:{health:200},hsa:{employee:2400,payroll:false}},expected:{federal:16514,fica:8996.4,net:77689.6,takeHome:79561.56,rsu:0,discount:0}});
for(const fixture of cases) {
 test('independent dollars: '+fixture.name,()=>{
  const p=C.calculate(C.merge(C.merge(C.defaults(),base),fixture.patch),2026),f=C.cashFlow(p),g=buildFlow(p,f),e=fixture.expected;
  const check=(actual,expected,name)=>{assert(Number.isFinite(actual),name+' must be finite');assertClose(actual,expected,.01,name);};
  check(p.taxes.federal,e.federal,'federal');check(p.taxes.fica,e.fica,'FICA');
  check(f.netCashFlow,e.net,'net cash');check(g.summary.takeHome,e.takeHome,'take-home');
  check(g.summary.rsuIncome,e.rsu,'RSU income in chart');check(g.summary.esppDiscount,e.discount,'ESPP discount in chart');
  for(const n of g.nodes.filter(n=>n.kind==='hub'))check(g.links.filter(l=>l.target===n.id).reduce((s,l)=>s+l.value,0),g.links.filter(l=>l.source===n.id).reduce((s,l)=>s+l.value,0),n.id+' conservation');
  assert(g.nodes.filter(n=>n.kind==='asset').every(n=>n.column===4),'assets reach right edge');
 });
}
module.exports={base,cases};

test('take-home is the first outgoing payroll flow; asset destinations reach the right edge',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,retirement:{traditional:24000},hsa:{employee:1200}}),2026);
 const g=buildFlow(p,C.cashFlow(p));
 assert(g.links.filter(l=>l.source==='gross')[0].target==='takehome','take-home starts above deductions');
 for(const id of ['traditional','hsa']) assert(g.links.some(l=>l.source===id && g.nodes.find(n=>n.id===l.target).column===4),id+' must continue to account');
});
test('ESPP purchase benefit is not earned twice when old shares sell',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,salaryGrowth:0,tax:{state:'none'},espp:{enabled:true,rate:.1,start:'2026-01-01',periodMonths:12,fractional:true,holdShares:false,holdMonths:12,offerPrice:100,purchasePrice:100,salePrice:100}}),2027);
 const g=buildFlow(p,C.cashFlow(p));
 assertClose(g.summary.esppDiscount,2117.6470588235,.01);
 assert(!g.links.some(l=>l.source==='espp-growth'),'flat old shares do not earn their discount again');
});
test('refunds, cross-year offerings and underwater sales conserve all intermediate flows',()=>{
 for(const year of [2026,2027,2028])for(const salePrice of [70,100,130])for(const periodMonths of [6,12]){
  const p=C.calculate(C.merge(C.defaults(),{salary:120000,espp:{enabled:true,rate:.2,start:'2025-10-01',periodMonths,fractional:false,holdShares:false,holdMonths:6,salePrice}}),year),g=buildFlow(p,C.cashFlow(p,{expenses:36000}));
  for(const n of g.nodes.filter(n=>n.kind==='hub'))assertClose(g.links.filter(l=>l.target===n.id).reduce((s,l)=>s+l.value,0),g.links.filter(l=>l.source===n.id).reduce((s,l)=>s+l.value,0),.01,`${year}/${salePrice}/${periodMonths}/${n.id}`);
  assertClose(g.summary.remainingCash-g.summary.fundingNeeded,g.summary.netCashFlow,.01);
 }
});
test('monthly money rounds floating-point half cents consistently',()=>{
 const {roundMoney}=require('../money-flow');
 assertClose(roundMoney(68287.01999999999/12),5690.59,.000001);
 assertClose(roundMoney(-68287.01999999999/12),-5690.59,.000001);
});
test('worked cases agree with the lifetime projection used by the UI',()=>{
 const S=require('../scenario'),P=require('../projection');const DEFAULT_CONFIG={expenses:S.defaults().projection.monthlyExpenses};
 for(const fixture of cases){
  const compensation=C.merge(C.merge(C.defaults(),base),fixture.patch);
  const m=P.calculate(S.migrate({config:{...DEFAULT_CONFIG,compensation,traditionalIRA:0,projectionYears:2,expenses:Object.fromEntries(Object.keys(DEFAULT_CONFIG.expenses).map(k=>[k,0]))}}).scenario);
  const row=m.rows.find(r=>r.payroll);
  assertClose(row.flow.netCashFlow,fixture.expected.net,.01,fixture.name);
 }
});
test('existing pretax IRA adds pro-rata tax to the maximum-contribution fixture',()=>{
 const S=require('../scenario'),P=require('../projection');const DEFAULT_CONFIG={expenses:S.defaults().projection.monthlyExpenses};
 const compensation=C.merge(C.merge(C.defaults(),base),cases[6].patch);
 const m=P.calculate(S.migrate({config:{...DEFAULT_CONFIG,compensation,traditionalIRA:30000,projectionYears:2,expenses:Object.fromEntries(Object.keys(DEFAULT_CONFIG.expenses).map(k=>[k,0]))}}).scenario);
 const row=m.rows.find(r=>r.payroll);
 // 7,500 * 30,000 / 37,500 = 6,000 taxable, at a 35% marginal rate.
 assertClose(row.flow.netCashFlow,111539.65,.01);
});
