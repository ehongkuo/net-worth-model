const {test,assert,assertClose}=require('./harness');
const C=require('../compensation'),T=require('../tax-engine'),F=require('../money-flow');
const sum=(rows,key)=>rows.reduce((s,r)=>s+r[key],0);
const cfg=patch=>C.merge(C.defaults(),{salary:120000,frequency:'monthly',tax:{state:'none'},...patch});
const grant=mode=>({value:12000,start:'2025-12-31',months:12,interval:3,cliff:0,grantPrice:100,vestPrice:100,saleMode:mode});
test('tax streams: bracket slices sum into source totals and preserve withholding',()=>{
 const p=C.calculate(cfg({grants:[grant('cover')]})),f=C.cashFlow(p),x=f.taxAttribution;
 // 132,000 gross less 16,100 standard = 115,900. Salary gets 10/11 of taxable income.
 // Salary: 1,240 + 4,560 + (105,363.63636 - 50,400)*22%.
 const salary=x.sources.find(s=>s.id==='salary'),rsu=x.sources.find(s=>s.id==='rsu');
 assertClose(salary.federalOrdinary,17892,.001);
 assertClose(rsu.federalOrdinary,2522,.001);
 assertClose(rsu.taxable,10536.363636,.001);
 assertClose(sum(x.sources,'federalOrdinary'),20414,.001);
 assertClose(sum(x.groups,'total'),30512,.001);
 assertClose(sum(x.groups,'cashWithholding'),p.cashWithholding,.001);
 assertClose(sum(x.groups,'cover'),3558,.001);
 assertClose(sum(x.groups,'balance'),f.taxBalance,.001);
 assertClose(p.stockAssets,8442,.001);
});
test('tax streams: deductions compare on identical schedules and zero-income stays finite',()=>{
 const p=C.calculate(cfg({retirement:{traditional:24000}})),x=C.cashFlow(p).taxAttribution;
 assertClose(x.beforeOrdinary,120000);assertClose(x.afterOrdinary,79900);
 assertClose(x.beforeBracketTax,21398);assertClose(x.afterBracketTax,12290);
 assertClose(sum(x.sources,'deduction'),40100);
 const z=C.cashFlow(C.calculate(cfg({salary:0}))).taxAttribution;
 assertClose(z.afterOrdinary,0);assertClose(sum(z.groups,'total'),0);
});
test('tax streams: credits, capital gains, state and payroll reconcile without double counting',()=>{
 const p=C.calculate(cfg({grants:[grant('cover')],tax:{state:'CA',federalCredits:1000,estimatedPayments:500}}));
 const taxes=T.calculate({...p.income,longGain:30000},2026,p.taxes.audit.settings),f=C.cashFlow(p,{taxes}),x=f.taxAttribution;
 for(const key of ['federal','state','payroll','total'])assertClose(sum(x.groups,key),key==='payroll'?taxes.fica+taxes.sdi:taxes[key],.001);
 assertClose(sum(x.groups,'estimatedPayments'),500,.001);
 assertClose(sum(x.groups,'balance'),f.taxBalance,.001);
 assertClose(sum(x.sources,'capitalTax'),taxes.audit.capitalTax,.001);
});
test('tax streams: gross RSU source stays whole for hold, sell and cover modes',()=>{
 for(const mode of ['hold','sell','cover']){
  const p=C.calculate(cfg({grants:[grant(mode)]})),f=C.cashFlow(p),g=F.buildFlow(p,f);
  assertClose(g.links.filter(l=>l.source==='rsu-vesting').reduce((s,l)=>s+l.value,0),12000,.001,mode);
  const rsu=f.taxAttribution.groups.find(s=>s.id==='rsu');
  assertClose(rsu.cover,p.rsuSellToCover,.001);
  for(const n of g.nodes.filter(n=>n.kind==='hub'))assertClose(g.links.filter(l=>l.target===n.id).reduce((s,l)=>s+l.value,0),g.links.filter(l=>l.source===n.id).reduce((s,l)=>s+l.value,0),.001,n.id);
  assertClose(g.summary.remainingCash-g.summary.fundingNeeded,f.spendableCashFlow,.001);
 }
});
test('tax streams: backdoor explanation distinguishes basis from taxable conversion',()=>{
 const clean=C.calculate(cfg({retirement:{ira:7500,iraMode:'backdoor'}}));
 assertClose(clean.contributions.iraTaxableConversion,0);
 assertClose(clean.contributions.iraConversionAudit.nontaxable,7500);
 const mixed=C.calculate(cfg({retirement:{ira:7500,iraMode:'backdoor',iraPretaxBalance:30000}}));
 assertClose(mixed.contributions.iraConversionAudit.pretaxBalance,30000);
 assertClose(mixed.contributions.iraConversionAudit.nontaxable,1500);
 assertClose(mixed.contributions.iraTaxableConversion,6000);
});
test('tax streams: mixed RSU elections preserve one gross vesting source',()=>{
 const p=C.calculate(cfg({grants:[grant('sell'),grant('cover'),grant('hold')]})),f=C.cashFlow(p),g=F.buildFlow(p,f);
 assert(g.nodes.filter(n=>n.id==='rsu-vesting').length===1);
 assertClose(g.links.filter(l=>l.source==='rsu-vesting').reduce((s,l)=>s+l.value,0),36000,.001);
 assertClose(sum(f.taxAttribution.groups,'total'),f.taxes.total,.001);
});
test('tax streams: overpayments and zero-income estimated payments reconcile',()=>{
 for(const patch of [{tax:{state:'none',estimatedPayments:50000}},{salary:0,tax:{state:'none',estimatedPayments:2000}}]){
  const p=C.calculate(cfg(patch)),f=C.cashFlow(p),g=F.buildFlow(p,f);
  assertClose(sum(f.taxAttribution.groups,'estimatedPayments'),patch.tax.estimatedPayments,.001);
  assertClose(sum(f.taxAttribution.groups,'balance'),f.taxBalance,.001);
  assertClose(sum(f.taxAttribution.groups,'reserve'),0,.001);
  assertClose(g.summary.remainingCash-g.summary.fundingNeeded,f.spendableCashFlow,.001);
 }
});
test('tax streams: each cash withholding and reserve ribbon matches the engine group',()=>{
 const p=C.calculate(cfg({grants:[grant('hold')],espp:{enabled:true,holdShares:false,fractional:true,shareCap:0}})),f=C.cashFlow(p),g=F.buildFlow(p,f);
 for(const row of f.taxAttribution.groups){
  for(const [prefix,field] of [['withholding','cashWithholding'],['tax-reserve','reserve']]){
   const value=g.links.filter(l=>l.target===`${prefix}-${row.id}`).reduce((s,l)=>s+l.value,0);
   assertClose(value,row[field],.001);
  }
 }
});
