/* Reviewed payroll observations and forecasts share the scenario calendar. */
let paystubDrafts=[],paystubDocuments=[],payrollUndo=null;
const payrollMoney=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v||0);
function setupPayrollUI(){
  const move=(path,target)=>{
    const el=document.querySelector(`[data-cf="${path}"]`);
    if(el)document.getElementById(target).append(el.closest('.cf-field,.cf-check'));
  };
  ['taxYear','birthday','age','tax.filing','tax.state','hsa.eligible','hsa.coverage'].forEach(p=>move(p,'setup-tax'));
  ['retirement.employerAnnual','retirement.matchPercent','retirement.matchRate','retirement.megaEnabled','hsa.employer','espp.enabled','espp.annualPayrollCap','espp.shareCap','espp.annualFmvLimit'].forEach(p=>move(p,'setup-plan'));
  document.getElementById('setup-plan').insertAdjacentHTML('beforeend',field('retirement.megaAnnualCap','Employer annual after-tax / mega cap','amountOverride',{hint:'Blank means no additional employer cap. Zero disables new after-tax contributions. This remains separate from your election.'}));
  document.getElementById('payroll-controls').innerHTML=field('payroll.enabled','Use dated paycheck projection','check',{hint:'The monthly view and lifetime model use this calendar when enabled.'})+field('payroll.useYtd','Reconcile earlier estimates to uploaded YTD','check',{hint:'Missing earlier checks remain estimates. Turn off for a full-year run-rate experiment.'})+
    field('frequency','Pay frequency',[['biweekly','Every two weeks'],['semimonthly','Twice monthly'],['monthly','Monthly'],['weekly','Weekly']])+field('firstPayday','Payday anchor','date')+field('payroll.bonusDate','Bonus paycheck date (optional)','date',{optional:true});
  document.querySelectorAll('#tax-assumptions .cf-group,#espp-controls .cf-group').forEach(group=>{if(!group.querySelector('input,select,button,textarea'))group.remove();});
  // Keep one editor for each shared field, with optional inputs outside the sidebar.
  for(const path of ['frequency','firstPayday','espp.enabled','espp.rate']){
    const all=[...document.querySelectorAll(`[data-cf="${path}"]`)];
    const keep=all.find(el=>el.closest(path.startsWith('espp.')?(path==='espp.enabled'?'#setup-plan':'#espp-controls'):'#payroll-controls'));
    all.filter(el=>el!==keep).forEach(el=>el.closest('.cf-field,.cf-check').remove());
  }
  document.getElementById('advanced-tax-inputs').append(document.getElementById('tax-assumptions'));
  document.getElementById('manual-compensation-inputs').append(document.getElementById('compensation-controls'));
  document.querySelectorAll('#compensation-controls > details').forEach(el=>el.open=false);
  document.getElementById('paystub-files').addEventListener('change',readPaystubs);
}
async function readPaystubs(event){
  const status=document.getElementById('paystub-status');status.textContent='Reading PDF text locally…';
  for(const doc of paystubDocuments)await doc.cleanup?.();
  paystubDrafts=[];paystubDocuments=[];
  try{
    const files=[...event.target.files];if(files.length>12)throw new Error('Upload up to 12 documents at a time.');
    const pdfjs=await import('./node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='./node_modules/pdfjs-dist/build/pdf.worker.mjs';
    for(const file of files){
      if(file.size>15*1024*1024)throw new Error('Each PDF must be smaller than 15 MB.');
      const data=new Uint8Array(await file.arrayBuffer());
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
      const doc=await pdfjs.getDocument({data,isEvalSupported:false,enableXfa:false,useSystemFonts:true}).promise;
      paystubDocuments.push(doc);
      if(doc.numPages>12)throw new Error('Each paystub must have 12 pages or fewer.');
      const pages=[];
      for(let page=1;page<=doc.numPages;page++){
        const content=await (await doc.getPage(page)).getTextContent();
        const lines=[];
        for(const item of content.items){
          if(!item.str)continue;
          const y=item.transform[5];let line=lines.find(l=>Math.abs(l.y-y)<2);
          if(!line){line={y,items:[]};lines.push(line);}line.items.push(item);
        }
        pages.push({page,text:lines.sort((a,b)=>b.y-a.y).map(l=>l.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(i=>i.str).join(' ')).join('\n')});
      }
      const record=PaystubParser.parse(pages);
      const mappings=model.getConfig().compensation.payroll?.mappings||{};
      for(const line of record.lines)if(mappings[`${line.section}:${line.label}`])line.key=mappings[`${line.section}:${line.label}`];
      PaystubParser.rebuild(record);record.id=hash;record.sourcePages=doc.numPages;
      if(!record.lines.length)throw new Error('No supported payroll table found. Scanned PDFs need OCR, which is not available in this version.');
      paystubDrafts.push(record);
    }
    status.textContent='Review dates, mappings and totals. Nothing has been applied.';renderPaystubReview();
  }catch(error){status.textContent=`Could not import: ${error.message}`;paystubDrafts=[];document.getElementById('paystub-review').replaceChildren();}
  event.target.value='';
}
function renderPaystubReview(){
  const el=document.getElementById('paystub-review');
  const selectedElections=document.getElementById('import-elections')?.checked??true,selectedSchedule=document.getElementById('import-pay-schedule')?.checked??true;
  el.innerHTML=paystubDrafts.map((r,i)=>{
    const v=PaystubParser.validate(r);
    return `<details class="paystub-review" open><summary>Document ${i+1}: ${escapeText(r.date||'Check date needed')} · ${payrollMoney(r.netPay)}</summary><label>Check date <input type="date" data-review-date="${i}" value="${escapeText(r.date)}"></label><p class="cf-note">Printed values are per paycheck. Blank current cells are treated as no current activity. Verify inferred allowance tax treatment and deduction categories.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Printed label</th><th>Use as</th><th>Current</th><th>YTD</th><th>Source</th></tr></thead><tbody>${r.lines.map((l,j)=>`<tr><td>${escapeText(l.label)}</td><td><select data-review-map="${i}:${j}" aria-label="Category for ${escapeText(l.label)}"><option value="">Choose category</option>${Object.entries(PaystubParser.labels).map(([key,label])=>`<option value="${key}" ${l.key===key?'selected':''}>${label}</option>`).join('')}</select></td><td><input type="number" step=".01" data-review-value="${i}:${j}:current" aria-label="Current ${escapeText(l.label)}" value="${l.current??''}" placeholder="Blank"></td><td><input type="number" step=".01" data-review-value="${i}:${j}:ytd" aria-label="YTD ${escapeText(l.label)}" value="${l.ytd??''}"></td><td><button class="btn-secondary" data-source-page="${i}:${l.page}">Page ${l.page}</button></td></tr>`).join('')}</tbody></table></div><p class="${v.valid?'cash-text':'loss-text'}">${v.valid?'Gross, deductions, taxes and net pay reconcile.':v.errors.map(escapeText).join(' ')}</p></details>`;
  }).join('')+`<div id="paystub-source-preview"></div><div class="import-choices"><label><input id="import-elections" type="checkbox" checked> Use extracted contribution elections and recurring benefits</label><label><input id="import-pay-schedule" type="checkbox"> Update salary, pay frequency and payday anchor</label><p id="import-suggestions" class="cf-note"></p><p class="cf-note">Employer HSA observed pace: ${payrollMoney((paystubDrafts.at(-1)?.current.hsaEmployer||0)*({weekly:52,biweekly:26,semimonthly:24,monthly:12}[model.getConfig().compensation.frequency]||26))}/year if repeated. Confirm the annual amount in step 2.</p><p class="cf-note">Employer annual funding, ESPP participation and plan limits stay as entered in step 2. IRA contributions and RSU grants are preserved. Review participation before applying.</p><button type="button" class="btn-primary" id="apply-paystubs">Apply reviewed paychecks</button></div>`;
  document.getElementById('import-elections').checked=selectedElections;document.getElementById('import-pay-schedule').checked=selectedSchedule;
  const suggestion=PaystubParser.suggest(PaystubParser.mergeRecords(model.getConfig().compensation.payroll?.records||[],paystubDrafts),model.getConfig().compensation);
  document.getElementById('import-suggestions').textContent=`Proposed pay schedule: ${payrollMoney(suggestion.salary)} annual salary, ${suggestion.frequency}, anchor ${suggestion.firstPayday}. ${Object.entries(suggestion.elections||{}).map(([k,e])=>`${PaystubParser.labels[k]}: ${e.mode==='percent'?(e.value*100).toFixed(2)+'%':payrollMoney(e.value)+'/check'}`).join(' · ')}`;
  el.querySelectorAll('[data-review-map]').forEach(input=>input.onchange=()=>{const[i,j]=input.dataset.reviewMap.split(':').map(Number);paystubDrafts[i].lines[j].key=input.value;PaystubParser.rebuild(paystubDrafts[i]);renderPaystubReview();});
  el.querySelectorAll('[data-review-value]').forEach(input=>input.onchange=()=>{const[i,j,k]=input.dataset.reviewValue.split(':');paystubDrafts[i].lines[j][k]=input.value===''?null:Number(input.value);PaystubParser.rebuild(paystubDrafts[i]);renderPaystubReview();});
  el.querySelectorAll('[data-review-date]').forEach(input=>input.onchange=()=>{paystubDrafts[input.dataset.reviewDate].date=input.value;renderPaystubReview();});
  el.querySelectorAll('[data-source-page]').forEach(button=>button.onclick=async()=>{
    const[i,pageNo]=button.dataset.sourcePage.split(':').map(Number),page=await paystubDocuments[i].getPage(pageNo);
    const viewport=page.getViewport({scale:1.2}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;canvas.setAttribute('aria-label',`Document ${i+1}, page ${pageNo}`);
    const preview=document.getElementById('paystub-source-preview');preview.replaceChildren(canvas);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;preview.scrollIntoView({block:'nearest'});
  });
  document.getElementById('apply-paystubs').disabled=!paystubDrafts.length||paystubDrafts.some(r=>!PaystubParser.validate(r).valid);
  document.getElementById('apply-paystubs').onclick=()=>{
    try{
      if(paystubDrafts.some(r=>!PaystubParser.validate(r).valid))throw new Error('Resolve all reconciliation errors first.');
      const c=structuredClone(model.getConfig().compensation);
      if(paystubDrafts.some(r=>Number(r.date.slice(0,4))!==c.taxYear))throw new Error('Set the starting tax year to the uploaded check year first.');
      const records=PaystubParser.mergeRecords(c.payroll?.records||[],paystubDrafts);
      payrollUndo=structuredClone(c);if(payrollUndo.payroll)delete payrollUndo.payroll.importUndo;c.payroll??={};c.payroll.importUndo=payrollUndo;c.payroll.enabled=true;c.payroll.records=records;c.payroll.useYtd??=true;c.payroll.mappings??={};
      for(const record of paystubDrafts)for(const line of record.lines)c.payroll.mappings[`${line.section}:${line.label}`]=line.key;
      c.payroll.annualSettingKeys=[];
      c.payroll.uploadBaseline=document.getElementById('import-elections').checked;
      if(c.payroll.uploadBaseline)c.payroll.elections={...c.payroll.elections,...suggestion.elections};
      if(document.getElementById('import-pay-schedule').checked){c.salary=suggestion.salary;c.frequency=suggestion.frequency;c.firstPayday=suggestion.firstPayday;}
      model.updateConfig({compensation:c});syncCompensationFields();runSimulation();
      paystubDrafts=[];el.replaceChildren();document.getElementById('paystub-status').textContent='Paychecks saved locally. Existing grants and plan limits were preserved.';
      for(const doc of paystubDocuments)doc.cleanup?.();paystubDocuments=[];
    }catch(error){document.getElementById('paystub-status').textContent=error.message;}
  };
}
function renderPayrollUI(c,result){
  const panel=document.getElementById('effective-limits');if(!panel)return;
  const l=result.limits,cal=result.payrollCalendar;
  panel.innerHTML=table(['Account','Statutory baseline','Your effective capacity','Projected contribution'],[
    ['Employee 401(k)',money(l.deferral)+' + eligible catch-up',money(cal?.caps.deferral??l.deferral),money(result.contributions.traditional+result.contributions.roth)],
    ['After-tax / mega',money(l.total401k)+' shared plan total',cal?money(cal.caps.mega):'Activate dated projection',money(result.contributions.mega)],
    ['Employee HSA',money(c.hsa.coverage==='family'?l.hsaFamily:l.hsaSingle)+' incl. employer',cal?money(cal.caps.hsa):'Activate dated projection',money(result.contributions.hsa)],
    ['ESPP',money(l.espp)+' grant-date FMV',money(Math.min(l.espp,c.espp.annualFmvLimit))+' grant-date FMV',money(result.espp.contributions)+' payroll dollars']
  ]);
  const elections=document.getElementById('payroll-elections');
  if(!elections.contains(document.activeElement))elections.innerHTML=`<details class="cf-group"><summary>Current payroll elections</summary><p class="cf-note">Imported elections continue at this pace until capped. Without an election, existing annual contribution settings are spread across the calendar. Fixed amounts stay fixed in future years; percentages follow salary.</p>${Object.entries(c.payroll?.elections||{}).map(([key,e])=>`<div class="election-row"><span>${escapeText(PaystubParser.labels[key]||key)}</span>${field(`payroll.elections.${key}.mode`,'Election basis',[['percent','Percent of eligible pay'],['fixed','Dollars per check']])}${field(`payroll.elections.${key}.value`,'Election',e.mode==='percent'?'percent':'number',{step:.01})}<button class="btn-secondary" data-remove-election="${key}">Use annual setting</button></div>`).join('')||'<p class="cf-note">Upload a paystub to infer recurring elections.</p>'}</details>`;
  elections.querySelectorAll('[data-remove-election]').forEach(b=>b.onclick=()=>{const p=model.config.compensation.payroll;p.annualSettingKeys=[...new Set([...(p.annualSettingKeys||[]),b.dataset.removeElection])];delete p.elections[b.dataset.removeElection];runSimulation();});
  payrollUndo=c.payroll?.importUndo||null;
  const records=document.getElementById('paystub-records');
  records.innerHTML=`<p class="cf-note">${c.payroll?.records?.length||0} imported checks. Financial records are included in scenario export; original PDFs are not.</p>${(c.payroll?.records||[]).map(r=>`<div class="cf-line"><span>${escapeText(r.date)} · ${payrollMoney(r.netPay)}</span><button class="btn-secondary" data-remove-paystub="${escapeText(r.id)}">Remove record</button></div>`).join('')}${payrollUndo?'<button class="btn-secondary" id="undo-payroll-import">Undo last import and its setting changes</button>':''}`;
  records.querySelectorAll('[data-remove-paystub]').forEach(b=>b.onclick=()=>{const cfg=model.getConfig().compensation;cfg.payroll.records=cfg.payroll.records.filter(r=>r.id!==b.dataset.removePaystub);model.updateConfig({compensation:cfg});runSimulation();});
  const undo=document.getElementById('undo-payroll-import');if(undo)undo.onclick=()=>{model.config.compensation=payrollUndo;payrollUndo=null;syncCompensationFields();runSimulation();};
  const checks=document.getElementById('paycheck-results');
  if(!cal){checks.innerHTML='<section class="glass-card"><p>Enable the dated paycheck projection in Setup &amp; limits to use the calendar. Your existing annual scenario is preserved until then.</p><button class="btn-secondary" id="enable-payroll">Enable paycheck calendar</button></section>';document.getElementById('enable-payroll').onclick=()=>{model.updateConfig({compensation:{payroll:{enabled:true}}});runSimulation();};return;}
  const today=new Date().toISOString().slice(0,10);
  checks.innerHTML=`<section class="glass-card"><div class="payroll-summary"><span>${cal.rows.length} paychecks</span><span>Gross cash ${payrollMoney(cal.rows.reduce((n,r)=>n+r.grossCash,0))}</span><span>Paycheck deposits ${payrollMoney(cal.rows.reduce((n,r)=>n+r.netPay,0))}</span></div><p class="cf-note">Paycheck deposits exclude IRA and direct HSA transfers, living expenses and separate equity events. Future federal and state withholding use the latest uploaded effective rates when available; payroll taxes follow statutory rules. State withholding uses gross salary and bonus when the uploaded state wage basis is unavailable. Imported withholding is preserved. Dates use the anchor without bank-holiday adjustments.</p>${cal.warnings.map(w=>`<p class="cf-note">${escapeText(w)}</p>`).join('')}</section>`+
    cal.rows.map(row=>`<details class="glass-card paycheck-row"><summary><span>${row.date}</span><span class="paycheck-status">${row.source==='uploaded'?(row.date>today?'Uploaded · scheduled':'Uploaded'):row.source==='history-estimate'?'History estimate':'Forecast'}</span><span>Gross ${payrollMoney(row.grossCash)}</span><strong>Take-home ${payrollMoney(row.netPay)}</strong>${row.capEvents.length?'<span class="cap-badge">Limit applied</span>':''}</summary><div class="paycheck-detail">${table(['Paycheck component','Amount'],[
      ['Base salary',row.salary],['Bonus',row.bonus],['Cash allowance',row.allowance],['Noncash taxable benefit',row.imputed],['Traditional 401(k)',-row.traditional],['Roth 401(k)',-row.roth],['Mega backdoor',-row.mega],[c.hsa.payroll?'Employee HSA':'Direct HSA transfer (outside paycheck)',c.hsa.payroll?-row.hsa:row.hsa],['Pre-tax insurance / benefits',-row.health],['ESPP funding',-row.espp],['Post-tax expenses',-row.post],['Federal withholding',-row.federal],['State withholding',-row.state],['Social Security',-row.ss],['Medicare',-row.medicare],['State disability',-row.sdi],['Net paycheck',row.netPay],['Employer retirement (separate funding)',row.employer],['Employer HSA (separate funding)',row.hsaEmployer]
    ].filter(([,v])=>v!==0).map(([label,value])=>[label,payrollMoney(value)]))}<div><h4>Remaining after this check</h4><p>Employee 401(k): ${payrollMoney(row.remaining.deferral)}</p><p>Mega backdoor: ${payrollMoney(row.remaining.mega)}</p><p>Employee HSA: ${payrollMoney(row.remaining.hsa)}</p>${row.capEvents.map(e=>`<p class="cf-note">${escapeText(e)}</p>`).join('')}</div></div></details>`).join('')+
    `<section class="glass-card"><h3>Separate equity events</h3>${table(['Date','Event','Value'],[...result.rsuVests.map(v=>[v.date,escapeText(v.name)+' vest',payrollMoney(v.value)]),...result.espp.lots.map(l=>[l.purchaseDate,'ESPP purchase / refund',`${payrollMoney(l.cost)} / ${payrollMoney(l.refund)}`])].sort((a,b)=>a[0].localeCompare(b[0])))}</section>`;
}
