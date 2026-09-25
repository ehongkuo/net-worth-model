const {test,assert,assertClose}=require('./harness');
const C=require('../compensation'),F=require('../money-flow'),UI=require('../input-rules');
const grant={value:12000,grantPrice:100,start:'2025-12-31',months:12,interval:3,saleMode:'hold'};
test('salary-only pre-tax elections leave gross bonus and RSUs intact in the second bar',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,bonusPercent:.1,grants:[grant],retirement:{traditional:12000,bonusEligible:false,rsuEligible:false},hsa:{employee:2400},tax:{state:'none'}}));
 const x=C.cashFlow(p).taxAttribution,by=id=>x.sources.find(s=>s.id===id);
 assertClose(by('salary').gross,120000);assertClose(by('salary').afterPretax,105600);
 assertClose(by('bonus').afterPretax,12000);assertClose(by('rsu').afterPretax,12000);
 assertClose(x.afterPretax,129600);assertClose(x.afterOrdinary,113500);assertClose(x.householdDeductions,16100);
 assertClose(x.sources.reduce((s,r)=>s+r.taxable,0),113500);
});
test('deductions follow dated cash paychecks and do not reduce the RSU wage source',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,bonusPercent:.1,grants:[grant],retirement:{traditional:14400,bonusEligible:true,rsuEligible:true},tax:{state:'none'}}));
 const x=C.cashFlow(p).taxAttribution,by=id=>x.sources.find(s=>s.id===id);
 assertClose(by('salary').payrollDeduction+by('bonus').payrollDeduction,14400);assertClose(by('rsu').payrollDeduction,0);
 assertClose(x.afterPretax,129600);assertClose(x.householdDeductions,16100);
});
test('salary timing explains two and three paycheck months without altering annual pay',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:165000,frequency:'biweekly',firstPayday:'2026-01-09'}));
 const a=UI.salaryTiming(p,1),b=UI.salaryTiming(p,5);
 assert(a.checks===2);assert(b.checks===3);assert(a.annualChecks===26);
 assertClose(a.average,13750);assertClose(a.scheduled,12692.32,.001);assertClose(b.scheduled,19038.46,.02);
 assertClose(p.months.reduce((s,m)=>s+m.salary,0),165000);
});
test('state income comparison applies California HSA rules without shrinking bonus or RSUs',()=>{
 const {stateIncomeComparison}=require('../tax-ui');
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,bonusPercent:.1,grants:[grant],retirement:{traditional:12000,bonusEligible:false},hsa:{employee:2400,employer:1000},tax:{state:'CA'}}));
 const f=C.cashFlow(p),v=stateIncomeComparison(f.taxAttribution,f.taxes.audit,f.taxes);
 assertClose(v.gross,145000);assertClose(v.afterPretax,133000);
 assertClose(v.sources.find(s=>s.id==='bonus').afterPretax,12000);assertClose(v.sources.find(s=>s.id==='rsu').afterPretax,12000);
 assertClose(v.afterPretax-v.householdDeductions,f.taxes.stateTaxable);
});
test('gross bars preserve pay when household losses reduce final taxable income',()=>{
 const T=require('../tax-engine');
 const p=C.calculate(C.merge(C.defaults(),{salary:120000,bonusPercent:.1,grants:[grant],retirement:{traditional:12000,bonusEligible:false},hsa:{employee:2400},tax:{state:'none'}}));
 const taxes=T.calculate({...p.income,ordinary:-6000},2026,p.taxes.audit.settings),x=T.attribute(taxes,p);
 assertClose(x.beforeOrdinary,144000);assertClose(x.afterPretax,129600);assertClose(x.afterOrdinary,107500);assertClose(x.householdDeductions,22100);
 assertClose(x.sources.find(s=>s.id==='bonus').gross,12000);
});
test('high compensation does not over-allocate deductions beyond the actual contribution',()=>{
 const p=C.calculate(C.merge(C.defaults(),{salary:500000,bonusPercent:.1,retirement:{traditional:24500,bonusEligible:true},tax:{state:'none'}}));
 assertClose(Object.values(p.deductionSources).reduce((a,b)=>a+b,0),24500,.001);
 const x=C.cashFlow(p).taxAttribution;assertClose(x.beforeOrdinary-x.afterPretax,24500,.001);
});
