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
  rsuTaxRate: 0.35,
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
  realEstateAppreciation: 0.03
};

window.EVENT_TYPES = ['career', 'housing', 'family', 'health', 'purchase', 'market', 'windfall'];

window.EVENT_TEMPLATES = {
  promotionSenior: {
    name: 'Promoted to Senior SWE',
    type: 'career',
    effects: { baseSalary: 195000, bonusPercent: 0.12, rsuAnnualGross: 12500 } // 50k/4yr
  },
  promotionStaff: {
    name: 'Promoted to Staff SWE',
    type: 'career',
    effects: { baseSalary: 240000, bonusPercent: 0.15, rsuAnnualGross: 25000 } // 100k/4yr
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
    type: 'purchase',
    effects: { oneTimeCost: 45000 }
  },
  bearMarket: {
    name: 'Bear Market',
    type: 'market',
    duration: 2,
    effects: { marketReturn: -0.15 },
    reversal: { marketReturn: 0.07 }
  },
  bullMarket: {
    name: 'Bull Market',
    type: 'market',
    duration: 3,
    effects: { marketReturn: 0.12 },
    reversal: { marketReturn: 0.07 }
  },
  inheritance: {
    name: 'Inheritance',
    type: 'windfall',
    effects: { oneTimeIncome: 200000 }
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
   * Calculates tax liability.
   * @param {number} taxableIncome - The taxable income amount.
   * @param {boolean} married - Filing status.
   * @param {number} yearOffset - Years from start (for inflation).
   * @param {number} inflationRate - Annual inflation rate.
   * @returns {number} Total tax liability.
   */
  calculateTax(taxableIncome, married, yearOffset, inflationRate) {
    if (taxableIncome <= 0) return 0;
    
    const inflationMultiplier = Math.pow(1 + inflationRate, yearOffset);
    
    // 2025 Brackets
    const singleBrackets = [
      { limit: 11600, rate: 0.10 },
      { limit: 47150, rate: 0.12 },
      { limit: 100525, rate: 0.22 },
      { limit: 191950, rate: 0.24 },
      { limit: 243725, rate: 0.32 },
      { limit: 609350, rate: 0.35 },
      { limit: Infinity, rate: 0.37 }
    ];
    
    const marriedBrackets = [
      { limit: 23200, rate: 0.10 },
      { limit: 94300, rate: 0.12 },
      { limit: 201050, rate: 0.22 },
      { limit: 383900, rate: 0.24 },
      { limit: 487450, rate: 0.32 },
      { limit: 731200, rate: 0.35 },
      { limit: Infinity, rate: 0.37 }
    ];
    
    const brackets = married ? marriedBrackets : singleBrackets;
    
    let federalTax = 0;
    let prevLimit = 0;
    
    for (const bracket of brackets) {
      const adjustedLimit = bracket.limit === Infinity ? Infinity : bracket.limit * inflationMultiplier;
      if (taxableIncome > prevLimit) {
        const taxableAmountInBracket = Math.min(taxableIncome - prevLimit, adjustedLimit - prevLimit);
        federalTax += taxableAmountInBracket * bracket.rate;
      } else {
        break;
      }
      prevLimit = adjustedLimit;
    }
    
    // State CA Tax (Effective 9.3%)
    const stateTax = taxableIncome * 0.093;
    
    // FICA
    const ssLimit = 168600 * inflationMultiplier;
    const ssTax = Math.min(taxableIncome, ssLimit) * 0.062;
    const medTax = taxableIncome * 0.0145;
    const addlMedThreshold = 200000 * inflationMultiplier;
    const addlMedTax = taxableIncome > addlMedThreshold ? (taxableIncome - addlMedThreshold) * 0.009 : 0;
    
    return federalTax + stateTax + ssTax + medTax + addlMedTax;
  }

  /**
   * Applies an event to the state.
   */
  applyEvent(state, event, yearOffset) {
    let oneTimeIncome = 0;
    let oneTimeCost = 0;
    let eventName = event.name || 'Event';
    
    if (event.effects) {
      const effects = event.effects;
      
      if (effects.baseSalary !== undefined) state.salary = effects.baseSalary;
      if (effects.bonusPercent !== undefined) state.bonusPercent = effects.bonusPercent;
      if (effects.rsuAnnualGross !== undefined) state.rsuAnnualGross = effects.rsuAnnualGross;
      if (effects.esppAnnualGain !== undefined) state.esppAnnualGain = effects.esppAnnualGain;
      
      if (effects.employed !== undefined) state.employed = effects.employed;
      if (effects.spouseIncome !== undefined) state.spouseIncome = effects.spouseIncome;
      if (effects.rentalIncome !== undefined) state.rentalIncome = effects.rentalIncome;
      if (effects.marketReturn !== undefined) state.marketReturn = effects.marketReturn;
      if (effects.inflationRate !== undefined) state.inflation = effects.inflationRate;
      
      if (effects.severance) oneTimeIncome += effects.severance;
      if (effects.signingBonus) oneTimeIncome += effects.signingBonus;
      if (effects.oneTimeIncome) oneTimeIncome += effects.oneTimeIncome;
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
        oneTimeIncome += (effects.homeSale.salePrice - (state.mortgageBalance || 0));
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
    }
    
    return { oneTimeIncome, oneTimeCost, eventName };
  }

  /**
   * Reverses an effect from the state.
   */
  reverseEffect(state, reversal) {
    if (!reversal) return;
    
    if (reversal.employed !== undefined) state.employed = reversal.employed;
    if (reversal.baseSalary !== undefined) state.salary = reversal.baseSalary;
    if (reversal.marketReturn !== undefined) state.marketReturn = reversal.marketReturn;
    // Add more reverse properties as needed based on duration events
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
      }
    };

    let activeEffects = [];

    for (let yearOffset = 0; yearOffset <= this.config.projectionYears; yearOffset++) {
      const currentYear = new Date().getFullYear() + yearOffset;
      const currentAge = this.config.age + yearOffset;
      const eventsThisYear = [];
      let yearOneTimeIncome = 0;
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
        const { oneTimeIncome, oneTimeCost, eventName } = this.applyEvent(state, event, yearOffset);
        yearOneTimeIncome += oneTimeIncome;
        yearOneTimeCost += oneTimeCost;
        eventsThisYear.push(eventName);
        
        if (event.duration && event.reversal) {
          activeEffects.push({
            endYear: yearOffset + event.duration,
            reversal: event.reversal
          });
        }
      }
      
      // 3. Calculate Income
      let salary = 0, bonus = 0, rsuGross = 0, esppGain = 0;
      if (state.employed) {
        salary = state.salary;
        bonus = salary * state.bonusPercent;
        rsuGross = state.rsuAnnualGross;
        esppGain = state.esppAnnualGain;
      }
      
      const totalGross = salary + bonus + rsuGross + esppGain + state.spouseIncome + state.rentalIncome + yearOneTimeIncome;
      
      // 4. Calculate savings contributions
      let p401k = 0, mBackdoor = 0, hsaC = 0, rIRA = 0;
      if (state.employed) {
        p401k = state.pretax401k;
        mBackdoor = state.megaBackdoor;
        hsaC = state.hsaContrib;
        rIRA = state.rothIRA;
      }
      
      // 5. Calculate taxes
      const preTaxDeductions = p401k + hsaC;
      const taxableIncome = Math.max(0, totalGross - preTaxDeductions);
      const taxes = this.calculateTax(taxableIncome, state.married, yearOffset, state.inflation);
      
      // 6. Calculate expenses
      let baseMonthlyExpenseTotal = 0;
      for (const val of Object.values(state.monthlyExpenses)) {
        baseMonthlyExpenseTotal += val;
      }
      
      // If has home, recalculate housing expense just in case property taxes inflate
      if (state.hasHome) {
         state.monthlyExpenses.housing = state.mortgagePayment + state.homeHoa + ((state.homeValue * state.homePropTaxRate) / 12);
         baseMonthlyExpenseTotal = 0;
         for (const val of Object.values(state.monthlyExpenses)) {
            baseMonthlyExpenseTotal += val;
         }
      }

      const annualExpenses = (baseMonthlyExpenseTotal * 12) + state.additionalAnnualExpenses + yearOneTimeCost;
      
      // 7. Net Cash Flow
      const postTaxTakeHome = taxableIncome - taxes;
      const postTaxSavings = mBackdoor + rIRA;
      const netCashForSpending = postTaxTakeHome - postTaxSavings;
      const netCashFlow = netCashForSpending - annualExpenses;
      
      // 8. Grow balances and add contributions
      const mr = state.marketReturn;
      
      state.balances.pretax401k = state.balances.pretax401k * (1 + mr) + p401k;
      state.balances.rothAccounts = state.balances.rothAccounts * (1 + mr) + postTaxSavings;
      state.balances.traditionalIRA = state.balances.traditionalIRA * (1 + mr);
      state.balances.hsa = state.balances.hsa * (1 + mr) + hsaC;
      
      state.balances.brokerage = state.balances.brokerage * (1 + mr);
      // Net cash flow goes to cash first; overflow to brokerage if cash > 50k
      state.balances.cash += netCashFlow;
      
      if (state.balances.cash > 50000) {
        const overflow = state.balances.cash - 50000;
        state.balances.brokerage += overflow;
        state.balances.cash = 50000;
      } else if (state.balances.cash < 0) {
        const deficit = -state.balances.cash;
        state.balances.brokerage -= deficit;
        state.balances.cash = 0;
        if (state.balances.brokerage < 0) {
          // Debt scenario, allow negative brokerage to simulate debt
        }
      }
      
      // 9. Home appreciation & amortization
      let homeEquity = 0;
      if (state.hasHome) {
        state.homeValue *= (1 + state.realEstateAppreciation);
        if (state.mortgageBalance > 0) {
          const amort = this.calculateMortgagePayment(state.mortgageBalance, state.mortgageRate, state.mortgagePayment);
          state.mortgageBalance = amort.newBalance;
        }
        homeEquity = state.homeValue - state.mortgageBalance;
      }
      
      // 10. Net Worth
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
        income: {
          gross: totalGross,
          salary,
          bonus,
          rsu: rsuGross,
          espp: esppGain,
          spouse: state.spouseIncome,
          rental: state.rentalIncome,
          oneTime: yearOneTimeIncome
        },
        taxes,
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
          married: state.married,
          children: state.children,
          hasHome: state.hasHome,
          baseSalary: state.salary
        }
      };
      
      results.push(yearResult);
      
      // 11. Apply salary growth and expense inflation for next year
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
    }
    
    return results;
  }
}

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
