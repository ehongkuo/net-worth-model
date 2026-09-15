/* Compensation controls share one scenario with the lifetime projection. */
const money = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0);
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
let cashFlowYear = 2026;
let compensationView = 'cashflow';
let compensationFieldId = 0;

function configValue(c, path) { return path.split('.').reduce((v,k) => v?.[k], c); }
function setConfigValue(c, path, value) {
  const keys = path.split('.'); let target = c;
  keys.slice(0,-1).forEach(k => { target[k] ??= {}; target = target[k]; });
  target[keys.at(-1)] = value;
}
function field(path, label, kind = 'number', options = {}) {
  const id = `cf-${path.replaceAll('.', '-')}-${++compensationFieldId}`;
  const hint = options.hint ? `<small>${options.hint}</small>` : '';
  const attrs = `id="${id}" data-cf="${path}" data-kind="${kind}"`;
  if (kind === 'check') return `<label class="cf-check" for="${id}"><input type="checkbox" ${attrs}>${label}${hint}</label>`;
  let control;
  if (Array.isArray(kind)) control = `<select ${attrs}>${kind.map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
  else control = `<input ${attrs} type="${kind === 'date' || kind === 'text' ? kind : 'number'}" ${kind === 'date' && !options.optional ? 'required' : ''} ${['number','percent','optional','years'].includes(kind) ? `min="${options.min ?? 0}" ${options.max !== undefined ? `max="${options.max}"` : ''} step="${options.step ?? (kind === 'percent' ? '.1' : kind === 'years' ? 'any' : '1')}"` : ''} ${kind === 'optional' ? 'placeholder="Auto estimate"' : ''}>`;
  return `<div class="cf-field"><label for="${id}">${label}${kind === 'percent' ? ' (%)' : ''}</label>${control}${hint}</div>`;
}
function group(title, body, open = false, hint = '') {
  return `<details class="cf-group" ${open ? 'open' : ''}><summary>${title}</summary>${hint ? `<p class="cf-note">${hint}</p>` : ''}<div class="cf-fields">${body}</div></details>`;
}
function ensureCompensation() {
  const cfg = model.getConfig();
  if (!cfg.compensation) model.updateConfig({ compensation: Compensation.fromLegacy(cfg) });
  const c = model.getConfig().compensation;
  if (!c.equityHoldingDefaults) model.updateConfig({compensation:{equityHoldingDefaults:true,grants:c.grants.map(g=>({...g,sell:false})),espp:{holdShares:true}}});
  if (c.birthday) model.updateConfig({compensation:{age:c.taxYear-Number(c.birthday.slice(0,4))}});
  if (!c.simplifiedDefaults) model.updateConfig({ compensation: {
    simplifiedDefaults:true, retirement:{iraPretaxBalance:Math.max(0,(c.retirement.iraPretaxBalance || 0)-cfg.traditionalIRA),max401k:true,maxMega:true,maxIra:true,iraMode:'backdoor',conversionDelayMonths:0,contributionGrowth:0}, hsa:{maxContribution:true}
  } });
}
function setupCompensationUI() {
  ensureCompensation();
  cashFlowYear = model.getConfig().compensation.taxYear;
  document.getElementById('mobile-input-toggle').addEventListener('click', event => {
    const open = document.querySelector('.sidebar').classList.toggle('mobile-open');
    event.target.setAttribute('aria-expanded',String(open));
    event.target.textContent = open ? 'Back to results' : 'Edit inputs';
    window.scrollTo({top:0,behavior:'smooth'});
  });
  const months = Array.from({ length: 12 }, (_,i) => [i+1, new Date(2026,i).toLocaleString('en-US',{month:'long'})]);
  document.getElementById('tax-assumptions').innerHTML = group('Personal details',
    field('birthday','Birthday (optional)','date',{optional:true}) + field('age','Age at year end','number',{min:18,max:100}) + field('taxYear','Starting tax year','number',{min:2026,max:2100}),true,'Birthday derives the age you turn in each tax year. Leave blank to enter age manually.') + group('Tax profile',
    field('tax.filing','Filing status',[['single','Single'],['married','Married filing jointly']]) +
    field('tax.state','State tax',[['CA','California'],['none','No state income tax'],['custom','Custom effective rate']]) +
    field('tax.customStateRate','Custom state effective rate','percent',{max:30}) +
    field('tax.spouseIncome','Spouse annual wages') + field('tax.otherIncome','Other annual ordinary income') +
    field('tax.caSdi','California SDI rate','percent',{max:10}) +
    field('tax.caHsaConforms','Treat HSA as deductible for state tax','check'), false) +
    group('Deductions and tax adjustments',
      field('tax.federalDeduction','Federal itemized deduction') +
      field('tax.stateDeduction','State itemized deduction') + field('tax.federalCredits','Federal nonrefundable credits') +
      field('tax.stateCredits','State nonrefundable credits') + field('tax.federalAdjustment','Federal tax adjustment','number',{min:-1000000}) +
      field('tax.stateAdjustment','State tax adjustment','number',{min:-1000000}) + field('tax.capitalLossCarry','Starting capital loss carryforward'), false,
      'Annual dollars. The greater of standard or itemized deductions is used. Enter credits after eligibility and phase-outs; adjustments can be negative.') +
    group('Withholding estimates',
      field('tax.salaryFederalRate','Salary federal rate override','optional',{max:100,hint:'Blank uses an annualized estimate. Enter percent.'}) +
      field('tax.salaryStateRate','Salary state rate override','optional',{max:100}) +
      field('tax.bonusFederalRate','Bonus federal withholding','percent',{max:100}) +
      field('tax.bonusStateRate','Bonus state withholding','percent',{max:100}) +
      field('tax.rsuFederalRate','RSU federal withholding','percent',{max:100}) +
      field('tax.rsuStateRate','RSU state withholding','percent',{max:100}) +
      field('tax.federalExtra','Extra federal per paycheck') + field('tax.stateExtra','Extra state per paycheck'),false,
      'Cash deposits use these estimates. Final estimated tax is calculated separately. Rate overrides let you match a paystub; this is not a W-4 payroll service.') +
    group('Future tax and contribution limits',
      field('tax.limitGrowth','Annual contribution-limit growth','percent',{max:10}) +
      field('tax.bracketGrowth','Annual tax-bracket growth','percent',{max:10}) +
      field('tax.wageGrowth','Social Security wage-base growth','percent',{max:10}) +
      field('tax.caGrowth2026','2025 to 2026 CA table adjustment','percent',{max:10}) +
      '<button type="button" class="btn-secondary" data-open-view="limits">View projected limits</button>',false,
      '2026 federal limits are published. Later years use rounded projections. Fixed thresholds stay fixed. California income-tax tables are projected from 2025 FTB values.') ;
  document.getElementById('compensation-controls').innerHTML =
    group('Total compensation', field('salary','Annual base salary') + field('bonusPercent','Target bonus','percent',{max:500}) +
      field('bonusMonth','Bonus payout month',months) + field('frequency','Pay frequency',[['biweekly','Every two weeks'],['semimonthly','Twice per month'],['monthly','Monthly'],['weekly','Weekly']]) +
      field('firstPayday','First payday anchor','date') + field('stockGrowth','Annual company-stock growth','percent',{min:-90,max:100}), true) +
    group('RSU grants', '<div id="rsu-grants" class="cf-full"></div><button class="btn-secondary" type="button" id="add-rsu-grant">+ Add grant</button>',false,
      'Enter total grant value, then its vesting schedule. Unsold RSUs stay invested, with vesting taxes funded from cash. Prices are scenario estimates.') +
    group('401(k) and mega backdoor', field('retirement.max401k','Maximize employee 401(k) each year','check') + field('retirement.traditional','Annual traditional 401(k) contribution','number',{hint:'Your election, not a separate IRS limit. Traditional and Roth 401(k) share the employee maximum.'}) + '<p class="cf-note cf-full" id="employee-limit-note"></p>' + field('retirement.roth','Annual Roth 401(k)') +
      field('retirement.employerAnnual','Annual fixed employer contribution') + field('retirement.matchPercent','Employer match up to pay','percent',{max:100}) +
      field('retirement.matchRate','Match per dollar contributed','percent',{max:300}) +
      field('retirement.bonusEligible','Bonus eligible for 401(k)','check') + field('retirement.rsuEligible','RSUs eligible for 401(k)','check') +
      field('retirement.megaEnabled','Plan permits after-tax contributions and Roth conversion','check') + field('retirement.maxMega','Use remaining plan room for mega backdoor','check') + field('retirement.mega','Annual mega backdoor contribution') +
      group('Advanced contribution adjustments',
      field('retirement.priorYearWages','Prior-year wages for Roth catch-up rule') +
      field('retirement.priorDeferrals','Already contributed at another employer') + field('retirement.priorEmployer','Other employer additions in same plan-limit group') +
      field('retirement.priorAfterTax','Prior after-tax additions in same plan-limit group')),false,
      'Automatic conversion is assumed for each new after-tax contribution. Employee traditional and Roth share a limit. Employer and after-tax additions consume total plan room. Match assumes annual true-up; contributions spread across eligible pay. Prior amounts reduce remaining limits and are not deducted again.') +
    group('HSA and benefits', field('hsa.eligible','Eligible for HSA contributions','check') +
      field('hsa.coverage','HDHP coverage',[['single','Self only'],['family','Family']]) + field('hsa.eligibleMonths','Eligible months','number',{max:12}) +
      field('hsa.maxContribution','Maximize employee HSA after employer funding','check') + field('hsa.employee','Annual employee HSA contribution') + field('hsa.employer','Annual employer HSA contribution') + field('hsa.prior','HSA already contributed elsewhere') +
      field('hsa.payroll','HSA through cafeteria-plan payroll','check') +
      field('benefits.health','Monthly pre-tax health premium') + field('benefits.dental','Monthly pre-tax dental premium') +
      field('benefits.vision','Monthly pre-tax vision premium') + field('benefits.fsa','Monthly compatible FSA') +
      field('benefits.otherPretax','Other monthly Section 125 deductions') + field('benefits.otherPosttax','Other monthly after-tax deductions')) +
    group('Regular backdoor Roth IRA', field('retirement.maxIra','Maximize IRA contribution each year','check') + field('retirement.ira','Annual IRA / regular backdoor Roth contribution') +
      field('retirement.iraMode','IRA method',[['roth','Direct Roth (income limit applied)'],['backdoor','Nondeductible IRA to Roth']]) +
      field('retirement.iraPretaxBalance','Additional pre-tax IRA balance outside starting balances') + field('retirement.iraBasis','Existing nondeductible IRA basis'),false,
      '2026 IRA limit: $7,500, or $8,600 age 50+. Shared across traditional and Roth IRAs, separate from mega backdoor. IRA contributions are transfers after your paycheck. The pro-rata estimate uses all traditional, SEP and SIMPLE IRA balances.') +
    group('ESPP payroll deduction', field('espp.enabled','Participate in ESPP','check') + field('espp.rate','Eligible-pay contribution','percent',{max:100}) +
      '<button type="button" class="btn-secondary" data-open-view="espp">Open ESPP plan</button>');
  const balances = [['cash','Cash'],['brokerage','Brokerage'],['pretax401kBal','Pre-tax 401(k)'],['rothAccounts','Roth accounts'],['traditionalIRA','Traditional IRA'],['hsa','HSA']];
  document.getElementById('starting-balances').innerHTML = group('Starting balances', balances.map(([key,label]) => `<div class="cf-field"><label for="balance-${key}">${label}</label><input id="balance-${key}" data-balance="${key}" type="number" min="0" step="any" value="${model.getConfig()[key]}"></div>`).join(''),false,'Balances at the start of the scenario, before projected contributions. Include all traditional, SEP and SIMPLE IRAs for the pro-rata estimate.');
  document.querySelectorAll('[data-balance]').forEach(el => el.addEventListener('change', () => {
    if (!el.checkValidity()) return el.reportValidity();
    model.updateConfig({[el.dataset.balance]:Number(el.value)}); runSimulation();
  }));
  document.getElementById('living-expense-controls').innerHTML = Object.keys(model.getConfig().expenses).filter(k => k !== 'housing').map(k => `<div class="cf-field"><label for="expense-${k}">${escapeText(k[0].toUpperCase()+k.slice(1))}</label><input type="number" min="0" step="10" id="expense-${k}" data-expense="${k}" value="${model.getConfig().expenses[k]}"></div>`).join('');
  document.querySelectorAll('[data-expense]').forEach(el => el.addEventListener('change', () => {
    if (!el.checkValidity()) { el.reportValidity(); return; }
    model.updateConfig({ expenses: { [el.dataset.expense]:Number(el.value) } }); runSimulation();
  }));
  document.getElementById('espp-controls').innerHTML =
    '<button type="button" id="apply-sofi-plan" class="btn-secondary cf-full">Use Own SoFi plan rules</button>' + field('espp.firstEnrollmentDate','First enrolled offering date','date',{optional:true}) + field('espp.autoEnroll','Enroll in future offerings automatically','check') + field('espp.employmentStart','Employment start (optional)','date',{optional:true}) + field('espp.employmentEnd','Employment end (optional)','date',{optional:true}) + field('espp.purchaseTiming','Purchase timing',[['month-end','End of final month'],['day-before-next-start','Day before next offering (business day)']]) + field('espp.annualPayrollCap','Annual payroll contribution cap (0 = none)') + field('espp.symbol','Stock ticker','text') + '<div class="cf-full" data-market-inline="espp"></div>' + field('espp.enabled','Participate in ESPP','check') + field('espp.rate','Payroll contribution','percent',{max:100}) +
    field('espp.bonusEligible','Include bonus in eligible pay','check') + field('espp.discount','Purchase discount','percent',{max:99}) +
    field('espp.lookback','Use offering-date lookback','check') + field('espp.start','First offering date','date') +
    field('espp.periodMonths','Months per purchase period','number',{min:1,max:24}) +
    field('espp.offerPrice','Offering-date share price','number',{min:.01,step:.01}) + field('espp.purchasePrice','Purchase-date share price','number',{min:.01,step:.01}) +
    '<div class="cf-note cf-full" id="espp-price-preview"></div>' + field('espp.salePrice','Sale-date share price','number',{min:.01,step:.01}) + field('espp.holdShares','Hold ESPP shares without scheduled sales','check') + field('espp.holdMonths','Months from purchase to sale','number',{max:120}) +
    field('espp.shareCap','Plan share cap per purchase (0 = none)') + field('espp.annualFmvLimit','Annual grant-date FMV allowance','number',{max:25000}) +
    field('espp.fractional','Allow fractional shares','check') + field('espp.fee','Fee per sale','number',{step:.01});
  document.getElementById('apply-sofi-plan').onclick=()=>{const c=model.getConfig().compensation,preset=Compensation.planPresets.sofi,planDate=(year,month,day)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;model.updateConfig({compensation:{espp:{...c.espp,...preset,start:planDate(c.taxYear-1,preset.offeringMonth,preset.offeringDay),firstEnrollmentDate:planDate(c.taxYear,preset.initialEnrollmentMonth,preset.initialEnrollmentDay),enrollments:{}}}});syncCompensationFields();runSimulation();};
  const enrollmentPanel=document.createElement('div');enrollmentPanel.id='espp-enrollments';enrollmentPanel.className='cf-full';document.getElementById('espp-controls').append(enrollmentPanel);
  let lastFlowWidth=0;new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width>0 && Math.abs(width-lastFlowWidth)>1){lastFlowWidth=width;if(compensationView==='cashflow')requestAnimationFrame(renderCompensation);}}).observe(document.getElementById('money-sankey'));
  document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => showCompensationView(button.dataset.openView)));
  let pendingInput;
  function commitInput(el, render = true) {
    if (!el.matches('[data-cf]')) return;
    if (!el.checkValidity()) { el.reportValidity(); syncCompensationFields(); return; }
    const c = model.getConfig().compensation;
    let value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    if (el.dataset.kind === 'percent' || el.dataset.kind === 'optional') value = el.value === '' && el.dataset.kind === 'optional' ? null : value / 100;
    if (el.dataset.kind === 'years') value = Math.max(1, Math.round(value * 12));
    if (el.dataset.cf === 'bonusMonth') value = Number(value);
    const previousYear = c.taxYear;
    const elections = {'retirement.max401k':['retirement.traditional','traditional'], 'retirement.maxMega':['retirement.mega','mega'], 'retirement.maxIra':['retirement.ira','ira'], 'hsa.maxContribution':['hsa.employee','hsa']};
    if (elections[el.dataset.cf] && value === false && configValue(c,el.dataset.cf)) {
      const [path,key]=elections[el.dataset.cf];
      setConfigValue(c,path,Compensation.calculate(c,c.taxYear).contributions[key]);
    }
    if ((el.dataset.cf.startsWith('tax.overrides.') || el.dataset.cf.startsWith('espp.enrollments.')) && el.value === '' && el.type !== 'checkbox') {
      const keys = el.dataset.cf.split('.'); if(keys[0]==='tax') delete c.tax.overrides[keys[2]]?.[keys[3]]; else delete c.espp.enrollments?.[keys[2]]?.[keys[3]];
    } else setConfigValue(c, el.dataset.cf, value);
    if (c.taxYear !== previousYear) cashFlowYear = c.taxYear;
    model.updateConfig({ compensation: c });
    if (render) { syncCompensationFields(); runSimulation(); }
  }
  document.addEventListener('change', event => {
    clearTimeout(pendingInput); commitInput(event.target);
  });
  document.addEventListener('input', event => {
    const el = event.target;
    if (!el.matches('[data-cf]')) return;
    clearTimeout(pendingInput);
    if (el.checkValidity() && (el.value !== '' || el.dataset.cf.startsWith('espp.enrollments.'))) commitInput(el, false);
    if (!el.dataset.cf.startsWith('tax.overrides.')) pendingInput = setTimeout(() => { syncCompensationFields(); runSimulation(); }, 300);
  });
  document.getElementById('add-rsu-grant').addEventListener('click', () => {
    const c = model.getConfig().compensation;
    c.grants.push({ name: 'New grant', value: 100000, grantPrice:100, vestPrice:100,
      start:`${c.taxYear}-01-01`, months:48, cliff:12, interval:3, saleMode:'cover', repeat:false });
    model.updateConfig({ compensation:c }); renderGrantFields(); syncCompensationFields(); runSimulation();
  });
  renderGrantFields(); syncCompensationFields(); showCompensationView('cashflow');
}
function renderGrantFields() {
  const c = model.getConfig().compensation;
  document.getElementById('rsu-grants').innerHTML = c.grants.map((g,i) => {
    const f = (k,l,t,o) => field(`grants.${i}.${k}`,l,t,o);
    return `<fieldset class="cf-grant"><legend>Grant ${i+1}</legend>${f('name','Name','text')}${f('symbol','Stock ticker','text',{hint:'For example AAPL. A quote appears below after you connect Stock prices.'})}<div class="cf-full" data-market-inline="grant-${i}"></div>${f('value','Total grant value ($)')}${f('months','Over X years','years',{min:1/12,max:10,hint:'Total award spread over this duration. For example: $100,000 over 4 years.'})}<p class="cf-note" data-grant-summary="${i}"></p>${f('grantPrice','Share price used to size the grant','number',{min:.01,step:.01})}${f('vestPrice','Assumed share price at vest','number',{min:.01,step:.01})}${f('start','Vesting start','date')}${f('cliff','Cliff (months)','number',{max:120})}${f('interval','Vest every N months','number',{min:1,max:12})}${f('saleMode','Shares at vest',[['cover','Sell to cover taxes, retain the rest'],['hold','Hold all shares, pay taxes from cash'],['sell','Sell all shares']])}${f('repeat','Repeat this grant annually','check')}<button type="button" class="btn-danger" data-remove-grant="${i}">Remove grant</button></fieldset>`;
  }).join('') || '<p class="cf-note">No grants. Add an RSU award to include vesting income.</p>';
  document.querySelectorAll('[data-remove-grant]').forEach(button => button.addEventListener('click', () => {
    const latest = model.getConfig().compensation;
    latest.grants.splice(Number(button.dataset.removeGrant),1); model.updateConfig({ compensation:latest });
    renderGrantFields(); syncCompensationFields(); runSimulation();
  }));
}
function syncCompensationFields() {
  const c = model.getConfig().compensation;
  if (!c) return;
  document.querySelectorAll('[data-cf]').forEach(el => {
    const value = el.dataset.cf.endsWith('.saleMode') ? Compensation.rsuMode(c.grants[Number(el.dataset.cf.split('.')[1])]) : configValue(c,el.dataset.cf) ?? ({'espp.purchaseTiming':'month-end','espp.annualPayrollCap':0}[el.dataset.cf]);
    if (el.type === 'checkbox') el.checked = el.dataset.cf==='espp.autoEnroll' ? value!==false : !!value;
    else el.value = value === null || value === undefined ? '' : el.dataset.kind === 'years' ? value/12 : (el.dataset.kind === 'percent' || el.dataset.kind === 'optional') ? Math.round(value*1000000)/10000 : value;
  });
  document.querySelectorAll('[data-cf="age"]').forEach(el=>el.disabled=!!c.birthday);
  document.querySelectorAll('[data-cf="espp.holdMonths"],[data-cf="espp.salePrice"]').forEach(el=>el.disabled=!!c.espp.holdShares);
  const calculated = Compensation.calculate(c,c.taxYear);
  const limitNote=document.getElementById('employee-limit-note');
  if(limitNote) limitNote.textContent=`${c.taxYear} employee base limit: ${money(calculated.limits.deferral)}. Catch-up room is applied automatically by age; employer funding reduces mega backdoor room.`;
  const automatic = {'retirement.traditional':['retirement.max401k',calculated.contributions.traditional], 'retirement.mega':['retirement.maxMega',calculated.contributions.mega], 'retirement.ira':['retirement.maxIra',calculated.contributions.ira], 'hsa.employee':['hsa.maxContribution',calculated.contributions.hsa]};
  Object.entries(automatic).forEach(([path,[flag,value]]) => document.querySelectorAll(`[data-cf="${path}"]`).forEach(el => {el.disabled=!!configValue(c,flag); if(el.disabled) el.value=Math.round(value); }));
  document.querySelectorAll('[data-balance]').forEach(el => el.value=model.getConfig()[el.dataset.balance]);
  const pricePreview=document.getElementById('espp-price-preview');
  if(pricePreview) pricePreview.textContent=`Discounted purchase cost: ${money(Math.min(c.espp.lookback ? c.espp.offerPrice : c.espp.purchasePrice,c.espp.purchasePrice)*(1-c.espp.discount))} per share (${Math.round(c.espp.discount*100)}% discount). Market prices remain independent.`;
  document.querySelectorAll('[data-expense]').forEach(el => { el.value = model.getConfig().expenses[el.dataset.expense]; });
  document.querySelectorAll('[data-grant-summary]').forEach(el => {
    const g = c.grants[Number(el.dataset.grantSummary)];
    el.textContent = `${money(g.value)} over ${(g.months/12).toLocaleString('en-US',{maximumFractionDigits:2})} years = ${money(g.value*12/Math.max(1,g.months))}/year at grant value. ${((g.value || 0)/(g.grantPrice || 100)).toLocaleString('en-US',{maximumFractionDigits:2})} total shares. Actual vesting in ${c.taxYear}: ${money(calculated.rsuVests.filter(v=>v.grantIndex===Number(el.dataset.grantSummary)).reduce((sum,v)=>sum+v.value,0))}. ${g.cliff>g.months ? 'Cliff exceeds grant duration. Check these inputs.' : 'Vesting uses scheduled shares multiplied by the assumed vest price.'}`;
  });
}
function showCompensationView(view) {
  compensationView = view;
  document.querySelectorAll('[data-main-view]').forEach(el => { el.hidden = el.dataset.mainView !== view; });
  document.querySelectorAll('#model-tabs button').forEach(el => {
    el.classList.toggle('active',el.dataset.openView === view);
    el.setAttribute('aria-selected',String(el.dataset.openView === view));
  });
  document.querySelector('.timeline-dashboard').hidden = false;
  if (view === 'projection' && chart) chart.resize();
  if (view === 'cashflow') requestAnimationFrame(renderCompensation);
}
function table(headers, rows) {
  return `<div class="table-scroll"><table class="data-table cf-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function renderCompensation() {
  const c = model.getConfig().compensation;
  if (!c) return;
  const horizon = model.getConfig().projectionYears;
  cashFlowYear = c.taxYear;
  document.getElementById('cash-period').textContent=`Monthly averages for ${cashFlowYear}, the starting tax year. The projection slider does not change this flow.`;
  const projection = currentResults.find(row => row.year === cashFlowYear && row.payroll);
  const payroll = projection?.payroll || Compensation.calculate(c,cashFlowYear);
  const flow = projection?.cashFlow || Compensation.cashFlow(payroll,{expenses:Object.values(model.getConfig().expenses).reduce((a,b)=>a+b,0)*12});
  const r = {...payroll,taxes:flow.taxes,taxBalance:flow.taxBalance,afterTaxCash:flow.afterTaxCash,months:flow.months};
  const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(MoneyFlow.roundMoney(displayValue(value, projection || {inflationFactor:(1+model.getConfig().inflation)**(cashFlowYear-c.taxYear)})));
  const expenses=flow.expenses, cashIn=flow.cashIn, cashOut=flow.cashOut;
  const graph=MoneyFlow.buildFlow(payroll,flow);
  const s=graph.summary;
  document.getElementById('cash-summary').innerHTML = `<div class="flow-summary-cards">${[['Income & equity earned',s.totalIncome,'Cash pay, vesting and employer funding'],['Spendable cash',r.afterTaxCash,'After taxes and contributions, before expenses'],['Assets funded',s.assetAdditions,'Retirement, HSA and retained equity'],['Net cash flow',s.netCashFlow,'Cash remaining after living expenses']].map(([label,value,hint])=>`<div><span>${label}</span><strong>${money(value/12)}/mo</strong><small>${hint}</small></div>`).join('')}</div>`;
  const rows=MoneyFlow.render(document.getElementById('money-sankey'),graph,money);
  document.getElementById('flow-table').innerHTML=table(['From','To','Monthly amount'],rows);
  document.getElementById('flow-outcomes').innerHTML=`<span class="loss-text">Taxes + spending: <b>${money((s.taxes+s.spending)/12)}</b></span><span class="asset-text">Transfers into assets: <b>${money(s.assetTransfers/12)}</b></span><span>Net cash flow before asset withdrawals: <b>${money(s.netCashFlow/12)}</b></span>`;
  document.getElementById('noncash-flow').innerHTML=`<p class="cf-note">RSU vesting and ESPP purchase benefits are included as incoming equity value. Held shares are not take-home cash. Income shown here is economic value, not a taxable-income total. Account destinations show monthly additions, not accumulated balances.</p>`;
  document.getElementById('flow-income').innerHTML=`<span>Total incoming value <strong>${money(s.totalIncome/12)}/mo</strong></span><span>RSUs vested (amortized) <strong>${money(s.rsuIncome/12)}/mo</strong></span><span>ESPP purchase benefit <strong>${money(s.esppDiscount/12)}/mo</strong></span>`;
  document.getElementById('cash-sidebar-summary').innerHTML = `<span>Monthly after-tax cash</span><strong>${money(r.afterTaxCash/12)}</strong><small>${cashFlowYear} · monthly average before living expenses</small>`;
  const flowGroup = (title,rows) => `<section class="flow-group"><h4>${title}</h4>${rows.map(([label,value,total])=>`<div class="cf-line ${total?'flow-total':''}"><span>${label}</span><b>${money(value/12)}</b></div>`).join('')}</section>`;
  document.getElementById('cash-reconciliation').innerHTML =
    flowGroup('1. Income', [['Base salary',r.salary],['Bonus (amortized)',r.bonus],['RSU sales (amortized)',r.rsuCash],['Spouse income',r.income.spouse],['Other / rental income',flow.otherIncome],['Social Security',flow.socialSecurity],['Life-event income (amortized)',flow.eventIncome],['ESPP sales and refunds',r.espp.proceeds+r.espp.refunds],['Total cash inflows',cashIn,true]]) +
    flowGroup('2. Taxes and money set aside', [['Taxes funded from cash',-(r.taxes.total-(r.rsuSellToCover || 0))],['Traditional 401(k)',-r.contributions.traditional],['Roth 401(k)',-r.contributions.roth],['Mega backdoor Roth',-r.contributions.mega],['Regular IRA / backdoor Roth',-r.contributions.ira],['Employee HSA',-r.contributions.hsa],['Benefits',-r.benefits],['ESPP payroll deductions',-r.espp.contributions]]) +
    flowGroup('3. Available cash', [['Available after taxes and contributions',r.afterTaxCash,true]]) +
    flowGroup('4. Spending and remaining cash', [['Living expenses',-expenses],['Total cash outflows',-cashOut,true],['Net monthly cash flow',cashIn-cashOut,true]]);
  document.getElementById('tax-reconciliation').innerHTML = [
    ['Federal income tax (includes AMT / NIIT)',r.taxes.federal],['State income tax',r.taxes.state],
    ['Social Security',r.taxes.ss],['Medicare + Additional Medicare',r.taxes.medicare+r.taxes.additionalMedicare],['State disability',r.taxes.sdi],
    ['Estimated tax total',r.taxes.total],['Cash withholding',r.cashWithholding],['RSU sell-to-cover withholding',r.rsuSellToCover],['Total withholding',r.withholding],
    [r.taxBalance>=0?'Additional tax reserve needed':'Estimated overpayment',Math.abs(r.taxBalance)]
  ].map(([label,value])=>`<div class="cf-line"><span>${label}</span><b>${money(value/12)}</b></div>`).join('');
  document.getElementById('account-contributions').innerHTML = table(['Destination','Your monthly contribution','Employer monthly funding'],[
    ['Traditional 401(k)',money(r.contributions.traditional/12),money(r.contributions.employer/12)],
    ['Roth 401(k)',money(r.contributions.roth/12),''],['Mega backdoor Roth',money(r.contributions.mega/12),''],
    ['HSA',money(r.contributions.hsa/12),money(r.contributions.hsaEmployer/12)],['IRA',money(r.contributions.ira/12),''],['RSU vesting kept invested (amortized)',money((r.rsuGross-r.rsuCash-(r.rsuSellToCover || 0))/12),'Non-cash equity']
  ]);
  document.getElementById('cash-months').innerHTML = table(['Month','Paychecks','Salary','Bonus','RSUs sold for cash','RSU sell-to-cover','Spouse','Other / rental','Social Security','Event income*','ESPP returned','Accounts','Benefits','ESPP deducted','Cash withheld','Cash after withholding','Living costs*','Tax adjustment*','Net cash flow'],r.months.map(m=>[
    new Date(cashFlowYear,m.month-1).toLocaleString('en-US',{month:'short'}),m.checks,...['salary','bonus','rsuCash','rsuSellToCover','spouseIncome','otherIncome','socialSecurity','eventIncome','esppProceeds','contributions','benefits','esppContributions','cashWithholding','bankCash','livingExpenses','taxAdjustment','netCashFlow'].map(k=>money(m[k]))
  ]));
  const actionable = r.warnings.filter(w => /cliff|capped|pro-rata calculation/.test(w));
  document.getElementById('cash-alerts').innerHTML = actionable.map(w=>`<p class="cf-note" role="status">${escapeText(w)}</p>`).join('');
  document.getElementById('cash-warnings').innerHTML = r.warnings.length ? `<details class="cf-notices"><summary>Assumptions and checks (${r.warnings.length})</summary><ul>${r.warnings.map(w=>`<li>${escapeText(w)}</li>`).join('')}</ul></details>` : '';
  const panel=document.getElementById('espp-enrollments');
  if(panel && !panel.contains(document.activeElement)) {
    const expandedOfferings=new Set([...panel.querySelectorAll('details[open]')].map(el=>el.dataset.offering));
    const offerings=(r.espp.offerings || []).filter(o=>Number(o.purchaseDate.slice(0,4))>=cashFlowYear);
    panel.innerHTML='<h4>Enrollment by offering</h4><p class="cf-note">Each offering can be skipped independently. Skipping an offering preserves unused annual share allowance; it does not remove the $25,000 grant-date FMV limit. The SoFi preset starts enrollment in the second offering; change the date for your situation.</p>'+offerings.map(o=>`<label class="cf-check"><input type="checkbox" data-enrollment="${o.grantDate}" ${o.enrolled?'checked':''}>${o.grantDate} to ${o.purchaseDate}</label><details data-offering="${o.grantDate}" ${expandedOfferings.has(o.grantDate)?'open':''}><summary>Offering adjustments</summary><div class="cf-fields">${field(`espp.enrollments.${o.grantDate}.rate`,'Contribution rate override','optional',{hint:'Blank uses the plan contribution rate.'})}${field(`espp.enrollments.${o.grantDate}.offerPrice`,'Offering price override','number',{min:.01,step:.01})}${field(`espp.enrollments.${o.grantDate}.purchasePrice`,'Purchase price override','number',{min:.01,step:.01})}${field(`espp.enrollments.${o.grantDate}.purchaseDate`,'Purchase date override','date',{optional:true})}</div></details>`).join('');
    panel.querySelectorAll('[data-enrollment]').forEach(el=>el.onchange=()=>{const config=model.getConfig().compensation;config.espp.enrollments ??= {};config.espp.enrollments[el.dataset.enrollment]={...config.espp.enrollments[el.dataset.enrollment],enrolled:el.checked};model.updateConfig({compensation:config});runSimulation();});
  }
  document.getElementById('espp-summary').innerHTML = `<div class="cf-line"><span>Payroll contributions</span><b>${money(r.espp.contributions)}</b></div><div class="cf-line"><span>Sale proceeds</span><b>${money(r.espp.proceeds)}</b></div><div class="cf-line"><span>Unused contributions refunded</span><b>${money(r.espp.refunds)}</b></div><div class="cf-line"><span>Ordinary income recognized</span><b>${money(r.espp.ordinary)}</b></div><div class="cf-line"><span>Realized capital gain / loss</span><b>${money(r.espp.shortGain+r.espp.longGain)}</b></div>`;
  document.getElementById('espp-lots').innerHTML = table(['Offering','Purchase','Sale','Shares','Cost','Grant-date FMV used','Refund','Proceeds','Disposition'],r.espp.lots.map(l=>[l.grantDate,l.purchaseDate,l.held?'Held':l.saleDate,l.shares.toFixed(4),money(l.cost),money(l.shares*l.grantPrice),money(l.refund),money(l.proceeds),l.held?'Unrealized':l.qualified?'Qualifying':'Disqualifying']));
  document.getElementById('espp-comparison').innerHTML = table(['Sale strategy','Cash returned this year','Ordinary income this year','Capital gain / loss this year'],[0,13,25].map(delay=>{
    const comparison = Compensation.calculate(Compensation.merge(c,{espp:{holdMonths:delay,holdShares:false}}),cashFlowYear);
    return [delay===0?'Sell immediately':`Hold ${delay} months`,money(comparison.espp.proceeds+comparison.espp.refunds),money(comparison.espp.ordinary),money(comparison.espp.shortGain+comparison.espp.longGain)];
  }));
  document.getElementById('limit-table').innerHTML = table(['Tax year','Source','401(k) employee','401(k) total','HSA self','HSA family','IRA','SS wage base'],Array.from({length:31},(_,i)=>{
    const year = c.taxYear+i,l = Compensation.limits(year,c.tax);
    return [year,c.tax.overrides?.[year]?'User override':l.projected?'Projected':'Published (federal)',...['deferral','total401k','hsaSingle','hsaFamily','ira','ssBase'].map(k=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(displayValue(l[k],{inflationFactor:(1+model.getConfig().inflation)**(year-c.taxYear)})))];
  }));
  document.getElementById('limit-overrides').innerHTML = ['deferral','total401k','hsaSingle','hsaFamily','ira','ssBase'].map((k,i)=>field(`tax.overrides.${cashFlowYear}.${k}`,['401(k) employee','401(k) total','HSA self','HSA family','IRA','Social Security wage base'][i],'number')).join('') + '<button type="button" class="btn-secondary" id="clear-limit-overrides">Use published / projected values</button>';
  document.getElementById('clear-limit-overrides').onclick = () => { delete c.tax.overrides[cashFlowYear]; model.config.compensation = c; syncCompensationFields(); runSimulation(); };
  syncCompensationFields();
  if(typeof renderMarketPrices==='function') renderMarketPrices();
}
