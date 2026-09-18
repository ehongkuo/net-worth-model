const {test,assert,assertClose}=require('./harness');
const C=require('../compensation'),Parser=require('../paystub-parser');
const config=()=>C.merge(C.defaults(),{salary:120000,bonusPercent:0,frequency:'semimonthly',retirement:{megaEnabled:true,megaAnnualCap:20000},payroll:{enabled:true,useYtd:true}});
const record=(date,traditional,ytd)=>({id:date,date,kind:'regular',current:{salary:5000,traditional,mega:750,hsa:100,health:20,federal:400,state:200,taxableFederal:4880-traditional,taxablePayroll:4880},ytd:{salary:50000,traditional:ytd,mega:7500,hsa:1000,health:200,federal:4000,state:2000}});
test('latest regular upload supplies future elections and withholding without rewriting actuals',()=>{
 const c=config();c.payroll.records=[record('2026-05-15',500,5000),record('2026-05-31',750,5750)];
 const p=C.calculate(c),future=p.paychecks.find(r=>r.source==='forecast'&&r.date>'2026-05-31');
 assertClose(future.traditional,750);assertClose(future.mega,750);assertClose(future.health,20);
 assertClose(future.federal,400);assertClose(future.state,200);
 assertClose(p.paychecks.find(r=>r.date==='2026-05-15').traditional,500);
});
test('capped upload preserves prior election and resumes it next year',()=>{
 const c=config();c.payroll.records=[record('2026-11-15',1000,24000),record('2026-11-30',500,24500)];
 assertClose(Parser.suggest(c.payroll.records,c).elections.traditional.value,.2);
 const future=C.calculate(c,2027).paychecks[0];assertClose(future.traditional,future.salary*.2,.01);
});
test('uncapped zero upload stops an old deduction while capped zero keeps its election',()=>{
 const c=config();c.payroll.elections={traditional:{mode:'percent',value:.19}};
 let r=record('2026-05-15',0,5000);assertClose(Parser.suggest([r],c).elections.traditional.value,0);
 r.ytd.traditional=24500;assertClose(Parser.suggest([r],c).elections.traditional.value,.19);
});
test('eligible bonus basis does not inflate inferred elections',()=>{
 const c=config(),r=record('2026-05-15',1000,5000);r.current.bonus=5000;c.retirement.bonusEligible=true;
 assertClose(Parser.suggest([r],c).elections.traditional.value,.1);
});
test('reviewed election edits override the same upload, while a newer upload replaces them',()=>{
 const c=config(),r=record('2026-05-15',500,5000);c.payroll.records=[r];
 c.payroll.elections={traditional:{mode:'percent',value:.12,sourceDate:r.date}};
 let p=C.calculate(c);assertClose(p.paychecks.find(r=>r.source==='forecast'&&r.date>'2026-05-15').traditional,600);
 c.payroll.records.push(record('2026-05-31',750,5750));p=C.calculate(c);
 assertClose(p.paychecks.find(r=>r.source==='forecast'&&r.date>'2026-05-31').traditional,750);
});
