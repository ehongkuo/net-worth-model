(function(root){
  'use strict';
  const labels={salary:'Base salary',bonus:'Bonus',allowance:'Cash allowance (not taxable)',imputed:'Noncash taxable benefit',traditional:'Traditional 401(k)',roth:'Roth 401(k)',mega:'After-tax mega contribution',hsa:'Employee HSA',health:'Pre-tax benefits',post:'Post-tax expense',espp:'ESPP funding',employer:'Employer retirement',hsaEmployer:'Employer HSA',employerMedical:'Employer medical benefit',federal:'Federal withheld',state:'State withheld',ss:'Social Security',medicare:'Medicare',sdi:'State disability',taxablePayroll:'Payroll taxable wages',taxableMedicare:'Medicare taxable wages',taxableFederal:'Federal taxable wages',ignore:'Exclude from forecast'};
  const benefitTypes={health:{label:'Pre-tax coverage / services',field:'health'},fsa:{label:'Healthcare FSA',field:'health'},dependentCare:{label:'Dependent-care FSA',field:'health'},commuter:{label:'Transit funds',field:'health'},parking:{label:'Parking funds',field:'health'},post:{label:'Post-tax coverage / services',field:'post'},restrictedPost:{label:'Post-tax restricted funds',field:'post'},allowance:{label:'Nontaxable cash reimbursement',field:'allowance'},taxableAllowance:{label:'Taxable cash allowance',field:'taxableAllowance'},imputed:{label:'Taxable noncash benefit',field:'imputed'},employerMedical:{label:'Employer-paid coverage / direct service',field:'employerMedical'}};
  Object.entries(benefitTypes).forEach(([key,type])=>labels[key]=type.label);
  const money=s=>Number(String(s).replace(/[$,()]/g,''))*(String(s).includes('(')?-1:1);
  const total=(o,keys)=>Math.round(keys.reduce((n,k)=>n+(o[k]||0),0)*100)/100;
  const iso=s=>{const [m,d,y]=s.split('/');return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;};
  function mapping(label,section){
    if(section==='Taxable Wages')return /Federal/i.test(label)?'taxableFederal':/Medicare/i.test(label)?'taxableMedicare':/OASDI|Social Security/i.test(label)?'taxablePayroll':null;
    if(section==='Employer Paid Benefits')return /HSA/i.test(label)?'hsaEmployer':/401|match|retirement/i.test(label)?'employer':/medical/i.test(label)?'employerMedical':null;
    if(section==='Employee Taxes')return /OASDI|Social Security/i.test(label)?'ss':/Medicare/i.test(label)?'medicare':/Federal/i.test(label)?'federal':/SDI|disability/i.test(label)?'sdi':/State Tax|State Withholding/i.test(label)?'state':null;
    if(section==='Earnings')return /imputed/i.test(label)?'imputed':/regular salary|base salary|regular pay/i.test(label)?'salary':/bonus/i.test(label)?'bonus':/connectivity allowance/i.test(label)?'allowance':null;
    if(/mega|after.tax.*401|401.*after.tax/i.test(label))return 'mega';
    if(/401.*roth|roth.*401/i.test(label))return 'roth';
    if(/401.*pre.tax|traditional.*401/i.test(label))return 'traditional';
    if(/HSA/i.test(label))return 'hsa';
    if(/ESPP/i.test(label))return 'espp';
    if(section==='Pre Tax Deductions'){if(/dependent.*care/i.test(label))return 'dependentCare';if(/FSA|flex.*spend/i.test(label))return 'fsa';if(/parking/i.test(label))return 'parking';if(/transit|commut/i.test(label))return 'commuter';if(/medical|dental|vision/i.test(label))return 'health';}
    if(section==='Post Tax Deductions'&&/gym/i.test(label))return 'post';
    return null;
  }
  function parse(pages,existing=[]){
    const result={version:1,date:'',kind:'regular',current:{},ytd:{},lines:[],netPay:0,summary:{},periodStart:'',periodEnd:''};
    let section='';
    for(const page of pages)for(const raw of page.text.split('\n')){
      const line=raw.trim();
      const dates=line.match(/\d{2}\/\d{2}\/\d{4}/g);
      if(dates?.length>=3&&!result.date){[result.periodStart,result.periodEnd,result.date]=dates.slice(-3).map(iso);}
      if(['Earnings','Employee Taxes','Pre Tax Deductions','Post Tax Deductions','Employer Paid Benefits','Taxable Wages'].includes(line)){section=line;continue;}
      if(/^(Withholding|Absence Plans|Payment Information|Current and YTD Totals)$/.test(line)){section='';continue;}
      const numbers=[...line.matchAll(/-?\$?\(?\d[\d,]*\.\d{2}\)?/g)];
      if(/^(Current|YTD)\s/.test(line)&&numbers.length>=6){
        const values=numbers.slice(-5).map(m=>money(m[0]));
        const target=line.startsWith('Current')?'current':'ytd';
        result.summary[target]=Object.fromEntries(['gross','pretax','taxes','posttax','net'].map((k,i)=>[k,values[i]]));
        if(target==='current')result.netPay=values[4];continue;
      }
      if(!section||!numbers.length||/^Total:|^Description|^©/.test(line))continue;
      const label=line.slice(0,numbers[0].index).replace(/\d{2}\/\d{2}\/\d{4}.*$/,'').trim();
      if(!label||/^\d{2}\/|^Page/.test(label))continue;
      const values=numbers.slice(-2).map(m=>money(m[0]));
      result.lines.push({label,section,key:mapping(label,section),current:values.length>1?values[0]:null,ytd:values.at(-1),page:page.page});
    }
    const previous=benefitPlans(existing);
    for(const line of result.lines){const known=previous.find(b=>b.id===line.section+':'+line.label);if(known){line.key=known.category;line.schedule=known.schedule;line.annualCap=known.annualCap;}}
    return rebuild(result);
  }
  function rebuild(record){
    record.current={};record.ytd={};record.benefits=[];
    for(const line of record.lines){
      if(!line.key||line.key==='ignore')continue;
      const type=benefitTypes[line.key],key=type?.field||line.key;
      for(const period of ['current','ytd'])if(line[period]!=null||period==='current')record[period][key]=total({a:record[period][key],b:line[period]},['a','b']);
      if(type)record.benefits.push({id:line.section+':'+line.label,label:line.label,category:line.key,current:line.current,ytd:line.ytd,annualCap:line.annualCap??null,schedule:line.schedule||(['commuter','parking'].includes(line.key)?'review':'paycheck')});
    }
    return record;
  }
  function validate(r){
    const errors=[];
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date)errors.push('Confirm the check date.');
    if(!r.summary?.current)errors.push('Current payroll totals were not found. This layout needs manual review.');
    if(r.benefits?.some(b=>b.schedule==='review'))errors.push('Confirm the schedule for restricted benefit deductions.');
    if(r.lines.some(l=>!l.key))errors.push('Map all unrecognized lines.');
    if(r.lines.some(l=>(l.current||0)<0))errors.push('Negative adjustments require a corrected regular statement; this importer does not yet forecast reversals.');
    const current=r.current||{},gross=total(current,['salary','bonus','allowance','taxableAllowance']),pretax=total(current,['traditional','hsa','health']),taxes=total(current,['federal','state','ss','medicare','sdi']),posttax=total(current,['roth','mega','espp','post']);
    const computed={gross,pretax,taxes,posttax,net:Math.round((gross-pretax-taxes-posttax)*100)/100};
    for(const k of Object.keys(computed))if(r.summary?.current&&Math.abs(computed[k]-(k==='net'?r.netPay:r.summary.current[k]))>.011)errors.push(`${k} does not reconcile to the printed total.`);
    if(r.summary?.ytd){
      const y=r.ytd||{},gross=total(y,['salary','bonus','allowance','taxableAllowance']),pretax=total(y,['traditional','hsa','health']),taxes=total(y,['federal','state','ss','medicare','sdi']),posttax=total(y,['roth','mega','espp','post']);
      const computedYtd={gross,pretax,taxes,posttax,net:Math.round((gross-pretax-taxes-posttax)*100)/100};
      for(const [key,value] of Object.entries(computedYtd))if(Math.abs(value-r.summary.ytd[key])>.011)errors.push(`YTD ${key} does not reconcile to the printed total.`);
    }
    return {valid:errors.length===0,errors,computed};
  }
  function mergeRecords(existing,incoming){
    const out=[...existing];
    for(const r of incoming){
      const same=out.find(x=>x.date===r.date&&x.kind===r.kind);
      if(same){if(JSON.stringify(same.current)!==JSON.stringify(r.current)||JSON.stringify(same.ytd)!==JSON.stringify(r.ytd)||same.netPay!==r.netPay)throw new Error(`A different ${r.kind} check already exists on ${r.date}. Remove the old record before importing a correction.`);continue;}
      out.push(r);
    }
    return out.sort((a,b)=>a.date.localeCompare(b.date));
  }
  function suggest(records,c){
    const tax=typeof module!=='undefined'&&module.exports?require('./tax-engine'):root.TaxEngine;
    const sorted=[...records].filter(r=>(r.kind||'regular')==='regular').sort((a,b)=>a.date.localeCompare(b.date)),last=sorted.at(-1);
    if(!last)return {};
    const gap=sorted.length>1?(Date.parse(last.date)-Date.parse(sorted.at(-2).date))/86400000:0;
    const frequency=gap===14?'biweekly':gap===7?'weekly':c.frequency;
    const count={weekly:52,biweekly:26,semimonthly:24,monthly:12}[frequency];
    const salary=last.current.salary*count,elections={},warnings=[];
    const capped=(record,key)=>{
      const year=Number(record.date.slice(0,4)),l=tax.limits(year,c.tax),age=c.age+year-c.taxYear,y=record.ytd||{},r=c.retirement;
      const deferral=l.deferral+(age>=60&&age<=63?l.superCatchup:age>=50?l.catchup:0);
      const caps={traditional:deferral,roth:deferral,mega:Math.min(r.megaAnnualCap??Infinity,Math.max(0,l.total401k-Math.min(l.deferral,(y.traditional||0)+(y.roth||0))-(y.employer||0))),hsa:Math.max(0,((c.hsa.coverage==='family'?l.hsaFamily:l.hsaSingle)+(age>=55?l.hsaCatchup:0))*Math.min(12,c.hsa.eligibleMonths)/12-(y.hsaEmployer||0)),espp:c.espp.annualPayrollCap||Infinity};
      const used=['traditional','roth'].includes(key)?(y.traditional||0)+(y.roth||0):y[key];
      return used!=null&&used>=caps[key]-.02;
    };
    for(const key of ['traditional','roth','mega','espp','hsa','health','post','imputed','allowance','taxableAllowance']){
      let source=last;
      if(capped(last,key)){
        source=sorted.slice(0,-1).reverse().find(r=>r.current[key]>0&&!capped(r,key));
        if(!source){if(c.payroll?.elections?.[key])elections[key]=c.payroll.elections[key];else warnings.push(`${labels[key]} is already capped; existing annual settings remain until an uncapped election is supplied.`);continue;}
      }
      if(source.current[key]==null)continue;
      const percent=['traditional','roth','mega','espp'].includes(key);
      const bonusEligible=key==='espp'?c.espp.bonusEligible:c.retirement.bonusEligible;
      const basis=(source.current.salary||0)+(bonusEligible?(source.current.bonus||0):0);
      if(percent&&basis<=0){warnings.push(`${labels[key]} has no eligible pay basis; confirm the election.`);continue;}
      elections[key]={mode:percent?'percent':'fixed',value:percent?source.current[key]/Math.max(.01,basis):source.current[key],sourceDate:source.date};
    }
    const v=last.current,withholding={};
    if(v.taxableFederal>0&&v.federal!=null)withholding.federal={rate:v.federal/v.taxableFederal,basis:'Federal taxable wages',sourceDate:last.date};
    if(v.salary+ (v.bonus||0)>0&&v.state!=null)withholding.state={rate:v.state/(v.salary+(v.bonus||0)),basis:'Gross salary and bonus (state wage basis unavailable)',sourceDate:last.date};
    return {salary:Math.abs(salary-c.salary)<1?c.salary:salary,frequency,firstPayday:last.date,elections,withholding,warnings,record:last};
  }
  function benefitPlans(records){
    const plans=new Map();
    for(const record of [...records].sort((a,b)=>a.date.localeCompare(b.date)))for(const b of record.benefits||[]){
      if(!benefitTypes[b.category])continue;
      const previous=plans.get(b.id);
      const current=b.schedule==='monthly'&&!(b.current>0)&&previous?previous.current:b.current;
      plans.set(b.id,{...b,current:current??previous?.current??0,sourceDate:record.date});
    }
    return [...plans.values()];
  }
  const api={benefitTypes,benefitPlans,parse,rebuild,validate,mergeRecords,suggest,labels};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.PaystubParser=api;
})(typeof window!=='undefined'?window:globalThis);
