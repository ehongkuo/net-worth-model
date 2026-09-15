(function(root) {
  'use strict';
  const colors={cash:'#38bdf8',loss:'#fb7185',asset:'#a78bfa',equity:'#fbbf24',funding:'#fb923c'};
  function buildFlow(p,f) {
    const nodes=[],links=[];
    const node=(id,label,column,type='cash',kind='sink')=>{nodes.push({id,label,column,color:colors[type],kind});return id;};
    const link=(source,target,value)=>{if(value>1e-7) links.push({source,target,value});};
    node('gross','Gross cash pay',1,'cash','hub');
    node('takehome','Take-home cash',2,'cash','hub');
    node('available','Cash to allocate',3,'cash','hub');
    let gross=0;
    for(const [id,label,value] of [['salary','Base salary',p.salary],['bonus','Bonus',p.bonus],['rsu','RSUs sold (amortized)',p.rsuCash],['spouse','Spouse pay',p.income.spouse]]) {
      if(value>0) {node(id,label,0,'cash','source');link(id,'gross',value);gross+=value;}
    }
    const payrollHsa=p.income.hsaPayroll || 0;
    const deductions=[['withholding','Cash tax withholding',p.cashWithholding ?? p.withholding,'loss'],['traditional','Traditional 401(k)',p.contributions.traditional,'asset'],['roth','Roth 401(k)',p.contributions.roth,'asset'],['mega','Mega backdoor',p.contributions.mega,'asset'],['hsa','Payroll HSA',payrollHsa,'asset'],['espp','ESPP purchases / funding',p.espp.contributions,'equity'],['benefits','Benefits',p.benefits,'loss']];
    let payrollDeductions=0;
    deductions.forEach(([id,label,value,type])=>{if(value>0){node(id,label,2,type);link('gross',id,value);payrollDeductions+=value;}});
    const takeHome=gross-payrollDeductions;
    const payrollFunding=Math.max(0,-takeHome);
    if(payrollFunding){node('payroll-funding','Payroll funding needed',0,'funding','source');link('payroll-funding','gross',payrollFunding);}
    link('gross','takehome',Math.max(0,takeHome));link('takehome','available',Math.max(0,takeHome));
    let otherCash=0, otherCosts=0;
    for(const [id,label,value] of [['other','Other / rental cash',f.otherIncome],['ss','Social Security',f.socialSecurity],['events','Life-event cash',f.eventIncome],['espp-return','ESPP sales + refunds',p.espp.proceeds+p.espp.refunds],['tax-refund','Estimated tax overpayment',Math.max(0,-f.taxBalance)]]) {
      if(value>0){node(id,label,2,'cash','source');link(id,'available',value);otherCash+=value;}
      else if(value<0){node(id,label+' outflow',4,'loss');link('available',id,-value);otherCosts-=value;}
    }
    const uses=[['living','Living expenses',f.expenses,'loss'],['ira','IRA / backdoor Roth',p.contributions.ira,'asset'],['direct-hsa','Direct HSA transfer',p.contributions.hsa-payrollHsa,'asset'],['tax-reserve','Additional tax reserve',Math.max(0,f.taxBalance),'loss']];
    uses.forEach(([id,label,value,type])=>{if(value>0){node(id,label,4,type);link('available',id,value);otherCosts+=value;}});
    const budget=Math.max(0,takeHome)+otherCash-otherCosts;
    const budgetFunding=Math.max(0,-budget);
    if(budgetFunding){node('budget-funding','Savings needed for budget',2,'funding','source');link('budget-funding','available',budgetFunding);}
    if(budget>0){node('remaining','Remaining cash',4);link('available','remaining',budget);}
    const purchased=p.espp.lots.filter(l=>Number(l.purchaseDate.slice(0,4))===p.year);
    const sold=p.espp.lots.filter(l=>!l.held && Number(l.saleDate.slice(0,4))===p.year);
    const purchaseCost=purchased.reduce((s,l)=>s+l.cost,0);
    const esppDiscount=purchased.reduce((s,l)=>s+Math.max(0,l.shares*l.purchasePrice-l.cost),0);
    const priorSold=sold.filter(l=>Number(l.purchaseDate.slice(0,4))<p.year);
    const priorCost=priorSold.reduce((s,l)=>s+(l.openingValue ?? l.shares*l.purchasePrice),0);
    const movement=sold.map(l=>l.proceeds-(Number(l.purchaseDate.slice(0,4))===p.year?l.cost+Math.max(0,l.shares*l.purchasePrice-l.cost):(l.openingValue ?? l.shares*l.purchasePrice)));
    const saleGrowth=movement.reduce((s,v)=>s+Math.max(0,v),0),saleLoss=movement.reduce((s,v)=>s+Math.max(0,-v),0);
    const pending=p.espp.contributions-p.espp.refunds-purchaseCost;
    const released=priorCost+Math.max(0,-pending);
    const retained=purchased.filter(l=>l.held || Number(l.saleDate.slice(0,4))>p.year).reduce((s,l)=>s+l.cost+Math.max(0,l.shares*l.purchasePrice-l.cost),0)+Math.max(0,pending);
    // ESPP proceeds recycle principal. Only the purchase benefit and later gains are new value.
    const oldReturn=links.findIndex(l=>l.source==='espp-return');
    if(oldReturn>=0) links.splice(oldReturn,1);
    const oldNode=nodes.findIndex(n=>n.id==='espp-return');if(oldNode>=0)nodes.splice(oldNode,1);
    if(!nodes.some(n=>n.id==='espp'))node('espp','ESPP purchases / funding',2,'equity','hub');
    nodes.find(n=>n.id==='espp').kind='hub';
    const source=(id,label,value,target,type='equity')=>{if(value>1e-7){node(id,label,0,type,'source');link(id,target,value);}};
    source('espp-discount','ESPP purchase benefit',esppDiscount,'espp');
    source('espp-growth','ESPP sale gains',saleGrowth,'espp');
    source('espp-released','Existing ESPP funds',released,'espp','funding');
    link('espp','available',p.espp.proceeds+p.espp.refunds);
    node('equity-account','Equity retained',4,'equity','asset');
    link('espp','equity-account',retained);
    if(saleLoss){node('espp-loss','ESPP value lost / fees',4,'loss');link('espp','espp-loss',saleLoss);}
    node('retirement-account','Retirement accounts',4,'asset','asset');
    node('hsa-account','HSA account',4,'asset','asset');
    for(const [id,target] of [['traditional','retirement-account'],['roth','retirement-account'],['mega','retirement-account'],['hsa','hsa-account']]) {
      const n=nodes.find(n=>n.id===id);if(n){n.kind='hub';const amount=links.filter(l=>l.target===id).reduce((s,l)=>s+l.value,0);link(id,target,amount);}
    }
    // Post-payroll contributions feed the same account destinations without creating income.
    for(const [id,target] of [['ira','retirement-account'],['direct-hsa','hsa-account']]) {
      const l=links.find(l=>l.target===id);if(l)l.target=target;
      const i=nodes.findIndex(n=>n.id===id);if(i>=0)nodes.splice(i,1);
    }
    const heldRsu=Math.max(0,p.rsuGross-p.rsuCash-(p.rsuSellToCover || 0));
    source('rsu-vesting','RSUs vested (amortized)',heldRsu,'equity-account');
    if(p.rsuSellToCover>0){if(!nodes.some(n=>n.id==='rsu-vesting'))node('rsu-vesting','RSUs vested (amortized)',0,'equity','source');node('rsu-cover','RSU sell-to-cover taxes',2,'loss');link('rsu-vesting','rsu-cover',p.rsuSellToCover);}
    source('employer-retirement','Employer retirement',p.contributions.employer,'retirement-account','asset');
    source('employer-hsa','Employer HSA',p.contributions.hsaEmployer,'hsa-account','asset');
    const remaining=nodes.find(n=>n.id==='remaining');if(remaining){remaining.kind='asset';remaining.label='Cash retained';}
    const active=new Set(links.flatMap(l=>[l.source,l.target]));
    // Allocate the upper payroll ribbon to take-home before allocating deductions.
    links.sort((a,b)=>(a.source==='gross'&&a.target==='takehome'?-1:0)-(b.source==='gross'&&b.target==='takehome'?-1:0));
    const nonCash=[{label:'RSUs kept invested',value:heldRsu,color:colors.equity},{label:'Employer retirement funding',value:p.contributions.employer,color:colors.asset},{label:'Employer HSA funding',value:p.contributions.hsaEmployer,color:colors.asset}].filter(r=>r.value>0);
    return {nodes:nodes.filter(n=>active.has(n.id)),links,nonCash,summary:{grossCashPay:gross,payrollDeductions,takeHome,rsuIncome:p.rsuGross,esppDiscount,assetAdditions:p.contributions.totalEmployee+p.contributions.employer+p.contributions.hsaEmployer+heldRsu+retained,totalIncome:gross+heldRsu+(p.rsuSellToCover || 0)+esppDiscount+saleGrowth+p.contributions.employer+p.contributions.hsaEmployer+Math.max(0,f.otherIncome)+Math.max(0,f.socialSecurity)+Math.max(0,f.eventIncome),assetTransfers:p.contributions.totalEmployee+p.espp.contributions,taxes:f.taxes.total,spending:f.expenses+p.benefits,remainingCash:Math.max(0,budget),fundingNeeded:payrollFunding+budgetFunding,netCashFlow:f.netCashFlow}};
  }

  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(container,graph,format) {
    if(!container.clientWidth) return [];
    const endpointOrder=['remaining','living','tax-reserve','retirement-account','hsa-account','equity-account','espp-loss'];
    const sourceOrder=['salary','bonus','rsu','spouse','payroll-funding','employer-retirement','employer-hsa','espp-discount','espp-growth','espp-released','rsu-vesting'];
    const columns=Array.from({length:5},(_,c)=>graph.nodes.filter(n=>n.column===c).sort((a,b)=>c===4?(endpointOrder.indexOf(a.id)<0?99:endpointOrder.indexOf(a.id))-(endpointOrder.indexOf(b.id)<0?99:endpointOrder.indexOf(b.id)):c===0?sourceOrder.indexOf(a.id)-sourceOrder.indexOf(b.id):0));
    const sums=new Map(graph.nodes.map(n=>[n.id,{input:0,output:0}]));
    graph.links.forEach(l=>{sums.get(l.source).output+=l.value;sums.get(l.target).input+=l.value;});
    const height=Math.max(620,...columns.map(c=>c.length*70+100)),width=Math.max(780,container.clientWidth || 780),gap=52,nodeWidth=12;
    const scale=Math.min(...columns.filter(c=>c.length).map(c=>(height-100-gap*(c.length-1))/c.reduce((sum,n)=>sum+Math.max(sums.get(n.id).input,sums.get(n.id).output),0)));
    const positions=new Map();
    columns.forEach((column,c)=>{let y=70;column.forEach(n=>{const value=Math.max(sums.get(n.id).input,sums.get(n.id).output);const h=value*scale;positions.set(n.id,{...n,x:12+c*(width-174)/4,y,h,value,input:0,output:0});y+=h+gap;});});
    const offsets=new Map(graph.links.map(l=>[l,{}]));
    for(const n of positions.values()){
      let offset=0;
      graph.links.filter(l=>l.source===n.id).sort((a,b)=>positions.get(a.target).y-positions.get(b.target).y).forEach(l=>{offsets.get(l).out=offset;offset+=l.value*scale;});
      offset=0;
      graph.links.filter(l=>l.target===n.id).sort((a,b)=>positions.get(a.source).y-positions.get(b.source).y).forEach(l=>{offsets.get(l).in=offset;offset+=l.value*scale;});
    }
    const paths=graph.links.map((l,i)=>{
      const a=positions.get(l.source),b=positions.get(l.target),thickness=l.value*scale;
      const y1=a.y+offsets.get(l).out+thickness/2,y2=b.y+offsets.get(l).in+thickness/2;
      const x1=a.x+nodeWidth,x2=b.x,mid=(x1+x2)/2;
      const text=`${a.label} → ${b.label}: ${format(l.value)} / year ÷ 12 = ${format(l.value/12)} / month`;
      return `<path class="sankey-link" data-flow="${i}" tabindex="0" role="button" aria-label="${escape(text)}" d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" stroke="${a.color===colors.funding?a.color:b.color}" stroke-width="${Math.max(.5,thickness)}"><title>${escape(text)}</title></path>`;
    }).join('');
    const wrap=label=>{const lines=[''];for(const word of label.split(' ')){if((lines.at(-1)+' '+word).trim().length>21) lines.push(word);else lines[lines.length-1]=(lines.at(-1)+' '+word).trim();}return lines;};
    const labels=[...positions.values()].map(n=>`<g><rect x="${n.x}" y="${n.y}" width="${nodeWidth}" height="${Math.max(.5,n.h)}" fill="${n.color}" rx="3"/><text x="${n.x}" y="${n.y-21}" class="sankey-label">${wrap(n.label).map((line,i,lines)=>`<tspan x="${n.x}" y="${n.y-21-(lines.length-1-i)*14}">${escape(line)}</tspan>`).join('')}</text><text x="${n.x}" y="${n.y-6}" class="sankey-value">${escape(format(n.value/12))}</text></g>`).join('');
    container.innerHTML=`<div class="sankey-scroll"><svg viewBox="0 0 ${width} ${height}" role="group" aria-label="Monthly money flow. Use the flow table below for exact amounts.">${paths}${labels}</svg></div><p class="flow-selection" aria-live="polite">Select a flow to inspect its monthly amount.</p>`;
    const select=el=>{const l=graph.links[Number(el.dataset.flow)];container.querySelector('.flow-selection').textContent=`${positions.get(l.source).label} → ${positions.get(l.target).label}: ${format(l.value)} / year ÷ 12 = ${format(l.value/12)} / month.`;};
    container.querySelectorAll('[data-flow]').forEach(el=>{el.onclick=()=>select(el);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(el);}};});
    return graph.links.map(l=>[positions.get(l.source).label,positions.get(l.target).label,format(l.value/12)]);
  }
  const roundMoney=value=>Math.sign(value)*Math.round((Math.abs(value)+1e-9)*100)/100;
  const api={buildFlow,render,roundMoney};
  if(typeof module!=='undefined') module.exports=api;
  root.MoneyFlow=api;
})(typeof window!=='undefined'?window:globalThis);
