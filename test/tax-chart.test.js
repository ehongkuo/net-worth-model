const {test,assert,assertClose}=require('./harness');
const {taxChartLayout}=require('../tax-ui');
const rows=[{lower:0,upper:12400,rate:.1,income:12400,tax:1240},{lower:12400,upper:50400,rate:.12,income:38000,tax:4560},{lower:50400,upper:105700,rate:.22,income:29500,tax:6490},{lower:105700,upper:Infinity,rate:.24,income:0,tax:0}];
test('tax chart: sources fill one taxable bar and share the bracket dollar scale',()=>{
 const v=taxChartLayout([{label:'Salary',value:120000},{label:'Bonus',value:12000}],rows);
 assertClose(v.total,79900,.001);assertClose(v.maximum,84694,.001);
 assertClose(v.segments[0].value,72636.363636,.001);assertClose(v.segments[1].value,7263.636364,.001);
 assertClose(v.segments[1].start,v.segments[0].value,.001);
 assertClose(v.headroom,25800,.001);assertClose(v.brackets[1].start,12400,.001);
});
test('tax chart: zero income has a finite axis and no misleading taxable slices',()=>{
 const v=taxChartLayout([{label:'Salary',value:12000}],rows.map(r=>({...r,income:0,tax:0})));
 assert(v.segments.length===0);assertClose(v.maximum,12400,.001);assertClose(v.total,0,.001);
});
test('tax chart: exact boundary uses next bracket and top bracket has no invented limit',()=>{
 const boundary=taxChartLayout([{label:'Salary',value:12400}],rows.map((r,i)=>({...r,income:i===0?12400:0})));
 assertClose(boundary.maximum,13144,.001);assertClose(boundary.headroom,38000,.001);
 const top=taxChartLayout([{label:'Salary',value:2000000}],rows.map((r,i)=>({...r,income:i===3?2000000:0})));
 assert(Number.isFinite(top.maximum));assert(top.maximum>top.total);assert(top.headroom===null);
 assert(top.brackets.every(r=>r.end<=top.maximum));
});
