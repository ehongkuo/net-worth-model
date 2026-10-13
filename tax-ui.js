function taxChartLayout(sources, rows) {
  const total = rows.reduce((sum, r) => sum + r.income, 0);
  const next = rows.find((r) => r.upper > total);
  const maximum =
    total > 0
      ? total * 1.06
      : Math.max(1, Number.isFinite(rows[0]?.upper) ? rows[0].upper : 1);
  const gross = sources.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  let start = 0;
  const segments = sources
    .filter((s) => s.value > 0 && total > 0)
    .map((s) => {
      const value = gross ? (s.value / gross) * total : 0,
        segment = { ...s, gross: s.value, value, start };
      start += value;
      return segment;
    });
  return {
    total,
    maximum,
    segments,
    headroom: Number.isFinite(next?.upper) ? next.upper - total : null,
    brackets: rows
      .filter((r) => r.lower < maximum)
      .map((r) => ({ ...r, start: r.lower, end: Math.min(r.upper, maximum) })),
  };
}
function taxCashOutcome(payroll, flow) {
  const engine =
    typeof module !== "undefined" ? require("./money-flow") : MoneyFlow;
  const graph = engine.buildFlow(payroll, flow);
  const equity = graph.links
    .filter((l) => l.target === "equity-account")
    .reduce((sum, l) => sum + l.value, 0);
  return { cash: flow.afterTaxCash, equity, total: flow.afterTaxCash + equity };
}
function taxIncomeComparison(attribution) {
  const sources = attribution.sources.map((s) => ({
    id: s.id,
    gross: s.gross,
    afterPretax: s.afterPretax ?? s.taxable,
    taxable: s.taxable,
  }));
  return {
    sources,
    gross: attribution.beforeOrdinary,
    afterPretax: attribution.afterPretax ?? attribution.afterOrdinary,
    taxable: attribution.afterOrdinary,
    deductions:
      attribution.beforeOrdinary -
      (attribution.afterPretax ?? attribution.afterOrdinary),
    householdDeductions: attribution.householdDeductions || 0,
  };
}
function stateIncomeComparison(attribution, audit, taxes) {
  const ca = audit.settings.state === "CA";
  const sources = attribution.sources.map((s) => {
    const gross = Math.max(
      0,
      s.gross +
        s.capitalGross -
        (s.id === "other" ? audit.income.federalOnly || 0 : 0),
    );
    const deduction = Math.max(
      0,
      s.payrollDeduction - (ca && s.id === "salary" ? audit.hsa : 0),
    );
    return { ...s, gross, afterPretax: Math.max(0, gross - deduction) };
  });
  if (ca && audit.income.employerHsa > 0)
    sources.push({
      id: "employer-hsa",
      label: "Employer HSA",
      color: "#a78bfa",
      gross: audit.income.employerHsa,
      afterPretax: audit.income.employerHsa,
    });
  const gross = sources.reduce((sum, s) => sum + s.gross, 0),
    afterPretax = sources.reduce((sum, s) => sum + s.afterPretax, 0);
  return {
    sources,
    gross,
    afterPretax,
    householdDeductions: afterPretax - taxes.stateTaxable,
  };
}
if (typeof module !== "undefined")
  module.exports = {
    taxChartLayout,
    taxCashOutcome,
    taxIncomeComparison,
    stateIncomeComparison,
  };

/* All source amounts come from the same engine result used by the monthly flow. */
function renderTaxExplorer(container, config, payroll, flow) {
  const t = flow.taxes,
    a = t.audit,
    x = flow.taxAttribution;
  if (!container || !a || !x) return;
  const selectedChart =
    container.querySelector('[data-tax-chart-mode][aria-pressed="true"]')
      ?.dataset.taxChartMode || "federal";
  const expanded = new Set(
    [...container.querySelectorAll("details[open]")].map(
      (el) => el.dataset.taxDetail,
    ),
  );
  const { money, escape: safe } =
    typeof module !== "undefined" && module.exports
      ? require("./util")
      : globalThis.Util;
  const compact = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  const percent = (n) =>
    `${(n * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const line = (label, value, total = false) =>
    `<div class="tax-line ${total ? "tax-total" : ""}"><span>${safe(label)}</span><strong>${money(value)}</strong></div>`;
  const detail = (id, title, body) =>
    `<details data-tax-detail="${id}" ${expanded.has(id) ? "open" : ""}><summary>${title}</summary>${body}</details>`;
  const formula = (r) =>
    `${money(r.income)} × ${percent(r.rate)} = ${money(r.tax)}`;
  const before = taxChartLayout(
    x.sources.map((s) => ({ ...s, value: s.gross })),
    x.beforeRows,
  );
  const comparison = taxIncomeComparison(x);
  const maximum = before.maximum,
    pct = (n) => (n / maximum) * 100;
  const markerRows = x.beforeRows
    .filter((r) => r.lower < maximum)
    .map((r) => ({ ...r, start: r.lower, end: Math.min(r.upper, maximum) }));
  const description = (r) =>
    `Ordinary income bracket ${percent(r.rate)}: before deductions ${formula(x.beforeRows.find((b) => b.lower === r.lower))}; after deductions ${formula(x.afterRows.find((b) => b.lower === r.lower))}.`;
  const bar = (title, key, total) => {
    let start = 0;
    return `<div class="tax-bar-heading"><h4>${title} <small>${key === "gross" ? "Before contributions and household deductions" : "Before household deductions and tax"}</small></h4><strong>${money(total)}</strong></div><div class="tax-chart-track" aria-label="${title}">${x.sources
      .filter((s) => s[key] > 0)
      .map((s) => {
        const left = start;
        start += s[key];
        return `<button type="button" style="left:${pct(left)}%;width:${pct(s[key])}%;background:${s.color}" data-tax-source="${s.id}" aria-label="${safe(s.label)}: ${title}, ${money(s[key])}" title="${safe(s.label)}: ${money(s[key])}">${pct(s[key]) > 14 ? `${safe(s.label)}<strong>${compact(s[key])}</strong>` : ""}</button>`;
      })
      .join("")}${markerRows
      .slice(1)
      .map((r) => `<i style="left:${pct(r.start)}%" aria-hidden="true"></i>`)
      .join("")}</div>`;
  };
  const c = payroll.contributions,
    conversion = c.iraConversionAudit;
  const rowsTable = (headers, rows) =>
    `<div class="table-scroll"><table class="data-table"><thead><tr>${headers.map((h) => `<th>${safe(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${safe(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const sourceBody = (s) =>
    `${rowsTable(
      ["Income", "Annual amount"],
      [
        ["Gross ordinary income", money(s.gross)],
        ["Payroll deductions", money(s.payrollDeduction)],
        [
          "Household deductions allocated",
          money(s.deduction - s.payrollDeduction),
        ],
        ["Ordinary taxable income", money(s.taxable)],
      ],
    )}${rowsTable(
      ["Tax", "Annual", "Monthly"],
      [
        ["Federal", money(s.federal), money(s.federal / 12)],
        ["State", money(s.state), money(s.state / 12)],
        ["Payroll", money(s.payroll), money(s.payroll / 12)],
        ["Total", money(s.total), money(s.total / 12)],
      ],
    )}${detail(
      "source-calculation",
      "Bracket slices and attribution",
      `${rowsTable(
        ["Taxable amount", "Rate", "Federal tax"],
        s.slices.map((r) => [money(r.income), percent(r.rate), money(r.tax)]),
      )}${s.capitalGross ? line("Preferential taxable gains", s.capitalTaxable) + line("Preferential gains tax", s.capitalTax) : ""}<p class="cf-note">Payroll deductions follow their income source. Household deductions are allocated proportionally. Federal slices follow the displayed source order; state tax is attributed by gross income and payroll tax uses vest timing. These allocations sum to the household estimate.</p>`,
    )}`;
  const deductionDetails = `${line("Traditional 401(k)", a.pretax)}${line("Pre-tax payroll benefits", a.payrollDeduction)}${line("Employee HSA", a.hsa)}${line("Allowed net capital loss", a.capitalLossDeduction)}${line("Standard deduction available", a.standardDeduction)}${line("Eligible itemized deduction after limitation", a.itemizedDeduction)}${line(`${a.deductionMethod} deduction selected`, a.deduction, true)}<p class="cf-note">The larger eligible standard or itemized deduction is used. Itemized inputs include modeled mortgage interest and capped state/local taxes, or your entered total eligible itemized deduction (including eligible donations). Home equity and mortgage principal are assets or payments, not deductions. Enter eligible totals after applying the relevant limits.</p>${line("Mortgage interest supplied by projection", a.income.mortgageInterest || 0)}${line("Property taxes supplied by projection", a.income.propertyTaxes || 0)}${line("SALT cap", a.saltCap)}<p class="cf-note">Roth 401(k), backdoor Roth contributions, mega-backdoor principal and ESPP contributions are after-tax transfers and do not reduce taxable income. Employer retirement contributions are excluded from employee wages.</p>`;
  const conversionDetails = `${line("Backdoor IRA contribution", c.ira)}${line("After-tax amount converted without tax", conversion?.nontaxable || 0)}${line("Taxable portion of backdoor conversion", c.iraTaxableConversion)}${line("Starting Traditional IRA balance used", conversion?.startingBalance || 0)}${line("Additional pre-tax IRA balance entered", conversion?.additionalBalance || 0)}${line("Combined pre-tax IRA balance used", conversion?.pretaxBalance || 0)}${line("Existing nondeductible IRA basis", conversion?.existingBasis || 0)}${c.iraTaxableConversion > 0 ? `<p class="cf-note">The model includes starting traditional IRA assets plus the additional pre-tax IRA balance you entered. Its estimate is contribution × pre-tax balance ÷ (pre-tax balance + existing basis + new contribution). Update these balances to your expected year-end traditional, SEP and SIMPLE IRA amounts. 401(k) balances do not enter this ratio.</p>` : '<p class="cf-note">This scenario has no taxable backdoor IRA conversion. Nondeductible principal is not taxed again. Earnings or other pre-tax IRA balances can make part taxable.</p>'}${line("Mega-backdoor taxable conversion earnings", c.conversionEarnings)}<p class="cf-note">This is an annual pro-rata estimate, not a full Form 8606 basis ledger. <a href="https://www.irs.gov/instructions/i8606" target="_blank" rel="noreferrer">IRS Form 8606 guidance</a>.</p>`;
  const funding = flow.taxFunding;
  const paymentRows = x.groups
    .filter(
      (g) =>
        Math.abs(g.total) + g.cashWithholding + g.cover + g.estimatedPayments >
        1e-8,
    )
    .map(
      (g) =>
        `<tr><th>${safe(g.label)}</th><td>${money(g.total)}</td><td>${money(g.cashWithholding)}</td><td>${money(g.cover)}</td><td>${money(g.estimatedPayments)}</td><td>${money(g.balance)}</td></tr>`,
    )
    .join("");
  const stateDetails = `${line("State adjusted gross income", a.stateAgi)}${line("State deduction", t.stateDeduction)}${line("State taxable income", t.stateTaxable)}${a.stateBrackets
    .filter((r) => r.income > 0)
    .map((r) => `<p class="tax-formula">${formula(r)}</p>`)
    .join(
      "",
    )}${line("State credits, adjustments and surtax", a.stateNetAdjustments)}${line("State income tax", t.state, true)}`;
  const stateComparison = stateIncomeComparison(x, a, t),
    stateBefore = stateComparison.gross;
  const stateMaximum = Math.max(
    1,
    stateBefore * 1.06,
    stateComparison.afterPretax * 1.06,
  );
  const stateBar = (title, key, total) => {
    let start = 0;
    return `<div class="tax-bar-heading"><h4>${title}</h4><strong>${money(total)}</strong></div><div class="tax-chart-track">${stateComparison.sources
      .filter((s) => s[key] > 0)
      .map((s) => {
        const value = s[key],
          left = start;
        start += value;
        return `<button type="button" style="left:${(left / stateMaximum) * 100}%;width:${(value / stateMaximum) * 100}%;background:${s.color}" title="${safe(s.label)}: ${money(value)} state income" aria-label="${safe(s.label)}: ${money(value)} state income">${value / stateMaximum > 0.2 ? compact(value) : ""}</button>`;
      })
      .join("")}${a.stateBrackets
      .filter((r) => r.lower > 0 && r.lower < stateMaximum)
      .map(
        (r) =>
          `<i style="left:${(r.lower / stateMaximum) * 100}%" aria-hidden="true"></i>`,
      )
      .join("")}</div>`;
  };
  const stateChart = `<div data-tax-chart="state" hidden><p class="cf-note">${a.settings.state === "CA" ? '<span class="context-chip">Estimated brackets · 2025 base</span>' : '<span class="context-chip">Effective-rate estimate</span>'}</p><div class="tax-chart-rates">${a.stateBrackets
    .filter((r) => r.lower < stateMaximum)
    .map(
      (r) =>
        `<button type="button" style="left:${(r.lower / stateMaximum) * 100}%;width:${((Math.min(r.upper, stateMaximum) - r.lower) / stateMaximum) * 100}%" title="${percent(r.rate)}: ${formula(r)}" aria-label="${percent(r.rate)}: ${formula(r)}">${(Math.min(r.upper, stateMaximum) - r.lower) / stateMaximum > 0.065 ? percent(r.rate) : ""}</button>`,
    )
    .join(
      "",
    )}</div>${stateBar("State income before deductions", "gross", stateBefore)}${stateBar("State income after pre-tax deductions", "afterPretax", stateComparison.afterPretax)}<div class="tax-chart-axis"><span>$0</span><span>${compact(stateMaximum)}</span></div><div class="deduction-strip">${line("Household deductions / adjustments", stateComparison.householdDeductions)}${line("State taxable income", t.stateTaxable, true)}</div>${detail("state-brackets", "State bracket calculations", stateDetails)}</div>`;
  container.innerHTML = `<p class="tax-period">${a.year} · ${a.settings.filing === "married" ? "Married filing jointly" : "Single"} · ${a.settings.state === "CA" ? "California" : a.settings.state === "custom" ? "Custom state estimate" : "No state income tax"}</p>
    <section class="glass-card tax-overview"><h3>Income before tax</h3><div class="flow-mode-toggle" role="group" aria-label="Tax jurisdiction"><button type="button" data-tax-chart-mode="federal" aria-pressed="true">Federal</button><button type="button" data-tax-chart-mode="state" aria-pressed="false" ${a.settings.state === "none" ? "disabled" : ""}>State</button></div><div data-tax-chart="federal">
      <div class="tax-chart-scroll"><div class="tax-chart-plot"><div class="tax-chart-rates">${markerRows.map((r) => `<button type="button" style="left:${pct(r.start)}%;width:${pct(r.end - r.start)}%" data-tax-bracket="${x.afterRows.findIndex((b) => b.lower === r.lower)}" title="${safe(description(r))}" aria-label="${safe(description(r))}">${pct(r.end - r.start) > 6 ? percent(r.rate) : ""}</button>`).join("")}</div>${bar("Gross ordinary income", "gross", comparison.gross)}${bar("Income after pre-tax deductions", "afterPretax", comparison.afterPretax)}<div class="tax-chart-axis"><span>$0</span>${markerRows
        .slice(1)
        .filter((r) => pct(r.start) > 8 && pct(r.start) < 90)
        .map(
          (r) =>
            `<span style="left:${pct(r.start)}%">${compact(r.start)}</span>`,
        )
        .join("")}<span>${compact(maximum)}</span></div></div></div>
      <div class="deduction-strip">${line("Household deductions", comparison.householdDeductions)}${line("Ordinary taxable income", comparison.taxable, true)}</div>
      <div class="tax-source-legend">${x.sources
        .filter((s) => s.gross > 0)
        .map(
          (s) =>
            `<button type="button" data-tax-source="${s.id}"><i style="background:${s.color}"></i>${safe(s.label)}</button>`,
        )
        .join("")}</div>

      </div>${stateChart}${detail("deductions", "Contributions and deductions", deductionDetails)}${
        x.capitalGross
          ? detail(
              "capital",
              "Preferential capital gains",
              `${line("Net gains before deductions", x.capitalGross)}${line("Taxable preferential gains", x.capitalTaxable)}${a.capitalBrackets
                .filter((r) => r.income > 0)
                .map((r) => `<p class="tax-formula">${formula(r)}</p>`)
                .join(
                  "",
                )}<p class="cf-note">These gains stack above ordinary income but use their own tax rates.</p>`,
            )
          : ""
      }
    </section>
    <section class="glass-card tax-source-section"><h3>Tax breakdown</h3><div class="tax-breakdown-bar" aria-label="Federal, state and payroll tax">${[
      ["Federal", t.federal, "#fb7185"],
      ["State", t.state, "#fda4af"],
      ["Payroll", t.ss + t.medicare + t.additionalMedicare + t.sdi, "#e11d48"],
    ]
      .filter(([, v]) => v > 0)
      .map(
        ([label, value, color]) =>
          `<span style="flex:${value};background:${color}" title="${label}: ${money(value)}"></span>`,
      )
      .join(
        "",
      )}</div><div class="tax-totals">${line("Federal", t.federal)}${line("State", t.state)}${line("Payroll", t.ss + t.medicare + t.additionalMedicare + t.sdi)}${line("Total annual tax", t.total, true)}</div><div class="tax-chart-selection" aria-live="polite">Select an income segment or bracket for its breakdown.</div>${detail("comparison", "Tax savings from deductions", `${line("Ordinary bracket tax before deductions", x.beforeBracketTax)}${line("Ordinary bracket tax after deductions", x.afterBracketTax)}${line("Reduction", x.beforeBracketTax - x.afterBracketTax, true)}<p class="cf-note">Federal ordinary brackets only; excludes credits, AMT, state and payroll taxes.</p>`)}${c.ira > 0 || c.conversionEarnings > 0 ? detail("conversions", `Backdoor Roth${c.iraTaxableConversion > 0 ? " · taxable portion " + money(c.iraTaxableConversion) : ""}`, conversionDetails) : ""}</section>
    <section class="glass-card"><h3>Payments</h3><div class="tax-headline"><span>Withheld / funded<strong>${money(funding.cashWithholding + funding.rsuWithholding + funding.estimatedPayments)}</strong></span><span>${funding.remainingLiability >= 0 ? "Still to fund" : "Estimated overpayment"}<strong>${money(Math.abs(funding.remainingLiability))}</strong></span></div><details><summary>Payments by source</summary><div class="table-scroll"><table class="data-table tax-payments"><thead><tr><th>Source</th><th>Tax owed</th><th>Cash withheld</th><th>Shares withheld</th><th>Estimated payments</th><th>Balance</th></tr></thead><tbody>${paymentRows}</tbody><tfoot><tr><th>Total</th><th>${money(t.total)}</th><th>${money(funding.cashWithholding)}</th><th>${money(funding.rsuWithholding)}</th><th>${money(funding.estimatedPayments)}</th><th>${money(funding.remainingLiability)}</th></tr></tfoot></table></div><p class="cf-note">Positive balances still need funding; negative balances offset other sources or create an estimated overpayment. RSU cash withholding follows payroll calculations. Other paycheck withholding stays with cash compensation. Estimated payments are allocated by liability; remaining reserves are netted across sources. Share sales follow your grant election.</p></details>${line(funding.remainingLiability >= 0 ? "Additional cash to reserve each month" : "Estimated overpayment per month", Math.abs(funding.remainingLiability) / 12, true)}
      ${detail("tax-components", "Federal, state and payroll calculation", `${line("Ordinary federal bracket tax", a.ordinaryTax)}${line("Preferential gains tax", a.capitalTax)}${line("Additional AMT", t.amt)}${line("Federal credits applied", -a.federalCreditsApplied)}${line("NIIT", t.niit)}${line("Federal adjustment", a.federalAdjustment)}${line("Federal total", t.federal, true)}${line("State total", t.state)}${line("Social Security", t.ss)}${line("Medicare", t.medicare)}${line("Additional Medicare", t.additionalMedicare)}${line("State disability", t.sdi)}${a.settings.state !== "none" ? stateDetails : ""}`)}
      ${config.espp.enabled ? detail("espp", "ESPP timing and future reserves", `${line("Incremental current-year tax from ESPP sales", funding.esppSaleTax)}<p class="cf-note">This with-versus-without-sales comparison is already included in total tax. It may differ from the source allocation above. Qualified-plan held purchase benefits remain untaxed federally. After-tax ESPP contributions are principal.</p>${line("Cash earmarked for a future ESPP sale", flow.futureTaxReserve)}<p class="cf-note">This optional reserve remains a cash asset and is separate from current tax liability.</p>`) : ""}
      ${detail("sources", "Rules and assumptions", `<p class="cf-note">All amounts use nominal tax-year dollars. ${a.projectedFederal ? "Federal thresholds are projected from 2026." : "Federal thresholds use published 2026 rules."} ${a.projectedState ? "California brackets are projected from published 2025 tables." : ""} Supported filing statuses are single and married filing jointly. Custom states use an effective-rate estimate. Qualified dividends, self-employment, special credits, multi-state allocation, California AMT and full IRA basis tracking are not automated.</p><p><a href="https://www.irs.gov/irb/2025-45_IRB" target="_blank" rel="noreferrer">IRS brackets</a> · <a href="https://www.irs.gov/publications/p15t" target="_blank" rel="noreferrer">Payroll withholding</a> · <a href="https://www.ftb.ca.gov/forms/2025/2025-540-booklet.html" target="_blank" rel="noreferrer">California rules</a></p>`)}
    </section>`;
  const switchChart = (mode) => {
    container
      .querySelectorAll("[data-tax-chart]")
      .forEach((el) => (el.hidden = el.dataset.taxChart !== mode));
    container
      .querySelectorAll("[data-tax-chart-mode]")
      .forEach((el) =>
        el.setAttribute(
          "aria-pressed",
          String(el.dataset.taxChartMode === mode),
        ),
      );
  };
  container
    .querySelectorAll("[data-tax-chart-mode]")
    .forEach(
      (button) =>
        (button.onclick = () => switchChart(button.dataset.taxChartMode)),
    );
  switchChart(a.settings.state === "none" ? "federal" : selectedChart);
  container.querySelectorAll("[data-tax-source]").forEach((button) => {
    const select = () => {
      const s = x.sources.find((s) => s.id === button.dataset.taxSource);
      container.querySelector(".tax-chart-selection").innerHTML =
        `<strong>${safe(s.label)}</strong>${sourceBody(s)}`;
    };
    button.onclick = select;
    button.onfocus = select;
  });
  container.querySelectorAll("[data-tax-bracket]").forEach((button) => {
    const select = () => {
      const r = x.afterRows[Number(button.dataset.taxBracket)],
        b = x.beforeRows[Number(button.dataset.taxBracket)];
      container.querySelector(".tax-chart-selection").innerHTML =
        `<strong>${percent(r.rate)} bracket: ${money(r.lower)} to ${Number.isFinite(r.upper) ? money(r.upper) : "no upper limit"}</strong>${rowsTable(
          ["Basis", "Taxable amount", "Tax"],
          [
            ["Before deductions", money(b.income), money(b.tax)],
            ["After deductions", money(r.income), money(r.tax)],
          ],
        )}${rowsTable(
          ["Income source", "Taxable amount", "Tax"],
          r.sources.map((s) => [
            s.label,
            money(s.value),
            money(s.value * r.rate),
          ]),
        )}`;
    };
    button.onclick = select;
    button.onfocus = select;
  });
}
