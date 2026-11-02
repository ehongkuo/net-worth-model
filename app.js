"use strict";
const $ = (id) => document.getElementById(id);
const { escape, money } = Util;
const KEY = "netWorthModel:scenario:v3",
  BACKUP = "netWorthModel:legacy-backup";
let scenario,
  result,
  view = "monthly",
  drafts = [],
  fieldConfig,
  profileStep = 0,
  showLearned = false,
  keptValues = [],
  grantTimelineAnnual = false;
const get = (object, path) => path.split(".").reduce((v, k) => v?.[k], object);
function set(object, path, value) {
  const keys = path.split(".");
  let o = object;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}
function table(headers, rows) {
  return `<table><thead><tr>${headers.map((x) => `<th>${escape(x)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
// Paths already drawn in the current form render; each field appears once.
let shownPaths = null;
function field(path, label, type = "number", hint = "", { also = [] } = {}) {
  if (shownPaths?.has(path)) return "";
  const enginePath = path.startsWith("employerPlan.")
    ? path.slice(13)
    : path.startsWith("taxProfile.settings.")
      ? "tax." + path.slice(20)
      : null;
  if (
    enginePath &&
    fieldConfig &&
    !compensationFieldVisible(fieldConfig, enginePath)
  )
    return "";
  const source = scenario.uploads.fieldSources?.[path];
  const election = path.startsWith("uploads.elections.")
    ? scenario.uploads.elections[path.split(".")[2]]
    : null;
  const manual =
    election?.manual || scenario.uploads.manualFields?.includes(path);
  const provenance = manual
    ? "Your override"
    : source
      ? `${source.basis}. From ${source.sourceDate} paycheck.`
      : election?.sourceDate
        ? `From ${election.sourceDate} paycheck. ${election.mode === "percent" ? "Inferred from base salary plus bonus when configured eligible." : "Observed amount per paycheck."}`
        : "";
  const sourceInfo = provenance
    ? `<details class="field-source" data-key="source:${path}"><summary>Source</summary>${escape(provenance)}</details>`
    : "";
  shownPaths?.add(path);
  const value = get(scenario, path),
    attrs = `data-path="${path}" data-type="${type}"${also.length ? ` data-also="${also.join(",")}"` : ""}`;
  const state = Profile.fieldState(scenario, path);
  const { badge, approve } = Presentation.fieldBadge(state, path, label);
  if (type === "check")
    return `<div class="profile-cell state-${state.kind}"><label class="check">${badge}<input ${attrs} type="checkbox" ${value ? "checked" : ""}>${escape(label)}${hint ? `<small>${escape(hint)}</small>` : ""}</label>${sourceInfo}${approve}</div>`;
  const choices = Array.isArray(type) ? type : null;
  const control = choices
    ? `<select ${attrs}>${value == null || value === "" ? '<option value="" selected disabled>Choose</option>' : ""}${choices
        .map((v) => {
          const [key, text] = Array.isArray(v) ? v : [v, v];
          return `<option value="${key}" ${String(value) === String(key) ? "selected" : ""}>${escape(text)}</option>`;
        })
        .join("")}</select>`
    : `<input ${attrs} type="${["date", "text"].includes(type) ? type : "number"}" step="any" value="${escape(Profile.displayValue(value, type === "number" && /(?:^taxProfile\.(?:year|age)$|\.(?:years|retirementAge|socialSecurityStartAge|eligibleMonths|periodMonths|holdMonths|cliff|interval|shareCap)$)/.test(path) ? "count" : type))}">`;
  return `<div class="profile-cell state-${state.kind}"><label class="field">${badge}<span>${escape(label)}${type === "percent" ? " (%)" : ""}</span>${control}${hint ? `<small>${escape(hint)}</small>` : ""}</label>${sourceInfo}${approve}</div>`;
}
const group = (title, body, open = false) =>
  `<details ${open ? "open" : ""}><summary>${escape(title)}</summary><div class="field-grid">${body}</div></details>`;
// Keeps a toggle beside the inputs it controls under a call-site title.
const choices = (title, body) =>
  body
    ? `<fieldset class="choice-group"><legend>${escape(title)}</legend>${body}</fieldset>`
    : "";
const compactGroup = (title, body) =>
  `<section class="paycheck-group"><h3>${escape(title)}</h3><div class="field-grid">${body}</div></section>`;
// Re-renders the profile form; keeps keyboard focus on the same field.
function setup() {
  Util.preserveFocus($("setup"), renderSetup);
}
// Questions shown on the quick screen this session; answered ones stay in place
// so the form doesn't jump while the user works through it.
const quickAsked = new Set();
function quickQuestions() {
  for (const m of Presentation.missing(scenario)) quickAsked.add(m.id);
  const why = Object.fromEntries(
    Presentation.missing(scenario).map((m) => [m.id, m.why]),
  );
  const espp = scenario.employerPlan.espp;
  const items = {
    spending: [
      "Monthly spending",
      field(
        "projection.monthlyExpenses.other",
        "About how much you spend per month",
        "number",
        "Rent, food, travel and everything not taken out of your paycheck. Saved as Other spending; if you add categories later, lower Other by what you move into them.",
      ),
    ],
    balances: [
      "What you already have",
      field("projection.startingBalances.cash", "Cash and savings") +
        field("projection.startingBalances.brokerage", "Taxable investments") +
        field("projection.startingBalances.pretax401k", "Traditional 401(k)") +
        field("projection.startingBalances.rothAccounts", "Roth accounts") +
        field("projection.startingBalances.traditionalIRA", "Traditional IRA") +
        field("projection.startingBalances.hsa", "HSA"),
    ],
    age: ["Your age", field("taxProfile.age", "Age today")],
    filing: [
      "Filing status",
      field("taxProfile.settings.filing", "How you file taxes", [
        ["single", "Single"],
        ["married", "Married filing jointly"],
      ]),
    ],
    state: [
      "State income tax",
      field("taxProfile.settings.state", "Where you pay income tax", [
        ["CA", "California"],
        ["none", "A state with no income tax"],
        ["custom", "Another state (effective rate)"],
      ]) +
        field(
          "taxProfile.settings.customStateRate",
          "State effective rate",
          "percent",
        ),
    ],
    spouse: [
      "Spouse income",
      field("taxProfile.settings.spouseIncome", "Spouse's annual wages"),
    ],
    hsa: [
      "HSA coverage",
      field("employerPlan.hsa.coverage", "Your HSA health plan covers", [
        ["single", "Just me (self-only)"],
        ["family", "Me and family"],
      ]),
    ],
    espp: espp.enabled
      ? [
          "ESPP",
          field(
            "employerPlan.espp.offerPrice",
            "Company share price today",
            "number",
            "A starting estimate for the offering, purchase and sale prices. Set the offering-start price and expected prices separately under Complete the picture when you know them.",
            {
              also: [
                "employerPlan.espp.purchasePrice",
                "employerPlan.espp.salePrice",
              ],
            },
          ) +
            field(
              "employerPlan.espp.start",
              "Current offering started",
              "date",
            ) +
            field("employerPlan.espp.periodMonths", "Months per offering"),
        ]
      : null,
  };
  const html = [...quickAsked]
    .filter((id) => items[id])
    .map(
      (id) =>
        `<section class="quick-question"><h3>${escape(items[id][0])}</h3>${why[id] ? `<p class="cf-note">${escape(why[id])}</p>` : '<p class="cf-note quick-done">Answered</p>'}<div class="field-grid">${items[id][1]}</div></section>`,
    )
    .join("");
  return html
    ? `<h2>A few things your paystub can't tell us</h2>${html}`
    : '<h2>About you</h2><p class="cf-note">Your paystub and answers cover everything the model needs.</p>';
}
function renderSetup() {
  shownPaths = new Set();
  try {
    renderSetupForm();
  } finally {
    // A failed render must not leave later fields hidden.
    shownPaths = null;
  }
}
function renderSetupForm() {
  fieldConfig = Scenario.engineInput(scenario);
  const quick = quickQuestions();
  const t = "taxProfile.",
    r = "employerPlan.retirement.",
    h = "employerPlan.hsa.",
    e = "employerPlan.espp.",
    c = "compensation.",
    p = "projection.";
  const plan = scenario.employerPlan,
    limits = TaxEngine.limits(
      scenario.taxProfile.year,
      scenario.taxProfile.settings,
    );
  const tax =
    field(t + "year", "Starting tax year") +
    field(t + "age", "Age at start of projection") +
    field(t + "settings.filing", "Filing status", [
      ["single", "Single"],
      ["married", "Married filing jointly"],
    ]) +
    field(t + "settings.state", "State tax model", [
      ["CA", "California"],
      ["none", "No state income tax"],
      ["custom", "Other state (effective rate)"],
    ]) +
    (scenario.taxProfile.settings.state === "custom"
      ? field(t + "settings.customStateRate", "State effective rate", "percent")
      : "") +
    field(
      t + "settings.localRate",
      "City or local income tax rate",
      "percent",
      "Effective rate for city, county or school income tax (e.g. NYC); 0 if none",
    ) +
    `<p class="cf-note">${limits.year} limits: employee 401(k) ${money(limits.deferral)}, total plan ${money(limits.total401k)}, IRA ${money(limits.ira)}. Catch-up eligibility is applied by age.</p>` +
    group(
      "Additional tax information",
      field(t + "settings.spouseIncome", "Spouse annual wages") +
        field(t + "settings.otherIncome", "Other annual ordinary income") +
        field(
          t + "settings.federalDeduction",
          "Federal itemized deduction (0 uses standard)",
        ) +
        field(t + "settings.stateDeduction", "State deduction override") +
        field(t + "settings.federalCredits", "Federal credits") +
        field(t + "settings.stateCredits", "State credits") +
        field(
          t + "settings.estimatedPayments",
          "Annual estimated tax payments",
        ) +
        field(t + "settings.capitalLossCarry", "Capital loss carryforward"),
    );
  // Settings that describe the model rather than the user, gathered in one
  // collapsed group so setup never asks for them.
  const modelAssumptions = group(
    "Model assumptions",
    field(p + "years", "Projection years") +
      field(p + "inflation", "Annual inflation", "percent") +
      field(p + "marketReturn", "Annual nominal investment return", "percent") +
      field(c + "salaryGrowth", "Annual salary growth", "percent") +
      field(c + "stockGrowth", "Annual company stock growth", "percent") +
      field(t + "settings.limitGrowth", "Future IRS limit growth", "percent") +
      field(
        t + "settings.bracketGrowth",
        "Future tax bracket growth",
        "percent",
      ) +
      field(
        t + "settings.caGrowth2026",
        "California 2026 bracket adjustment",
        "percent",
      ) +
      choices(
        "Your W-4 (optional)",
        field(t + "settings.withholdingMethod", "Forecast withholding", [
          ["annual-estimate", "Estimated annual tax"],
          ["w4", "W-4 payroll method"],
        ]) +
          field(t + "settings.w4Credits", "W-4 annual credits") +
          field(t + "settings.w4OtherIncome", "W-4 other income") +
          field(t + "settings.w4Deductions", "W-4 deductions") +
          field(t + "settings.w4MultipleJobs", "W-4 multiple jobs", "check"),
      ),
  );
  const electionField = (key) => {
    const v = scenario.uploads.elections[key];
    return v
      ? field(
          `uploads.elections.${key}.value`,
          `${PaystubParser.labels[key]} (${v.mode === "percent" ? "of eligible pay" : "per paycheck"})`,
          v.mode === "percent" ? "percent" : "number",
        )
      : "";
  };
  const funding = Profile.employerFunding(scenario, result?.rows[1]?.payroll);
  const fundingSummary = `<div class="funding-summary"><h3>Employer retirement funding</h3>${table(["Reported YTD", "Projected remaining", "Projected annual total"], [[funding.ytd == null ? "No YTD uploaded" : money(funding.ytd), money(funding.remaining), money(funding.total)]])}<p class="cf-note">${funding.date ? `YTD through ${escape(funding.date)}. ` : ""}Reported YTD is already included in the projection. An annual target or matching rule sets expected future funding.</p></div>`;
  const retirement =
    fundingSummary +
    ["traditional", "roth", "mega"].map(electionField).join("") +
    field(
      r + "employerAnnual",
      "Fixed annual employer funding (excluding formula match)",
    ) +
    field(
      r + "matchPercent",
      "Match applies to the first portion of pay",
      "percent",
    ) +
    field(
      r + "matchRate",
      "Employer pays this portion of matched contributions",
      "percent",
    ) +
    choices(
      "After-tax 401(k)",
      field(r + "megaEnabled", "After-tax retirement contributions", "check") +
        (plan.retirement.megaEnabled
          ? field(
              r + "megaAnnualCap",
              "Employer annual mega backdoor cap",
              "number",
              "Blank means no employer cap beyond IRS limits.",
            )
          : ""),
    ) +
    choices(
      "IRA contributions",
      field(r + "iraMode", "IRA strategy", [
        ["backdoor", "Backdoor Roth IRA"],
        ["roth", "Direct Roth IRA"],
        ["traditional", "Traditional IRA"],
      ]) +
        field(r + "maxIra", "Maximize annual IRA contribution", "check") +
        (!plan.retirement.maxIra
          ? field(r + "ira", "Annual IRA contribution")
          : "") +
        (plan.retirement.iraMode === "backdoor"
          ? field(
              r + "iraPretaxBalance",
              "Other pre-tax IRA balance",
              "number",
              "Starting Traditional IRA balances also enter the pro-rata calculation.",
            ) + field(r + "iraBasis", "Existing nondeductible IRA basis")
          : ""),
    );
  const hsa =
    electionField("hsa") +
    choices(
      "HSA eligibility & funding",
      field(h + "eligible", "HSA eligible", "check") +
        (plan.hsa.eligible
          ? field(h + "coverage", "HSA coverage", [
              ["single", "Self-only"],
              ["family", "Family"],
            ]) +
            (Profile.describe(scenario).last?.current.hsaEmployer != null
              ? `<p class="cf-note">Employer HSA funding: ${money(Profile.describe(scenario).last.current.hsaEmployer)} per paycheck, from your upload.</p>`
              : field(h + "employer", "Annual employer HSA contribution")) +
            field(h + "eligibleMonths", "Eligible months")
          : ""),
    );
  const espp =
    choices(
      "Participation",
      field(e + "enabled", "Participate in ESPP", "check") +
        (plan.espp.enabled
          ? // A per-paycheck dollar election from a paystub drives payroll; the
            // percent rate only applies when the election is a percentage.
            (scenario.uploads.elections.espp &&
            scenario.uploads.elections.espp.mode !== "percent"
              ? field(
                  "uploads.elections.espp.value",
                  "ESPP contribution per paycheck",
                )
              : field(e + "rate", "Payroll contribution", "percent")) +
            field(
              e + "bonusEligible",
              "Include bonus in eligible ESPP pay",
              "check",
            )
          : ""),
    ) +
    (plan.espp.enabled
      ? choices(
          "Offerings",
          field(e + "start", "First offering start", "date") +
            field(e + "end", "First offering end (optional)", "date") +
            field(e + "periodMonths", "Months per offering") +
            field(
              e + "autoEnroll",
              "Automatically enroll in subsequent offerings",
              "check",
            ) +
            field(
              e + "firstEnrollmentDate",
              "First offering you participate in (optional)",
              "date",
            ),
        ) +
        choices(
          "Purchase rules",
          field(e + "discount", "Purchase discount", "percent") +
            field(
              e + "lookback",
              "Use lower of offering and purchase price",
              "check",
            ) +
            field(e + "offerPrice", "Offering share price") +
            field(e + "purchasePrice", "Expected purchase-date share price") +
            field(
              e + "shareCap",
              "Maximum shares per offering (0 means none)",
            ) +
            field(
              e + "annualPayrollCap",
              "Employer annual payroll cap (0 means none)",
            ) +
            field(
              e + "annualFmvLimit",
              "Qualified-plan annual grant-date value limit",
            ) +
            field(e + "fractional", "Allow fractional shares", "check"),
        ) +
        choices(
          "After purchase",
          field(e + "holdShares", "Hold purchased shares", "check") +
            (!plan.espp.holdShares
              ? field(e + "salePrice", "Expected sale price") +
                field(e + "holdMonths", "Months until sale")
              : ""),
        )
      : "");
  const fallback =
    choices(
      "401(k) elections",
      field(r + "max401k", "Maximize employee 401(k)", "check") +
        (!plan.retirement.max401k
          ? field(r + "traditional", "Annual Traditional 401(k) election")
          : "") +
        field(r + "roth", "Annual Roth 401(k) election"),
    ) +
    (plan.retirement.megaEnabled
      ? choices(
          "Mega backdoor election",
          field(r + "maxMega", "Maximize mega backdoor", "check") +
            (!plan.retirement.maxMega
              ? field(r + "mega", "Annual mega backdoor election")
              : ""),
        )
      : "") +
    choices(
      "HSA election",
      field(h + "maxContribution", "Maximize employee HSA", "check") +
        (!plan.hsa.maxContribution
          ? field(h + "employee", "Annual employee HSA contribution")
          : ""),
    );
  const grants = scenario.compensation.grants
    .map((g, i) =>
      group(
        g.name || `Grant ${i + 1}`,
        field(c + `grants.${i}.name`, "Grant name", "text") +
          field(c + `grants.${i}.value`, "Total grant value") +
          field(c + `grants.${i}.grantPrice`, "Grant-date share price") +
          field(c + `grants.${i}.vestPrice`, "Assumed vest-date share price") +
          choices(
            "Vesting schedule",
            field(c + `grants.${i}.start`, "Grant date", "date") +
              field(
                c + `grants.${i}.months`,
                "Vesting duration (years)",
                "years",
              ) +
              field(
                c + `grants.${i}.evenVesting`,
                "Even vesting schedule",
                "check",
              ) +
              `<label class="profile-cell"><span>Annual allocations (%)</span><input data-grant-allocation="${i}" value="${EquitySchedule.allocations(
                g,
              )
                .map((x) => Number(x.toFixed(6)))
                .join(
                  " / ",
                )}" ${g.evenVesting !== false ? "readonly" : ""} aria-label="Annual allocations for ${escape(g.name)}"><small>${g.evenVesting !== false ? "Calculated from the vesting duration." : "One percentage per grant year, separated by /. Must total 100%."}</small></label>` +
              field(c + `grants.${i}.cliff`, "Cliff (months)") +
              field(c + `grants.${i}.interval`, "Vesting interval (months)") +
              field(c + `grants.${i}.repeat`, "Repeat grant annually", "check"),
          ) +
          field(c + `grants.${i}.saleMode`, "At vest", [
            ["cover", "Sell to cover taxes"],
            ["hold", "Hold all shares"],
            ["sell", "Sell all shares"],
          ]) +
          (() => {
            const v = Profile.grantPreview(g),
              pace = EquitySchedule.pace(
                g,
                EquitySchedule.asOf(scenario.taxProfile.year),
              );
            return `<div class="grant-preview"><h3>Current earning pace: ${money(pace.monthlyMarket)}/month</h3><p class="cf-note">${pace.phase ? `Grant year ${pace.phase} · next change ${pace.nextChange}` : "Outside this grant’s earning period"}. Earning pace spreads the current grant-year allocation evenly; scheduled vests remain dated below.</p><details data-key="first-vest:${i}"><summary>First vest · ${escape(v.date)}</summary>${table(["Grant duration", "Shares vesting", "Value at grant price", "Estimated market value"], [[`${v.years} years`, v.shares.toLocaleString("en-US", { maximumFractionDigits: 4 }), money(v.grantValue), money(v.marketValue)]])}<p class="cf-note">Pre-tax values for the first vest, not a monthly average. Market value uses your assumed vest price.</p></details></div>`;
          })() +
          `<button data-remove-grant="${i}">Remove grant</button>`,
      ),
    )
    .join("");
  // Salary, pay frequency and payday live with the paychecks (step 2) only.
  const compensation =
    field(c + "bonusPercent", "Bonus target", "percent") +
    field(
      c + "bonusMonth",
      "Bonus month",
      Array.from({ length: 12 }, (_, i) => [
        i + 1,
        new Date(2026, i, 1).toLocaleString("en-US", { month: "long" }),
      ]),
    ) +
    `<div id="grant-timeline" class="grant-preview"></div>` +
    grants +
    '<button id="add-grant">Add RSU grant</button>';
  const planElections = ["traditional", "roth", "mega", "hsa", "espp"];
  const elections = Object.entries(scenario.uploads.elections)
    // Plan elections are edited in their plan sections (401(k), HSA, ESPP).
    .filter(([key]) => !planElections.includes(key))
    .map(([key, v]) =>
      field(
        `uploads.elections.${key}.value`,
        `${PaystubParser.labels[key]} (${v.mode === "percent" ? "percent of eligible wages" : "per paycheck"})`,
        v.mode === "percent" ? "percent" : "number",
      ),
    )
    .join("");
  const uploads =
    `<p class="cf-note">Review extracted amounts before saving. Documents stay on this device.</p><label class="button">Read paystub PDFs<input id="paystubs" type="file" accept="application/pdf" multiple hidden></label><p>${scenario.uploads.records.length} saved paycheck observations</p><div id="upload-status" role="status"></div><div id="upload-review"></div>${Profile.describe(
      scenario,
    )
      .questions.filter((q) => q.id === "schedule")
      .map((q) => `<p class="plan-review-note">${escape(q.why)}</p>`)
      .join("")}` +
    compactGroup(
      "Salary & pay schedule",
      field(c + "salary", "Annual base salary") +
        field(c + "frequency", "Pay frequency", [
          ["biweekly", "Every two weeks"],
          ["semimonthly", "Twice monthly"],
          ["monthly", "Monthly"],
          ["weekly", "Weekly"],
        ]) +
        field(c + "firstPayday", "A recent payday", "date"),
    ) +
    (elections
      ? compactGroup("Other recurring paycheck items", elections)
      : "") +
    (scenario.uploads.records.length
      ? ""
      : compactGroup(
          "Contributions & benefits without a paystub",
          fallback +
            Object.entries({
              health: "Monthly health premium",
              dental: "Monthly dental premium",
              vision: "Monthly vision premium",
              fsa: "Monthly FSA contribution",
              otherPretax: "Other monthly pre-tax benefits",
              otherPosttax: "Other monthly post-tax benefits",
            })
              .map(([key, label]) =>
                field("employerPlan.benefits." + key, label),
              )
              .join(""),
        )) +
    (PaystubParser.benefitPlans(scenario.uploads.records).length
      ? compactGroup(
          "Benefits from paychecks",
          table(
            ["Benefit", "Category", "Amount per occurrence", "Schedule"],
            PaystubParser.benefitPlans(scenario.uploads.records).map((b) => [
              b.label,
              PaystubParser.labels[b.category],
              money(b.current),
              b.schedule,
            ]),
          ),
        )
      : "") +
    (scenario.uploads.records.length
      ? compactGroup(
          "Saved paychecks",
          table(
            ["Date", "Kind", "Net pay"],
            scenario.uploads.records.map((x) => [
              x.date,
              x.kind,
              money(x.netPay),
            ]),
          ),
        )
      : "");
  const balances = Object.entries({
    cash: "Cash",
    brokerage: "Taxable investments",
    pretax401k: "Traditional 401(k)",
    rothAccounts: "Roth accounts",
    traditionalIRA: "Traditional IRA (included in backdoor pro-rata tax)",
    hsa: "HSA",
  })
    .map(([key, label]) => field(p + "startingBalances." + key, label))
    .join("");
  const expenses = Object.keys(scenario.projection.monthlyExpenses)
    .map((key) =>
      field(p + "monthlyExpenses." + key, key[0].toUpperCase() + key.slice(1)),
    )
    .join("");
  const projection =
    field(p + "retirementAge", "Retirement age") +
    field(p + "socialSecurityAnnual", "Annual Social Security benefit") +
    field(p + "socialSecurityStartAge", "Social Security start age") +
    group("Starting balances", balances) +
    group(
      "Monthly living expenses",
      (scenario.projection.monthlyExpenses.other > 0 &&
      Object.entries(scenario.projection.monthlyExpenses).some(
        ([key, v]) => key !== "other" && v > 0,
      )
        ? '<p class="plan-review-note">Your spending total is saved as Other (under About you, or below). Lower it by the amounts you entered in other categories so nothing is counted twice.</p>'
        : "") + expenses,
    ) +
    modelAssumptions;
  const review = Profile.describe(scenario).questions;
  const section = (id, title, body, questionIds = []) => {
    const notes = review.filter((q) => questionIds.includes(q.id));
    return `<section class="plan-section" id="plan-${id}"><div class="plan-section-heading"><h3>${escape(title)}</h3>${notes.length ? '<span class="context-chip">Review plan details</span>' : ""}</div>${notes.map((q) => `<p class="plan-review-note">${escape(q.why)}</p>`).join("")}<div class="field-grid">${body}</div></section>`;
  };
  const detailKey = (x) =>
    x.dataset.key || x.querySelector("summary").textContent;
  const open = new Set(
    [...$("setup").querySelectorAll("details[open]")].map(detailKey),
  );
  $("setup").innerHTML =
    `<div data-profile-step="1" class="profile-panel">${quick}<h2>Tax details</h2>${tax}</div>` +
    `<div data-profile-step="0" class="profile-panel"><h2>Paychecks</h2><p>Choose your latest regular paycheck. Two consecutive checks help us identify your pay schedule.</p>${uploads}</div>` +
    `<div data-profile-step="2" class="profile-panel plan-panel"><div class="plan-sections">` +
    section("retirement", "Retirement & IRA", retirement, [
      "mega",
      "employer",
    ]) +
    section("hsa", "HSA", hsa, ["hsa"]) +
    section("espp", "ESPP", espp, ["espp"]) +
    section("compensation", "Pay & stock grants", compensation, ["allowance"]) +
    section(
      "projection",
      "Lifetime & spending",
      '<p class="cf-note">Expenses exclude benefits already deducted from pay.</p>' +
        projection,
    ) +
    `</div></div>`;
  $("setup")
    .querySelectorAll("details")
    .forEach((x) => (x.open = open.has(detailKey(x))));
  $("setup")
    .querySelectorAll(".field-grid")
    .forEach((grid) => {
      const cells = [...grid.children].filter((el) =>
        el.classList.contains("profile-cell"),
      );
      cells.sort(
        (a, b) =>
          Number(b.classList.contains("state-review")) -
          Number(a.classList.contains("state-review")),
      );
      grid.replaceChildren(
        ...[...grid.children].map((el) =>
          el.classList.contains("profile-cell") ? cells.shift() : el,
        ),
      );
    });
  $("setup")
    .querySelectorAll("details")
    .forEach((section) => {
      const count = section.querySelectorAll(".state-review").length;
      if (count) section.querySelector("summary").dataset.reviewCount = count;
    });
  $("setup")
    .querySelectorAll("[data-confirm]")
    .forEach((button) => {
      button.onclick = () => {
        const next = structuredClone(scenario);
        Profile.confirm(next, button.dataset.confirm);
        commit(next);
      };
    });
  $("setup")
    .querySelectorAll("[data-path]")
    .forEach(
      (el) =>
        (el.onchange = () =>
          deferUntilFocusMoves(() => {
            const next = structuredClone(scenario),
              kind = el.dataset.type;
            const value =
              kind === "check"
                ? el.checked
                : el.tagName === "SELECT" || ["date", "text"].includes(kind)
                  ? el.dataset.path === "compensation.bonusMonth"
                    ? Number(el.value)
                    : el.value
                  : el.value === ""
                    ? null
                    : (Number(el.value) * (kind === "years" ? 12 : 1)) /
                      (kind === "percent" ? 100 : 1);
            // One answer can fill related fields (e.g. one share price), but
            // never a value the user set or confirmed, and the copies stay
            // unmarked so later uploads or edits can still fill them.
            const locked = Profile.lockedPaths(scenario);
            Profile.edit(next, el.dataset.path, value);
            for (const path of (el.dataset.also || "")
              .split(",")
              .filter((p) => p && !locked.includes(p)))
              set(next, path, value);
            commit(next);
          })),
    );
  GrantTimeline.render(
    $("grant-timeline"),
    scenario.compensation.grants,
    EquitySchedule.asOf(scenario.taxProfile.year),
    grantTimelineAnnual,
    (annual) => {
      grantTimelineAnnual = annual;
      setup();
    },
  );
  $("setup")
    .querySelectorAll("[data-grant-allocation]")
    .forEach((el) => {
      el.oninput = () => el.setCustomValidity("");
      el.onchange = () =>
        deferUntilFocusMoves(() => {
          const next = structuredClone(scenario),
            index = Number(el.dataset.grantAllocation);
          const values = el.value
            .split("/")
            .map((x) => (x.trim() === "" ? NaN : Number(x.trim())));
          next.compensation.grants[index].annualAllocations = values;
          try {
            EquitySchedule.allocations(next.compensation.grants[index]);
          } catch (error) {
            el.setCustomValidity(error.message);
            el.reportValidity();
            return;
          }
          Profile.edit(
            next,
            `compensation.grants.${index}.annualAllocations`,
            values,
          );
          commit(next);
        });
    });
  $("add-grant").onclick = () => {
    const next = structuredClone(scenario);
    next.compensation.grants.push({
      name: "New grant",
      value: 0,
      grantPrice: 100,
      vestPrice: 100,
      start: `${next.taxProfile.year}-01-01`,
      months: 48,
      cliff: 12,
      interval: 3,
      saleMode: "cover",
      repeat: false,
    });
    commit(next);
  };
  $("setup")
    .querySelectorAll("[data-remove-grant]")
    .forEach(
      (el) =>
        (el.onclick = () => {
          const next = structuredClone(scenario);
          next.compensation.grants.splice(Number(el.dataset.removeGrant), 1);
          commit(next);
        }),
    );
  $("paystubs").onchange = readPaystubs;
  renderProfile();
}
// A field's change event fires while Tab or a click is still moving focus
// (activeElement is <body>). Re-render after focus lands so setup() can
// restore it to the field the user moved to.
const deferUntilFocusMoves = (fn) => setTimeout(fn);
function commit(next) {
  try {
    const normalized = Scenario.normalize(next),
      computed = Projection.calculate(normalized);
    localStorage.setItem(KEY, Scenario.serialize(normalized));
    scenario = normalized;
    result = computed;
    $("status").textContent = "";
    setup();
    render();
  } catch (error) {
    $("status").textContent = `Changes were not applied: ${error.message}`;
    setup();
  }
}
const modelNotesDisclosure = (html) =>
  html
    ? `<details class="context-help"><summary>Model notes</summary>${html}</details>`
    : "";
function render() {
  const ready = Profile.hasIncome(scenario);
  $("attention").replaceChildren();
  $("attention").hidden = true;
  $("accuracy").hidden = true;
  if (!ready && !["profile", "welcome"].includes(view)) view = "welcome";
  if (ready && view === "welcome") view = "monthly";
  for (const name of ["welcome", "profile", "monthly", "tax", "lifetime"])
    $(name).hidden = name !== view;
  document.querySelector('nav[aria-label="Views"]').hidden = view === "welcome";
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.disabled = button.dataset.view !== "profile" && !ready;
    button.title = button.disabled
      ? "Add income in Your profile to see results"
      : "";
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  });
  if (view === "welcome") {
    $("status").textContent = "";
    return;
  }
  if (view === "profile") {
    renderProfile();
    return;
  }
  const row = result.rows[1],
    c = Scenario.engineInput(scenario),
    month = Number($("period").value);
  // The month comes from today's date, the data from the model's tax year;
  // name both so a different modeled year is never mistaken for this month.
  {
    const option = $("period").options[1],
      today = new Date(),
      name = today.toLocaleString("en-US", { month: "long" });
    option.text =
      row.year === today.getFullYear()
        ? `This month (${name})`
        : `${name} ${row.year}`;
  }
  const payroll =
      view === "lifetime" || (view === "monthly" && month)
        ? row.payroll
        : result.ongoing.payroll,
    notices = Presentation.forView(payroll.warnings, view),
    modelNotes = notices.notes.map((n) => `<p>${escape(n)}</p>`).join("");
  renderLearned(view === "monthly" && showLearned);
  renderAccuracy(!(view === "monthly" && showLearned));
  if (view === "monthly") {
    const selected = month
      ? MoneyFlow.forMonth(row.payroll, row.flow, month)
      : result.ongoing;
    CompactFlow.render(
      $("flow"),
      CompactFlow.build(selected.payroll, selected.flow, c),
      money,
    );
    $("salary-context").innerHTML =
      `<span class="context-chip">${month ? `Scheduled · ${row.year}` : `As of ${escape(selected.payroll.earningPace.asOf)}`}</span><details class="context-help"><summary>How this view works</summary><p>${month ? "Scheduled paychecks, vesting and purchases for this month." : "Your current salary, grant-year allocations and ESPP cycle averaged monthly, with annual contribution limits."}</p><p>Asset additions are new funding before expenses. Spending follows cash, equity, then retirement; additional sale taxes are not modeled.</p>${modelNotes}</details>`;
    // Include the selected payroll's history notes too: forView routes them
    // here on this view rather than to the model notes.
    const history = [
      ...new Set([
        ...Presentation.notices(row.payroll.warnings).history,
        ...Presentation.notices(selected.payroll.warnings).history,
      ]),
    ];
    $("history-notes").innerHTML = history.length
      ? `<details class="context-help"><summary>Estimated history</summary>${history.map((n) => `<p>${escape(n)}</p>`).join("")}</details>`
      : "";
    $("months").innerHTML = table(
      [
        "Month",
        "Salary",
        "Bonus",
        "RSUs vested",
        "Cash tax withheld",
        "RSU cover",
        "Employee saving",
        "ESPP funding",
        "Net cash flow",
      ],
      row.flow.months.map((m) => [
        `${row.year}-${String(m.month).padStart(2, "0")}`,
        ...[
          "salary",
          "bonus",
          "rsu",
          "cashWithholding",
          "rsuSellToCover",
          "contributions",
          "esppContributions",
          "netCashFlow",
        ].map((k) => money(m[k])),
      ]),
    );
    $("checks").innerHTML = table(
      [
        "Date",
        "Source",
        "Salary",
        "Bonus",
        "Traditional",
        "Roth",
        "Mega",
        "HSA",
        "ESPP",
        "Net pay",
      ],
      row.payroll.paychecks.map((r) => [
        r.date,
        r.source,
        ...[
          "salary",
          "bonus",
          "traditional",
          "roth",
          "mega",
          "hsa",
          "espp",
          "netPay",
        ].map((k) => money(r[k])),
      ]),
    );
  } else if (view === "tax") {
    $("tax-notes").innerHTML = modelNotesDisclosure(modelNotes);
    renderTaxExplorer(
      $("tax-explorer"),
      c,
      result.ongoing.payroll,
      result.ongoing.flow,
      { stateUnset: !scenario.taxProfile.settings.state },
    );
    renderEsppComparison(
      Compensation.esppSaleComparison(c, result.ongoing.payroll, {
        asOf: result.ongoing.payroll.earningPace.asOf,
        lots: result.rows.flatMap((r) => r.payroll?.espp?.lots || []),
      }),
    );
  } else {
    renderProjection();
    $("lifetime-notes").innerHTML = modelNotesDisclosure(modelNotes);
  }
  const alerts = notices.attention;
  $("attention").hidden = !alerts.length;
  $("attention").innerHTML = alerts.length
    ? `<details class="attention-list"><summary>${alerts.length} item${alerts.length === 1 ? "" : "s"} to review</summary><ul>${alerts.map((n) => `<li>${escape(n)}</li>`).join("")}</ul></details>`
    : "";
}
function renderEsppComparison(x) {
  const host = $("espp-compare");
  if (!x) return host.replaceChildren();
  const s = x.scenarios,
    row = (label, f) => [label, ...s.map(f)],
    cents = (n) => Math.round(n * 100) / 100 || 0,
    gain = (v) => {
      const total = cents(v.shortGain + v.longGain);
      if (!total) return "None";
      return money(total) + (cents(v.longGain) ? " long-term" : " short-term");
    };
  const rows = [
    row("Sale date", (v) => v.saleDate),
    row("Sale price", (v) => money(v.price)),
    row("Proceeds", (v) => money(v.proceeds)),
    row("Ordinary income", (v) => money(v.ordinary)),
    row("Capital gain", gain),
    row("Added tax this year", (v) => money(v.tax)),
    row("After-tax cash", (v) => money(v.afterTax)),
    row(
      x.qualifiedPlan ? "Profit over cost" : "Profit over purchase value",
      (v) => money(v.profit),
    ),
  ];
  const best = s.find((v) => v.id === x.best),
    verdict = best
      ? `Highest after-tax cash: <strong>${escape(best.label)}</strong>.`
      : "After-tax cash is the same at every horizon.";
  host.innerHTML = `<section class="espp-compare"><h2>ESPP sale timing</h2><p class="view-subtitle">Current purchase: ${x.lot.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} shares bought ${escape(x.lot.purchaseDate)} for ${money(x.lot.cost)}. ${verdict}</p><div class="table-scroll"><table class="data-table"><thead><tr><th></th>${s.map((v) => `<th${v.id === x.best ? ' class="espp-best"' : ""}>${escape(v.label)}</th>`).join("")}</tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr><th>${escape(r[0])}</th>${r
          .slice(1)
          .map(
            (v, i) =>
              `<td${s[i].id === x.best ? ' class="espp-best"' : ""}>${escape(v)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><details class="context-help"><summary>How this is calculated</summary><p>Selling at purchase uses the purchase-date price. Holding uses your assumed ESPP sale price, so the difference also reflects that price assumption.</p><p>Each column's tax is the increase in this year's full household tax estimate when that sale is added, at this year's brackets, even when the sale falls in a later year. Losses beyond the $3,000 annual deduction carry forward and are not credited here. The columns ignore the time value of money and the risk that the price changes while you hold.</p><p>${x.qualifiedPlan ? "Qualified (Section 423) plan. A sale qualifies more than two years after the offering starts and more than one year after purchase. Earlier sales are disqualifying: the purchase-date discount is ordinary income even if the price falls." : "Non-qualified plan. The purchase discount is taxed as wages when you buy, so it is the same in every column and not shown. Only the later gain or loss differs."}</p></details></section>`;
}
// Results stay visible while details are missing; this bar says which.
function renderAccuracy(visible) {
  const host = $("accuracy"),
    gaps = visible ? Presentation.missing(scenario) : [];
  host.hidden = !gaps.length;
  host.innerHTML = gaps.length
    ? `<span><strong>Estimates</strong> until you add: ${gaps.map((g) => escape(g.label)).join(" · ")}</span><button id="accuracy-next">Improve accuracy</button>`
    : "";
  if (gaps.length)
    $("accuracy-next").onclick = () => {
      profileStep = 1;
      document.querySelector('[data-view="profile"]').click();
    };
}
function renderLearned(visible) {
  const host = $("learned");
  if (!visible) return host.replaceChildren();
  const rows = Presentation.learned(scenario),
    gaps = Presentation.missing(scenario),
    kept = keptValues.length
      ? `<div class="learned-kept"><h3>Your settings were kept</h3><ul>${keptValues.map((k, i) => `<li><strong>${escape(Presentation.labelFor(k.path))}</strong>: you set ${escape(Presentation.formatValue(k.path, k.yours))}; your paystub suggests ${escape(Presentation.formatValue(k.path, k.paystub))} <button data-use-paystub="${i}">Use paystub value</button> <button data-keep-mine="${i}">Keep mine</button></li>`).join("")}</ul></div>`
      : "";
  host.innerHTML = `<section class="learned-card" aria-labelledby="learned-title"><div class="learned-heading"><h2 id="learned-title">What we learned from your paystub</h2><button id="learned-dismiss" aria-label="Dismiss">Dismiss</button></div>${kept}${rows.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Item</th><th>Value</th><th>Source</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${escape(r.label)}</td><td>${escape(r.value)}</td><td><span class="source-chip source-${r.source === "Inferred" ? "inferred" : "paystub"}" title="${escape(r.basis || "")}">${escape(r.source)}</span></td></tr>`).join("")}</tbody></table></div>` : ""}${gaps.length ? `<div class="learned-gaps"><h3>Still needed for accurate results</h3><ul>${gaps.map((g) => `<li><strong>${escape(g.label)}</strong> <span>${escape(g.why)}</span></li>`).join("")}</ul><button id="learned-next" class="primary">Answer ${gaps.length} quick question${gaps.length === 1 ? "" : "s"}</button></div>` : '<p class="cf-note">Your profile has everything it needs.</p>'}</section>`;
  host.querySelectorAll("[data-use-paystub]").forEach(
    (button) =>
      (button.onclick = () => {
        const [item] = keptValues.splice(Number(button.dataset.usePaystub), 1);
        const next = Profile.usePaystubValue(structuredClone(scenario), item);
        // Elections depend on settings such as HSA coverage and age (they
        // decide which checks hit a limit), so re-read them from the checks.
        if (next.uploads.records?.length)
          Profile.applyElections(
            next,
            PaystubParser.suggest(
              next.uploads.records,
              Scenario.engineInput(next),
              { locked: Profile.lockedPaths(next) },
            ),
          );
        commit(next);
      }),
  );
  host.querySelectorAll("[data-keep-mine]").forEach(
    (button) =>
      (button.onclick = () => {
        const [item] = keptValues.splice(Number(button.dataset.keepMine), 1);
        commit(Profile.keepYourValue(structuredClone(scenario), item));
      }),
  );
  $("learned-dismiss").onclick = () => {
    showLearned = false;
    host.replaceChildren();
  };
  if ($("learned-next"))
    $("learned-next").onclick = () => {
      showLearned = false;
      profileStep = 1;
      document.querySelector('[data-view="profile"]').click();
    };
}
function renderProjection() {
  const rows = result.rows,
    real = $("real").checked,
    series = [
      ["Cash", "#38bdf8", (b) => b.cash + b.esppPending],
      ["Equity", "#fbbf24", (b) => b.brokerage + b.companyEquity],
      [
        "Retirement + HSA",
        "#a78bfa",
        (b) => b.pretax401k + b.rothAccounts + b.traditionalIRA + b.hsa,
      ],
    ];
  const value = (r) => r.netWorth / (real ? r.inflationFactor : 1),
    max = Math.max(1, ...rows.map(value)),
    width = 900,
    height = 330;
  const x = (i) => 50 + (i * (width - 70)) / (rows.length - 1),
    y = (v) => height - 30 - (v / max) * (height - 60);
  let previous = rows.map(() => 0);
  const areas = series
    .map(([name, color, amount]) => {
      const totals = rows.map(
        (r, i) =>
          previous[i] + amount(r.balances) / (real ? r.inflationFactor : 1),
      );
      const path = `M${totals.map((v, i) => `${x(i)},${y(v)}`).join(" L")} L${previous
        .map((v, i) => `${x(i)},${y(v)}`)
        .reverse()
        .join(" L")} Z`;
      previous = totals;
      return `<path d="${path}" fill="${color}" opacity=".6"><title>${name}</title></path>`;
    })
    .join("");
  $("projection-chart").innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Projected assets by class">${areas}<text x="50" y="18" fill="#e2e8f0">${escape(money(max))}</text><text x="50" y="325" fill="#94a3b8">Starting balances</text><text x="780" y="325" fill="#94a3b8">Age ${rows.at(-1).age}</text></svg><p>${series.map(([n, color]) => `<span style="color:${color};margin-right:18px">● ${n}</span>`).join("")}</p>`;
  $("year").max = rows.length - 1;
  const selected = rows[Math.min(Number($("year").value), rows.length - 1)],
    factor = real ? selected.inflationFactor : 1;
  $("balances").innerHTML =
    `<h2>${selected.initial ? "Starting balances" : `End of ${selected.year}`} · Age ${selected.age}</h2>` +
    `<div class="asset-summary">${series.map(([name, color, amount]) => `<div style="--asset-color:${color}"><span>${escape(name)}</span><strong>${money(amount(selected.balances) / factor)}</strong></div>`).join("")}<div><span>Total</span><strong>${money(selected.netWorth / factor)}</strong></div></div>${selected.shortfall > 0 ? `<p class="inline-alert">Unfunded expenses: ${money(selected.shortfall / factor)}</p>` : ""}<details><summary>Account balances</summary>` +
    table(
      ["Asset", "Balance"],
      Object.entries(selected.balances)
        .filter(([, value]) => Math.abs(value) > 0.005)
        .map(([key, v]) => [
          {
            cash: "Cash",
            brokerage: "Taxable investments",
            pretax401k: "Traditional 401(k)",
            rothAccounts: "Roth accounts",
            traditionalIRA: "Traditional IRA",
            hsa: "HSA",
            companyEquity: "Company equity",
            esppPending: "Pending ESPP cash",
          }[key],
          money(v / factor),
        ])
        .concat([["Total", money(selected.netWorth / factor)]]),
    ) +
    "</details>";
}
function download(text, name) {
  const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function readPaystubs(event) {
  const status = $("upload-status");
  status.textContent = "Reading locally…";
  drafts = [];
  try {
    const files = [...event.target.files];
    if (files.length > 12) throw new Error("Choose up to 12 PDFs.");
    const pdfjs = await import("./vendor/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
    for (const file of files) {
      if (file.size > 15 * 1024 * 1024)
        throw new Error("Each PDF must be smaller than 15 MB.");
      const data = new Uint8Array(await file.arrayBuffer()),
        id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("");
      const loadingTask = pdfjs.getDocument({
        data,
        isEvalSupported: false,
        enableXfa: false,
        useSystemFonts: true,
      });
      try {
        const doc = await loadingTask.promise;
        if (doc.numPages > 12)
          throw new Error("Each PDF must have 12 pages or fewer.");
        const pages = [];
        for (let page = 1; page <= doc.numPages; page++) {
          const content = await (await doc.getPage(page)).getTextContent(),
            lines = [];
          for (const item of content.items) {
            if (!item.str) continue;
            const y = item.transform[5];
            let line = lines.find((l) => Math.abs(l.y - y) < 2);
            if (!line) {
              line = { y, items: [] };
              lines.push(line);
            }
            line.items.push(item);
          }
          pages.push({
            page,
            text: lines
              .sort((a, b) => b.y - a.y)
              .map((l) =>
                l.items
                  .sort((a, b) => a.transform[4] - b.transform[4])
                  .map((i) => i.str)
                  .join(" "),
              )
              .join("\n"),
          });
        }
        const record = PaystubParser.parse(pages, scenario.uploads.records);
        record.id = id;
        drafts.push(record);
      } finally {
        await loadingTask.destroy();
      }
    }
    status.textContent =
      "Review categories and printed totals before applying.";
    reviewUploads();
  } catch (error) {
    status.textContent = error.message;
    drafts = [];
  }
}
function reviewUploads() {
  const preview = Profile.describe({
    ...scenario,
    uploads: { ...scenario.uploads, records: drafts },
  });
  const checks = drafts
    .map(
      (r, i) =>
        `<h3>Paycheck ${i + 1}</h3><label class="field">Check date<input type="date" data-review-date="${i}" value="${escape(r.date)}"></label><p class="cf-note">Salary ${money(r.current.salary)} · Deposited cash ${money(r.netPay)}</p><details ${PaystubParser.validate(r).valid ? "" : "open"}><summary>Review extracted amounts and categories</summary><div class="table-scroll"><table><thead><tr><th>Printed label</th><th>Category</th><th>Current</th><th>YTD</th></tr></thead><tbody>${r.lines
          .map(
            (l, j) =>
              `<tr><td>${escape(l.label)}</td><td><select data-mapping="${i}:${j}"><option value="">Choose</option>${Object.entries(
                PaystubParser.labels,
              )
                .map(
                  ([k, v]) =>
                    `<option value="${k}" ${l.key === k ? "selected" : ""}>${escape(v)}</option>`,
                )
                .join("")}</select>${
                PaystubParser.benefitTypes[l.key]
                  ? `<label>Repeats<select data-benefit-schedule="${i}:${j}">${Object.entries(
                      {
                        review: "Confirm schedule",
                        paycheck: "Every paycheck",
                        monthly: "First paycheck each month",
                        once: "This payment only",
                      },
                    )
                      .map(
                        ([k, v]) =>
                          `<option value="${k}" ${(l.schedule || (["commuter", "parking"].includes(l.key) ? "review" : "paycheck")) === k ? "selected" : ""}>${v}</option>`,
                      )
                      .join(
                        "",
                      )}</select></label><label>Employer annual cap (optional)<input type="number" min="0" step=".01" data-benefit-cap="${i}:${j}" value="${l.annualCap ?? ""}"></label>`
                  : ""
              }</td><td><input aria-label="Current ${escape(l.label)}" type="number" step=".01" data-review-value="${i}:${j}:current" value="${l.current ?? ""}"></td><td><input aria-label="YTD ${escape(l.label)}" type="number" step=".01" data-review-value="${i}:${j}:ytd" value="${l.ytd ?? ""}"></td></tr>`,
          )
          .join(
            "",
          )}</tbody></table></div></details><p>${PaystubParser.validate(r).errors.map(escape).join(" ") || "Amounts reconcile."}</p>`,
    )
    .join("");
  const schedule = `<label class="check"><input id="apply-schedule" type="checkbox" checked>Fill salary and payday schedule${preview.schedule.confirmed ? " from check dates" : " using the selected pay frequency (confirm this in your profile)"}</label>`;
  // When every check reconciles there is nothing to decide: show a one-line
  // summary and keep line-by-line details one click away.
  const clean =
    drafts.length &&
    drafts.every((r) => PaystubParser.validate(r).valid) &&
    preview.schedule.confirmed;
  $("upload-review").innerHTML = clean
    ? `<p class="review-summary"><strong>${drafts.length} paycheck${drafts.length === 1 ? "" : "s"} read</strong> · ${drafts.map((r) => escape(r.date)).join(", ")} · all totals reconcile</p><button id="apply-upload" class="primary">Use these paychecks</button><details class="review-details"><summary>Check what we read</summary>${checks}${schedule}</details>`
    : `${checks}${schedule}<button id="apply-upload">Apply reviewed paychecks</button>`;
  $("upload-review")
    .querySelectorAll("[data-benefit-cap]")
    .forEach(
      (el) =>
        (el.onchange = () => {
          const [i, j] = el.dataset.benefitCap.split(":");
          drafts[i].lines[j].annualCap =
            el.value === "" ? null : Number(el.value);
          PaystubParser.rebuild(drafts[i]);
          reviewUploads();
        }),
    );
  $("upload-review")
    .querySelectorAll("[data-benefit-schedule]")
    .forEach(
      (el) =>
        (el.onchange = () => {
          const [i, j] = el.dataset.benefitSchedule.split(":");
          drafts[i].lines[j].schedule = el.value;
          PaystubParser.rebuild(drafts[i]);
          reviewUploads();
        }),
    );
  $("upload-review")
    .querySelectorAll("[data-mapping]")
    .forEach(
      (el) =>
        (el.onchange = () => {
          const [i, j] = el.dataset.mapping.split(":");
          drafts[i].lines[j].key = el.value;
          PaystubParser.rebuild(drafts[i]);
          reviewUploads();
        }),
    );
  $("upload-review")
    .querySelectorAll("[data-review-date]")
    .forEach(
      (el) =>
        (el.onchange = () => {
          drafts[Number(el.dataset.reviewDate)].date = el.value;
          reviewUploads();
        }),
    );
  $("upload-review")
    .querySelectorAll("[data-review-value]")
    .forEach(
      (el) =>
        (el.onchange = () => {
          const [i, j, key] = el.dataset.reviewValue.split(":");
          drafts[i].lines[j][key] = el.value === "" ? null : Number(el.value);
          PaystubParser.rebuild(drafts[i]);
          reviewUploads();
        }),
    );
  $("apply-upload").disabled =
    !drafts.length || drafts.some((r) => !PaystubParser.validate(r).valid);
  $("apply-upload").onclick = () => {
    try {
      if (new Set(drafts.map((r) => r.date.slice(0, 4))).size > 1)
        throw new Error(
          "Upload checks from one calendar year at a time, starting with the latest year.",
        );
      const next = structuredClone(scenario),
        records = PaystubParser.mergeRecords(next.uploads.records, drafts),
        suggestion = PaystubParser.suggest(
          records,
          Scenario.engineInput(next),
          { locked: Profile.lockedPaths(next) },
        );
      const applied = Profile.applyUpload(
        next,
        records,
        suggestion,
        $("apply-schedule").checked,
      );
      // The tax year is inferred only from a current-year check; the checks
      // must match the year the profile models after applying them.
      const checkYear = Number(drafts[0]?.date.slice(0, 4));
      if (checkYear && checkYear !== applied.scenario.taxProfile.year)
        throw new Error(
          `These checks are from ${checkYear}, but your profile models ${applied.scenario.taxProfile.year}. Upload checks from the year you want to model.`,
        );
      showLearned = true;
      keptValues = applied.kept || [];
      view = "monthly";
      commit(applied.scenario);
      drafts = [];
    } catch (error) {
      $("upload-status").textContent = error.message;
    }
  };
}
$("export").onclick = () =>
  download(Scenario.serialize(scenario), "net-worth-scenario.json");
$("import").onchange = async (event) => {
  try {
    const raw = await event.target.files[0].text(),
      imported = Scenario.migrate(JSON.parse(raw));
    if (!localStorage.getItem(BACKUP)) localStorage.setItem(BACKUP, raw);
    commit(imported.scenario);
    if (imported.warnings.length)
      $("status").textContent = imported.warnings.join(" ");
  } catch (error) {
    $("status").textContent = error.message;
  }
  event.target.value = "";
};
$("inspect").onclick = () => {
  $("scenario-json").textContent = Scenario.serialize(scenario);
  $("backup").hidden = !localStorage.getItem(BACKUP);
  $("scenario-dialog").showModal();
};
$("close-inspect").onclick = () => $("scenario-dialog").close();
$("backup").onclick = () =>
  download(localStorage.getItem(BACKUP), "net-worth-original-scenario.json");
document.querySelectorAll("[data-view]").forEach(
  (button) =>
    (button.onclick = () => {
      view = button.dataset.view;
      if (view === "profile") $("status").textContent = "";
      for (const name of ["profile", "monthly", "tax", "lifetime"])
        $(name).hidden = name !== view;
      document
        .querySelectorAll("[data-view]")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      render();
    }),
);
// Two views: the monthly average at your current earning pace, or this
// calendar month's scheduled paychecks, vests and purchases.
{
  const today = new Date();
  $("period").add(
    new Option(
      `This month (${today.toLocaleString("en-US", { month: "long" })})`,
      today.getMonth() + 1,
    ),
  );
}
$("period").onchange = render;
$("year").oninput = renderProjection;
$("real").onchange = renderProjection;
let resizeTimer,
  lastWidth = 0;
new ResizeObserver((entries) => {
  const width = entries[0].contentRect.width;
  if (Math.abs(width - lastWidth) < 1) return;
  lastWidth = width;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (result) render();
  }, 100);
}).observe(document.querySelector("main"));
try {
  const saved = localStorage.getItem(KEY),
    legacy = localStorage.getItem("netWorthModel:v1");
  let warnings = [];
  if (saved) scenario = Scenario.normalize(JSON.parse(saved));
  else if (legacy) {
    if (legacy && !localStorage.getItem(BACKUP))
      localStorage.setItem(BACKUP, legacy);
    const migrated = Scenario.migrate(JSON.parse(legacy));
    scenario = migrated.scenario;
    warnings = migrated.warnings;
  } else {
    scenario = Scenario.defaults();
    // A new profile models the current year (the engine starts at 2026).
    scenario.taxProfile.year = Math.max(
      scenario.taxProfile.year,
      new Date().getFullYear(),
    );
  }
  view = Profile.initialView(scenario);
  result = Projection.calculate(scenario);
  setup();
  render();
  if (warnings.length) $("status").textContent = warnings.join(" ");
} catch (error) {
  $("status").textContent =
    `Saved scenario could not be loaded: ${error.message}. Your original data has not been overwritten. Import a corrected scenario to continue.`;
}

function renderProfile() {
  const profile = Profile.describe(scenario),
    v = profile.last?.current || {};
  document
    .querySelectorAll("[data-profile-step]")
    .forEach(
      (el) => (el.hidden = Number(el.dataset.profileStep) !== profileStep),
    );
  document.querySelectorAll("[data-step]").forEach((el) => {
    el.setAttribute(
      "aria-current",
      Number(el.dataset.step) === profileStep ? "step" : "false",
    );
  });
  $("profile-back").hidden = profileStep === 0;
  $("profile-next").disabled =
    profileStep === 2 && !Profile.hasIncome(scenario);
  $("profile-next").title = $("profile-next").disabled
    ? "Upload a paystub or enter income to see your monthly picture"
    : "";
  $("profile-next").textContent =
    profileStep === 2
      ? "See my monthly picture"
      : profileStep === 1
        ? "Continue to plan details"
        : "Continue with what I have";
  if (Profile.hasIncome(scenario)) {
    const { payroll, flow } = result.ongoing;
    const graph = CompactFlow.build(
      payroll,
      flow,
      Scenario.engineInput(scenario),
    );
    const cards = Presentation.overview(payroll, flow, graph.buckets);
    $("profile-overview").innerHTML =
      `<div class="overview-heading"><span>Monthly earning pace</span><small>Asset additions before expenses</small></div><div class="profile-overview-grid">${cards.map((c) => `<div class="overview-metric metric-${c.kind}" title="${escape(c.note)}"><span>${escape(c.label)}</span><strong>${money(c.value)}</strong></div>`).join("")}</div>`;
  } else $("profile-overview").innerHTML = "";
  const date = profile.last?.date;
  $("profile-summary").innerHTML =
    profileStep !== 0
      ? ""
      : profile.last
        ? `<div class="profile-preview"><div><h2>Latest paycheck</h2><p>${escape(date)}</p></div><div class="profile-metrics"><div><span>Cash deposited</span><strong>${money(profile.snapshot.cash)}</strong></div><div><span>Retirement + HSA</span><strong>${money(profile.snapshot.retirement + profile.snapshot.hsa)}</strong></div><div><span>ESPP cash set aside</span><strong>${money(profile.snapshot.espp)}</strong></div></div><p class="cf-note">${profile.records} paycheck${profile.records === 1 ? "" : "s"} saved · ${profile.schedule.confirmed ? "Every " + (profile.schedule.frequency === "weekly" ? "week" : "two weeks") + " inferred from check dates." : "Pay frequency needs confirmation."}</p></div>`
        : `<div class="profile-empty"><strong>A paycheck fills in most of your profile.</strong><p>Upload a text-based PDF to extract earnings, deductions, withholding and YTD totals. Your documents stay on this device.</p></div>`;
  const rows = [];
  if (profile.last) {
    rows.push([
      "Regular gross pay",
      money(v.salary),
      "Latest regular paycheck",
    ]);
    rows.push([
      "Pay frequency",
      profile.schedule.frequency,
      profile.schedule.confirmed
        ? "Inferred from check dates"
        : "Your setting, needs confirmation",
    ]);
    rows.push(["Payday anchor", profile.schedule.anchor, "Actual check date"]);
    for (const key of [
      "traditional",
      "roth",
      "mega",
      "hsa",
      "hsaEmployer",
      "espp",
      "health",
      "federal",
      "state",
      "ss",
      "medicare",
      "sdi",
    ])
      if (v[key] != null) {
        const rate =
          ["traditional", "roth", "mega", "espp"].includes(key) && v.salary > 0
            ? ` (${((v[key] / v.salary) * 100).toFixed(1)}% of base pay on this check)`
            : "";
        rows.push([
          PaystubParser.labels[key] || key,
          money(v[key]) + rate,
          "Uploaded amount per paycheck",
        ]);
      }
  } else
    rows.push([
      "Annual salary",
      money(scenario.compensation.salary),
      "Saved / manual setting",
    ]);
  const limits = TaxEngine.limits(
    scenario.taxProfile.year,
    scenario.taxProfile.settings,
  );
  rows.push(
    [
      "Employee 401(k) base limit",
      money(limits.deferral),
      "Tax year; eligible catch-up is applied by age",
    ],
    [
      "IRA base limit",
      money(limits.ira),
      "Tax year; eligible compensation and age also apply",
    ],
  );
  $("profile-facts").innerHTML = table(["Item", "Value", "Source"], rows);
}
document.querySelectorAll("[data-step]").forEach(
  (button) =>
    (button.onclick = () => {
      profileStep = Number(button.dataset.step);
      renderProfile();
    }),
);
$("start-upload").onclick = () => {
  ((profileStep = 0), (grantTimelineAnnual = false));
  document.querySelector('[data-view="profile"]').click();
  $("paystubs")?.click();
};
$("start-profile").onclick = () => {
  ((profileStep = 0), (grantTimelineAnnual = false));
  document.querySelector('[data-view="profile"]').click();
};
const scenarioMenu = document.querySelector(".scenario-menu");
const closeScenarioMenu = () => scenarioMenu.removeAttribute("open");
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && scenarioMenu.open) {
    closeScenarioMenu();
    scenarioMenu.querySelector("summary").focus();
  }
});
document.addEventListener("click", (event) => {
  if (!scenarioMenu.contains(event.target)) closeScenarioMenu();
});
for (const id of ["export", "import", "inspect"])
  $(id).addEventListener(
    id === "import" ? "change" : "click",
    closeScenarioMenu,
  );
$("welcome-import").onclick = () => $("import").click();
$("profile-back").onclick = () => {
  profileStep = Math.max(0, profileStep - 1);
  renderProfile();
};
$("profile-next").onclick = () => {
  if (profileStep < 2) {
    profileStep++;
    renderProfile();
    $("profile").scrollIntoView({ block: "start", behavior: "smooth" });
  } else document.querySelector('[data-view="monthly"]').click();
};
