const { describe, test, assert, assertClose, assertEqual } = require('./harness');
const C = require('../compensation');
const P = require('../payroll-calendar');
const config = patch => C.merge(C.defaults(), {
  salary: 165000, frequency: 'biweekly', firstPayday: '2026-01-09',
  retirement: { megaEnabled: true, megaAnnualCap: 20000 },
  hsa: { employer: 800 }, payroll: { enabled: true, useYtd: false,
    elections: { traditional: {mode:'fixed',value:1205.77}, mega:{mode:'fixed',value:951.93}, hsa:{mode:'fixed',value:178.75} } }, ...patch
});
describe('dated payroll contributions', () => {
  test('keeps observed pace until IRS and employer caps, with cent-level final checks', () => {
    const r=C.calculate(config());
    assertClose(r.contributions.traditional,24500);
    assertClose(r.contributions.mega,20000);
    assertClose(r.contributions.hsa,3600);
    assertClose(r.paychecks[19].traditional,1205.77);
    assertClose(r.paychecks[20].traditional,384.60);
    assertClose(r.paychecks[21].mega,9.47);
    assertClose(r.paychecks[22].mega,0);
    assertClose(r.paychecks[20].hsa,25);
    assertClose(r.paychecks[21].hsa,0);
    assert(r.paychecks[22].netPay>r.paychecks[0].netPay);
  });
  test('monthly contributions and paycheck amounts share one calendar', () => {
    const r=C.calculate(config());
    for(const m of r.months){
      const checks=r.paychecks.filter(p=>Number(p.date.slice(5,7))===m.month);
      assertClose(m.accountContributions.mega,checks.reduce((n,p)=>n+p.mega,0));
      assertClose(m.salary,checks.reduce((n,p)=>n+p.salary,0));
      assertClose(m.bankCash,checks.reduce((n,p)=>n+p.netPay,0));
    }
  });
  test('no employer cap can raise statutory capacity', () => {
    const c=config();c.retirement.megaAnnualCap=100000;c.retirement.employerAnnual=10000;
    c.payroll.elections.mega.value=10000;
    assertClose(C.calculate(c).contributions.mega,37500);
  });
  test('zero is a real custom cap, blank means no employer restriction', () => {
    const c=config();c.retirement.megaAnnualCap=0;
    assertClose(C.calculate(c).contributions.mega,0);
    c.retirement.megaAnnualCap=null;
    assertClose(C.calculate(c).contributions.mega,24750.18);
  });
  test('family HSA, disabled contributions, and 27-paycheck calendars', () => {
    const c=config();c.frequency='biweekly';c.firstPayday='2026-01-01';c.hsa.coverage='family';
    const r=C.calculate(c);assertEqual(r.paychecks.length,27);assertClose(r.contributions.hsa,4826.25);
    c.hsa.eligible=false;c.retirement.megaEnabled=false;
    const off=C.calculate(c);assertClose(off.contributions.hsa,0);assertClose(off.contributions.mega,0);
  });
  test('actuals stay unchanged; YTD reduces future room without double counting', () => {
    const c=config();c.payroll.useYtd=true;
    c.payroll.records=[{id:'synthetic',date:'2026-09-18',kind:'regular',current:{salary:6346.15,traditional:1205.77,mega:951.93,hsa:178.75,hsaEmployer:30.77,health:24,federal:753.58,state:354.22,ss:381.37,medicare:89.19,sdi:82.29,espp:0,post:0,imputed:7.75,allowance:0},ytd:{salary:95192.25,traditional:16880.78,mega:13327.02,hsa:2502.58,hsaEmployer:461.55}}];
    const r=C.calculate(c),actual=r.paychecks.find(p=>p.date==='2026-09-18');
    assertClose(actual.traditional,1205.77);assertEqual(actual.source,'uploaded');
    assertClose(r.contributions.traditional,24500);
    assertClose(r.contributions.mega,19990.53);
    assert(r.paychecks.some(p=>p.source==='history-estimate'));
    assertClose(r.paychecks.filter(p=>p.date<='2026-09-18').reduce((n,p)=>n+p.traditional,0),16880.78);
    assertClose(r.deductionSources.salary,r.contributions.traditional+r.income.payrollDeduction+r.contributions.hsa);
  });
  test('money distribution preserves cents and rejects invalid dates', () => {
    assertEqual(P.splitCents(100,3).reduce((n,v)=>n+v,0),100);
    assert(!P.validDate('2026-02-30'));assert(P.validDate('2026-02-28'));
  });
  test('equity and salary share the Social Security wage cap on the event calendar', () => {
    const c=config();c.salary=200000;c.grants=[{value:100000,grantPrice:100,vestPrice:100,start:'2025-12-31',months:12,interval:3,cliff:0,saleMode:'cover'}];
    const r=C.calculate(c),ss=r.paychecks.reduce((n,p)=>n+p.ss,0)+r.payrollCalendar.equityTaxes.reduce((n,e)=>n+e.ss,0);
    assertClose(ss,11439,.03);
    const flow=C.cashFlow(r);assertClose(flow.months.reduce((n,m)=>n+m.netCashFlow,0),flow.netCashFlow,.02);
  });
  test('statutory overrides cannot raise a contribution ceiling', () => {
    const c=config();c.tax.overrides={2026:{deferral:99999,total401k:999999,hsaSingle:99999}};
    const r=C.calculate(c);assertClose(r.contributions.traditional,24500);assertClose(r.contributions.hsa,3600);
  });
  test('allowances enter cash flow while imputed income enters only the tax base', () => {
    const c=config();c.payroll.elections.allowance={mode:'fixed',value:40};c.payroll.elections.imputed={mode:'fixed',value:7.75};
    const r=C.calculate(c),flow=C.cashFlow(r);
    assertClose(r.cashAllowance,1040);assertClose(r.imputedIncome,201.5);
    assertClose(r.income.wages,r.salary+r.bonus+r.rsuGross+201.5);
    assertClose(flow.months.reduce((n,m)=>n+m.netCashFlow,0),flow.netCashFlow,.02);
  });
  test('ESPP payroll cap limits paycheck deductions and monthly funding together', () => {
    const c=config();c.espp={...c.espp,enabled:true,annualPayrollCap:5000,holdShares:true};c.payroll.elections.espp={mode:'fixed',value:951.93};
    const r=C.calculate(c);assertClose(r.espp.contributions,5000);
    assertClose(r.paychecks.reduce((n,p)=>n+p.espp,0),5000);
  });
  test('direct HSA transfers affect monthly cash but do not reduce paycheck deposits', () => {
    const c=config();c.hsa.payroll=false;
    const r=C.calculate(c);
    assertClose(r.paychecks.reduce((n,p)=>n+p.netPay,0)-r.bankCash,r.contributions.hsa,.02);
  });
  test('uploaded checks are matched to pay periods when bank and check dates differ',()=>{
    const c=config();c.firstPayday='2026-01-08';c.payroll.records=[{id:'different-anchor',date:'2026-09-18',periodStart:'2026-09-07',periodEnd:'2026-09-20',kind:'regular',current:{salary:6346.15},ytd:{}}];
    const r=C.calculate(c);assertEqual(r.paychecks.length,26);assert(!r.paychecks.some(p=>p.date==='2026-09-17'));
  });
});
