(function (root) {
  'use strict';

  const positive = v => Math.max(0, Number(v) || 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] || 0), 0);
  const iso = d => d.toISOString().slice(0, 10);
  const date = s => new Date(`${s}T12:00:00Z`);
  const endMonth = (y, m) => iso(new Date(Date.UTC(y, m + 1, 0, 12)));
  function addMonths(s, n) {
    const d = date(s), day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
    return iso(d);
  }
  function merge(a, b) {
    const out = { ...a };
    for (const [key, value] of Object.entries(b || {})) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      out[key] = value && typeof value === 'object' && !Array.isArray(value)
        ? merge(a?.[key] || {}, value) : value;
    }
    return out;
  }
  function defaults() {
    return {
      version: 2, taxYear: 2026, age: 25, salary: 165000, salaryGrowth: 0.03,
      bonusPercent: 0, bonusMonth: 3, frequency: 'biweekly', firstPayday: '2026-01-09',
      stockGrowth: 0, grants: [],
      tax: { filing: 'single', state: 'CA', spouseIncome: 0, otherIncome: 0,
        federalDeduction: 0, stateDeduction: 0, federalCredits: 0, stateCredits: 0,
        federalAdjustment: 0, stateAdjustment: 0, customStateRate: 0,
        federalExtra: 0, stateExtra: 0, salaryFederalRate: null, salaryStateRate: null,
        bonusFederalRate: 0.22, bonusStateRate: 0.1023, rsuFederalRate: 0.22, rsuStateRate: 0.1023,
        caSdi: 0.013, caHsaConforms: false, caGrowth2026: 0.03,
        limitGrowth: 0.025, bracketGrowth: 0.025, wageGrowth: 0.035, overrides: {}, capitalLossCarry: 0 },
      retirement: { traditional: 0, roth: 0, mega: 0, megaEnabled: false,
        employerAnnual: 0, matchRate: 1, matchPercent: 0, matchTrueUp: true,
        bonusEligible: true, rsuEligible: false, contributionGrowth: 0.025,
        priorDeferrals: 0, priorEmployer: 0, priorAfterTax: 0,
        ira: 0, iraMode: 'roth', iraPretaxBalance: 0, iraBasis: 0,
        conversionDelayMonths: 0, priorYearWages: 0 },
      hsa: { eligible: true, coverage: 'single', employee: 0, employer: 0, payroll: true, eligibleMonths: 12, prior: 0 },
      benefits: { health: 0, dental: 0, vision: 0, fsa: 0, otherPretax: 0, otherPosttax: 0 },
      espp: { enabled: false, qualifiedPlan: true, rate: 0.15, bonusEligible: false,
        discount: 0.15, lookback: true, offerPrice: 100, purchasePrice: 100, salePrice: 100,
        periodMonths: 6, start: '2026-01-01', holdMonths: 0, shareCap: 1517,
        annualFmvLimit: 25000, fractional: false, fee: 0 },
      forecastFromMonth: 1
    };
  }

  // Published federal/SSA 2026 values. California income tax starts from FTB 2025.
  // Source URLs and projection conventions are documented in TAX_RULES.md.
  function limits(year, settings = {}) {
    const t = merge(defaults().tax, settings);
    const n = Math.max(0, year - 2026);
    const round = (v, step, rate = t.limitGrowth) => Math.floor((v * (1 + rate) ** n + 1e-7) / step) * step;
    const l = {
      year, projected: year !== 2026,
      deferral: round(24500, 500), total401k: round(72000, 1000), compensation: round(360000, 5000),
      catchup: round(8000, 500), superCatchup: round(11250, 250), rothCatchupThreshold: round(150000, 5000, t.wageGrowth),
      ira: round(7500, 500), iraCatchup: round(1100, 100),
      hsaSingle: round(4400, 50), hsaFamily: round(8750, 50), hsaCatchup: 1000,
      ssBase: Math.round(184500 * (1 + t.wageGrowth) ** n / 300) * 300,
      espp: 25000, additionalMedicare: { single: 200000, married: 250000 },
      niit: { single: 200000, married: 250000 },
      federalDeduction: { single: 16100 * (1 + t.bracketGrowth) ** n, married: 32200 * (1 + t.bracketGrowth) ** n }
    };
    return merge(l, t.overrides?.[year] || {});
  }
  function brackets(income, ends, rates, mult = 1) {
    let prev = 0, total = 0;
    ends.concat(Infinity).forEach((end, i) => {
      const upper = end * mult;
      total += Math.max(0, Math.min(income, upper) - prev) * rates[i];
      prev = upper;
    });
    return total;
  }
  function tax(income, year, settings = {}) {
    const t = merge(defaults().tax, settings), l = limits(year, t);
    const married = t.filing === 'married', status = married ? 'married' : 'single';
    const f = (1 + t.bracketGrowth) ** Math.max(0, year - 2026);
    const ca = (1 + t.caGrowth2026) * (1 + t.bracketGrowth) ** Math.max(0, year - 2026);
    const wages = positive(income.wages), spouse = positive(income.spouse);
    const payrollDed = positive(income.payrollDeduction);
    const hsa = positive(income.hsa), employerHsa = positive(income.employerHsa);
    const pretax = positive(income.pretax);
    const ordinary = Number(income.ordinary) || 0;
    const st = Number(income.shortGain) || 0, lt = Number(income.longGain) || 0;
    const net = st + lt, loss = Math.max(-3000, Math.min(0, net));
    const longGain = Math.max(0, Math.min(lt, net));
    const shortGain = Math.max(0, net - longGain);
    const fedAgi = wages + spouse + ordinary + positive(income.federalOnly) - pretax - payrollDed - hsa + shortGain + loss;
    const caAgi = wages + spouse + ordinary - pretax - payrollDed + (t.state !== 'CA' || t.caHsaConforms ? -hsa : employerHsa) + shortGain + loss;
    const caEnds = [11079,26264,41452,57542,72724,371479,445771,742953].map(v => married ? v * 2 : v);
    const stateDed = Math.max((married ? 11412 : 5706) * ca, positive(t.stateDeduction), positive(income.stateItemized));
    const stateTaxable = Math.max(0, caAgi + longGain - stateDed);
    let state = t.state === 'CA' ? brackets(stateTaxable, caEnds, [.01,.02,.04,.06,.08,.093,.103,.113,.123], ca)
      + Math.max(0, stateTaxable - 1000000) * .01
      : t.state === 'custom' ? stateTaxable * clamp(t.customStateRate, 0, 1) : 0;
    if (t.state === 'CA') {
      const threshold = (married ? 504411 : 252203) * ca;
      const phaseout = Math.ceil(Math.max(0, caAgi + longGain - threshold) / (married ? 2500 : 1250)) * 6;
      state -= Math.max(0, (married ? 306 : 153) * ca - phaseout);
    }
    state = Math.max(0, state - positive(t.stateCredits) + (Number(t.stateAdjustment) || 0));
    const magi = fedAgi + longGain;
    const saltBase = year <= 2029 ? 40400 * 1.01 ** (year - 2026) : 10000;
    const saltThreshold = year <= 2029 ? 505000 * 1.01 ** (year - 2026) : Infinity;
    const salt = Math.max(10000, saltBase - .3 * Math.max(0, magi - saltThreshold));
    const statePayrollTax = t.state === 'CA' ? (Math.max(0, wages - payrollDed) + spouse + employerHsa) * t.caSdi : 0;
    const itemized = positive(income.mortgageInterest) + Math.min(salt, state + statePayrollTax + positive(income.propertyTaxes));
    const totalItemized = Math.max(positive(t.federalDeduction), itemized);
    const limitedItemized = totalItemized - (2/37) * Math.min(totalItemized, Math.max(0, magi - (married ? 768700 : 640600) * f));
    const deduction = Math.max(l.federalDeduction[status], limitedItemized);
    const taxable = Math.max(0, fedAgi - deduction);
    const taxableLong = Math.max(0, longGain - Math.max(0, deduction - fedAgi));
    const fedEnds = married ? [24800,100800,211400,403550,512450,768700] : [12400,50400,105700,201775,256225,640600];
    const rates = [.1,.12,.22,.24,.32,.35,.37];
    const cgEnds = married ? [98900,613700] : [49450,545500];
    const capitalTax = brackets(taxable + taxableLong, cgEnds, [0,.15,.2], f) - brackets(taxable, cgEnds, [0,.15,.2], f);
    const regular = brackets(taxable, fedEnds, rates, f) + capitalTax;
    const amtIncome = Math.max(0, magi - positive(income.mortgageInterest));
    const exemption = Math.max(0, (married ? 140200 : 90100) * f - .5 * Math.max(0, amtIncome - (married ? 1000000 : 500000) * f));
    const amtTaxable = Math.max(0, amtIncome - exemption);
    const amtLong = Math.min(longGain, amtTaxable);
    const amtOrdinary = amtTaxable - amtLong;
    const amtCapitalTax = brackets(amtOrdinary + amtLong, cgEnds, [0,.15,.2], f) - brackets(amtOrdinary, cgEnds, [0,.15,.2], f);
    const amt = Math.max(0, brackets(amtOrdinary, [244500], [.26,.28], f) + amtCapitalTax - regular);
    const niit = .038 * Math.min(Math.max(0, net), Math.max(0, magi - l.niit[status]));
    const federal = Math.max(0, regular + amt + niit - positive(t.federalCredits) + (Number(t.federalAdjustment) || 0));
    const w = Math.max(0, wages - payrollDed - positive(income.hsaPayroll));
    const ss = .062 * (Math.min(w, l.ssBase) + Math.min(spouse, l.ssBase));
    const medicare = .0145 * (w + spouse);
    const additionalMedicare = .009 * Math.max(0, w + spouse - l.additionalMedicare[status]);
    const sdi = statePayrollTax;
    return { federal, state, ss, medicare, additionalMedicare, sdi, niit, amt,
      fica: ss + medicare + additionalMedicare,
      total: federal + state + ss + medicare + additionalMedicare + sdi,
      federalTaxable: taxable + taxableLong, stateTaxable, deduction, stateDeduction: stateDed,
      lossCarryforward: Math.max(0, -net - 3000) };
  }
  const paydayCache = new Map();
  function paydays(c, year) {
    const key = `${c.frequency}:${c.firstPayday}:${year}`;
    if (paydayCache.has(key)) return paydayCache.get(key);
    const days = [];
    if (c.frequency === 'biweekly' || c.frequency === 'weekly') {
      const d = date(c.firstPayday), step = c.frequency === 'weekly' ? 7 : 14;
      if (!Number.isFinite(d.getTime())) throw new Error('Enter a valid first payday.');
      const start = date(`${year}-01-01`);
      d.setUTCDate(d.getUTCDate() + Math.ceil((start - d) / 86400000 / step) * step);
      while (d.getUTCFullYear() === year) { days.push(iso(d)); d.setUTCDate(d.getUTCDate() + step); }
    } else {
      for (let m = 0; m < 12; m++) {
        if (c.frequency === 'semimonthly') days.push(`${year}-${String(m+1).padStart(2,'0')}-15`);
        days.push(endMonth(year, m));
      }
    }
    paydayCache.set(key, days);
    return days;
  }
  function sellLot(lot, saleDate, price, fee = 0) {
    const proceeds = Math.max(0, lot.shares * price - fee);
    const qualified = saleDate > addMonths(lot.grantDate, 24) && saleDate > addMonths(lot.purchaseDate, 12);
    const ordinary = qualified ? Math.max(0, Math.min(lot.shares * lot.grantPrice * lot.discount, proceeds - lot.cost))
      : lot.shares * Math.max(0, lot.purchasePrice - lot.cost / Math.max(lot.shares, 1e-20));
    const gain = proceeds - lot.cost - ordinary;
    const longTerm = saleDate > addMonths(lot.purchaseDate, 12);
    return { proceeds, ordinary, gain, longGain: longTerm ? gain : 0, shortGain: longTerm ? 0 : gain, qualified };
  }
  const planPresets={sofi:{name:'Own SoFi',offeringMonth:12,offeringDay:9,initialEnrollmentMonth:6,initialEnrollmentDay:9,periodMonths:6,purchaseTiming:'day-before-next-start',discount:.15,lookback:true,shareCap:5000,minRate:.01,maxRate:.15,bonusEligible:true,qualifiedPlan:true,annualFmvLimit:25000,annualPayrollCap:21250,payrollRounding:true,autoEnroll:true,stopAtAnnualLimit:true,fractional:true}};
  const rsuMode=g=>g.saleMode || (g.sell===true?'sell':g.sell===false?'hold':'cover');
  function offeringDates(e,grantDate) {
    const next=addMonths(grantDate,Math.max(1,Math.round(e.periodMonths)));
    const nominal=e.purchaseTiming==='day-before-next-start'?iso(new Date(date(next).getTime()-86400000)):endMonth(date(addMonths(grantDate,e.periodMonths-1)).getUTCFullYear(),date(addMonths(grantDate,e.periodMonths-1)).getUTCMonth());
    let purchaseDate=e.enrollments?.[grantDate]?.purchaseDate || nominal;
    if(e.purchaseTiming==='day-before-next-start' && !e.enrollments?.[grantDate]?.purchaseDate){while([0,6].includes(date(purchaseDate).getUTCDay()) || (e.marketHolidays || []).includes(purchaseDate))purchaseDate=iso(new Date(date(purchaseDate).getTime()-86400000));}
    return {next,purchaseDate};
  }
  function equity(c, year, salary, bonus, options = {}) {
    const months = Array.from({ length: 12 }, () => ({ rsu: 0, rsuCash: 0, rsuCoverEligible:0, esppContrib: 0, esppSalaryContrib: 0, esppProceeds: 0, esppRefund: 0, ordinary: 0, shortGain: 0, longGain: 0 }));
    let stockAssets = 0, openingAssets = 0;
    const lots = [], rsuVests=[], offerings=[], e = c.espp, baseYear = c.taxYear;
    const stockFactor = y => (1 + c.stockGrowth) ** Math.max(0, y - baseYear);
    const grants = c.grants.flatMap((g,grantIndex) => g.repeat ? Array.from({ length: Math.max(0, year - Number(g.start.slice(0,4)) + 1) }, (_, i) => ({ ...g, grantIndex, start: addMonths(g.start, 12 * i) })) : [{...g,grantIndex}]);
    for (const grant of grants) {
      const length = Math.max(1, Math.round(grant.months || 48));
      const interval = Math.max(1, Math.round(grant.interval || 3));
      const cliff = clamp(grant.cliff, 0, length);
      const start = grant.start || `${baseYear}-01-01`;
      let vested = 0;
      for (let elapsed = 1; elapsed <= length; elapsed++) {
        if (elapsed < cliff || (elapsed % interval !== 0 && elapsed !== cliff && elapsed !== length)) continue;
        const vestDate = addMonths(start, elapsed);
        const vestYear = Number(vestDate.slice(0,4));
        const value = positive(grant.value) * (elapsed - vested) / length * (positive(grant.vestPrice) || positive(grant.grantPrice) || 100) / (positive(grant.grantPrice) || 100) * stockFactor(vestYear);
        const vestShares=positive(grant.value)*(elapsed-vested)/length/(positive(grant.grantPrice)||100);
        vested = elapsed;
        if (vestYear < baseYear || vestYear > year || (options.stopYear && vestYear >= options.stopYear) || options.history?.[vestYear]?.employed === false || (vestYear === year && options.employed === false)) continue;
        if (rsuMode(grant)!=='sell') {
          stockAssets += value / stockFactor(vestYear) * stockFactor(year);
          if (vestYear < year) openingAssets += value / stockFactor(vestYear) * stockFactor(year - 1);
        }
        if (vestYear === year && options.employed !== false) {
          const m = months[Number(vestDate.slice(5,7)) - 1]; m.rsu += value;
          if (rsuMode(grant)==='sell') m.rsuCash += value;
          if (rsuMode(grant)==='cover') m.rsuCoverEligible += value;
          rsuVests.push({grantIndex:grant.grantIndex,name:grant.name || 'RSU grant',date:vestDate,shares:vestShares,value,mode:rsuMode(grant)});
        }
      }
    }
    if (e.enabled) {
      const period = Math.max(1, Math.round(e.periodMonths)), start = e.start || `${baseYear}-01-01`;
      const usage = {},payrollUsage={};
      for (let i = 0; i < 1200; i++) {
        const grantDate = addMonths(start, i * period);
        if (Number(grantDate.slice(0,4)) > year) break;
        const election=e.enrollments?.[grantDate] || {};
        const enrolled=election.enrolled ?? ((e.autoEnroll ?? true) && (!e.firstEnrollmentDate || grantDate>=e.firstEnrollmentDate));
        const {next,purchaseDate}=offeringDates(e,grantDate),py=Number(purchaseDate.slice(0,4));
        if(!enrolled){offerings.push({grantDate,purchaseDate,enrolled:false,contributions:0});continue;}
        const rate=clamp(election.rate ?? e.rate,e.minRate ?? 0,e.maxRate ?? 1);
        let cash=0;
        for(let cy=Number(grantDate.slice(0,4));cy<=Math.min(year,py);cy++){
          if((options.stopYear && cy>=options.stopYear)||options.history?.[cy]?.employed===false||(cy===year && options.employed===false))continue;
          const annual=cy===year?salary:options.history?.[cy]?.salary ?? c.salary*(1+c.salaryGrowth)**Math.max(0,cy-baseYear);
          const annualBonus=cy===year?bonus:annual*(options.history?.[cy]?.bonusPercent ?? c.bonusPercent);
          const checks=paydays(c,cy),bonusChecks=checks.filter(d=>Number(d.slice(5,7))===c.bonusMonth);
          for(const payday of checks){
            if(payday<grantDate || payday>=next || (e.employmentStart && payday<e.employmentStart) || (e.employmentEnd && payday>e.employmentEnd))continue;
            const cm=Number(payday.slice(5,7))-1;
            if(e.stopAtAnnualLimit && (usage[cy] || 0)>=positive(e.annualFmvLimit)-.000001)continue;
            const salaryPart=annual/checks.length*rate;
            let deduction=salaryPart+(e.bonusEligible && cm===c.bonusMonth-1 ? annualBonus/Math.max(1,bonusChecks.length)*rate:0);
            if(e.payrollRounding)deduction=Math.round(deduction*100)/100;
            deduction=Math.min(deduction,Math.max(0,(positive(e.annualPayrollCap)||Infinity)-(payrollUsage[cy]||0)));
            payrollUsage[cy]=(payrollUsage[cy]||0)+deduction;cash+=deduction;
            if(cy===year){months[cm].esppContrib+=deduction;months[cm].esppSalaryContrib+=Math.min(salaryPart,deduction);}
          }
        }
        offerings.push({grantDate,purchaseDate,enrolled:true,rate,contributions:cash});
        if(e.employmentEnd && e.employmentEnd<purchaseDate){if(Number(e.employmentEnd.slice(0,4))===year)months[Number(e.employmentEnd.slice(5,7))-1].esppRefund+=cash;continue;}
        if (py > year) { stockAssets += cash; continue; }
        const gp = Math.max(.01, (election.offerPrice ?? e.offerPrice) * stockFactor(Number(grantDate.slice(0,4))));
        const pp = Math.max(.01, (election.purchasePrice ?? e.purchasePrice) * stockFactor(py));
        const price = Math.min(e.lookback ? gp : pp, pp) * (1 - clamp(e.discount, 0, .99));
        const cap = e.qualifiedPlan ? Math.max(0, Math.min(25000, positive(e.annualFmvLimit)) - (usage[py] || 0)) / gp : Infinity;
        let shares = Math.min(cash / price, positive(e.shareCap) || Infinity, cap);
        if (!e.fractional) shares = Math.floor(shares);
        usage[py] = (usage[py] || 0) + shares * gp;
        const cost = shares * price, refund = cash - cost;
        const saleDate = addMonths(purchaseDate, positive(e.holdMonths));
        const sy = e.holdShares ? Infinity : Number(saleDate.slice(0,4));
        const lot = { grantDate, purchaseDate, shares, cost, grantPrice: gp, purchasePrice: pp, discount: e.discount, saleDate, refund };
        const sale = e.holdShares ? {proceeds:0,ordinary:0,gain:0,longGain:0,shortGain:0,qualified:false,held:true} : sellLot(lot, saleDate, (election.salePrice ?? e.salePrice) * stockFactor(sy), e.fee);
        if (!e.qualifiedPlan) { sale.ordinary = 0; sale.shortGain = sale.proceeds - cost - shares * (pp - price); sale.longGain = 0; }
        if (py === year) {
          months[Number(purchaseDate.slice(5,7))-1].esppRefund += refund;
          if (!e.qualifiedPlan) months[Number(purchaseDate.slice(5,7))-1].rsu += shares * (pp - price);
        }
        if (sy === year) {
          const m = months[Number(saleDate.slice(5,7))-1];
          m.esppProceeds += sale.proceeds; m.ordinary += sale.ordinary;
          m.shortGain += sale.shortGain; m.longGain += sale.longGain;
        }
        if (sy > year) stockAssets += shares * pp / stockFactor(py) * stockFactor(year);
        if (py < year && sy >= year) openingAssets += shares * pp / stockFactor(py) * stockFactor(year-1);
        if (py === year || sy === year) lots.push({ ...lot, ...sale, openingValue: py < year ? shares * pp / stockFactor(py) * stockFactor(year-1) : 0 });
      }
    }
    return { months, stockAssets, openingAssets, lots, rsuVests, offerings };
  }

  function calculate(input, year = input.taxYear || 2026, options = {}) {
    const c = merge(defaults(), input), warnings = [];
    const coverHistory=options.coverHistory || {};
    if(c.grants.some(g=>rsuMode(g)==='cover'))for(let prior=c.taxYear;prior<year;prior++){
      if(coverHistory[prior]===undefined)coverHistory[prior]=options.history?.[prior]?.rsuSellToCover ?? calculate(c,prior,{...options,coverHistory,salary:options.history?.[prior]?.salary,bonusPercent:options.history?.[prior]?.bonusPercent,employed:options.history?.[prior]?.employed}).rsuSellToCover;
    }
    if (!Number.isInteger(year) || year < 2026 || year > 2200) throw new Error('Tax year must be between 2026 and 2200.');
    const offset = year - c.taxYear, age = c.age + offset;
    c.grants.forEach((g,i) => {
      if (g.cliff > g.months) warnings.push(`Grant ${i+1}: cliff exceeds vesting duration. The calculation uses the final vest month; correct the schedule before relying on it.`);
    });
    const l = limits(year, c.tax), r = c.retirement, h = c.hsa, b = c.benefits;
    const salary = options.employed === false ? 0 : positive(options.salary ?? c.salary * (1 + c.salaryGrowth) ** offset);
    const bonus = salary * clamp(options.bonusPercent ?? c.bonusPercent, 0, 10);
    const eq = equity(c, year, salary, bonus, options);
    if (options.rsuOverride !== undefined) {
      for (const m of eq.months) { m.rsu = positive(options.rsuOverride) / 12; m.rsuCash = m.rsu; }
    }
    const rsuGross = sum(eq.months, 'rsu'), rsuCash = sum(eq.months, 'rsuCash');
    const grossEligible = salary + (r.bonusEligible ? bonus : 0) + (r.rsuEligible ? rsuGross : 0);
    const eligible = Math.min(l.compensation, grossEligible);
    const grow = (1 + r.contributionGrowth) ** Math.max(0, offset);
    const prior = offset === 0;
    const cap = (name, value, limit) => {
      const n = positive(value), allowed = Math.max(0, limit);
      if (n > allowed + .01) warnings.push(`${name} capped at ${Math.round(allowed).toLocaleString('en-US')}.`);
      return Math.min(n, allowed);
    };
    const catchup = age >= 60 && age <= 63 ? l.superCatchup : age >= 50 ? l.catchup : 0;
    const employeeRoom = Math.min(eligible, l.deferral + catchup - (prior ? r.priorDeferrals : 0));
    let traditional = cap('Traditional 401(k)', r.max401k ? employeeRoom - Math.min(employeeRoom, positive(r.roth)) : r.traditional * grow, employeeRoom);
    let roth = cap('Roth 401(k)', r.max401k ? r.roth : r.roth * grow, employeeRoom - traditional);
    if (catchup && (r.priorYearWages || (r.max401k ? salary / (1 + c.salaryGrowth) : 0)) > l.rothCatchupThreshold && traditional > l.deferral) {
      roth += traditional - l.deferral; traditional = l.deferral;
      warnings.push('Catch-up contributions moved to Roth based on prior-year wages.');
    }
    const regularDeferrals = Math.min(l.deferral, traditional + roth + (prior ? r.priorDeferrals : 0));
    const employer = cap('Employer contribution', r.employerAnnual * grow + Math.min(traditional + roth, eligible * r.matchPercent) * r.matchRate,
      Math.min(eligible, l.total401k) - regularDeferrals - (prior ? r.priorEmployer + r.priorAfterTax : 0));
    const mega = cap('Mega backdoor', r.megaEnabled ? (r.maxMega ? Math.max(0, Math.min(eligible, l.total401k) - regularDeferrals - employer - (prior ? r.priorEmployer + r.priorAfterTax : 0)) : r.mega * grow) : 0,
      Math.min(eligible, l.total401k) - regularDeferrals - employer - (prior ? r.priorEmployer + r.priorAfterTax : 0));
    const hsaLimit = h.eligible ? ((h.coverage === 'family' ? l.hsaFamily : l.hsaSingle) + (age >= 55 ? l.hsaCatchup : 0)) * clamp(h.eligibleMonths, 0, 12) / 12 : 0;
    const hsaEmployer = cap('Employer HSA', salary ? h.employer * grow : 0, hsaLimit - (prior ? h.prior : 0));
    const hsa = cap('Employee HSA', salary ? (h.maxContribution ? Math.max(0, hsaLimit - hsaEmployer - (prior ? h.prior : 0)) : h.employee * grow) : 0, hsaLimit - hsaEmployer - (prior ? h.prior : 0));
    const benefits = salary ? (positive(b.health) + positive(b.dental) + positive(b.vision) + positive(b.fsa) + positive(b.otherPretax)) * 12 : 0;
    const postBenefits = salary ? positive(b.otherPosttax) * 12 : 0;
    if (b.fsa > 0 && hsa > 0) warnings.push('HSA eligibility requires a compatible limited-purpose FSA; confirm your plan.');
    const other = Number(options.otherIncome ?? c.tax.otherIncome) || 0;
    const spouse = positive(options.spouseIncome ?? c.tax.spouseIncome);
    const conversionEarnings = mega * ((1 + Math.max(0, c.stockGrowth)) ** (r.conversionDelayMonths / 12) - 1);
    const income = { wages: salary + bonus + rsuGross + positive(options.extraWages), spouse,
      ordinary: other + sum(eq.months, 'ordinary') + conversionEarnings,
      shortGain: sum(eq.months, 'shortGain') - positive(options.capitalLossCarry ?? (year === c.taxYear ? c.tax.capitalLossCarry : 0)), longGain: sum(eq.months, 'longGain'),
      pretax: traditional, payrollDeduction: benefits, hsa, hsaPayroll: h.payroll ? hsa : 0, employerHsa: hsaEmployer };
    const approxMagi = income.wages + spouse + income.ordinary - traditional - benefits - hsa + income.shortGain + income.longGain;
    const phaseStart = (c.tax.filing === 'married' ? 242000 : 153000) * (1 + c.tax.bracketGrowth) ** Math.max(0, year - 2026);
    const phaseWidth = c.tax.filing === 'married' ? 10000 : 15000;
    const iraLimit = Math.min(salary + bonus + spouse, l.ira + (age >= 50 ? l.iraCatchup : 0));
    const rothRoom = Math.max(0, Math.ceil(iraLimit * clamp((phaseStart + phaseWidth - approxMagi) / phaseWidth, 0, 1) / 10) * 10);
    const ira = cap('IRA contribution', r.maxIra ? (r.iraMode === 'roth' ? rothRoom : iraLimit) : r.ira * grow, r.iraMode === 'roth' ? rothRoom : iraLimit);
    let iraTaxableConversion = 0;
    if (r.iraMode === 'backdoor' && ira > 0) {
      iraTaxableConversion = ira * Math.max(0, 1 - Math.min(1, (positive(r.iraBasis) + ira) / Math.max(1, positive(options.iraPretaxBalance ?? r.iraPretaxBalance) + positive(r.iraBasis) + ira)));
      income.ordinary += iraTaxableConversion;
      if (iraTaxableConversion > 0) warnings.push('Backdoor IRA conversion includes taxable income under the pro-rata calculation.');
    }
    const taxes = tax(income, year, c.tax);
    const employee = traditional + roth + mega + hsa + ira;
    const payDates = paydays(c, year), monthly = [];
    const salaryTax = tax({ wages: salary, spouse, ordinary: other, pretax: traditional * salary / Math.max(1, grossEligible),
      payrollDeduction: benefits, hsa, hsaPayroll: h.payroll ? hsa : 0, employerHsa: hsaEmployer }, year, c.tax);
    let cumWages = 0, supplemental = 0, cumSpouseWages = 0;
    for (let m = 0; m < 12; m++) {
      const checks = payDates.filter(d => Number(d.slice(5,7))-1 === m).length;
      const fraction = checks / payDates.length;
      const base = salary * fraction, bm = m === c.bonusMonth - 1 ? bonus : 0, q = eq.months[m];
      const allocation = eligible ? (base + (r.bonusEligible ? bm : 0) + (r.rsuEligible ? q.rsu : 0)) / (salary + (r.bonusEligible ? bonus : 0) + (r.rsuEligible ? rsuGross : 0)) : 0;
      const retirement = (traditional + roth + mega) * allocation;
      const health = benefits * fraction, hs = hsa * fraction, post = postBenefits * fraction;
      const payrollWages = Math.max(0, base + bm + q.rsu - health - (h.payroll ? hs : 0));
      const ss = .062 * Math.max(0, Math.min(l.ssBase, cumWages + payrollWages) - Math.min(l.ssBase, cumWages));
      const addl = .009 * (Math.max(0, cumWages + payrollWages - 200000) - Math.max(0, cumWages - 200000));
      const spouseWages = spouse / 12;
      const spouseFica = .062 * (Math.min(l.ssBase, cumSpouseWages + spouseWages) - Math.min(l.ssBase, cumSpouseWages)) + spouseWages*.0145 +
        .009 * (Math.max(0,cumSpouseWages+spouseWages-200000)-Math.max(0,cumSpouseWages-200000));
      const fica = ss + payrollWages * .0145 + addl + spouseFica;
      const sdi = c.tax.state === 'CA' ? Math.max(0, base + bm + q.rsu - health + hsaEmployer*fraction + spouseWages) * c.tax.caSdi : 0;
      const baseFed = c.tax.salaryFederalRate === null ? salaryTax.federal * fraction : Math.max(0, base - traditional * allocation - health - hs) * c.tax.salaryFederalRate;
      const baseState = c.tax.salaryStateRate === null ? salaryTax.state * fraction : Math.max(0, base - traditional * allocation - health - (c.tax.caHsaConforms ? hs : 0)) * c.tax.salaryStateRate;
      const bonusTaxable = Math.max(0, bm - (r.bonusEligible ? traditional * bm / Math.max(1, grossEligible) : 0));
      const rsuTaxable = Math.max(0, q.rsu - (r.rsuEligible ? traditional * q.rsu / Math.max(1, grossEligible) : 0));
      const supp = bonusTaxable + rsuTaxable;
      const excess = Math.max(0, supplemental + supp - 1000000) - Math.max(0, supplemental - 1000000);
      const fedSupplemental = bonusTaxable * c.tax.bonusFederalRate + rsuTaxable * c.tax.rsuFederalRate;
      const federal = baseFed + (supp ? fedSupplemental * (supp - excess) / supp + excess * .37 : 0) + c.tax.federalExtra * checks;
      const state = c.tax.state === 'none' ? 0 : baseState + bonusTaxable * c.tax.bonusStateRate + rsuTaxable * c.tax.rsuStateRate + c.tax.stateExtra * checks;
      const withholding = federal + state + fica + sdi;
      const noRsuWages=Math.max(0,payrollWages-q.rsu);
      const rsuSs=.062*(Math.min(l.ssBase,cumWages+payrollWages)-Math.min(l.ssBase,cumWages+noRsuWages));
      const rsuAddl=.009*(Math.max(0,cumWages+payrollWages-200000)-Math.max(0,cumWages+noRsuWages-200000));
      const rsuFederal=supp ? rsuTaxable*c.tax.rsuFederalRate*(supp-excess)/supp + excess*.37*rsuTaxable/supp : 0;
      const rsuWithholding=rsuFederal+(c.tax.state==='none'?0:rsuTaxable*c.tax.rsuStateRate)+rsuSs+q.rsu*.0145+rsuAddl+(c.tax.state==='CA'?q.rsu*c.tax.caSdi:0);
      const rsuSellToCover=Math.min(q.rsuCoverEligible,Math.max(0,c.tax.rsuCoverRate==null?rsuWithholding*q.rsuCoverEligible/Math.max(1e-20,q.rsu):q.rsuCoverEligible*c.tax.rsuCoverRate));
      const receipts = base + bm + q.rsuCash + q.esppProceeds + q.esppRefund + spouse / 12 + other / 12;
      const bankCash = receipts - retirement - hs - ira / 12 - health - post - q.esppContrib - withholding + rsuSellToCover;
      const regularShare = payrollWages ? Math.max(0, base - health - (h.payroll ? hs : 0)) / payrollWages : 0;
      monthly.push({ month: m+1, checks: salary ? checks : 0, spouseIncome:spouse/12, otherIncome:other/12, salary: base, bonus: bm, rsu: q.rsu, rsuCash: q.rsuCash,
        esppContributions: q.esppContrib, esppProceeds: q.esppProceeds + q.esppRefund,
        contributions: retirement + hs + ira/12, benefits: health + post,
        withholding, rsuWithholding, rsuSellToCover, cashWithholding:withholding-rsuSellToCover, federal, state, fica, sdi, bankCash,
        regularCash: salary ? base - (traditional + roth + mega) * (eligible ? base / (salary + (r.bonusEligible ? bonus : 0) + (r.rsuEligible ? rsuGross : 0)) : 0) - hs - health - post - baseFed - baseState - (fica - spouseFica + sdi - (c.tax.state === 'CA' ? spouseWages * c.tax.caSdi : 0)) * regularShare - q.esppSalaryContrib - (c.tax.federalExtra + c.tax.stateExtra) * checks : 0 });
      cumWages += payrollWages; cumSpouseWages += spouseWages; supplemental += supp;
    }
    const rsuSellToCover=sum(monthly,'rsuSellToCover');
    coverHistory[year]=rsuSellToCover;
    eq.stockAssets-=rsuSellToCover;
    for(const [prior,value] of Object.entries(coverHistory))if(Number(prior)<year){eq.stockAssets-=value*(1+c.stockGrowth)**(year-Number(prior));eq.openingAssets-=value*(1+c.stockGrowth)**(year-1-Number(prior));}
    const withholding = sum(monthly, 'withholding'), bankCash = sum(monthly, 'bankCash');
    const taxBalance = taxes.total - withholding;
    const espp = { contributions: sum(eq.months, 'esppContrib'), proceeds: sum(eq.months, 'esppProceeds'), refunds: sum(eq.months, 'esppRefund'), ordinary: sum(eq.months, 'ordinary'), shortGain: sum(eq.months, 'shortGain'), longGain: sum(eq.months, 'longGain'), lots: eq.lots, offerings:eq.offerings };
    if (employee + benefits + postBenefits + espp.contributions > salary + bonus) warnings.push('Contributions and deductions exceed cash wages; review paycheck funding.');
    if (monthly.some(m => m.bankCash < 0)) warnings.push('Some months need cash from savings. Review the monthly schedule.');
    if (c.grants.some(g => rsuMode(g)==='hold')) warnings.push('Held RSU taxes are funded from cash. Shares remain invested until you change the sale assumption.');
    if (c.tax.state === 'CA') warnings.push('California income tax uses 2025 FTB tables projected to 2026 with the editable CA adjustment.');
    if (taxes.lossCarryforward) warnings.push('Unused capital losses carry into later years in the lifetime projection.');
    if (c.tax.spouseIncome) warnings.push('Spouse wages affect household taxes. Use withholding overrides to reconcile both paychecks.');
    if (r.iraMode === 'backdoor') warnings.push('IRA pro-rata inputs are annual planning estimates; update year-end IRA balances before relying on conversion tax.');
    if (c.legacyEsppGain && !c.espp.enabled) warnings.push('The previous fixed ESPP gain is no longer added automatically. Enable ESPP and enter the plan settings.');
    return { year, limits: l, months: monthly, salary, bonus, rsuGross, rsuCash, rsuSellToCover, cashWithholding:withholding-rsuSellToCover, rsuVests:eq.rsuVests,
      gross: salary + bonus + rsuGross, otherIncome: other, income, taxes, withholding, bankCash, taxBalance,
      afterTaxCash: bankCash - taxBalance, regularMonthly: sum(monthly, 'regularCash') / 12,
      remainingCash: monthly.filter(m => m.month >= c.forecastFromMonth).reduce((n,m) => n+m.bankCash,0),
      contributions: { traditional, roth, mega, employer, hsa, hsaEmployer, ira, totalEmployee: employee, iraTaxableConversion, conversionEarnings },
      benefits: benefits + postBenefits, espp, stockAssets: eq.stockAssets, openingAssets: eq.openingAssets,
      warnings: [...new Set(warnings)] };
  }
  function cashFlow(payroll, options = {}) {
    const taxes = options.taxes || payroll.taxes;
    const expenses = Number(options.expenses) || 0;
    const socialSecurity = Number(options.socialSecurity) || 0;
    const eventIncome = Number(options.eventIncome) || 0;
    const otherIncome = payroll.otherIncome || 0;
    const cashIn = payroll.salary + payroll.bonus + payroll.rsuCash + payroll.income.spouse + otherIncome + payroll.espp.proceeds + payroll.espp.refunds + socialSecurity + eventIncome;
    const cashOut = taxes.total - (payroll.rsuSellToCover || 0) + payroll.contributions.totalEmployee + payroll.benefits + payroll.espp.contributions + expenses;
    const taxBalance = taxes.total - payroll.withholding;
    const months = payroll.months.map(month => {
      const bankCash = month.bankCash + (socialSecurity + eventIncome) / 12;
      const livingExpenses = expenses / 12;
      const taxAdjustment = taxBalance / 12;
      return { ...month, socialSecurity:socialSecurity/12, eventIncome:eventIncome/12,
        bankCash, livingExpenses, taxAdjustment, netCashFlow:bankCash-livingExpenses-taxAdjustment };
    });
    return { cashIn, cashOut, netCashFlow:cashIn-cashOut, afterTaxCash:cashIn-cashOut+expenses,
      taxes, taxBalance, expenses, socialSecurity, eventIncome, otherIncome, months };
  }
  function fromLegacy(cfg) {
    if (cfg.compensation?.version === 2) return merge(defaults(), cfg.compensation);
    return merge(defaults(), { salary: cfg.baseSalary ?? 165000, age: cfg.age ?? 25, legacyEsppGain: cfg.esppAnnualGain || 0,
      salaryGrowth: cfg.salaryGrowth ?? .03, bonusPercent: cfg.bonusPercent ?? .1,
      tax: { spouseIncome: cfg.spouseIncome || 0, otherIncome: cfg.rentalIncome || 0 },
      retirement: { traditional: cfg.pretax401k || 0, mega: cfg.megaBackdoor || 0,
        megaEnabled: !!cfg.megaBackdoor, ira: cfg.rothIRA || 0, iraPretaxBalance: cfg.traditionalIRA || 0 },
      hsa: { employee: cfg.hsaContrib || 0 },
      grants: cfg.rsuAnnualGross ? [{ name: 'Existing annual RSU estimate', value: cfg.rsuAnnualGross,
        grantPrice: 100, vestPrice:100, start: '2025-12-31', months: 12, cliff: 0, interval: 3, sell: true, repeat: true }] : [] });
  }
  const api = { planPresets, offeringDates, rsuMode, defaults, merge, limits, tax, calculate, cashFlow, fromLegacy, sellLot, paydays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Compensation = api;
})(typeof window !== 'undefined' ? window : globalThis);
