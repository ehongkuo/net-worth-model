/**
 * Lifetime Net Worth Projection Model
 * Core simulation engine for projection model.
 */

// Run in both the browser (globals hang off `window`) and Node (for the test
// suite). In Node there is no `window`, so alias it to `globalThis`.
if (typeof window === 'undefined') { globalThis.window = globalThis; }

window.DEFAULT_CONFIG = {
  age: 25,
  projectionYears: 75,
  baseSalary: 165000,
  bonusPercent: 0.10,
  rsuAnnualGross: 31667,
  esppAnnualGain: 4368,
  spouseIncome: 0,
  rentalIncome: 0,
  expenses: {
    housing: 3500,
    dining: 600,
    groceries: 250,
    giving: 300,
    travel: 500,
    entertainment: 200,
    auto: 150,
    other: 500
  },
  pretax401k: 31350,
  megaBackdoor: 24750,
  hsaContrib: 4296,
  rothIRA: 7000,
  cash: 26000,
  brokerage: 124000,
  pretax401kBal: 10000,
  rothAccounts: 40000,
  traditionalIRA: 30000,
  hsa: 1200,
  inflation: 0.03,
  salaryGrowth: 0.03,
  marketReturn: 0.07,
  realEstateAppreciation: 0.03,
  // Retirement: at retirementAge employment income and contributions stop and
  // spending is funded by drawing down accounts. Social Security (in today's
  // dollars, inflated to nominal) begins at socialSecurityStartAge.
  retirementAge: 65,
  socialSecurityAnnual: 40000,
  socialSecurityStartAge: 67
};

window.EVENT_TYPES = ['career', 'housing', 'family', 'health', 'purchase', 'market', 'windfall', 'vehicle'];

window.EVENT_TEMPLATES = {
  promotionSenior: {
    name: 'Promoted to Senior SWE',
    type: 'career',
    // Relative raise so it lands correctly whenever it is scheduled.
    effects: { salaryMultiplier: 1.18, bonusPercent: 0.12, rsuAnnualGross: 12500 } // 50k/4yr
  },
  promotionStaff: {
    name: 'Promoted to Staff SWE',
    type: 'career',
    effects: { salaryMultiplier: 1.25, bonusPercent: 0.15, rsuAnnualGross: 25000 } // 100k/4yr
  },
  jobChange: {
    name: 'New Company',
    type: 'career',
    effects: { baseSalary: 210000, signingBonus: 30000, rsuAnnualGross: 50000 } // 200k/4yr
  },
  layoff: {
    name: 'Laid Off',
    type: 'career',
    duration: 1,
    effects: { employed: false, severance: 41250 }, // 3 months salary
    reversal: { employed: true }
  },
  buyHome: {
    name: 'Buy SF Condo',
    type: 'housing',
    effects: {
      homePurchase: { price: 1050000, downPercent: 0.20, rate: 0.065, hoa: 1556, propertyTaxRate: 0.0118, yourShare: 0.25 }
    }
  },
  marriage: {
    name: 'Marriage',
    type: 'family',
    effects: { marriage: { spouseIncome: 100000, weddingCost: 40000 } }
  },
  childBorn: {
    name: 'Child Born',
    type: 'family',
    effects: { child: { annualCost: 20000 } }
  },
  carPurchase: {
    name: 'Buy a Car',
    type: 'vehicle',
    effects: { 
      vehiclePurchase: { 
        price: 45000, 
        insurance: 112, 
        maintenance: 56, 
        fuelType: 'gas', 
        fuel: 150 
      } 
    }
  },
  bearMarket: {
    name: 'Bear Market',
    type: 'market',
    duration: 2,
    effects: { marketReturn: -0.15 } // reverts to the actual market-return setting via snapshot
  },
  bullMarket: {
    name: 'Bull Market',
    type: 'market',
    duration: 3,
    effects: { marketReturn: 0.12 } // reverts to the actual market-return setting via snapshot
  },
  inheritance: {
    name: 'Inheritance',
    type: 'windfall',
    effects: { oneTimeIncomeTaxFree: 200000 } // inheritances are not income-taxed
  },
  sabbatical: {
    name: 'Sabbatical',
    type: 'career',
    duration: 1,
    effects: { employed: false },
    reversal: { employed: true }
  }
};

/**
 * Tax tables (2025). Bracket limits and thresholds are inflation-adjusted at
 * simulation time via a multiplier, so these are the year-0 nominal values.
 */
window.TAX_TABLES = {
  federal: {
    single: [
      { limit: 11925, rate: 0.10 },
      { limit: 48475, rate: 0.12 },
      { limit: 103350, rate: 0.22 },
      { limit: 197300, rate: 0.24 },
      { limit: 250525, rate: 0.32 },
      { limit: 626350, rate: 0.35 },
      { limit: Infinity, rate: 0.37 }
    ],
    married: [
      { limit: 23850, rate: 0.10 },
      { limit: 96950, rate: 0.12 },
      { limit: 206700, rate: 0.22 },
      { limit: 394600, rate: 0.24 },
      { limit: 501050, rate: 0.32 },
      { limit: 751600, rate: 0.35 },
      { limit: Infinity, rate: 0.37 }
    ],
    stdDeduction: { single: 15000, married: 30000 },
    ltcg: {
      single: [
        { limit: 47025, rate: 0.0 },
        { limit: 518900, rate: 0.15 },
        { limit: Infinity, rate: 0.20 }
      ],
      married: [
        { limit: 94050, rate: 0.0 },
        { limit: 583750, rate: 0.15 },
        { limit: Infinity, rate: 0.20 }
      ]
    },
    niitThreshold: { single: 200000, married: 250000 }
  },
  // California FTB brackets. CA has no preferential rate for capital gains.
  california: {
    single: [
      { limit: 10756, rate: 0.01 },
      { limit: 25499, rate: 0.02 },
      { limit: 40245, rate: 0.04 },
      { limit: 55866, rate: 0.06 },
      { limit: 70606, rate: 0.08 },
      { limit: 360659, rate: 0.093 },
      { limit: 432787, rate: 0.103 },
      { limit: 721314, rate: 0.113 },
      { limit: Infinity, rate: 0.123 }
    ],
    married: [
      { limit: 21512, rate: 0.01 },
      { limit: 50998, rate: 0.02 },
      { limit: 80490, rate: 0.04 },
      { limit: 111732, rate: 0.06 },
      { limit: 141212, rate: 0.08 },
      { limit: 721318, rate: 0.093 },
      { limit: 865574, rate: 0.103 },
      { limit: 1442628, rate: 0.113 },
      { limit: Infinity, rate: 0.123 }
    ],
    stdDeduction: { single: 5540, married: 11080 }
  },
  fica: {
    ssWageBase: 176100,
    ssRate: 0.062,
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
    additionalMedicareThreshold: { single: 200000, married: 250000 }
  }
};

/**
 * Helper to perform deep merge on objects.
 */
function deepMerge(target, source) {
  if (typeof target !== 'object' || target === null) return source;
  if (typeof source !== 'object' || source === null) return source;
  
  const output = { ...target };
  Object.keys(source).forEach(key => {
    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
      output[key] = deepMerge(target[key] !== undefined ? target[key] : {}, source[key]);
    } else {
      output[key] = source[key];
    }
  });
  return output;
}

/**
 * Lifetime Net Worth Projection Model
 */
class LifetimeModel {
  /**
   * Create a new LifetimeModel instance.
   * @param {Object} config - Optional configuration object. Deep merges with DEFAULT_CONFIG.
   */
  constructor(config = {}) {
    this.config = deepMerge(window.DEFAULT_CONFIG, config);
    this.events = [];
    this.nextEventId = 1;
  }

  /**
   * Adds an event to the model.
   * @param {Object} event - The event object (must include at least 'yearOffset' or 'age').
   * @returns {number} The auto-incrementing ID of the event.
   */
  addEvent(event) {
    const newEvent = { ...event, id: this.nextEventId++ };
    this.events.push(newEvent);
    this._sortEvents();
    return newEvent.id;
  }

  /**
   * Removes an event from the model by ID.
   * @param {number} id - The event ID.
   */
  removeEvent(id) {
    this.events = this.events.filter(e => e.id !== id);
  }

  /**
   * Updates an existing event.
   * @param {number} id - The event ID.
   * @param {Object} updates - The fields to update.
   */
  updateEvent(id, updates) {
    const idx = this.events.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.events[idx] = deepMerge(this.events[idx], updates);
      this._sortEvents();
    }
  }

  /**
   * Gets a sorted copy of all events.
   * @returns {Array} Array of events.
   */
  getEvents() {
    return [...this.events];
  }

  /**
   * Clears all events.
   */
  clearEvents() {
    this.events = [];
  }

  /**
   * Updates the configuration.
   * @param {Object} partialConfig - Partial configuration to merge.
   */
  updateConfig(partialConfig) {
    this.config = deepMerge(this.config, partialConfig);
  }

  /**
   * Gets a copy of the current configuration.
   * @returns {Object} Configuration object.
   */
  getConfig() {
    return deepMerge({}, this.config);
  }

  _sortEvents() {
    this.events.sort((a, b) => {
      const yearA = a.yearOffset !== undefined ? a.yearOffset : (a.year !== undefined ? a.year : (a.age !== undefined ? a.age - this.config.age : 0));
      const yearB = b.yearOffset !== undefined ? b.yearOffset : (b.year !== undefined ? b.year : (b.age !== undefined ? b.age - this.config.age : 0));
      return yearA - yearB;
    });
  }

  /**
   * Calculates mortgage amortization details for a year.
   * @param {number} principal - Current mortgage principal balance.
   * @param {number} annualRate - Annual interest rate.
   * @param {number} monthlyPayment - The fixed monthly payment.
   * @returns {Object} Object with interest, principalPaid, and newBalance.
   */
  calculateMortgagePayment(principal, annualRate, monthlyPayment) {
    let balance = principal;
    let totalInterest = 0;
    let totalPrincipal = 0;
    
    for (let m = 0; m < 12; m++) {
      if (balance <= 0) break;
      const interest = balance * (annualRate / 12);
      let principalPaid = monthlyPayment - interest;
      
      if (principalPaid > balance) {
        principalPaid = balance;
      }
      
      balance -= principalPaid;
      totalInterest += interest;
      totalPrincipal += principalPaid;
    }
    
    return {
      interest: totalInterest,
      principalPaid: totalPrincipal,
      newBalance: balance
    };
  }

  /**
   * Calculates fixed monthly mortgage payment.
   * @param {number} principal - Loan amount.
   * @param {number} annualRate - Annual interest rate.
   * @param {number} years - Loan term in years.
   * @returns {number} Monthly payment.
   */
  calculateFixedMortgagePayment(principal, annualRate, years) {
    if (annualRate === 0) return principal / (years * 12);
    const r = annualRate / 12;
    const n = years * 12;
    return principal * ((r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
  }

  /**
   * Applies a progressive bracket table to an amount.
   * @param {Array} brackets - [{limit, rate}, ...] with an Infinity-limit top bracket.
   * @param {number} amount - Taxable amount (already net of deductions).
   * @param {number} inflationMultiplier - Scales the (year-0) bracket limits.
   * @returns {number} Tax owed.
   */
  applyBrackets(brackets, amount, inflationMultiplier) {
    if (amount <= 0) return 0;
    let tax = 0;
    let prevLimit = 0;
    for (const bracket of brackets) {
      const limit = bracket.limit === Infinity ? Infinity : bracket.limit * inflationMultiplier;
      if (amount <= prevLimit) break;
      tax += Math.min(amount - prevLimit, limit - prevLimit) * bracket.rate;
      prevLimit = limit;
    }
    return tax;
  }

  /**
   * Federal income tax on an already-taxable amount (deductions removed).
   * Exposed for testing.
   */
  federalTax(taxableAmount, married, yearOffset, inflationRate) {
    const t = window.TAX_TABLES.federal;
    const mult = Math.pow(1 + inflationRate, yearOffset);
    return this.applyBrackets(married ? t.married : t.single, taxableAmount, mult);
  }

  /**
   * Full tax breakdown for a year.
   *
   * Splits income by how it is actually taxed rather than lumping everything
   * together:
   *   - wages / spouseWages: subject to income tax AND FICA. FICA is on the
   *     gross wage (401k/HSA do not reduce it), and each earner gets their own
   *     Social Security wage base.
   *   - otherOrdinaryIncome: income-taxed but not FICA (rental, taxable one-offs).
   *   - taxFreeIncome: excluded entirely (inheritances, gifts, home-sale equity).
   *   - preTaxDeductions: reduce income-taxable ordinary income (401k, HSA)
   *     but never reduce FICA.
   *
   * @returns {{federal:number, state:number, fica:number, total:number}}
   */
  taxBreakdown({ 
    wages = 0, spouseWages = 0, otherOrdinaryIncome = 0, federalOnlyOrdinaryIncome = 0, 
    preTaxDeductions = 0, mortgageInterest = 0, propertyTaxes = 0, realizedLtcg = 0,
    married = false, yearOffset = 0, inflationRate = 0 
  }) {
    const T = window.TAX_TABLES;
    const mult = Math.pow(1 + inflationRate, yearOffset);
    const status = married ? 'married' : 'single';

    // Ordinary income for income-tax purposes
    const ordinaryIncome = Math.max(0, wages + spouseWages + otherOrdinaryIncome - preTaxDeductions);
    const fedOrdinary = ordinaryIncome + Math.max(0, federalOnlyOrdinaryIncome);

    // CA Itemized Deductions
    const caItemized = propertyTaxes + mortgageInterest;
    const caStdDed = T.california.stdDeduction[status] * mult;
    const caDeduction = Math.max(caItemized, caStdDed);
    
    // CA treats LTCG as ordinary income
    const caTaxable = Math.max(0, ordinaryIncome + realizedLtcg - caDeduction);
    const state = this.applyBrackets(T.california[status], caTaxable, mult);

    // Federal Itemized Deductions (SALT capped at $10k)
    const salt = Math.min(propertyTaxes + state, 10000); 
    const fedItemized = salt + mortgageInterest;
    const fedStdDed = T.federal.stdDeduction[status] * mult;
    const fedDeduction = Math.max(fedItemized, fedStdDed);

    let fedTaxableOrdinary = fedOrdinary - fedDeduction;
    let fedLtcg = realizedLtcg;
    
    // If ordinary deductions exceed ordinary income, the excess reduces LTCG
    if (fedTaxableOrdinary < 0) {
       fedLtcg = Math.max(0, fedLtcg + fedTaxableOrdinary);
       fedTaxableOrdinary = 0;
    }

    let federal = this.applyBrackets(T.federal[status], fedTaxableOrdinary, mult);

    // Federal LTCG stacked on top of ordinary income
    if (fedLtcg > 0) {
      let ltcgTax = 0;
      let remainingLtcg = fedLtcg;
      let currentIncome = fedTaxableOrdinary;
      
      for (const bracket of T.federal.ltcg[status]) {
        const limit = bracket.limit === Infinity ? Infinity : bracket.limit * mult;
        if (currentIncome >= limit) continue; 
        
        const roomInBracket = limit - currentIncome;
        const amountToTax = Math.min(remainingLtcg, roomInBracket);
        ltcgTax += amountToTax * bracket.rate;
        
        remainingLtcg -= amountToTax;
        currentIncome += amountToTax;
        
        if (remainingLtcg <= 0) break;
      }
      federal += ltcgTax;
      
      // NIIT (Net Investment Income Tax) 3.8%
      const magi = fedOrdinary + realizedLtcg;
      const niitThreshold = T.federal.niitThreshold[status] * mult;
      if (magi > niitThreshold) {
         const excessMagi = magi - niitThreshold;
         const niitBase = Math.min(fedLtcg, excessMagi);
         federal += niitBase * 0.038;
      }
    }

    // FICA on gross wages
    const ssBase = T.fica.ssWageBase * mult;
    const ss = (Math.min(wages, ssBase) + Math.min(spouseWages, ssBase)) * T.fica.ssRate;
    const totalWages = wages + spouseWages;
    const medicare = totalWages * T.fica.medicareRate;
    const addlThreshold = T.fica.additionalMedicareThreshold[status] * mult;
    const addlMedicare = totalWages > addlThreshold ? (totalWages - addlThreshold) * T.fica.additionalMedicareRate : 0;
    const fica = ss + medicare + addlMedicare;

    return { federal, state, fica, total: federal + state + fica };
  }

  calculateTax(params) {
    return this.taxBreakdown(params).total;
  }

  /**
   * Simulates a drawdown to determine tax consequences without mutating state.
   */
  simulateDrawdown(state, need) {
    if (need <= 0) return { pretaxWithdrawal: 0, realizedLtcg: 0 };
    let remaining = need;
    let pretaxWithdrawal = 0;
    let realizedLtcg = 0;
    
    // Brokerage (LTCG)
    if (state.balances.brokerage > 0) {
      const take = Math.min(state.balances.brokerage, remaining);
      const gainRatio = Math.max(0, (state.balances.brokerage - state.basis.brokerage) / state.balances.brokerage);
      realizedLtcg += take * gainRatio;
      remaining -= take;
    }
    
    // Pretax 401k
    if (remaining > 0 && state.balances.pretax401k > 0) {
      const take = Math.min(state.balances.pretax401k, remaining);
      pretaxWithdrawal += take;
      remaining -= take;
    }
    
    // Traditional IRA
    if (remaining > 0 && state.balances.traditionalIRA > 0) {
      const take = Math.min(state.balances.traditionalIRA, remaining);
      pretaxWithdrawal += take;
      remaining -= take;
    }
    
    return { pretaxWithdrawal, realizedLtcg };
  }

  /**
   * Applies an event to the state.
   */
  applyEvent(state, event, yearOffset) {
    // One-time income split by tax treatment:
    //   wage    - income tax + FICA (severance, signing bonus)
    //   ordinary- income tax only (taxable one-off, e.g. freelance)
    //   taxFree - untaxed (inheritance, gift, home-sale equity)
    let oneTimeWageIncome = 0;
    let oneTimeOrdinaryIncome = 0;
    let oneTimeTaxFreeIncome = 0;
    let oneTimeCost = 0;
    let eventName = event.name || 'Event';
    
    if (event.effects) {
      const effects = event.effects;
      
      // Salary can be set absolutely (baseSalary), scaled (salaryMultiplier,
      // e.g. 1.15 for a 15% raise), or bumped (salaryIncrease). Relative forms
      // avoid the trap where an absolute "promotion" set years out is actually
      // a pay cut once the base has grown. Applied set -> scale -> add.
      if (effects.baseSalary !== undefined) state.salary = effects.baseSalary;
      if (effects.salaryMultiplier !== undefined) state.salary *= effects.salaryMultiplier;
      if (effects.salaryIncrease !== undefined) state.salary += effects.salaryIncrease;
      if (effects.bonusPercent !== undefined) state.bonusPercent = effects.bonusPercent;
      if (effects.rsuAnnualGross !== undefined) state.rsuAnnualGross = effects.rsuAnnualGross;
      if (effects.esppAnnualGain !== undefined) state.esppAnnualGain = effects.esppAnnualGain;
      
      if (effects.employed !== undefined) state.employed = effects.employed;
      if (effects.spouseIncome !== undefined) state.spouseIncome = effects.spouseIncome;
      if (effects.rentalIncome !== undefined) state.rentalIncome = effects.rentalIncome;
      if (effects.marketReturn !== undefined) state.marketReturn = effects.marketReturn;
      if (effects.inflationRate !== undefined) state.inflation = effects.inflationRate;
      
      if (effects.severance) oneTimeWageIncome += effects.severance;
      if (effects.signingBonus) oneTimeWageIncome += effects.signingBonus;
      if (effects.oneTimeIncome) oneTimeOrdinaryIncome += effects.oneTimeIncome;
      if (effects.oneTimeIncomeTaxFree) oneTimeTaxFreeIncome += effects.oneTimeIncomeTaxFree;
      if (effects.oneTimeCost) oneTimeCost += effects.oneTimeCost;
      
      if (effects.expenseChanges) {
        for (const [cat, amt] of Object.entries(effects.expenseChanges)) {
          state.monthlyExpenses[cat] = amt;
        }
      }
      
      if (effects.additionalAnnualExpense) {
        state.additionalAnnualExpenses += effects.additionalAnnualExpense;
      }
      
      if (effects.homePurchase) {
        const p = effects.homePurchase;
        const downPaymentCost = p.price * p.downPercent * p.yourShare;
        oneTimeCost += downPaymentCost;
        state.hasHome = true;
        state.homeShare = p.yourShare;
        state.homeValue = p.price * p.yourShare;
        state.mortgageBalance = (p.price - (p.price * p.downPercent)) * p.yourShare;
        state.mortgageRate = p.rate;
        state.homeHoa = p.hoa * p.yourShare;
        state.homePropTaxRate = p.propertyTaxRate;
        state.mortgagePayment = this.calculateFixedMortgagePayment((p.price - (p.price * p.downPercent)), p.rate, 30) * p.yourShare; // Assuming 30 years
        
        // Update housing expense: Replace old housing expense with HOA + monthly Prop Tax + Mortgage payment
        state.monthlyExpenses.housing = state.mortgagePayment + state.homeHoa + ((p.price * p.propertyTaxRate * p.yourShare) / 12);
      }
      
      if (effects.homeSale) {
        // Your equity = your share of the sale price minus your mortgage
        // balance. A salePrice is the full property price; scale it by your
        // ownership share to match how homeValue/mortgageBalance are tracked.
        // Primary-residence sale proceeds are treated as a tax-free return of
        // equity (the $250k/$500k capital-gains exclusion typically covers the
        // gain for a home held this way).
        const share = state.homeShare || 1;
        const grossValue = effects.homeSale.salePrice !== undefined
          ? effects.homeSale.salePrice * share
          : state.homeValue;
        oneTimeTaxFreeIncome += Math.max(0, grossValue - (state.mortgageBalance || 0));
        state.hasHome = false;
        state.homeValue = 0;
        state.mortgageBalance = 0;
        state.monthlyExpenses.housing = this.config.expenses.housing; // Revert to renting roughly
      }
      
      if (effects.marriage) {
        state.married = true;
        if (effects.marriage.spouseIncome) state.spouseIncome = effects.marriage.spouseIncome;
        if (effects.marriage.weddingCost) oneTimeCost += effects.marriage.weddingCost;
      }
      
      if (effects.child) {
        state.children += 1;
        if (effects.child.annualCost) state.additionalAnnualExpenses += effects.child.annualCost;
      }
      
      if (effects.portfolioImpact) {
        state.balances.brokerage += effects.portfolioImpact;
      }
      
      if (effects.vehiclePurchase) {
        const v = effects.vehiclePurchase;
        oneTimeCost += (v.price || 0); // Assume cash purchase for simplicity
        const ongoingCost = (v.insurance || 0) + (v.maintenance || 0) + (v.fuel || 0);
        state.monthlyExpenses.auto = (state.monthlyExpenses.auto || 0) + ongoingCost;
      }
    }
    
    return { oneTimeWageIncome, oneTimeOrdinaryIncome, oneTimeTaxFreeIncome, oneTimeCost, eventName };
  }

  /**
   * Captures the current value of every state field a duration event's effects
   * will change, so the effect can be undone by restoring the real prior value
   * rather than a hard-coded guess. This keeps reversals correct even when the
   * user has changed an assumption (e.g. a bear market restoring the actual
   * market-return setting, not a baked-in 7%).
   */
  snapshotForReversal(state, effects) {
    if (!effects) return {};
    const R = LifetimeModel.REVERSIBLE;
    const snapshot = {};
    for (const key of Object.keys(effects)) {
      if (R[key]) snapshot[R[key].rev] = R[key].get(state);
    }
    return snapshot;
  }

  /**
   * Reverses an effect from the state by restoring snapshotted values.
   */
  reverseEffect(state, reversal) {
    if (!reversal) return;
    if (reversal.employed !== undefined) state.employed = reversal.employed;
    if (reversal.baseSalary !== undefined) state.salary = reversal.baseSalary;
    if (reversal.bonusPercent !== undefined) state.bonusPercent = reversal.bonusPercent;
    if (reversal.rsuAnnualGross !== undefined) state.rsuAnnualGross = reversal.rsuAnnualGross;
    if (reversal.esppAnnualGain !== undefined) state.esppAnnualGain = reversal.esppAnnualGain;
    if (reversal.spouseIncome !== undefined) state.spouseIncome = reversal.spouseIncome;
    if (reversal.rentalIncome !== undefined) state.rentalIncome = reversal.rentalIncome;
    if (reversal.marketReturn !== undefined) state.marketReturn = reversal.marketReturn;
    if (reversal.inflationRate !== undefined) state.inflation = reversal.inflationRate;
  }

  /**
   * How much of a spending shortfall would come from pre-tax accounts, given a
   * tax-efficient withdrawal order (taxable brokerage first, then pre-tax).
   * Pure - does not mutate. Used to solve the withdrawal/tax fixed point.
   */
  pretaxPortionOfWithdrawal(state, need) {
    if (need <= 0) return 0;
    const afterBrokerage = need - Math.max(0, state.balances.brokerage);
    if (afterBrokerage <= 0) return 0;
    const pretaxAvailable = Math.max(0, state.balances.pretax401k) + Math.max(0, state.balances.traditionalIRA);
    return Math.min(afterBrokerage, pretaxAvailable);
  }

  /**
   * Draws `need` of spendable cash from investment accounts in tax-efficient
   * order: taxable brokerage, then pre-tax (401k, traditional IRA), then Roth,
   * then HSA. Mutates state.balances. If accounts are exhausted the remainder
   * is left as a shortfall (portfolio depleted).
   * @returns {{drawn:number, shortfall:number, taxableWithdrawal:number}}
   */
  drawDown(state, need) {
    let remaining = need;
    let taxableWithdrawal = 0;
    const order = [
      { key: 'brokerage', taxable: false },
      { key: 'pretax401k', taxable: true },
      { key: 'traditionalIRA', taxable: true },
      { key: 'rothAccounts', taxable: false },
      { key: 'hsa', taxable: false }
    ];
    for (const acct of order) {
      if (remaining <= 0) break;
      const bal = state.balances[acct.key];
      if (bal <= 0) continue;
      const take = Math.min(bal, remaining);
      state.balances[acct.key] -= take;
      remaining -= take;
      
      if (acct.taxable) {
         taxableWithdrawal += take;
      }
      
      if (acct.key === 'brokerage') {
         const gainRatio = Math.max(0, (bal - state.basis.brokerage) / bal);
         const realizedGain = take * gainRatio;
         state.basis.brokerage = Math.max(0, state.basis.brokerage - (take - realizedGain));
      }
    }
    return { drawn: need - remaining, shortfall: remaining, taxableWithdrawal };
  }

  /**
   * Runs the simulation.
   * @returns {Array} Array of YearResult objects.
   */
  simulate() {
    const results = [];
    
    // Initialize state
    const state = {
      employed: true,
      married: false,
      children: 0,
      hasHome: false,
      homeValue: 0,
      mortgageBalance: 0,
      mortgageRate: 0,
      homeHoa: 0,
      homePropTaxRate: 0,
      mortgagePayment: 0,
      
      salary: this.config.baseSalary,
      bonusPercent: this.config.bonusPercent,
      rsuAnnualGross: this.config.rsuAnnualGross,
      esppAnnualGain: this.config.esppAnnualGain,
      spouseIncome: this.config.spouseIncome,
      rentalIncome: this.config.rentalIncome,
      
      monthlyExpenses: { ...this.config.expenses },
      additionalAnnualExpenses: 0,
      
      pretax401k: this.config.pretax401k,
      megaBackdoor: this.config.megaBackdoor,
      hsaContrib: this.config.hsaContrib,
      rothIRA: this.config.rothIRA,
      
      inflation: this.config.inflation,
      salaryGrowth: this.config.salaryGrowth,
      marketReturn: this.config.marketReturn,
      realEstateAppreciation: this.config.realEstateAppreciation,
      
      balances: {
        cash: this.config.cash,
        brokerage: this.config.brokerage,
        pretax401k: this.config.pretax401kBal,
        rothAccounts: this.config.rothAccounts,
        traditionalIRA: this.config.traditionalIRA,
        hsa: this.config.hsa
      },
      basis: {
        brokerage: this.config.brokerage
      }
    };

    let activeEffects = [];
    // Cumulative price level relative to year 0. Used to convert nominal
    // figures back to today's dollars for display. Compounds actual per-year
    // inflation, so it stays exact even if an event changes the rate.
    let inflationFactor = 1;

    // Push initial Year 0 snapshot
    let initialHomeEquity = state.hasHome ? (state.homeValue - state.mortgageBalance) : 0;
    let initialNetWorth = state.balances.cash + state.balances.brokerage + state.balances.pretax401k + state.balances.rothAccounts + state.balances.traditionalIRA + state.balances.hsa + initialHomeEquity;
    results.push({
      year: new Date().getFullYear(),
      age: this.config.age,
      yearOffset: 0,
      inflationFactor: 1,
      income: { gross: 0, salary: 0, bonus: 0, rsu: 0, espp: 0, spouse: 0, rental: 0, socialSecurity: 0, oneTime: 0, investment: 0 },
      taxes: 0,
      taxBreakdown: { federal: 0, state: 0, fica: 0, total: 0 },
      shortfall: 0,
      expenses: { total: 0, monthly: 0, oneTime: 0, breakdown: {} },
      savings: { pretax401k: 0, megaBackdoor: 0, rothIRA: 0, hsa: 0, total: 0 },
      netCashFlow: 0,
      balances: { ...state.balances, homeEquity: initialHomeEquity },
      netWorth: initialNetWorth,
      events: [],
      state: { employed: state.employed, retired: false, married: state.married, children: state.children, hasHome: state.hasHome, baseSalary: state.salary }
    });

    // Apply salary growth and expense inflation for year 1
    if (state.employed) {
      state.salary *= (1 + state.salaryGrowth);
    }
    for (const cat in state.monthlyExpenses) {
      if (cat !== 'housing' || !state.hasHome) { // Fixed mortgage payment doesn't inflate
        state.monthlyExpenses[cat] *= (1 + state.inflation);
      }
    }
    if (state.additionalAnnualExpenses > 0) {
      state.additionalAnnualExpenses *= (1 + state.inflation);
    }
    state.pretax401k *= (1 + state.inflation);
    state.megaBackdoor *= (1 + state.inflation);
    state.hsaContrib *= (1 + state.inflation);
    state.rothIRA *= (1 + state.inflation);
    inflationFactor *= (1 + state.inflation);

    for (let yearOffset = 1; yearOffset <= this.config.projectionYears; yearOffset++) {
      const currentYear = new Date().getFullYear() + yearOffset;
      const currentAge = this.config.age + yearOffset;
      const eventsThisYear = [];
      let yearWageIncome = 0;      // one-time wage income (severance, signing) - income tax + FICA
      let yearOrdinaryIncome = 0;  // one-time ordinary income - income tax only
      let yearTaxFreeIncome = 0;   // one-time tax-free income (inheritance, home equity)
      let yearOneTimeCost = 0;
      
      // 1. Reverse expired duration-based effects
      activeEffects = activeEffects.filter(effect => {
        if (effect.endYear <= yearOffset) {
          this.reverseEffect(state, effect.reversal);
          return false;
        }
        return true;
      });
      
      // 2. Apply events for this year
      const matchingEvents = this.events.filter(e => {
        const eYear = e.yearOffset !== undefined ? e.yearOffset : (e.year !== undefined ? e.year : (e.age !== undefined ? e.age - this.config.age : 0));
        return eYear === yearOffset;
      });
      
      for (const event of matchingEvents) {
        // Snapshot the pre-event state for any duration event, so it reverts to
        // the real prior values (explicit event.reversal still merges in for
        // anything the snapshot doesn't cover).
        const reversalSnapshot = event.duration ? this.snapshotForReversal(state, event.effects) : null;

        const r = this.applyEvent(state, event, yearOffset);
        yearWageIncome += r.oneTimeWageIncome;
        yearOrdinaryIncome += r.oneTimeOrdinaryIncome;
        yearTaxFreeIncome += r.oneTimeTaxFreeIncome;
        yearOneTimeCost += r.oneTimeCost;
        eventsThisYear.push(r.eventName);

        if (event.duration) {
          activeEffects.push({
            endYear: yearOffset + event.duration,
            reversal: { ...(event.reversal || {}), ...reversalSnapshot }
          });
        }
      }
      
      // 2b. Retirement: once retired, employment income and contributions stop.
      // Age-based and one-directional (it overrides employment set by events).
      const retired = this.config.retirementAge != null && currentAge >= this.config.retirementAge;
      if (retired) state.employed = false;

      // Social Security: config is in today's dollars, inflated to nominal.
      // Not subject to FICA; up to 85% is federally taxable and none by CA.
      const ssIncome = (this.config.socialSecurityStartAge != null &&
                        currentAge >= this.config.socialSecurityStartAge &&
                        this.config.socialSecurityAnnual > 0)
        ? this.config.socialSecurityAnnual * Math.pow(1 + state.inflation, yearOffset)
        : 0;
      const ssTaxable = 0.85 * ssIncome;

      // 3. Calculate Income
      let salary = 0, bonus = 0, rsuGross = 0, esppGain = 0;
      if (state.employed) {
        salary = state.salary;
        bonus = salary * state.bonusPercent;
        rsuGross = state.rsuAnnualGross;
        esppGain = state.esppAnnualGain;
      }

      // Income grouped by tax treatment (see taxBreakdown).
      const wages = salary + bonus + rsuGross + esppGain + yearWageIncome; // FICA + income tax
      const spouseWages = state.spouseIncome;                              // FICA + income tax (own SS cap)
      const otherOrdinary = state.rentalIncome + yearOrdinaryIncome;       // income tax only
      const yearOneTimeIncome = yearWageIncome + yearOrdinaryIncome + yearTaxFreeIncome;
      const totalGross = wages + spouseWages + otherOrdinary + yearTaxFreeIncome + ssIncome;
      
      // 4. Calculate savings contributions
      let p401k = 0, mBackdoor = 0, hsaC = 0, rIRA = 0;
      if (state.employed) {
        p401k = state.pretax401k;
        mBackdoor = state.megaBackdoor;
        hsaC = state.hsaContrib;
        rIRA = state.rothIRA;
      }
      
      // 5. Expenses
      let baseMonthlyExpenseTotal = 0;
      for (const val of Object.values(state.monthlyExpenses)) {
        baseMonthlyExpenseTotal += val;
      }
      // With a home, housing = mortgage + HOA + property tax (recomputed as the
      // home appreciates); it replaces the rent line.
      if (state.hasHome) {
         state.monthlyExpenses.housing = state.mortgagePayment + state.homeHoa + ((state.homeValue * state.homePropTaxRate) / 12);
         baseMonthlyExpenseTotal = 0;
         for (const val of Object.values(state.monthlyExpenses)) {
            baseMonthlyExpenseTotal += val;
         }
      }
      const annualExpenses = (baseMonthlyExpenseTotal * 12) + state.additionalAnnualExpenses + yearOneTimeCost;

      // 6. Contributions (already zero when not employed) and spendable cash.
      // 401k + HSA are pre-tax for income tax (not FICA). Contributions are
      // diverted to accounts, so they are not available to spend.
      const preTaxDeductions = p401k + hsaC;
      const postTaxSavings = mBackdoor + rIRA;
      const cashInflow = totalGross - preTaxDeductions - postTaxSavings;

      // 7. Grow balances and add contributions. Growth happens before any
      // drawdown so withdrawals come out of post-growth balances.
      const mr = state.marketReturn;
      const investmentGain = (state.balances.pretax401k + state.balances.rothAccounts + state.balances.traditionalIRA + state.balances.hsa + state.balances.brokerage) * mr;
      
      state.balances.pretax401k = state.balances.pretax401k * (1 + mr) + p401k;
      state.balances.rothAccounts = state.balances.rothAccounts * (1 + mr) + postTaxSavings;
      state.balances.traditionalIRA = state.balances.traditionalIRA * (1 + mr);
      state.balances.hsa = state.balances.hsa * (1 + mr) + hsaC;
      state.balances.brokerage = state.balances.brokerage * (1 + mr);

      // 8. Calculate Home Amortization & Taxes (Before full drawdown)
      let mortgageInterest = 0;
      let propertyTaxes = 0;
      if (state.hasHome) {
         propertyTaxes = state.homeValue * state.homePropTaxRate;
         if (state.mortgageBalance > 0) {
            const m = this.calculateMortgagePayment(state.mortgageBalance, state.mortgageRate, state.mortgagePayment);
            const deductibleRatio = Math.min(1, 750000 / Math.max(1, state.mortgageBalance));
            mortgageInterest = m.interest * deductibleRatio;
         }
      }

      // Solve taxes and retirement drawdown together using fixed point.
      let pretaxW = 0;
      let ltcgW = 0;
      const taxParams = (pre, ltcg) => ({
        wages, spouseWages,
        otherOrdinaryIncome: otherOrdinary + pre,
        realizedLtcg: ltcg,
        federalOnlyOrdinaryIncome: ssTaxable,
        preTaxDeductions,
        mortgageInterest, propertyTaxes,
        married: state.married, yearOffset, inflationRate: state.inflation
      });
      
      for (let i = 0; i < 16; i++) {
        const need = annualExpenses + this.calculateTax(taxParams(pretaxW, ltcgW)) - cashInflow;
        const accountsNeed = need - Math.max(0, state.balances.cash);
        const { pretaxWithdrawal, realizedLtcg } = this.simulateDrawdown(state, accountsNeed);
        if (Math.abs(pretaxWithdrawal - pretaxW) < 1 && Math.abs(realizedLtcg - ltcgW) < 1) { 
           pretaxW = pretaxWithdrawal; 
           ltcgW = realizedLtcg;
           break; 
        }
        pretaxW = pretaxWithdrawal;
        ltcgW = realizedLtcg;
      }
      
      const taxBreakdown = this.taxBreakdown(taxParams(pretaxW, ltcgW));
      const taxes = taxBreakdown.total;
      const netCashFlow = cashInflow - taxes - annualExpenses; // negative in retirement

      // 9. Apply the year's cash flow.
      let shortfall = 0;
      if (netCashFlow >= 0) {
        // Surplus builds the cash buffer, overflowing into brokerage above 50k.
        state.balances.cash += netCashFlow;
        if (state.balances.cash > 50000) {
          const surplus = state.balances.cash - 50000;
          state.balances.brokerage += surplus;
          state.basis.brokerage += surplus;
          state.balances.cash = 50000;
        }
      } else {
        // Deficit: spend the cash buffer first, then draw down accounts.
        let need = -netCashFlow;
        const fromCash = Math.min(Math.max(0, state.balances.cash), need);
        state.balances.cash -= fromCash;
        need -= fromCash;
        if (need > 0) shortfall = this.drawDown(state, need).shortfall;
      }

      // 10. Home appreciation & amortization
      let homeEquity = 0;
      if (state.hasHome) {
        state.homeValue *= (1 + state.realEstateAppreciation);
        if (state.mortgageBalance > 0) {
          const amort = this.calculateMortgagePayment(state.mortgageBalance, state.mortgageRate, state.mortgagePayment);
          state.mortgageBalance = amort.newBalance;
        }
        homeEquity = state.homeValue - state.mortgageBalance;
      }
      
      // 11. Net Worth
      const netWorth = state.balances.cash +
                       state.balances.brokerage + 
                       state.balances.pretax401k + 
                       state.balances.rothAccounts + 
                       state.balances.traditionalIRA + 
                       state.balances.hsa + 
                       homeEquity;
                       
      // Create result snapshot
      const yearResult = {
        year: currentYear,
        age: currentAge,
        yearOffset,
        inflationFactor,
        income: {
          gross: totalGross,
          salary,
          bonus,
          rsu: rsuGross,
          espp: esppGain,
          spouse: state.spouseIncome,
          rental: state.rentalIncome,
          socialSecurity: ssIncome,
          oneTime: yearOneTimeIncome,
          investment: investmentGain
        },
        taxes,
        taxBreakdown,
        shortfall,
        expenses: {
          total: annualExpenses,
          monthly: baseMonthlyExpenseTotal,
          oneTime: yearOneTimeCost,
          breakdown: { ...state.monthlyExpenses }
        },
        savings: {
          pretax401k: p401k,
          megaBackdoor: mBackdoor,
          rothIRA: rIRA,
          hsa: hsaC,
          total: p401k + mBackdoor + rIRA + hsaC
        },
        netCashFlow,
        balances: {
          cash: state.balances.cash,
          brokerage: state.balances.brokerage,
          pretax401k: state.balances.pretax401k,
          rothAccounts: state.balances.rothAccounts,
          traditionalIRA: state.balances.traditionalIRA,
          hsa: state.balances.hsa,
          homeEquity
        },
        netWorth,
        events: eventsThisYear,
        state: {
          employed: state.employed,
          retired,
          married: state.married,
          children: state.children,
          hasHome: state.hasHome,
          baseSalary: state.salary
        }
      };
      
      results.push(yearResult);
      
      // 12. Apply salary growth and expense inflation for next year
      if (state.employed) {
        state.salary *= (1 + state.salaryGrowth);
      }
      for (const cat in state.monthlyExpenses) {
        if (cat !== 'housing' || !state.hasHome) { // Fixed mortgage payment doesn't inflate, only HOA and prop tax (handled in loop)
          state.monthlyExpenses[cat] *= (1 + state.inflation);
        }
      }
      if (state.additionalAnnualExpenses > 0) {
        state.additionalAnnualExpenses *= (1 + state.inflation);
      }
      // Contribution limits (401k, mega-backdoor, HSA, Roth IRA) rise with
      // inflation, like the tax brackets. Otherwise a fixed nominal contribution
      // shrinks in real terms over a multi-decade run.
      state.pretax401k *= (1 + state.inflation);
      state.megaBackdoor *= (1 + state.inflation);
      state.hsaContrib *= (1 + state.inflation);
      state.rothIRA *= (1 + state.inflation);
      inflationFactor *= (1 + state.inflation);
    }

    return results;
  }
}

/**
 * Maps an effect key to the reversal key and the state value to snapshot, so a
 * duration event can be undone by restoring the real prior value.
 */
LifetimeModel.REVERSIBLE = {
  baseSalary:       { rev: 'baseSalary',     get: s => s.salary },
  salaryMultiplier: { rev: 'baseSalary',     get: s => s.salary },
  salaryIncrease:   { rev: 'baseSalary',     get: s => s.salary },
  bonusPercent:     { rev: 'bonusPercent',   get: s => s.bonusPercent },
  rsuAnnualGross:   { rev: 'rsuAnnualGross', get: s => s.rsuAnnualGross },
  esppAnnualGain:   { rev: 'esppAnnualGain', get: s => s.esppAnnualGain },
  employed:         { rev: 'employed',       get: s => s.employed },
  spouseIncome:     { rev: 'spouseIncome',   get: s => s.spouseIncome },
  rentalIncome:     { rev: 'rentalIncome',   get: s => s.rentalIncome },
  marketReturn:     { rev: 'marketReturn',   get: s => s.marketReturn },
  inflationRate:    { rev: 'inflationRate',  get: s => s.inflation }
};

window.LifetimeModel = LifetimeModel;

// Expose the engine to the Node test suite without affecting the browser bundle.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LifetimeModel,
    deepMerge,
    DEFAULT_CONFIG: window.DEFAULT_CONFIG,
    EVENT_TYPES: window.EVENT_TYPES,
    EVENT_TEMPLATES: window.EVENT_TEMPLATES
  };
}
