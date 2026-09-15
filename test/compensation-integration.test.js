const { describe, test, assert, assertClose, assertEqual } = require('./harness');
const C = require('../compensation');
const { LifetimeModel } = require('../model');
function model(patch = {}) {
  return new LifetimeModel({ projectionYears: 5, marketReturn:0, inflation:0,
    cash:100000, brokerage:0, pretax401kBal:0, rothAccounts:0, traditionalIRA:0, hsa:0,
    socialSecurityAnnual:0, retirementAge:90,
    expenses:{housing:0,dining:0,groceries:0,giving:0,travel:0,entertainment:0,auto:0,other:0},
    compensation:C.merge(C.defaults(),{salary:120000,salaryGrowth:0,...patch}) });
}
describe('compensation integration', () => {
  test('first projected cash year uses 2026 compensation without advancing salary', () => {
    const rows=model().simulate();
    assertEqual(rows[1].year,2026); assertEqual(rows[1].age,25);
    assertClose(rows[1].income.salary,120000);
    assertClose(rows[1].netCashFlow,rows[1].payroll.afterTaxCash);
  });
  test('cash, retirement and employer contributions reconcile to net worth', () => {
    const rows=model({retirement:{traditional:24000,roth:500,employerAnnual:5000,megaEnabled:true,mega:20000},hsa:{employee:4000,employer:400}}).simulate();
    for(let i=1;i<rows.length;i++) {
      const r=rows[i], p=r.payroll;
      assertClose(r.netWorth-rows[i-1].netWorth,p.gross+p.contributions.employer+p.contributions.hsaEmployer-r.taxes,0.01);
    }
  });
  test('held RSUs grow assets without creating cash and release no phantom salary', () => {
    const rows=model({grants:[{value:40000,start:'2026-01-01',months:48,cliff:12,interval:3,sell:false}]}).simulate();
    assertClose(rows[1].payroll.rsuCash,0);
    for(let i=1;i<rows.length;i++) {
      assertClose(rows[i].netWorth-rows[i-1].netWorth,rows[i].payroll.gross-rows[i].taxes,0.01);
    }
  });
  test('ESPP principal is conserved across delayed sales and calendar years', () => {
    const rows=model({espp:{enabled:true,holdMonths:13,offerPrice:100,purchasePrice:100,salePrice:100}}).simulate();
    for(let i=1;i<rows.length;i++) {
      const r=rows[i], p=r.payroll;
      const purchaseGain=p.espp.lots.filter(l=>l.purchaseDate.startsWith(String(r.year))).reduce((n,l)=>n+l.shares*l.purchasePrice-l.cost,0);
      assertClose(r.netWorth-rows[i-1].netWorth,p.salary+purchaseGain-r.taxes,0.01);
    }
  });
  test('retirement stops payroll and new stock purchases', () => {
    const m=model({espp:{enabled:true},retirement:{traditional:24500}});
    m.updateConfig({retirementAge:27});
    const r=m.simulate().find(r=>r.age===27);
    assertClose(r.payroll.salary,0); assertClose(r.payroll.contributions.totalEmployee,0);
    assertClose(r.payroll.espp.contributions,0);
  });
  test('input values and grant arrays are not mutated by simulation', () => {
    const m=model({grants:[{value:40000,start:'2026-01-01',months:48,cliff:12,interval:3,sell:true}]});
    const before=JSON.stringify(m.getConfig()); m.simulate();
    assertEqual(JSON.stringify(m.getConfig()),before);
  });
  test('changing contribution limit growth changes future capped savings', () => {
    const slow=model({retirement:{traditional:100000,contributionGrowth:0},tax:{limitGrowth:0}}).simulate();
    const fast=model({retirement:{traditional:100000,contributionGrowth:0},tax:{limitGrowth:.1}}).simulate();
    assert(fast.at(-1).savings.pretax401k>slow.at(-1).savings.pretax401k);
  });
  test('clearing a year override restores its calculated limit', () => {
    const m=model({tax:{overrides:{2030:{deferral:30000}}}});
    const c=m.getConfig().compensation;
    delete c.tax.overrides[2030].deferral;
    m.updateConfig({compensation:c});
    assertEqual(C.limits(2030,m.getConfig().compensation.tax).deferral,27000);
  });
  test('the selected horizon and all resulting balances remain finite', () => {
    const m=model({espp:{enabled:true,holdMonths:25},grants:[{value:100000,start:'2026-01-01',months:48,cliff:12,interval:3,sell:true}]});
    const rows=m.simulate();
    assertEqual(rows.at(-1).age,30);
    for(const r of rows) {
      assert(Number.isFinite(r.netWorth)); assert(Number.isFinite(r.taxes));
      assert(Object.values(r.balances).every(Number.isFinite));
    }
  });
});

describe('separate equity assets', () => {
  test('all account balances sum to net worth without counting shares twice', () => {
    const rows=model({espp:{enabled:true,holdShares:true},grants:[{value:40000,start:'2026-01-01',months:48,cliff:12,interval:3,sell:false}]}).simulate();
    for(const row of rows) {
      const total=Object.values(row.balances).reduce((sum,v)=>sum+v,0);
      assert(Number.isFinite(total)); assertClose(total,row.netWorth,.01);
      if(!row.isInitial) assertClose(row.balances.companyEquity,row.payroll.stockAssets);
    }
  });
});

describe('selected-year cash flow', () => {
  test('retirement income and final taxes reconcile with lifetime cash flow', () => {
    const m=model();m.updateConfig({age:65,retirementAge:65,socialSecurityStartAge:65,socialSecurityAnnual:40000});
    for(const row of m.simulate().filter(r=>!r.isInitial)) {
      assert(row.cashFlow.socialSecurity>0);
      assertClose(row.cashFlow.taxes.total,row.taxes);
      assertClose(row.cashFlow.netCashFlow,row.netCashFlow,.01);
      assertClose(row.cashFlow.months.reduce((n,m)=>n+m.netCashFlow,0),row.netCashFlow,.01);
    }
  });
  test('working household monthly and annual cash agree with final projection', () => {
    const m=model({tax:{spouseIncome:60000,otherIncome:12000},espp:{enabled:true,holdShares:true}});
    for(const row of m.simulate().filter(r=>!r.isInitial)) {
      const f=row.cashFlow;assertClose(f.netCashFlow,row.netCashFlow,.01);
      for(const month of f.months) {
        const receipts=month.salary+month.bonus+month.rsuCash+month.spouseIncome+month.otherIncome+month.socialSecurity+month.eventIncome+month.esppProceeds;
        const deductions=month.contributions+month.benefits+month.esppContributions+month.withholding+month.livingExpenses+month.taxAdjustment;
        assert(Number.isFinite(receipts-deductions)); assertClose(receipts-deductions,month.netCashFlow,.01);
      }
    }
  });
});
