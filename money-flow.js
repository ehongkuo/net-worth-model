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
    for(const [id,label,value] of [['salary','Base salary',p.salary],['allowance','Cash allowances',p.cashAllowance||0],['bonus','Bonus',p.bonus],['spouse','Spouse pay',p.income.spouse]]) {
      if(value>0) {node(id,label,0,'cash','source');link(id,'gross',value);gross+=value;}
    }
    if(p.rsuCash>0){node('rsu-vesting','RSUs vested (amortized)',0,'equity','source');link('rsu-vesting','gross',p.rsuCash);gross+=p.rsuCash;}
    const payrollHsa=p.income.hsaPayroll || 0;
    const deductions=[['withholding','Cash tax withholding',p.cashWithholding ?? p.withholding,'loss'],['traditional','Traditional 401(k), pre-tax',p.contributions.traditional,'asset'],['roth','Roth 401(k), after-tax',p.contributions.roth,'asset'],['mega','Mega backdoor, after-tax',p.contributions.mega,'asset'],['hsa','Payroll HSA',payrollHsa,'asset'],['espp','ESPP purchases / funding',p.espp.contributions,'equity'],['benefits','Benefits',p.benefits,'loss']];
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
    const uses=[['living','Living expenses',f.expenses,'loss'],['ira','IRA / backdoor Roth',p.contributions.ira,'asset'],['direct-hsa','Direct HSA transfer',p.contributions.hsa-payrollHsa,'asset'],['tax-payments','Estimated taxes paid',f.taxFunding?.estimatedPayments || 0,'loss'],['tax-reserve','Expected additional taxes',Math.max(0,f.taxBalance),'loss'],['future-tax-reserve','Cash reserved for future ESPP tax',f.futureTaxReserve || 0,'asset']];
    uses.forEach(([id,label,value,type])=>{if(value>0){node(id,label,4,type);link('available',id,value);otherCosts+=value;}});
    const budget=Math.max(0,takeHome)+otherCash-otherCosts;
    const budgetFunding=Math.max(0,-budget);
    if(budgetFunding){node('budget-funding','Savings needed for budget',2,'funding','source');link('budget-funding','available',budgetFunding);}
    if(budget>0){node('remaining','Remaining cash',4);link('available','remaining',budget);}
    const inPeriod=date=>Number(date.slice(0,4))===p.year&&(!p.periodMonth||Number(date.slice(5,7))===p.periodMonth);
    const periodStart=`${p.year}-${String(p.periodMonth||1).padStart(2,'0')}-01`;
    const periodEnd=p.periodMonth?`${p.year}-${String(p.periodMonth).padStart(2,'0')}-31`:`${p.year}-12-31`;
    const purchased=p.espp.lots.filter(l=>inPeriod(l.purchaseDate));
    const sold=p.espp.lots.filter(l=>!l.held && inPeriod(l.saleDate));
    const purchaseCost=purchased.reduce((s,l)=>s+l.cost,0);
    const esppDiscount=purchased.reduce((s,l)=>s+Math.max(0,l.shares*l.purchasePrice-l.cost),0);
    const priorSold=sold.filter(l=>l.purchaseDate<periodStart);
    const priorValue=l=>Number(l.purchaseDate.slice(0,4))<p.year?(l.openingValue??l.shares*l.purchasePrice):l.shares*l.purchasePrice;
    const priorCost=priorSold.reduce((s,l)=>s+priorValue(l),0);
    const movement=sold.map(l=>l.proceeds-(inPeriod(l.purchaseDate)?l.cost+Math.max(0,l.shares*l.purchasePrice-l.cost):priorValue(l)));
    const saleGrowth=movement.reduce((s,v)=>s+Math.max(0,v),0),saleLoss=movement.reduce((s,v)=>s+Math.max(0,-v),0);
    const pending=p.espp.contributions-p.espp.refunds-purchaseCost;
    const retained=purchased.filter(l=>l.held || l.saleDate>periodEnd).reduce((s,l)=>s+l.cost+Math.max(0,l.shares*l.purchasePrice-l.cost),0);
    // ESPP proceeds recycle principal. Only the purchase benefit and later gains are new value.
    const oldReturn=links.findIndex(l=>l.source==='espp-return');
    if(oldReturn>=0) links.splice(oldReturn,1);
    const oldNode=nodes.findIndex(n=>n.id==='espp-return');if(oldNode>=0)nodes.splice(oldNode,1);
    if(!nodes.some(n=>n.id==='espp'))node('espp','ESPP purchases / funding',2,'equity','hub');
    nodes.find(n=>n.id==='espp').kind='hub';
    const source=(id,label,value,target,type='equity')=>{if(value>1e-7){node(id,label,0,type,'source');link(id,target,value);}};
    source('espp-discount','ESPP purchase benefit',esppDiscount,'espp');
    source('espp-growth','ESPP sale gains',saleGrowth,'espp');
    source('espp-released','Existing ESPP shares sold',priorCost,'espp');
    source('espp-cash-released','Previously accumulated ESPP cash',Math.max(0,-pending),'espp','cash');
    link('espp','available',p.espp.proceeds+p.espp.refunds);
    node('equity-account','Equity retained',4,'equity','asset');
    link('espp','equity-account',retained);
    if(pending>0){node('espp-pending-account','ESPP cash awaiting purchase',4,'cash','asset');link('espp','espp-pending-account',pending);}
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
    if(heldRsu>0){if(!nodes.some(n=>n.id==='rsu-vesting'))node('rsu-vesting','RSUs vested (amortized)',0,'equity','source');link('rsu-vesting','equity-account',heldRsu);}
    if(p.rsuSellToCover>0){if(!nodes.some(n=>n.id==='rsu-vesting'))node('rsu-vesting','RSUs vested (amortized)',0,'equity','source');node('rsu-cover','RSU sell-to-cover taxes',2,'loss');link('rsu-vesting','rsu-cover',p.rsuSellToCover);}
    source('employer-retirement','Employer retirement',p.contributions.employer,'retirement-account','asset');
    source('employer-hsa','Employer HSA',p.contributions.hsaEmployer,'hsa-account','asset');
    const reserveNode=nodes.find(n=>n.id==='future-tax-reserve');if(reserveNode)reserveNode.kind='asset';
    const remaining=nodes.find(n=>n.id==='remaining');if(remaining){remaining.kind='asset';remaining.label='Unallocated cash';}
    if(f.taxAttribution){
      const groups=f.taxAttribution.groups;
      const replacePayment=(id,field,prefix)=>{
        const original=links.find(l=>l.target===id);if(!original)return;
        links.splice(links.indexOf(original),1);
        const old=nodes.findIndex(n=>n.id===id);if(old>=0)nodes.splice(old,1);
        groups.filter(g=>g[field]>1e-7).forEach(g=>{
          const target=`${id}-${g.id}`;node(target,`${g.label}: ${prefix}`,id==='withholding'?2:4,'loss');
          link(original.source,target,g[field]);
        });
      };
      replacePayment('withholding','cashWithholding','cash withheld');
      replacePayment('tax-reserve','reserve','additional tax');
      replacePayment('tax-payments','estimatedPayments','estimated payment');
      const rsu=groups.find(g=>g.id==='rsu');
      links.filter(l=>l.source==='rsu-vesting'||l.target.includes('rsu')).forEach(l=>{
        l.taxDetail={label:p.periodMonth?'RSU tax funding (with planning settlement)':'RSU attributed tax',liability:rsu.total,cover:rsu.cover,cash:rsu.cashWithholding,balance:rsu.balance};
      });
    }
    const active=new Set(links.flatMap(l=>[l.source,l.target]));
    // Allocate the upper payroll ribbon to take-home before allocating deductions.
    links.sort((a,b)=>(a.source==='gross'&&a.target==='takehome'?-1:0)-(b.source==='gross'&&b.target==='takehome'?-1:0));
    const nonCash=[{label:'RSUs kept invested',value:heldRsu,color:colors.equity},{label:'Employer retirement funding',value:p.contributions.employer,color:colors.asset},{label:'Employer HSA funding',value:p.contributions.hsaEmployer,color:colors.asset}].filter(r=>r.value>0);
    return {nodes:nodes.filter(n=>active.has(n.id)),links,nonCash,summary:{retirementBreakdown:{mega:p.contributions.mega,ira:p.contributions.ira},pretaxBenefits:p.income.payrollDeduction||0,grossCashPay:gross,payrollDeductions,takeHome,rsuIncome:p.rsuGross,esppDiscount,assetAdditions:p.contributions.totalEmployee+p.contributions.employer+p.contributions.hsaEmployer+heldRsu+retained+Math.max(0,pending),totalIncome:gross+heldRsu+(p.rsuSellToCover || 0)+esppDiscount+saleGrowth+p.contributions.employer+p.contributions.hsaEmployer+Math.max(0,f.otherIncome)+Math.max(0,f.socialSecurity)+Math.max(0,f.eventIncome),assetTransfers:p.contributions.totalEmployee+p.espp.contributions,taxes:f.taxes.total,spending:f.expenses+p.benefits,remainingCash:Math.max(0,budget),fundingNeeded:payrollFunding+budgetFunding,netCashFlow:f.netCashFlow,spendableCashFlow:f.spendableCashFlow}};
  }

  function forMonth(payroll,flow,month) {
    const m=flow.months.find(m=>m.month===month);
    if(!m)throw new RangeError('Month must be within the modeled year');
    const contributions={...payroll.contributions,...m.accountContributions};
    const p={...payroll,periodMonth:month,salary:m.salary,cashAllowance:m.allowance||0,imputedIncome:m.imputed||0,bonus:m.bonus,rsuGross:m.rsu,rsuCash:m.rsuCash,rsuSellToCover:m.rsuSellToCover,
      withholding:m.withholding,cashWithholding:m.cashWithholding,benefits:m.benefits,contributions,
      income:{...payroll.income,spouse:m.spouseIncome,hsaPayroll:m.payrollHsa,payrollDeduction:payroll.benefits?m.benefits*(payroll.income.payrollDeduction||0)/payroll.benefits:0},
      espp:{...payroll.espp,contributions:m.esppContributions,proceeds:m.esppSaleProceeds,refunds:m.esppRefund}};
    const groups=flow.taxAttribution?.groups.map(g=>{
      const cover=g.id==='rsu'?m.rsuSellToCover:0;
      const rsuCash=Math.min(Math.max(0,m.cashWithholding),Math.max(0,m.rsuWithholding-m.rsuSellToCover));
      const cashWithholding=g.id==='rsu'?rsuCash:g.id==='cash'?m.cashWithholding-rsuCash:0;
      const estimatedPayments=g.estimatedPayments/12,balance=g.balance/12;
      return {...g,annualLiability:g.total,total:cashWithholding+cover+estimatedPayments+balance,cashWithholding,cover,estimatedPayments,balance,reserve:g.reserve/12};
    });
    const taxes=m.cashWithholding+m.rsuSellToCover+m.estimatedTaxPayments+m.taxAdjustment;
    const f={...flow,periodMonth:month,expenses:m.livingExpenses,otherIncome:m.otherIncome,socialSecurity:m.socialSecurity,eventIncome:m.eventIncome,
      taxBalance:m.taxAdjustment,futureTaxReserve:m.futureTaxReserve,netCashFlow:m.netCashFlow,spendableCashFlow:m.spendableCashFlow,
      afterTaxCash:m.netCashFlow+m.livingExpenses,taxes:{...flow.taxes,total:taxes},
      taxFunding:{...flow.taxFunding,liability:taxes,cashWithholding:m.cashWithholding,rsuWithholding:m.rsuSellToCover,estimatedPayments:m.estimatedTaxPayments,remainingLiability:m.taxAdjustment},
      taxAttribution:groups?{...flow.taxAttribution,groups}:null};
    f.cashIn=m.salary+(m.allowance||0)+m.bonus+m.rsuCash+m.spouseIncome+m.otherIncome+m.esppProceeds+m.socialSecurity+m.eventIncome;
    f.cashOut=f.cashIn-f.netCashFlow;
    return {payroll:p,flow:f};
  }
  function allocateCosts(accounts,costs) {
    const remaining=Object.fromEntries(Object.entries(accounts).map(([key,value])=>[key,Math.max(0,value)]));
    const used={cash:0,espp:0,rsu:0,retirement:0};
    let shortfall=Math.max(0,costs);
    for(const key of Object.keys(used)){
      used[key]=Math.min(remaining[key]||0,shortfall);
      remaining[key]=(remaining[key]||0)-used[key];shortfall-=used[key];
    }
    return {used,remaining,shortfall};
  }

  function orderFlow(graph) {
    const allowance=graph.nodes.find(n=>n.id==='allowance');
    if(allowance){
      const salaryValue=graph.links.filter(l=>l.source==='salary').reduce((s,l)=>s+l.value,0),allowanceValue=graph.links.filter(l=>l.source==='allowance').reduce((s,l)=>s+l.value,0);
      const salary=graph.nodes.find(n=>n.id==='salary')||{...allowance,id:'salary'};
      graph={...graph,nodes:[...graph.nodes.filter(n=>!['salary','allowance'].includes(n.id)),{...salary,label:'Salary + cash allowances',components:[{label:'Base salary',value:salaryValue},{label:'Cash allowances',value:allowanceValue}]}],links:graph.links.map(l=>({...l,source:l.source==='allowance'?'salary':l.source}))};
    }
    const incoming=id=>graph.links.filter(l=>l.target===id).reduce((sum,l)=>sum+l.value,0);
    const outgoing=id=>graph.links.filter(l=>l.source===id).reduce((sum,l)=>sum+l.value,0);
    const nodes=graph.nodes.filter(n=>n.kind==='source'&&!['payroll-funding','budget-funding'].includes(n.id)).map(n=>({...n,column:0,label:n.label.replace(' (amortized)','')}));
    const links=[],add=(source,target,value,extra={})=>{if(value>1e-7)links.push({source,target,value,...extra});};
    const node=(id,label,column,color=colors.cash,kind='hub')=>nodes.push({id,label,column,color,kind});
    node('combined','Total incoming value',1);
    nodes.filter(n=>n.kind==='source').forEach(n=>add(n.id,'combined',outgoing(n.id)));
    let available=links.reduce((sum,l)=>sum+l.value,0),unfunded=0;
    const take=value=>{const amount=Math.min(available,Math.max(0,value));unfunded+=Math.max(0,value-amount);available-=amount;return amount;};
    const pretax={retirement:0,hsa:0};
    for(const [id,key] of [['traditional','retirement'],['hsa','hsa']]){
      const original=graph.nodes.find(n=>n.id===id);if(!original)continue;
      const amount=take(incoming(id));pretax[key]+=amount;
      node(id,original.label,2,colors.asset);add('combined',id,amount);add(id,`account-${key}`,amount);
    }
    const pretaxBenefits=Math.min(incoming('benefits'),graph.summary.pretaxBenefits||0);
    if(pretaxBenefits){node('benefits-pretax','Pre-tax insurance / benefits',2,colors.loss,'sink');add('combined','benefits-pretax',take(pretaxBenefits));}
    node('after-deductions','After pre-tax deductions',2);add('combined','after-deductions',available);
    const endpoints=graph.nodes.filter(n=>n.kind!=='source'&&n.kind!=='hub');
    const taxNodes=endpoints.filter(n=>/^(withholding|tax-payments|tax-reserve|rsu-cover)/.test(n.id));
    for(const n of taxNodes){
      nodes.push({...n,column:3});
      const old=graph.links.find(l=>l.target===n.id);
      add('after-deductions',n.id,take(incoming(n.id)),old?.taxDetail?{taxDetail:old.taxDetail}:{});
    }
    node('after-tax','After tax payments',3);add('after-deductions','after-tax',available);
    const rsu=graph.links.filter(l=>l.target==='equity-account'&&l.source==='rsu-vesting').reduce((sum,l)=>sum+l.value,0);
    const earmark=incoming('future-tax-reserve');
    const intended={cash:0,espp:Math.max(0,incoming('equity-account')-rsu),rsu,retirement:Math.max(0,incoming('retirement-account')-pretax.retirement),hsa:Math.max(0,incoming('hsa-account')-pretax.hsa),reserve:earmark,pending:incoming('espp-pending-account')};
    const assetTotal=Object.values(intended).reduce((a,b)=>a+b,0);
    intended.cash=Math.max(0,available-assetTotal);
    // Remove unfunded transfers from the illustration instead of inventing income.
    const constrained=allocateCosts(intended,Math.max(0,assetTotal-available));
    let constrainedGap=constrained.shortfall;
    for(const key of ['reserve','hsa','pending']){const cut=Math.min(constrained.remaining[key],constrainedGap);constrained.remaining[key]-=cut;constrainedGap-=cut;}
    const accounts={...constrained.remaining,retirement:constrained.remaining.retirement+pretax.retirement,hsa:constrained.remaining.hsa+pretax.hsa};
    const costs=endpoints.filter(n=>n.kind!=='asset'&&!taxNodes.includes(n));
    const costBreakdown=costs.map(n=>({label:n.id==='benefits'?'Post-tax benefits':n.label,value:incoming(n.id)-(n.id==='benefits'?pretaxBenefits:0)})).filter(n=>n.value>1e-7);
    const costTotal=costBreakdown.reduce((sum,n)=>sum+n.value,0);
    const allocation=allocateCosts(accounts,costTotal);
    const labels={cash:'Cash before expenses',espp:'ESPP assets',rsu:'RSU equity',retirement:'Retirement accounts',hsa:'HSA account',reserve:'Future-tax cash reserve',pending:'ESPP cash awaiting purchase'};
    node('costs','Expenses (illustrative funding)',5,colors.loss,'sink');
    for(const [key,label] of Object.entries(labels)){
      const id=`account-${key}`,color=['espp','rsu'].includes(key)?colors.equity:['retirement','hsa'].includes(key)?colors.asset:colors.cash;
      node(id,label,4,color);
      add('after-tax',id,constrained.remaining[key]||0);
      add(id,'costs',allocation.used[key]||0,{visualOnly:true,costBreakdown});
      if(allocation.remaining[key]>1e-7){node(`remaining-${key}`,`${key==='reserve'?'Reserved cash':label.replace(' before expenses','')} remaining`,5,color,'asset');add(id,`remaining-${key}`,allocation.remaining[key],{visualOnly:true});}
    }
    // Split the retirement presentation without changing the aggregate cost-allocation policy.
    let splitRoom=constrained.remaining.retirement||0;
    for(const [key,label] of [['mega','Mega backdoor Roth'],['ira','Regular IRA / backdoor Roth']]){
      const amount=Math.min(splitRoom,graph.summary.retirementBreakdown?.[key]||0);
      if(!amount)continue;
      splitRoom-=amount;
      const total=accounts.retirement,spent=total?amount*(allocation.used.retirement||0)/total:0;
      node(`account-${key}`,label,4,colors.asset);
      const feed=links.find(l=>l.source==='after-tax'&&l.target==='account-retirement');if(feed)feed.value-=amount;
      add('after-tax',`account-${key}`,amount);
      const cost=links.find(l=>l.source==='account-retirement'&&l.target==='costs');if(cost)cost.value-=spent;
      add(`account-${key}`,'costs',spent,{visualOnly:true,costBreakdown});
      const keep=amount-spent,old=links.find(l=>l.source==='account-retirement'&&l.target==='remaining-retirement');if(old)old.value-=keep;
      if(keep>1e-7){node(`remaining-${key}`,`${label} remaining`,5,colors.asset,'asset');add(`account-${key}`,`remaining-${key}`,keep,{visualOnly:true});}
    }
    for(let i=links.length-1;i>=0;i--)if(links[i].value<1e-7)links.splice(i,1);
    const active=new Set(links.flatMap(l=>[l.source,l.target]));
    return {...graph,nodes:nodes.filter(n=>active.has(n.id)),links,columnCount:6,
      visualAllocation:{...allocation,costs:costTotal,costBreakdown,unfundedBeforeExpenses:unfunded,constrainedTransfers:Math.max(0,assetTotal-available),cashShortfall:Math.max(0,-graph.summary.spendableCashFlow)}};
  }

  function sourceBands(graph) {
    const palette={bonus:'#818cf8',spouse:'#2dd4bf','espp-discount':'#fb923c','espp-growth':'#fb923c','espp-released':'#fb923c'};
    const nodes=graph.nodes.map(n=>({...n,color:palette[n.id]||n.color})),links=graph.links.map(l=>({...l,bands:[]}));
    const cash=b=>b.id==='espp-cash-released'||!b.id.startsWith('espp-')&&!b.id.startsWith('employer-')&&b.id!=='rsu-vesting';
    const preference=target=>target==='rsu-cover'||target==='account-rsu'?b=>b.id==='rsu-vesting':target==='account-espp'?b=>b.id.startsWith('espp-'):target==='account-retirement'?b=>b.id==='employer-retirement'||cash(b):target==='account-hsa'?b=>b.id==='employer-hsa'||cash(b):cash;
    for(const n of [...nodes].sort((a,b)=>a.column-b.column)){
      const outgoing=links.filter(l=>l.source===n.id),pool=new Map();
      const add=b=>{const old=pool.get(b.id);pool.set(b.id,{...b,value:(old?.value||0)+b.value});};
      if(n.kind==='source')add({id:n.id,label:n.label,color:n.color,value:outgoing.reduce((s,l)=>s+l.value,0)});
      else links.filter(l=>l.target===n.id).forEach(l=>l.bands.forEach(add));
      n.bands=[...pool.values()].map(b=>({...b}));
      const rank=l=>['account-rsu','account-espp','rsu-cover'].includes(l.target)?0:l.target.startsWith('after-')?2:1;
      for(const l of [...outgoing].sort((a,b)=>rank(a)-rank(b))){
        let need=l.value;const allocated=new Map();
        const consume=filter=>{
          const candidates=[...pool.values()].filter(b=>b.value>1e-9&&filter(b)),total=candidates.reduce((s,b)=>s+b.value,0),amount=Math.min(need,total);
          for(const b of candidates){const value=total?amount*b.value/total:0;allocated.set(b.id,{...b,value:(allocated.get(b.id)?.value||0)+value});b.value-=value;}
          need-=amount;
        };
        if(!l.target.startsWith('after-'))consume(preference(l.target));
        if(l.target==='account-espp')consume(cash);
        consume(()=>true);l.bands=[...allocated.values()].filter(b=>b.value>1e-9);
      }
    }
    return {...graph,nodes,links};
  }

  const categoryColors={cash:'#38bdf8',equity:'#fbbf24',retirement:'#a78bfa',cost:'#fb7185'};
  function flowCategory(id) {
    if(/^(espp-cash-released|espp-pending|account-pending|remaining-pending)/.test(id))return 'cash';
    if(/^(account-mega|account-ira|remaining-mega|remaining-ira)/.test(id))return 'retirement';
    if(/^(withholding|tax-payments|tax-reserve|rsu-cover|benefits|costs|living|espp-loss)/.test(id))return 'cost';
    if(/^(traditional|roth|mega|hsa|direct-hsa|retirement-account|hsa-account|employer-|account-retirement|account-hsa|remaining-retirement|remaining-hsa)/.test(id))return 'retirement';
    if(/^(rsu-vesting|espp-|equity-account|account-rsu|account-espp|remaining-rsu|remaining-espp)/.test(id))return 'equity';
    if(['combined','after-deductions','after-tax'].includes(id))return null;
    return 'cash';
  }
  function categoryBands(graph) {
    const result=sourceBands(graph);
    for(const link of result.links){
      const category=flowCategory(link.target),bands=[],groups=new Map();
      for(const original of link.bands){
        const sourceCategory=flowCategory(link.source)||flowCategory(original.id)||'cash',kind=category||sourceCategory,key=`${sourceCategory}:${kind}`;
        let band=groups.get(key);
        if(!band){band={sourceCategory,category:kind,id:kind,label:{cash:'Cash',equity:'Equity',retirement:'Retirement / HSA',cost:'Taxes / costs'}[kind],color:categoryColors[kind],value:0,components:[]};groups.set(key,band);bands.push(band);}
        band.value+=original.value;band.components.push({id:original.id,label:original.label,value:original.value});
      }
      link.bands=bands;
    }
    for(const node of result.nodes){
      node.color=categoryColors[flowCategory(node.id)]||'#64748b';
      node.bands=result.links.filter(l=>l.target===node.id).flatMap(l=>l.bands);
      if(node.kind==='source')node.bands=[{color:node.color,value:result.links.filter(l=>l.source===node.id).reduce((s,l)=>s+l.value,0)}];
    }
    return result;
  }
  function bandLayout(graph) {
    const result={...graph,nodes:graph.nodes.map(n=>({...n})),links:graph.links.map(l=>({...l,bands:l.bands.map(b=>({...b}))}))};
    const order=['equity','retirement','cash','cost'];
    for(const node of result.nodes){
      const incoming=result.links.filter(l=>l.target===node.id),outgoing=result.links.filter(l=>l.source===node.id);
      const place=(links,categoryKey,offsetKey)=>{
        let offset=0;
        for(const category of order){
          for(const link of [...links].sort((a,b)=>Number(b.target.startsWith('after-'))-Number(a.target.startsWith('after-')))){
            for(const band of link.bands.filter(b=>b[categoryKey]===category)){band[offsetKey]=offset;offset+=band.value;}
          }
        }
      };
      place(incoming,'category','targetOffset');place(outgoing,'sourceCategory','sourceOffset');
      node.segments=(incoming.length?incoming.flatMap(l=>l.bands.map(b=>({category:b.category,value:b.value,offset:b.targetOffset}))):outgoing.flatMap(l=>l.bands.map(b=>({category:b.sourceCategory,value:b.value,offset:b.sourceOffset}))));
    }
    return result;
  }
  function laneGeometry(graph,width) {
    const order=['cash','equity','retirement'];
    const nodes=graph.nodes.filter(n=>!n.id.startsWith('remaining-')).map(n=>({...n,segments:[]}));
    const links=graph.links.filter(l=>!l.target.startsWith('remaining-')).map(l=>({...l,bands:l.bands.map(b=>({...b}))}));
    const sum=(id,side)=>graph.links.filter(l=>l[side]===id).reduce((s,l)=>s+l.value,0);
    const total=Math.max(1,sum('combined','target')),scale=360/total,gap=84;
    const priority=['salary','bonus','spouse','other','ss','events','tax-refund','account-cash','account-pending','account-reserve','rsu-vesting','espp-discount','espp-growth','espp-released','account-espp','account-rsu','mega','account-mega','ira','account-ira','traditional','account-retirement','hsa','account-hsa','employer-retirement','employer-hsa'];
    const key=n=>priority.includes(n.id)?priority.indexOf(n.id):priority.length;
    const sorted=list=>[...list].sort((a,b)=>key(a)-key(b)||a.id.localeCompare(b.id));
    const taxCategory=n=>n.id==='rsu-cover'?'equity':'cash';
    const mixed=n=>flowCategory(n.id)===null;
    const size=n=>Math.max(sum(n.id,'target'),sum(n.id,'source'))*scale;
    const bases={},taxBases={};let cursor=100;
    for(const category of order){
      bases[category]=cursor;
      let extent=0,taxExtent=0,taxStart=0;
      for(let column=0;column<5;column++){
        const regular=nodes.filter(n=>n.column===column&&flowCategory(n.id)===category);
        const tax=nodes.filter(n=>n.column===column&&flowCategory(n.id)==='cost'&&taxCategory(n)===category);
        const mixedSize=Math.max(0,...nodes.filter(n=>n.column===column&&mixed(n)).map(n=>graph.links.filter(l=>l.target===n.id).flatMap(l=>l.bands).filter(b=>b.category===category).reduce((s,b)=>s+b.value*scale,0)));
        extent=Math.max(extent,regular.reduce((s,n)=>s+size(n),0)+Math.max(0,regular.length-1)*gap,mixedSize);
        if(tax.length)taxStart=Math.max(taxStart,mixedSize,regular.reduce((s,n)=>s+size(n),0)+Math.max(0,regular.length-1)*gap);
        taxExtent=Math.max(taxExtent,tax.reduce((s,n)=>s+size(n),0)+Math.max(0,tax.length-1)*gap);
      }
      taxBases[category]=cursor+taxStart+gap;
      cursor+=Math.max(extent,taxExtent?taxStart+gap+taxExtent:0)+gap;
    }
    const positions=new Map();
    for(let column=0;column<6;column++){
      for(const category of order){
        let y=bases[category];
        for(const n of sorted(nodes.filter(n=>n.column===column&&flowCategory(n.id)===category))){positions.set(n.id,{y});y+=size(n)+gap;}
        y=taxBases[category];
        for(const n of sorted(nodes.filter(n=>n.column===column&&flowCategory(n.id)==='cost'&&n.id!=='costs'&&taxCategory(n)===category))){positions.set(n.id,{y});y+=size(n)+gap;}
      }
      nodes.filter(n=>n.column===column&&mixed(n)).forEach(n=>positions.set(n.id,{y:100}));
    }
    for(const [id,target] of [['traditional','account-retirement'],['hsa','account-hsa']])if(positions.has(id)&&positions.has(target))positions.set(id,{...positions.get(target)});
    positions.set('costs',{y:100});
    for(const n of nodes){Object.assign(n,positions.get(n.id),{x:12+n.column*(width-174)/5,h:size(n),value:Math.max(sum(n.id,'target'),sum(n.id,'source')),remaining:graph.links.filter(l=>l.source===n.id&&l.target.startsWith('remaining-')).reduce((s,l)=>s+l.value,0)});}
    const byId=new Map(nodes.map(n=>[n.id,n]));
    for(const n of nodes){
      const place=(items,incoming)=>{
        const offset={cash:0,equity:0,retirement:0,cost:0};let packed=0;
        items.sort((a,b)=>{
          if(!incoming){const ac=a.target.startsWith('after-'),bc=b.target.startsWith('after-');if(ac!==bc)return bc-ac;}
          return byId.get(incoming?a.source:a.target).y-byId.get(incoming?b.source:b.target).y;
        });
        for(const l of items)for(const b of [...l.bands].sort((a,b)=>order.indexOf(incoming?a.category:a.sourceCategory)-order.indexOf(incoming?b.category:b.sourceCategory))){
          const category=incoming?b.category:b.sourceCategory;
          const y=mixed(n)?bases[category]+offset[category]:n.y+packed;
          b[incoming?'targetY':'sourceY']=y;offset[category]+=b.value*scale;packed+=b.value*scale;
        }
      };
      const incoming=links.filter(l=>l.target===n.id),outgoing=links.filter(l=>l.source===n.id);
      place(incoming,true);place(outgoing,false);
      n.segments=incoming.length?incoming.flatMap(l=>l.bands.map(b=>({category:b.category,value:b.value,y:b.targetY}))):outgoing.flatMap(l=>l.bands.map(b=>({category:b.sourceCategory,value:b.value,y:b.sourceY})));
    }
    return {...graph,nodes,links,scale,height:Math.max(620,cursor+30),width};
  }
  function ribbonPath(x1,x2,y1,y2,height) {
    const bend=(x2-x1)*.45;
    return `M${x1},${y1} C${x1+bend},${y1} ${x2-bend},${y2} ${x2},${y2} L${x2},${y2+height} C${x2-bend},${y2+height} ${x1+bend},${y1+height} ${x1},${y1+height} Z`;
  }

  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(container,graph,format) {
    graph=bandLayout(categoryBands(graph));
    if(!container.clientWidth) return [];
    if(!graph.links.length){container.innerHTML='<p class="cf-note">No income or outflows in this period.</p>';return [];}
    const count=graph.columnCount||6,divisor=graph.periodMonth?1:12;
    const periodLabel=graph.periodLabel||'Monthly average (amortized)';
    const width=Math.max(1260,container.clientWidth),nodeWidth=12;
    const financialGraph=graph;
    graph=laneGeometry(graph,width);
    const {height,scale}=graph,positions=new Map(graph.nodes.map(n=>[n.id,n]));
    const paths=graph.links.map((l,i)=>{
      const a=positions.get(l.source),b=positions.get(l.target);

      const x1=a.x+nodeWidth,x2=b.x;
      const text=graph.periodMonth?`${a.label} → ${b.label}: ${format(l.value)} in ${periodLabel}`:`${a.label} → ${b.label}: ${format(l.value)} / year ÷ 12 = ${format(l.value/12)} / month (amortized)`;
      const bands=l.bands.map((band,j)=>{
        const bandHeight=band.value*scale,y1=band.sourceY,y2=band.targetY,bend=(x2-x1)*.45,id=`flow-gradient-${i}-${j}`;
        const categoryLabel={cash:'Cash',equity:'Equity',retirement:'Retirement / HSA',cost:'Taxes / costs'};
        const description=`${a.label} → ${b.label} (${categoryLabel[band.sourceCategory]} → ${categoryLabel[band.category]}): `+(graph.periodMonth?`${format(band.value)} in ${periodLabel}`:`${format(band.value)} / year ÷ 12 = ${format(band.value/12)} / month (amortized)`);
        return `<g data-band="${j}"><title>${escape(description)}</title><defs><linearGradient id="${id}"><stop stop-color="${categoryColors[band.sourceCategory]}"/><stop offset=".35" stop-color="${band.color}"/></linearGradient></defs><path class="sankey-hit" d="M${x1},${y1+bandHeight/2} C${x1+bend},${y1+bandHeight/2} ${x2-bend},${y2+bandHeight/2} ${x2},${y2+bandHeight/2}" fill="none" stroke="transparent" stroke-width="16" vector-effect="non-scaling-stroke" pointer-events="stroke"/><path class="sankey-link" data-category="${band.category}" d="${ribbonPath(x1,x2,y1,y2,bandHeight)}" fill="url(#${id})"/></g>`;
      }).join('');
      return {value:l.value,html:`<g data-flow="${i}" tabindex="0" role="button" aria-label="${escape(text)}"><title>${escape(text)}</title>${bands}</g>`};
    }).sort((a,b)=>b.value-a.value).map(item=>item.html).join('');
    const wrap=label=>{const lines=[''];for(const word of label.split(' ')){if((lines.at(-1)+' '+word).trim().length>21) lines.push(word);else lines[lines.length-1]=(lines.at(-1)+' '+word).trim();}return lines;};
    const nodeBands=n=>{
      return n.segments.map(b=>`<rect x="${n.x}" y="${b.y}" width="${nodeWidth}" height="${b.value*scale}" fill="${categoryColors[b.category]}"/>`).join('');
    };
    const labels=[...positions.values()].map(n=>`<g>${nodeBands(n)}<text x="${n.x}" y="${n.y-21}" class="sankey-label">${wrap(n.label).map((line,i,lines)=>`<tspan x="${n.x}" y="${n.y-21-(lines.length-1-i)*14}">${escape(line)}</tspan>`).join('')}</text><text x="${n.x}" y="${n.y-6}" class="sankey-value">${escape(format(n.value/divisor))}${graph.periodMonth?'':' (amortized)'}</text>${n.id.startsWith('account-')?`<text x="${n.x}" y="${n.y+n.h+19}" class="sankey-value" data-remaining="${n.id}" tabindex="0" role="button">Remaining: ${escape(format(n.remaining/divisor))}</text>`:''}</g>`).join('');
    container.innerHTML=`<div class="sankey-scroll"><svg style="min-width:${count===6?1260:780}px" viewBox="0 0 ${width} ${height}" role="group" aria-label="Monthly money flow. Use the flow table below for exact amounts.">${count===6?['Income sources','Total value','Pre-tax deductions','Tax payments','Cash / assets','Expenses'].map((title,c)=>`<text x="${12+c*(width-174)/(count-1)}" y="16" class="sankey-value">${title}</text>`).join(''):''}${paths}${labels}</svg></div><p class="flow-selection" aria-live="polite">${escape(periodLabel)}. Select a flow for its amount and timing.</p>${graph.visualAllocation?`<p class="cf-note">Scroll horizontally to see all six stages. Visual cost allocation only: cash → ESPP → RSUs → retirement. These are this period’s flows, not existing account balances. Holdings, sales and projections are unchanged. Cash shortfall before hypothetical asset use: ${format(graph.visualAllocation.cashShortfall/divisor)}. Unfunded costs after allocation: ${format(graph.visualAllocation.shortfall/divisor)}.${graph.visualAllocation.unfundedBeforeExpenses>1e-7?` Unfunded deductions or tax payments: ${format(graph.visualAllocation.unfundedBeforeExpenses/divisor)}.`:''}${graph.visualAllocation.constrainedTransfers>1e-7?` Asset transfers exceeding available value: ${format(graph.visualAllocation.constrainedTransfers/divisor)}. Shown asset allocations are reduced visually.`:''}</p>`:''}`;
    const select=(el,bandIndex)=>{const l=graph.links[Number(el.dataset.flow)];container.querySelector('.flow-selection').textContent=(graph.periodMonth?`${positions.get(l.source).label} → ${positions.get(l.target).label}: ${format(l.value)} in ${periodLabel}.`:`${positions.get(l.source).label} → ${positions.get(l.target).label}: ${format(l.value)} / year ÷ 12 = ${format(l.value/12)} / month (amortized).`)+(positions.get(l.source).components?` Breakdown: ${positions.get(l.source).components.map(c=>`${c.label}: ${format(c.value/divisor)}${graph.periodMonth?' this month':` / month (${format(c.value)} / year)`}`).join('; ')}.`:'')+(l.bands?.length>1?` Categories: ${l.bands.map(b=>`${b.label} ${format(b.value/divisor)}`).join('; ')}.`:'')+(l.costBreakdown?` Costs: ${l.costBreakdown.map(c=>`${c.label} ${format(c.value/divisor)}`).join('; ')}.`:'')+(l.visualOnly?' Hypothetical allocation only; no assets are sold or withdrawn.':'')+(l.taxDetail?` ${l.taxDetail.label||'RSU attributed tax'}: ${format(l.taxDetail.liability/divisor)}/month; shares withheld: ${format(l.taxDetail.cover/divisor)}; cash withheld: ${format(l.taxDetail.cash/divisor)}; balance after payments: ${format(l.taxDetail.balance/divisor)}. The balance is reconciled with other income taxes.`:'');
      if(bandIndex!==undefined){
        const band=l.bands[Number(bandIndex)],label={cash:'Cash',equity:'Equity',retirement:'Retirement / HSA',cost:'Taxes / costs'};
        const detail=`Selected ribbon: ${label[band.sourceCategory]} → ${label[band.category]}, `+(graph.periodMonth?`${format(band.value)} in ${periodLabel}.`:`${format(band.value)} / year ÷ 12 = ${format(band.value/12)} / month (amortized).`);
        const sources=band.components.map(c=>`${c.label}: ${format(c.value/divisor)}`).join('; ');
        container.querySelector('.flow-selection').textContent=detail+` Sources (${graph.periodMonth?'this month':'monthly average'}): ${sources}. Connection total: `+container.querySelector('.flow-selection').textContent;
      }
    };
    container.querySelectorAll('[data-flow]').forEach(el=>{el.onclick=e=>select(el,e.target.closest('[data-band]')?.dataset.band);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(el);}};});
    const selectRemaining=id=>{const n=positions.get(id);if(n)container.querySelector('.flow-selection').textContent=`${n.label}: ${graph.periodMonth?`${format(n.remaining)} remaining in ${periodLabel}`:`${format(n.remaining)} / year ÷ 12 = ${format(n.remaining/12)} / month (amortized) remaining`}, after the illustrative expense allocation.`;};
    container.querySelectorAll('[data-remaining]').forEach(el=>{el.onclick=()=>selectRemaining(el.dataset.remaining);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectRemaining(el.dataset.remaining);}};});
    container.selectFlow=index=>{if(String(index).startsWith('account-')){selectRemaining(index);return;}const el=container.querySelector(`[data-flow="${index}"]`);if(el)select(el);};
    return graph.links.map((l,i)=>[`<button type="button" class="flow-table-select" data-flow-select="${i}">${escape(positions.get(l.source).label)}</button>`,positions.get(l.target).label,format(l.value/divisor)]).concat(financialGraph.links.filter(l=>l.target.startsWith('remaining-')).map(l=>[`<button type="button" class="flow-table-select" data-flow-select="${l.source}">${escape(positions.get(l.source).label)}</button>`,'Remaining after expenses',format(l.value/divisor)]));
  }
  const roundMoney=value=>Math.sign(value)*Math.round((Math.abs(value)+1e-9)*100)/100;
  const api={buildFlow,forMonth,orderFlow,allocateCosts,sourceBands,flowCategory,categoryBands,bandLayout,laneGeometry,ribbonPath,render,roundMoney};
  if(typeof module!=='undefined') module.exports=api;
  root.MoneyFlow=api;
})(typeof window!=='undefined'?window:globalThis);
