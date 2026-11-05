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
// The gaps last shown in the pop-up; it opens again only when they change.
// Per-viewer display choices on the profile; not part of the scenario.
let compPeriod = "year";
const compOpen = new Set();
// Money colors, by what form the money takes. Tokens live in style.css.
const MONEY_COLOR = {
  pay: "cash",
  cash: "cash",
  equity: "equity",
  kept: "equity",
  espp: "equity",
  rsu: "equity",
  employer: "employer",
  retirement: "retire",
  tax: "tax",
  benefits: "benefit",
};
// Paycheck items: what to call them and the units each can be entered in.
const UNIT_LABEL = {
  percent: "of pay",
  check: "per check",
  month: "per month",
  year: "per year",
};
const PAY_ITEMS = {
  traditional: ["Pre-tax 401(k)", ""],
  roth: ["Roth 401(k)", ""],
  mega: ["After-tax 401(k)", "Often used for a mega backdoor Roth."],
  hsa: ["HSA", "Your contribution. Your employer's is counted separately."],
  espp: ["ESPP", "Set aside from pay to buy company stock."],
  health: ["Pre-tax benefits", "Health, dental, vision, FSA and commuter."],
  post: [
    "After-tax deductions",
    "Coverage paid after tax, like extra life insurance.",
  ],
  allowance: [
    "Reimbursements",
    "Untaxed cash, like a phone or internet allowance.",
  ],
  taxableAllowance: ["Taxable allowances", "Cash stipends taxed as pay."],
  imputed: [
    "Taxable perks",
    "Not cash: adds to taxable pay, like employer-paid life insurance.",
  ],
};
const dollars = (v) =>
  (Number(v) || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
const longDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
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
  const sourceDate = source?.sourceDate || election?.sourceDate;
  const sourceInfo = provenance
    ? `<small class="field-origin" title="${escape(provenance)}">${manual ? "Your entry" : sourceDate ? `From your ${escape(longDate(sourceDate))} paystub` : escape(provenance)}</small>`
    : "";
  shownPaths?.add(path);
  const value = get(scenario, path),
    // The label wraps badges, hints and the value too; name the control by
    // its label alone so a screen reader doesn't read "200000.00".
    attrs = `data-path="${path}" data-type="${type}"${also.length ? ` data-also="${also.join(",")}"` : ""} aria-label="${escape(label + (type === "percent" ? " (%)" : ""))}"`;
  const state = Profile.fieldState(scenario, path);
  let { badge, approve } = Presentation.fieldBadge(state, path, label);
  // Inside a review block one bar confirms every estimate; each field only
  // flags a value that is missing.
  if (quietReview) {
    approve = "";
    if (state.label !== "Needs input") {
      badge = "";
      if (state.kind === "review" || state.kind === "inferred")
        state.kind = "estimate";
    }
  }
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
// The per-share price the engine uses, spelled out.
function esppPriceNote(e) {
  const offer = Math.max(0.01, e.offerPrice || 0),
    market = Math.max(0.01, e.purchasePrice || 0),
    d = Math.min(0.99, Math.max(0, e.discount || 0)),
    base = e.lookback ? Math.min(offer, market) : market;
  const which = !e.lookback
    ? `the purchase-day price of ${money(market)}`
    : offer <= market
      ? `the ${money(offer)} offering price (lower than ${money(market)} on purchase day)`
      : `the ${money(market)} purchase-day price (lower than the ${money(offer)} offering price)`;
  return `<p class="grant-summary"><strong>You'd buy at ${money(base * (1 - d))} a share</strong>: ${Math.round(d * 100)}% off ${which}.</p>`;
}
// A lower-impact value shown as words in a sentence; clicking it swaps in
// its control, which saves through the same data-path handler as a field.
// Its dot says where the value came from: a paystub, the user, or a default.
function chip(path, label, kind = "text", choices = null, empty = "not set") {
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
  shownPaths?.add(path);
  if (Array.isArray(kind)) [choices, kind] = [kind, "choice"];
  const value = get(scenario, path),
    st = Profile.fieldState(scenario, path),
    origin =
      st.kind === "observed"
        ? "paystub"
        : st.kind === "manual" || st.kind === "confirmed"
          ? "yours"
          : "default",
    title = {
      paystub: "From your paystub",
      yours: "Your entry",
      default: "Default, not checked yet",
    }[origin];
  const blank = value == null || value === "";
  const text = blank
    ? empty
    : kind === "choice"
      ? (choices.find(([k]) => String(k) === String(value)) || [0, value])[1]
      : kind === "bool"
        ? value
          ? "yes"
          : "no"
        : kind === "percent"
          ? `${Number((value * 100).toFixed(2))}%`
          : kind === "money"
            ? money(value)
            : kind === "date"
              ? longDate(value)
              : String(value);
  const type =
    kind === "choice"
      ? "text"
      : ["money", "count"].includes(kind)
        ? "number"
        : kind;
  const attrs = `data-path="${path}" data-type="${type}" aria-label="${escape(label)}"`;
  const options =
    kind === "bool"
      ? [
          [true, "yes"],
          [false, "no"],
        ]
      : choices;
  const control = options
    ? `<select ${attrs}>${options
        .map(
          ([k, t]) =>
            `<option value="${k}" ${String(value) === String(k) ? "selected" : ""}>${escape(t)}</option>`,
        )
        .join("")}</select>`
    : `<input ${attrs} type="${kind === "date" ? "date" : "number"}" step="any" value="${escape(blank ? "" : kind === "percent" ? Number((value * 100).toFixed(4)) : value)}">`;
  return `<span class="chip-field o-${origin}"><button type="button" class="chip" data-chip title="${title}. Click to change."><i class="dot" aria-hidden="true"></i>${escape(text)}</button><span class="chip-control" hidden>${control}</span></span>`;
}
// What a salary means per paycheck and per month, under its input.
function payMeaning(c) {
  const checks = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[
    c.frequency
  ];
  return c.salary > 0 && checks
    ? `${money(c.salary / checks)} per paycheck · ${money(c.salary / 12)} a month`
    : "";
}
// One sentence of chips and connecting words; empty when it has no chips.
function detailLine(...parts) {
  const flat = parts.flat();
  return flat.some((x) => x.startsWith('<span class="chip-field'))
    ? `<p class="detail-line">${flat.join("")}</p>`
    : "";
}
let quietReview = false;
// Fields whose values are still estimates (defaults or inferred from
// paystubs) under one title, with a single bar to confirm them together.
function reviewBlock(title, render, intro = "") {
  const outer = quietReview;
  quietReview = true;
  let body;
  try {
    body = render();
  } finally {
    quietReview = outer;
  }
  if (!body) return "";
  const pending = [
    ...new Set([...body.matchAll(/data-path="([^"]+)"/g)].map((m) => m[1])),
  ].filter((p) => {
    const st = Profile.fieldState(scenario, p);
    return (
      st.kind === "inferred" ||
      (st.kind === "review" && st.label !== "Needs input")
    );
  });
  const bar = pending.length
    ? `<div class="review-bar state-review"><span>${pending.length === 1 ? "1 value is an estimate" : `${pending.length} values are estimates`}. Check them, then confirm.</span><button type="button" data-confirm-all="${escape(pending.join(","))}">Looks right</button></div>`
    : "";
  return `<fieldset class="choice-group review-block"><legend>${escape(title)}</legend>${intro}${bar}<div class="field-grid">${body}</div></fieldset>`;
}
const group = (title, body, open = false) =>
  `<details ${open ? "open" : ""}><summary>${escape(title)}</summary><div class="field-grid">${body}</div></details>`;
const compactGroup = (title, body) =>
  `<section class="paycheck-group"><h3>${escape(title)}</h3><div class="field-grid">${body}</div></section>`;
// Re-renders the profile form; keeps keyboard focus on the same field.
function setup() {
  Util.preserveFocus($("setup"), renderSetup);
}
// What the paystubs can't tell, asked one at a time in place. Answers save
// together on Next; grants and ESPP need their own section, so those link
// there. Answered and skipped ones stay listed this session.
const quickAsked = new Map(),
  quickSkipped = new Set();
const QUICK_ORDER = [
  "age",
  "filing",
  "state",
  "spouse",
  "spending",
  "balances",
  "hsa",
  "rsu",
  "espp",
];
const QUICK_FIELDS = {
  age: [["taxProfile.age", "Your age", "count"]],
  filing: [
    [
      "taxProfile.settings.filing",
      "Filing status",
      [
        ["single", "Single"],
        ["married", "Married filing jointly"],
      ],
    ],
  ],
  state: [
    [
      "taxProfile.settings.state",
      "Where you pay income tax",
      [
        ["CA", "California"],
        ["none", "No state income tax"],
        ["custom", "Other state (effective rate)"],
      ],
    ],
  ],
  spouse: [["taxProfile.settings.spouseIncome", "Spouse's annual wages"]],
  spending: [
    [
      "projection.monthlyExpenses.other",
      "Total monthly spending",
      "money",
      "One total is enough; you can break it down later under Retirement & spending. Leave out what's taken from your paycheck.",
    ],
  ],
  balances: [
    ["projection.startingBalances.cash", "Cash"],
    ["projection.startingBalances.brokerage", "Taxable investments"],
    ["projection.startingBalances.pretax401k", "Traditional 401(k)"],
    ["projection.startingBalances.rothAccounts", "Roth accounts"],
  ],
  hsa: [
    [
      "employerPlan.hsa.coverage",
      "HSA coverage",
      [
        ["single", "Self-only"],
        ["family", "Family"],
      ],
    ],
  ],
};
let quickCurrent = "";
function quickQuestions() {
  const missing = Presentation.missing(scenario),
    open = new Set(missing.map((m) => m.id)),
    rank = (id) => QUICK_ORDER.indexOf(id);
  for (const m of missing) quickAsked.set(m.id, m);
  if (!quickAsked.size)
    return '<h2>About you</h2><p class="cf-note">Your paystub and answers cover everything the model needs.</p>';
  const asked = [...quickAsked.values()].sort(
    (a, b) => rank(a.id) - rank(b.id),
  );
  const waiting = asked.filter(
    (m) => open.has(m.id) && !quickSkipped.has(m.id),
  );
  if (!open.has(quickCurrent) || !waiting.some((m) => m.id === quickCurrent))
    quickCurrent = waiting[0]?.id || "";
  const q = quickAsked.get(quickCurrent);
  const others = asked
    .filter((m) => m.id !== quickCurrent)
    .map((m) => {
      const done = !open.has(m.id);
      return `<li class="${done ? "quick-done" : ""}"><button type="button" class="link-button" data-quick-go="${m.id}" ${done ? "disabled" : ""}>${done ? "✓ " : ""}${escape(m.label)}${!done && quickSkipped.has(m.id) ? " (skipped)" : ""}</button></li>`;
    })
    .join("");
  // A default isn't an answer, so it isn't filled in. The field also isn't
  // repeated further down while it's asked here.
  const single = QUICK_FIELDS[q?.id]?.length === 1;
  const control = ([path, label, type = "money", hint = ""]) => {
    shownPaths?.add(path);
    const value = get(scenario, path),
      known =
        value != null &&
        value !== "" &&
        Profile.fieldState(scenario, path).kind !== "review"
          ? value
          : "",
      attrs = `data-quick-path="${path}" aria-label="${escape(label)}"`;
    const input = Array.isArray(type)
      ? `<select ${attrs}><option value="" ${known === "" ? "selected" : ""} disabled>Choose</option>${type.map(([k, t]) => `<option value="${k}" ${String(known) === k ? "selected" : ""}>${escape(t)}</option>`).join("")}</select>`
      : `<input ${attrs} type="number" min="0" step="any" inputmode="decimal" value="${known > 0 ? known : ""}" placeholder="${type === "count" ? "" : "$0"}">`;
    return `<label class="field">${single ? "" : `<span>${escape(label)}</span>`}${input}${hint ? `<small>${escape(hint)}</small>` : ""}</label>`;
  };
  const body = !q
    ? `<p class="quick-why">${waiting.length || asked.some((m) => open.has(m.id)) ? "You skipped the rest for now. Pick one below when you're ready." : "That's everything. Your results now use your answers."}</p>${asked.some((m) => open.has(m.id)) ? "" : '<button type="button" class="primary" data-quick-finish>See my monthly picture</button>'}`
    : QUICK_FIELDS[q.id]
      ? `<form class="quick-form" data-quick-form="${q.id}"><p class="quick-why">${escape(q.why)}</p><div class="quick-fields">${QUICK_FIELDS[q.id].map(control).join("")}</div><div class="quick-actions"><button type="submit" class="primary">Next</button><button type="button" data-quick-skip>Skip for now</button></div></form>`
      : `<p class="quick-why">${escape(q.why)}</p><div class="quick-actions"><button type="button" class="primary" ${q.id === "rsu" ? "data-open-grants" : "data-open-espp"}>Open ${q.id === "rsu" ? "grants" : "ESPP"}</button><button type="button" data-quick-skip>Skip for now</button></div>`;
  const left = asked.filter((m) => open.has(m.id)).length;
  return `<section class="quick-card${left ? "" : " quick-card-done"}" id="quick-card" aria-labelledby="quick-title"><div class="quick-head"><h2 id="quick-title">${q ? escape(q.label) : "A few things your paystub can't tell us"}</h2><span class="context-chip">${left ? `${left} left` : "Done"}</span></div>${body}${others ? `<ul class="quick-list">${others}</ul>` : ""}</section>`;
}
// Saves the current quick question's answers and moves on.
function bindQuickQuestions() {
  const card = $("quick-card");
  if (!card) return;
  const form = card.querySelector("[data-quick-form]");
  if (form)
    form.onsubmit = (event) => {
      event.preventDefault();
      const next = structuredClone(scenario);
      let answered = false;
      for (const el of form.querySelectorAll("[data-quick-path]")) {
        if (el.value === "") continue;
        const path = el.dataset.quickPath;
        Profile.edit(
          next,
          path,
          el.tagName === "SELECT" ? el.value : Number(el.value),
        );
        answered = true;
      }
      const id = form.dataset.quickForm;
      // Next always moves on; an answer that doesn't settle the question
      // leaves it listed as skipped.
      if (
        !answered ||
        Presentation.missing(Scenario.normalize(next)).some((m) => m.id === id)
      )
        quickSkipped.add(id);
      commit(next);
      // A state not in the list needs its rate next.
      if (
        get(next, "taxProfile.settings.state") === "custom" &&
        form.dataset.quickForm === "state"
      )
        return jumpTo("taxProfile.settings.customStateRate");
      focusQuick();
    };
  card.querySelectorAll("[data-quick-skip]").forEach(
    (b) =>
      (b.onclick = () => {
        quickSkipped.add(quickCurrent);
        setup();
        focusQuick();
      }),
  );
  card.querySelectorAll("[data-quick-go]").forEach(
    (b) =>
      (b.onclick = () => {
        quickSkipped.delete(b.dataset.quickGo);
        quickCurrent = b.dataset.quickGo;
        setup();
        focusQuick();
      }),
  );
  card
    .querySelectorAll("[data-quick-finish]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          document.querySelector('[data-view="monthly"]').click()),
    );
}
// Brings the quick card into view with its first answer focused.
function focusQuick() {
  const card = $("quick-card");
  if (!card) return;
  if (
    card.getBoundingClientRect().top < 88 ||
    card.getBoundingClientRect().top > innerHeight / 2
  )
    card.scrollIntoView({ block: "start" });
  card
    .querySelector("[data-quick-path], .quick-actions .primary")
    ?.focus({ preventScroll: true });
}
// Going through one step's estimates in place: the step, its paths in
// order, how far along, and how many were skipped.
let estimateTour = null;
// Moves the current estimate's field into the tour card, so it's answered
// in one place; or, past the last one, says how it went.
function placeTour(panel, place) {
  const t = estimateTour;
  let el;
  while (t.at < t.paths.length) {
    el = panel.querySelector(`[data-path="${CSS.escape(t.paths[t.at])}"]`);
    if (el) break;
    t.at++;
  }
  const n = t.paths.length,
    q =
      el &&
      Presentation.estimateQuestion(
        scenario,
        t.paths[t.at],
        el.getAttribute("aria-label").replace(/ \(%\)$/, ""),
      );
  if (t.at >= n) {
    place(
      `<section class="quick-card quick-card-done" id="tour-card" aria-labelledby="tour-title"><div class="quick-head"><h2 id="tour-title">Estimates checked</h2><span class="context-chip">Done</span></div><p class="quick-why">${n - t.skipped} of ${n} confirmed${t.skipped ? `; ${t.skipped} skipped stay highlighted below` : ""}.</p><div class="quick-actions"><button type="button" class="primary" data-tour-stop>Close</button></div></section>`,
    );
    return;
  }
  place(
    `<section class="quick-card" id="tour-card" aria-labelledby="tour-title"><div class="quick-head"><h2 id="tour-title">${escape(q.topic)}</h2><span class="context-chip">${t.at + 1} of ${n}</span></div><p class="quick-why">${q.hint ? `${escape(q.hint)} ` : ""}This is an estimate: change it if you know the real value, or keep it.</p><form class="quick-form" data-tour-form><div class="quick-fields tour-field"></div><div class="quick-actions"><button type="submit" class="primary">${t.at + 1 < n ? "Next" : "Finish"}</button><button type="button" data-tour-skip>Skip</button><button type="button" class="link-button" data-tour-stop>Stop</button></div></form></section>`,
  );
  const cell = el.closest(".profile-cell") || el;
  // Its label reads on its own, without the section around it.
  const text = cell.querySelector("label.field > span:not([class])");
  if (text)
    text.textContent = q.label + (el.dataset.type === "percent" ? " (%)" : "");
  else {
    const node = [...(el.closest("label")?.childNodes || [])].find(
      (n) => n.nodeType === 3 && n.textContent.trim(),
    );
    if (node) node.textContent = q.label;
    // A chip's control has no visible label of its own.
    else
      el.insertAdjacentHTML(
        "beforebegin",
        `<span class="tour-label">${escape(q.label)}</span>`,
      );
  }
  el.setAttribute("aria-label", q.label);
  cell.querySelectorAll("[data-confirm]").forEach((b) => b.remove());
  el.closest(".chip-control")?.removeAttribute("hidden");
  // Saved by Next, not by the field's own change handler.
  el.dataset.tourPath = el.dataset.path;
  el.dataset.tourShown = el.type === "checkbox" ? el.checked : el.value;
  delete el.dataset.path;
  panel
    .querySelector(".tour-field")
    .append(el.closest(".chip-control") || cell);
}
function bindTour() {
  const card = $("tour-card");
  $("setup")
    .querySelectorAll("[data-tour-start]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          estimateTour = {
            step: Number(b.closest("[data-profile-step]").dataset.profileStep),
            paths: b.dataset.tourStart.split(","),
            at: 0,
            skipped: 0,
          };
          profileStep = estimateTour.step;
          setup();
          renderProfile();
          focusTour();
        }),
    );
  if (!card) return;
  const t = estimateTour;
  card.querySelector("[data-tour-form]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const el = card.querySelector("[data-tour-path]"),
      path = el.dataset.tourPath,
      next = structuredClone(scenario);
    // Kept as shown confirms the estimate; a new value is an edit.
    if (
      String(el.type === "checkbox" ? el.checked : el.value) ===
      el.dataset.tourShown
    )
      Profile.confirm(next, path);
    else editField(next, el, path);
    t.at++;
    commit(next);
    focusTour();
  });
  card.querySelector("[data-tour-skip]")?.addEventListener("click", () => {
    t.at++;
    t.skipped++;
    setup();
    focusTour();
  });
  card.querySelector("[data-tour-stop]")?.addEventListener("click", () => {
    estimateTour = null;
    setup();
  });
}
function focusTour() {
  const card = $("tour-card");
  if (!card) return;
  const top = card.getBoundingClientRect().top;
  if (top < 88 || top > innerHeight / 2)
    card.scrollIntoView({ block: "start" });
  card
    .querySelector("[data-tour-path], .quick-actions .primary")
    ?.focus({ preventScroll: true });
}
// A setup input by its scenario path, or "linked:<key>" for a per-paycheck
// amount read from paystubs.
// A setup control's value in scenario units.
function inputValue(el, path) {
  const kind = el.dataset.type;
  return kind === "check"
    ? el.checked
    : kind === "bool"
      ? el.value === "true"
      : el.tagName === "SELECT" || ["date", "text"].includes(kind)
        ? path === "compensation.bonusMonth"
          ? Number(el.value)
          : el.value
        : el.value === ""
          ? null
          : (Number(el.value) * (kind === "years" ? 12 : 1)) /
            (kind === "percent" ? 100 : 1);
}
// Saves a setup control into next. One answer can fill related fields (e.g.
// one share price), but never a value the user set or confirmed, and the
// copies stay unmarked so later uploads or edits can still fill them.
function editField(next, el, path) {
  const value = inputValue(el, path),
    locked = Profile.lockedPaths(scenario);
  Profile.edit(next, path, value);
  for (const p of (el.dataset.also || "")
    .split(",")
    .filter((p) => p && !locked.includes(p)))
    set(next, p, value);
}
const fieldFor = (path) =>
  $("setup").querySelector(
    path.startsWith("linked:")
      ? `[data-linked="${CSS.escape(path.slice(7))}"]`
      : `[data-path="${CSS.escape(path)}"]`,
  );
// Shows the one field for a path: its step, any collapsed parents or chip,
// focus.
function jumpTo(path) {
  const el = fieldFor(path);
  if (!el) return;
  const step = Number(el.closest("[data-profile-step]")?.dataset.profileStep);
  if (step !== profileStep) {
    profileStep = step;
    renderProfile();
  }
  for (
    let d = el.closest("details");
    d;
    d = d.parentElement?.closest("details")
  )
    d.open = true;
  // A value shown as a chip opens its control first.
  el.closest(".chip-control[hidden]")?.previousElementSibling?.click();
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
  const cell = el.closest(".profile-cell");
  cell?.classList.add("jump-flash");
  setTimeout(() => cell?.classList.remove("jump-flash"), 1600);
}
function renderSetup() {
  markFirstReview();
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
  // The share price slider replaces each market-price field.
  const sharePrice = Profile.sharePrice(scenario),
    sharePriceSet = !!sharePrice,
    sharePriceNote = sharePriceSet
      ? `<p class="grant-summary">Vests and purchases use the company share price of <strong>${money(sharePrice.price)}</strong>, set on the slider above.</p>`
      : "";
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
    reviewBlock(
      "Your tax situation",
      () =>
        field(t + "age", "Your age") +
        field(t + "settings.filing", "Filing status", [
          ["single", "Single"],
          ["married", "Married filing jointly"],
        ]) +
        field(t + "settings.state", "Where you pay income tax", [
          ["CA", "California"],
          ["none", "No state income tax"],
          ["custom", "Other state (effective rate)"],
        ]) +
        (scenario.taxProfile.settings.state === "custom"
          ? field(
              t + "settings.customStateRate",
              "State effective rate",
              "percent",
            )
          : "") +
        (scenario.taxProfile.settings.filing === "married"
          ? field(t + "settings.spouseIncome", "Spouse's annual wages")
          : "") +
        detailLine(
          "Tax year ",
          chip(t + "year", "Starting tax year", "count"),
          " · Local income tax ",
          chip(
            t + "settings.localRate",
            "City or local income tax rate",
            "percent",
          ),
        ),
    ) +
    `<p class="cf-note">${limits.year} limits: employee 401(k) ${money(limits.deferral)}, total plan ${money(limits.total401k)}, IRA ${money(limits.ira)}. Catch-up eligibility is applied by age.</p>` +
    group(
      "Additional tax information",
      field(t + "settings.spouseIncome", "Spouse's annual wages") +
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
    ) +
    group(
      "Your W-4 (optional)",
      field(t + "settings.withholdingMethod", "Forecast withholding", [
        ["annual-estimate", "Estimated annual tax"],
        ["w4", "W-4 payroll method"],
      ]) +
        field(t + "settings.w4Credits", "W-4 annual credits") +
        field(t + "settings.w4OtherIncome", "W-4 other income") +
        field(t + "settings.w4Deductions", "W-4 deductions") +
        field(t + "settings.w4MultipleJobs", "W-4 multiple jobs", "check"),
    );
  // Settings that describe the model rather than the user, gathered in one
  // collapsed group so setup never asks for them.
  const modelAssumptions = group(
    "Inflation, returns and future limits",
    field(p + "years", "Projection years") +
      field(p + "inflation", "Annual inflation", "percent") +
      field(p + "marketReturn", "Annual nominal investment return", "percent") +
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
      ),
  );

  const funding = Profile.employerFunding(scenario, result?.rows[1]?.payroll);
  const fundingSummary = `<div class="funding-summary"><h3>Employer retirement funding</h3>${table(["Reported YTD", "Projected remaining", "Projected annual total"], [[funding.ytd == null ? "No YTD uploaded" : money(funding.ytd), money(funding.remaining), money(funding.total)]])}<p class="cf-note">${funding.date ? `YTD through ${escape(funding.date)}. ` : ""}Reported YTD is already included in the projection. An annual target or matching rule sets expected future funding.</p></div>`;
  // Your employer's 401(k) rules; your own IRA is saving outside work.
  const employerRetirement =
    fundingSummary +
    paycheckItemNote(["traditional", "roth", "mega"]) +
    reviewBlock(
      "Employer match",
      () =>
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
        detailLine(
          "Plus fixed employer funding of ",
          chip(r + "employerAnnual", "Fixed annual employer funding", "money"),
          " a year, outside the match",
        ),
    ) +
    reviewBlock(
      "After-tax 401(k)",
      () =>
        field(
          r + "megaEnabled",
          "After-tax retirement contributions",
          "check",
        ) +
        (plan.retirement.megaEnabled
          ? detailLine(
              "Employer cap ",
              chip(
                r + "megaAnnualCap",
                "Employer annual mega backdoor cap",
                "money",
                null,
                "none beyond IRS limits",
              ),
              " a year",
            )
          : ""),
    );
  const ira = reviewBlock(
    "IRA contributions",
    () =>
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
        ? detailLine(
            "Other pre-tax IRA money ",
            chip(r + "iraPretaxBalance", "Other pre-tax IRA balance", "money"),
            " · Nondeductible basis ",
            chip(r + "iraBasis", "Existing nondeductible IRA basis", "money"),
          )
        : ""),
  );
  const hsa =
    paycheckItemNote(["hsa"]) +
    reviewBlock(
      "HSA eligibility & funding",
      () =>
        field(h + "eligible", "HSA eligible", "check") +
        (plan.hsa.eligible
          ? field(h + "coverage", "HSA coverage", [
              ["single", "Self-only"],
              ["family", "Family"],
            ]) +
            (Profile.describe(scenario).last?.current.hsaEmployer != null
              ? `<p class="cf-note">Employer HSA funding: ${money(Profile.describe(scenario).last.current.hsaEmployer)} per paycheck, from your upload.</p>`
              : field(h + "employer", "Annual employer HSA contribution")) +
            detailLine(
              "Eligible for ",
              chip(h + "eligibleMonths", "Eligible months", "count"),
              " months this year",
            )
          : ""),
    );
  const espp =
    reviewBlock(
      "Participation",
      () =>
        field(e + "enabled", "Participate in ESPP", "check") +
        (plan.espp.enabled
          ? // A per-paycheck dollar election from a paystub drives payroll; the
            // percent rate only applies when the election is a percentage.
            (scenario.uploads.elections.espp
              ? paycheckItemNote(["espp"])
              : field(e + "rate", "Payroll contribution", "percent")) +
            field(
              e + "bonusEligible",
              "Include bonus in eligible ESPP pay",
              "check",
            )
          : ""),
    ) +
    (plan.espp.enabled
      ? reviewBlock(
          "Offerings",
          () =>
            field(e + "start", "Current offering started", "date") +
            field(e + "periodMonths", "Months per offering") +
            detailLine(
              "Offering ends ",
              chip(
                e + "end",
                "Current offering ends",
                "date",
                null,
                "when its months are up",
              ),
              " · Re-enroll in new offerings: ",
              chip(
                e + "autoEnroll",
                "Re-enroll in each new offering",
                "bool",
                null,
                // Plans re-enroll by default.
                "yes",
              ),
              " · First offering you joined: ",
              chip(
                e + "firstEnrollmentDate",
                "First offering you joined",
                "date",
                null,
                "the current one",
              ),
            ),
        ) +
        reviewBlock(
          "Purchase price",
          () =>
            field(e + "discount", "Discount", "percent") +
            field(
              e + "lookback",
              "Lookback: pay the lower of the two prices",
              "check",
            ) +
            field(
              e + "offerPrice",
              "Market price when the offering started",
              "number",
              "Before the discount.",
            ) +
            (plan.espp.lookback
              ? `<div class="profile-cell"><label class="field"><span>Most you'll pay per share</span><input type="number" step="any" data-espp-ceiling value="${(plan.espp.offerPrice * (1 - plan.espp.discount)).toFixed(2)}"><small>After the discount. Enter this if it's the number you know; we work out the offering price from it.</small></label></div>`
              : "") +
            (sharePriceSet
              ? ""
              : field(
                  e + "purchasePrice",
                  "Expected market price on purchase day",
                  "number",
                  "Before the discount.",
                )),
          esppPriceNote(fieldConfig.espp) + sharePriceNote,
        ) +
        `<details class="plan-limits"><summary>Plan limits</summary><div class="field-grid">${
          field(e + "shareCap", "Most shares per offering (0 means none)") +
          field(
            e + "annualPayrollCap",
            "Employer yearly payroll cap (0 means none)",
          ) +
          field(
            e + "annualFmvLimit",
            "Yearly limit on stock value at offering prices",
          ) +
          field(e + "fractional", "Fractional shares", "check")
        }</div></details>` +
        reviewBlock(
          "After purchase",
          () =>
            field(e + "holdShares", "Hold purchased shares", "check") +
            (!plan.espp.holdShares
              ? (sharePriceSet
                  ? ""
                  : field(e + "salePrice", "Expected sale price")) +
                field(e + "holdMonths", "Months until sale")
              : ""),
        )
      : "");
  const fallback =
    reviewBlock(
      "401(k) elections",
      () =>
        field(r + "max401k", "Maximize employee 401(k)", "check") +
        (!plan.retirement.max401k
          ? field(r + "traditional", "Annual Traditional 401(k) election")
          : "") +
        field(r + "roth", "Annual Roth 401(k) election"),
    ) +
    (plan.retirement.megaEnabled
      ? reviewBlock(
          "Mega backdoor election",
          () =>
            field(r + "maxMega", "Maximize mega backdoor", "check") +
            (!plan.retirement.maxMega
              ? field(r + "mega", "Annual mega backdoor election")
              : ""),
        )
      : "") +
    reviewBlock(
      "HSA election",
      () =>
        field(h + "maxContribution", "Maximize employee HSA", "check") +
        (!plan.hsa.maxContribution
          ? field(h + "employee", "Annual employee HSA contribution")
          : ""),
    );
  const grants = scenario.compensation.grants
    .map((g, i) => {
      const p = c + `grants.${i}.`,
        vests = EquitySchedule.vests(fieldConfig.grants[i]),
        values = vests.map((v) => v.value),
        low = Math.min(...values),
        high = Math.max(...values),
        pace = EquitySchedule.pace(
          fieldConfig.grants[i],
          EquitySchedule.asOf(scenario.taxProfile.year),
        );
      const summary = vests.length
        ? `<p class="grant-summary"><strong>${vests.length} vest${vests.length === 1 ? "" : "s"} of ${Math.round(low) === Math.round(high) ? money(low) : `${money(low)}–${money(high)}`}</strong>, ${escape(longDate(vests[0].date))} to ${escape(longDate(vests.at(-1).date))}${pace.phase ? ` · about ${money(pace.monthlyMarket)} a month now` : ""}</p>`
        : "";
      const uneven = g.evenVesting === false;
      return `<div class="grant-card">${reviewBlock(
        g.name || `Grant ${i + 1}`,
        () =>
          field(p + "name", "Name", "text") +
          field(p + "value", "Total grant value") +
          field(p + "start", "Grant date", "date") +
          field(p + "months", "Vests over (years)", "years") +
          field(p + "interval", "Vests every (months)") +
          field(p + "cliff", "Cliff (months)") +
          field(
            p + "grantPrice",
            "Share price at grant",
            "number",
            "Turns the grant value into shares; it's on your grant letter.",
          ) +
          (sharePriceSet
            ? ""
            : field(
                p + "vestPrice",
                "Expected share price at vest",
                "number",
                "Same as the grant price means no growth.",
              )) +
          field(p + "saleMode", "At vest", [
            ["cover", "Sell to cover taxes"],
            ["hold", "Hold all shares"],
            ["sell", "Sell all shares"],
          ]) +
          field(p + "repeat", "A new grant like this every year", "check") +
          field(p + "evenVesting", "Same amount each year", "check") +
          (uneven
            ? `<label class="profile-cell"><span>Share per year (%)</span><input data-grant-allocation="${i}" value="${EquitySchedule.allocations(
                g,
              )
                .map((x) => Number(x.toFixed(6)))
                .join(
                  " / ",
                )}" aria-label="Share vesting each year for ${escape(g.name)}"><small>One percentage per year, separated by /. Must total 100%.</small></label>`
            : ""),
        summary + sharePriceNote,
      )}<button class="text-button" data-remove-grant="${i}">Remove grant</button></div>`;
    })
    .join("");
  // Salary, pay frequency and payday live with the paychecks (step 2) only.
  const compensation =
    reviewBlock(
      "Bonus & raises",
      () =>
        field(
          c + "bonusPercent",
          "Bonus target",
          "percent",
          scenario.compensation.salary > 0 &&
            scenario.compensation.bonusPercent > 0
            ? `${money(scenario.compensation.salary * scenario.compensation.bonusPercent)} a year before tax`
            : "",
        ) +
        field(c + "salaryGrowth", "Annual raise", "percent") +
        detailLine(
          "Bonus paid in ",
          chip(
            c + "bonusMonth",
            "Bonus month",
            Array.from({ length: 12 }, (_, i) => [
              i + 1,
              new Date(2026, i, 1).toLocaleString("en-US", { month: "long" }),
            ]),
          ),
          " · Company stock grows ",
          chip(c + "stockGrowth", "Company stock growth per year", "percent"),
          " a year",
        ),
    ) +
    `<div id="grant-timeline" class="grant-preview"></div>` +
    grants +
    (!scenario.compensation.grants.length &&
    PaystubParser.vestHistory(
      scenario.uploads.records,
      scenario.taxProfile.year,
    ).vests.length
      ? '<button id="grant-from-vests" class="primary">Start a grant from my vests</button>'
      : "") +
    '<button id="add-grant">Add RSU grant</button>';
  const records = [...scenario.uploads.records].sort((x, y) =>
    y.date.localeCompare(x.date),
  );
  const schedule = Profile.describe(scenario).schedule;
  const scheduleNote =
    records.length && !schedule.confirmed
      ? `<p class="plan-review-note">One paystub can't show how often you're paid. Add the paycheck before your latest one, or choose your schedule below.</p>`
      : "";
  const stubs = `<section class="stub-card"><div class="stub-card-head"><h3>Your paystubs</h3><label class="button">${records.length ? "Add paystubs" : "Choose paystub PDFs"}<input id="paystubs" type="file" accept="application/pdf" multiple hidden></label></div>${
    records.length
      ? `<ul class="stub-list">${records
          .map(
            (r) =>
              `<li><span>${escape(longDate(r.date))}</span><span class="stub-kind">${escape(PaystubParser.kindLabels[r.kind || "regular"] || "Paycheck")}</span>${stubAmount(r)}</li>`,
          )
          .join("")}</ul>`
      : `<p class="cf-note">PDFs are read on this device and never uploaded.</p>`
  }</section>`;
  // This calendar year's totals: year-to-date from paystubs plus the rest of
  // the year, so mid-year starts and changes are counted correctly.
  const yearRow = result?.rows.find(
    (x, i) => i > 0 && x.year === scenario.taxProfile.year,
  );
  const totals = Profile.yearTotals(yearRow?.payroll);
  const linked = (keys) =>
    keys.map((k) => linkedField(k, totals, yearRow?.payroll)).join("");
  const uploads =
    stubs +
    `<div id="upload-status" role="status"></div><div id="upload-review"></div>` +
    scheduleNote +
    reviewBlock(
      "Your pay",
      () =>
        field(
          c + "salary",
          "Annual base salary",
          "number",
          payMeaning(scenario.compensation),
        ) +
        detailLine(
          "Paid ",
          chip(c + "frequency", "How often you're paid", [
            ["biweekly", "every two weeks"],
            ["semimonthly", "twice a month"],
            ["monthly", "once a month"],
            ["weekly", "every week"],
          ]),
          // A regular paystub dates the pay calendar; only without one is a
          // payday worth asking for.
          records.some((r) => (r.kind || "regular") === "regular")
            ? ", on the dates of your paystubs"
            : [
                ", recent payday ",
                chip(
                  c + "firstPayday",
                  "A recent payday",
                  "date",
                  null,
                  "not set",
                ),
              ],
        ),
    ) +
    (records.length
      ? linkedGroup(
          "Taken out of each paycheck",
          "Enter whichever number you have. The others fill in.",
          linked([
            "traditional",
            "roth",
            "mega",
            "hsa",
            "espp",
            "health",
            "post",
          ]),
        ) +
        linkedGroup(
          "Added to your pay",
          "",
          linked(["allowance", "taxableAllowance", "imputed"]),
        )
      : compactGroup(
          "Contributions & benefits without a paystub",
          fallback +
            reviewBlock("Monthly benefits", () =>
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
            ),
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
      : "");
  const balances = () =>
    Object.entries({
      cash: "Cash",
      brokerage: "Taxable investments",
      pretax401k: "Traditional 401(k)",
      rothAccounts: "Roth accounts",
      traditionalIRA: "Traditional IRA (included in backdoor pro-rata tax)",
      hsa: "HSA",
    })
      .map(([key, label]) => field(p + "startingBalances." + key, label))
      .join("");
  // One monthly total, saved as Other, until categories are filled in;
  // then every category shows.
  const spending = scenario.projection.monthlyExpenses,
    brokenDown = Object.entries(spending).some(
      ([key, v]) => key !== "other" && v > 0,
    ),
    category = (key) =>
      field(p + "monthlyExpenses." + key, key[0].toUpperCase() + key.slice(1));
  const expenses = () =>
    brokenDown
      ? Object.keys(spending).map(category).join("")
      : field(p + "monthlyExpenses.other", "Total monthly spending") +
        `<details class="spending-breakdown" data-key="spending-breakdown"><summary>Break it down</summary><div class="field-grid">${Object.keys(
          spending,
        )
          .filter((key) => key !== "other")
          .map(category)
          .join("")}</div></details>`;
  const retirementPlan =
    reviewBlock(
      "When you retire",
      () =>
        field(p + "retirementAge", "Retirement age") +
        field(p + "socialSecurityAnnual", "Annual Social Security benefit") +
        detailLine(
          "Social Security starts at age ",
          chip(
            p + "socialSecurityStartAge",
            "Social Security start age",
            "count",
          ),
        ),
    ) +
    reviewBlock(
      "Monthly spending",
      () =>
        (scenario.projection.monthlyExpenses.other > 0 &&
        Object.entries(scenario.projection.monthlyExpenses).some(
          ([key, v]) => key !== "other" && v > 0,
        )
          ? '<p class="plan-review-note">Your total is saved under Other. Lower it by the amounts you entered in other categories so nothing is counted twice.</p>'
          : '<p class="cf-note">Leave out anything already taken from your paycheck, like insurance premiums.</p>') +
        expenses(),
    );
  const savings = ira + reviewBlock("What you have today", balances);
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
    `<div data-profile-step="0" class="profile-panel"><h2>Paychecks</h2><p class="panel-intro">${scenario.uploads.records.length ? "Your pay and what comes out of each check." : "Add your latest paycheck and the one before it, plus any RSU vest or bonus payslips."}</p>${uploads}</div>` +
    `<div data-profile-step="2" class="profile-panel plan-panel"><div class="plan-sections">` +
    section(
      "pay",
      "Pay & equity",
      compensation +
        (espp
          ? `<h4 class="plan-subhead" id="plan-espp">ESPP</h4>${espp}`
          : ""),
      ["allowance", "espp"],
    ) +
    section(
      "employer",
      "From your employer",
      employerRetirement + `<h4 class="plan-subhead">HSA</h4>${hsa}`,
      ["mega", "employer", "hsa"],
    ) +
    section("savings", "Saving outside work", savings) +
    section("retirement", "Retirement & spending", retirementPlan) +
    section("assumptions", "Assumptions", modelAssumptions) +
    `</div></div>`;
  $("setup")
    .querySelectorAll("details")
    .forEach((x) => (x.open = open.has(detailKey(x))));
  // One bar per step names its estimates and offers to go through them one
  // at a time, each field moved into a card at the top of the step.
  $("setup")
    .querySelectorAll("[data-profile-step]")
    .forEach((panel) => {
      const bars = [...panel.querySelectorAll(".review-block > .review-bar")];
      const paths = [
        ...new Set(
          bars.flatMap((b) =>
            b.querySelector("[data-confirm-all]").dataset.confirmAll.split(","),
          ),
        ),
      ];
      bars.forEach((b) => b.remove());
      const step = Number(panel.dataset.profileStep),
        place = (html) => {
          const quick = panel.querySelector("#quick-card");
          quick
            ? quick.insertAdjacentHTML("afterend", html)
            : panel.insertAdjacentHTML("afterbegin", html);
        };
      if (estimateTour?.step === step) return placeTour(panel, place);
      if (!paths.length) return;
      const label = (path) =>
          panel
            .querySelector(`[data-path="${CSS.escape(path)}"]`)
            ?.getAttribute("aria-label")
            ?.replace(/ \(%\)$/, "") || Presentation.labelFor(path),
        shown = paths.slice(0, 6),
        names =
          shown
            .map(
              (path) =>
                `<button type="button" class="link-button" data-jump="${escape(path)}">${escape(label(path))}</button>`,
            )
            .join(", ") +
          (paths.length > shown.length
            ? ` and ${paths.length - shown.length} more`
            : "");
      place(
        `<div class="review-bar state-review step-review"><span><strong>${paths.length === 1 ? "1 value on this step is an estimate" : `${paths.length} values on this step are estimates`}.</strong> They're highlighted below: ${names}.</span><button type="button" class="primary" data-tour-start="${escape(paths.join(","))}">Go through ${paths.length === 1 ? "it" : "them"}</button></div>`,
      );
    });
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
  bindTour();
  $("setup")
    .querySelectorAll("[data-confirm-all]")
    .forEach((button) => {
      button.onclick = () => {
        const next = structuredClone(scenario);
        for (const path of button.dataset.confirmAll.split(","))
          Profile.confirm(next, path);
        commit(next);
      };
    });
  $("setup")
    .querySelectorAll("[data-espp-ceiling]")
    .forEach(
      (el) =>
        (el.onchange = () =>
          deferUntilFocusMoves(() => {
            const next = structuredClone(scenario),
              d = Math.min(0.99, Math.max(0, next.employerPlan.espp.discount));
            if (el.value === "") return;
            Profile.edit(
              next,
              "employerPlan.espp.offerPrice",
              Number(el.value) / (1 - d),
            );
            commit(next);
          })),
    );
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
            const next = structuredClone(scenario);
            editField(next, el, el.dataset.path);
            commit(next);
          })),
    );
  $("setup")
    .querySelectorAll("[data-linked]")
    .forEach(
      (el) =>
        (el.onchange = () =>
          deferUntilFocusMoves(() => {
            const next = structuredClone(scenario),
              unit = el.dataset.unit;
            Profile.setElection(
              next,
              el.dataset.linked,
              unit,
              (Number(el.value) || 0) / (unit === "percent" ? 100 : 1),
            );
            commit(next);
          })),
    );
  $("setup")
    .querySelectorAll("[data-use-plan]")
    .forEach(
      (el) =>
        (el.onclick = () => {
          const next = structuredClone(scenario);
          Profile.setElection(
            next,
            el.dataset.usePlan,
            "check",
            Number(el.dataset.amount),
          );
          commit(next);
        }),
    );
  $("setup").querySelectorAll("[data-limit-chart]").forEach(bindLimitChart);
  $("setup")
    .querySelectorAll("[data-goto-step]")
    .forEach(
      (el) =>
        (el.onclick = () => {
          profileStep = Number(el.dataset.gotoStep);
          renderProfile();
        }),
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
  if ($("grant-from-vests"))
    $("grant-from-vests").onclick = () => {
      const next = structuredClone(scenario),
        grant = Profile.grantFromVests(
          PaystubParser.vestHistory(next.uploads.records, next.taxProfile.year),
        );
      if (!grant) return;
      next.compensation.grants.push(grant);
      commit(next);
    };
  $("setup")
    .querySelectorAll("[data-chip]")
    .forEach((chipButton) => {
      chipButton.onclick = () => {
        const box = chipButton.nextElementSibling,
          control = box.firstElementChild;
        chipButton.hidden = true;
        box.hidden = false;
        control.focus();
        control.addEventListener("blur", () => {
          box.hidden = true;
          chipButton.hidden = false;
        });
        control.addEventListener("keydown", (event) => {
          if (event.key === "Escape" || event.key === "Enter") control.blur();
        });
      };
    });
  $("setup")
    .querySelectorAll("[data-jump]")
    .forEach((el) => (el.onclick = () => jumpTo(el.dataset.jump)));
  bindQuickQuestions();
  $("setup")
    .querySelectorAll("[data-open-espp]")
    .forEach(
      (el) =>
        (el.onclick = () => {
          profileStep = 2;
          renderProfile();
          $("plan-espp")?.scrollIntoView({ block: "start" });
        }),
    );
  $("setup")
    .querySelectorAll("[data-open-grants]")
    .forEach(
      (el) =>
        (el.onclick = () => {
          profileStep = 2;
          renderProfile();
          $("plan-pay")?.scrollIntoView({ block: "start" });
        }),
    );
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
// A new profile models the current year (the engine starts at 2026).
function freshScenario() {
  const s = Scenario.defaults();
  s.taxProfile.year = Math.max(s.taxProfile.year, new Date().getFullYear());
  return s;
}
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
// One company share price for every view. Dragging previews without saving;
// letting go saves it. Typing a price also makes it the new reference.
let priceDragging = false,
  pricePreview = 0;
const compTotal = (s, r) =>
  Presentation.compensation(
    CompactFlow.build(
      r.ongoing.payroll,
      r.ongoing.flow,
      Scenario.engineInput(s),
    ),
  ).total;
// Total compensation at the reference price, recomputed only when an input
// other than the share price changes.
let priceBase = { key: "", total: 0 };
function equityReadout(reference) {
  if (!Profile.hasIncome(scenario)) return "";
  const total = compTotal(scenario, result);
  const base = structuredClone(scenario);
  base.compensation.sharePrice = reference;
  const key = JSON.stringify(base);
  if (key !== priceBase.key) {
    const s = Scenario.normalize(base);
    priceBase = { key, total: compTotal(s, Projection.calculate(s)) };
  }
  const diff = total - priceBase.total;
  // The total is on the page already; the bar shows what the price adds.
  return Math.abs(diff) >= 1
    ? `<strong>${diff > 0 ? "+" : "−"}${dollars(Math.abs(diff))}</strong> a year in compensation`
    : "";
}
function priceChange(price, p) {
  const pct = Math.round((price / p.reference - 1) * 100),
    to = p.fromGrant ? "your latest grant" : money(p.reference);
  return pct === 0 ? `Same as ${to}` : `${pct > 0 ? "+" : ""}${pct}% vs ${to}`;
}
function renderPriceBar() {
  const bar = $("price-bar"),
    p = view !== "welcome" && Profile.sharePrice(scenario);
  bar.hidden = !p;
  if (!p) return;
  if (priceDragging) {
    bar.querySelector("[data-price-readout]").innerHTML = equityReadout(
      p.reference,
    );
    return;
  }
  const at = (p.reference - p.min) / (p.max - p.min);
  bar.innerHTML = `<div class="price-head"><span class="price-label">Company share price</span><label class="price-exact"><span aria-hidden="true">$</span><input type="number" id="share-price-input" aria-label="Exact share price" min="0.01" step="0.01" value="${p.price.toFixed(2)}"></label><span class="price-change" data-price-change>${escape(priceChange(p.price, p))}</span><button type="button" class="price-reset" data-price-reset ${p.price === p.reference ? "hidden" : ""}>Reset to ${money(p.reference)}</button><span class="price-readout" data-price-readout>${equityReadout(p.reference)}</span></div><div class="price-control"><input type="range" id="share-price-range" aria-label="Company share price" min="${p.min}" max="${p.max}" step="0.01" value="${p.price}" aria-valuetext="${escape(`${money(p.price)}, ${priceChange(p.price, p)}`)}"><span class="price-scale"><span>${money(p.min)}</span><span class="price-tick" style="--at:${at.toFixed(4)}">${money(p.reference)}${p.fromGrant ? " grant" : ""}</span><span>${money(p.max)}</span></span></div>`;
  const range = $("share-price-range");
  const preview = (value) => {
    const next = structuredClone(scenario);
    next.compensation.sharePrice = value;
    return next;
  };
  range.oninput = () => {
    const value = Number(range.value);
    priceDragging = true;
    $("share-price-input").value = value.toFixed(2);
    bar.querySelector("[data-price-change]").textContent = priceChange(
      value,
      p,
    );
    bar.querySelector("[data-price-reset]").hidden = value === p.reference;
    range.setAttribute(
      "aria-valuetext",
      `${money(value)}, ${priceChange(value, p)}`,
    );
    if (pricePreview) return;
    pricePreview = setTimeout(() => {
      pricePreview = 0;
      // Preview only: the saved scenario changes when the slider is let go.
      const saved = scenario;
      scenario = Scenario.normalize(preview(Number(range.value)));
      result = Projection.calculate(scenario);
      render();
      scenario = saved;
    });
  };
  range.onchange = () => {
    clearTimeout(pricePreview);
    pricePreview = 0;
    priceDragging = false;
    commit(preview(Number(range.value)));
  };
  $("share-price-input").onchange = (event) => {
    const value = Number(event.target.value);
    if (!(value > 0)) return renderPriceBar();
    commit(preview(value));
  };
  bar.querySelector("[data-price-reset]").onclick = () =>
    commit(preview(p.reference));
}
const modelNotesDisclosure = (html) =>
  html
    ? `<details class="context-help"><summary>Model notes</summary>${html}</details>`
    : "";
// A new view opens at the top and a new setup step at its tabs; drawing the
// same place again, as after an edit, keeps the scroll position.
let shownPlace = "";
function settleScroll() {
  const place = view === "profile" ? `profile:${profileStep}` : view,
    sameView = shownPlace.split(":")[0] === view;
  if (place === shownPlace) return;
  shownPlace = place;
  const steps = document.querySelector(".profile-steps");
  if (!sameView) scrollTo(0, 0);
  else if (steps.getBoundingClientRect().top < 0)
    steps.scrollIntoView({ block: "start" });
}
function render() {
  const ready = Profile.hasIncome(scenario);
  $("attention").replaceChildren();
  $("attention").hidden = true;
  $("accuracy").hidden = true;
  if (!ready && !["profile", "welcome"].includes(view)) view = "welcome";
  if (ready && view === "welcome") view = "monthly";
  settleScroll();
  renderPriceBar();
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
    // Past vests show on paystubs; future ones need the grant behind them.
    const vests = PaystubParser.vestHistory(
      scenario.uploads.records,
      scenario.taxProfile.year,
    );
    if (
      vests.ytd > 0 &&
      !scenario.compensation.grants.some((g) => g.value > 0)
    ) {
      $("salary-context").insertAdjacentHTML(
        "beforeend",
        `<p class="flow-hint">Your paystubs show ${money(vests.ytd)} of RSU vests this year. Equity stays at $0 here until you add the grant behind them. <button type="button" class="text-button" data-flow-grants>Add your grant</button></p>`,
      );
      $("salary-context").querySelector("[data-flow-grants]").onclick = () => {
        profileStep = 2;
        document.querySelector('[data-view="profile"]').click();
        $("plan-pay")?.scrollIntoView({ block: "start" });
      };
    }
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
      focusQuick();
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
      focusQuick();
    };
}
function renderProjection() {
  const rows = result.rows,
    real = $("real").checked,
    series = [
      ["Cash", "var(--cash)", (b) => b.cash + b.esppPending],
      ["Equity", "var(--equity)", (b) => b.brokerage + b.companyEquity],
      [
        "Retirement + HSA",
        "var(--retire)",
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
      return `<path d="${path}" style="fill:${color}" opacity=".6"><title>${name}</title></path>`;
    })
    .join("");
  $("projection-chart").innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Projected assets by class">${areas}<text x="50" y="18" style="fill:var(--text)">${escape(money(max))}</text><text x="50" y="325" style="fill:var(--text-2)">Starting balances</text><text x="780" y="325" style="fill:var(--text-2)">Age ${rows.at(-1).age}</text></svg><p>${series.map(([n, color]) => `<span style="color:${color};margin-right:18px">● ${n}</span>`).join("")}</p>`;
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
// "Add more" keeps the paystubs already read and in review.
async function readPaystubs(event, append = false) {
  const status = $("upload-status");
  status.textContent = "Reading locally…";
  if (!append) drafts = [];
  try {
    const files = [...event.target.files];
    if (files.length + drafts.length > 12)
      throw new Error("Choose up to 12 PDFs.");
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
        // The same file chosen twice is read once.
        if (!drafts.some((d) => d.id === id)) drafts.push(record);
      } finally {
        await loadingTask.destroy();
      }
    }
    status.textContent = "";
    reviewUploads();
    showReview();
  } catch (error) {
    status.textContent = error.message;
    if (append) reviewUploads();
    else drafts = [];
  }
}
// A paystub's headline amount, named: take-home for a paycheck, the amount
// before tax for an RSU vest or bonus check, which often pay no cash.
function stubAmount(r) {
  const [value, what] =
    r.kind === "equity"
      ? [r.current.rsu, "vested"]
      : r.kind === "bonus"
        ? [r.current.bonus, "before tax"]
        : [r.netPay, "take-home"];
  return `<strong>${money(value)} <small>${what}</small></strong>`;
}
function reviewUploads() {
  const checks = drafts
    .map((r, i) => {
      const v = PaystubParser.validate(r);
      return `<li class="review-row${v.valid ? "" : " has-error"}"><details ${v.valid ? "" : "open"}><summary><span>${escape(longDate(r.date))}</span><span class="stub-kind">${escape(PaystubParser.kindLabels[r.kind] || "Paycheck")}</span>${stubAmount(r)}<span class="review-state">${v.valid ? "✓ Totals match" : "Needs a fix"}</span></summary><div class="review-body"><label class="field">Check date<input type="date" data-review-date="${i}" value="${escape(r.date)}"></label><p class="cf-note">${
        r.kind === "equity"
          ? `RSU vest ${money(r.current.rsu)} · Shares delivered ${money(r.current.rsuOffset || 0)} · Tax withheld ${money(r.summary?.current?.taxes || 0)}`
          : r.kind === "bonus"
            ? `Bonus ${money(r.current.bonus)} · Deposited cash ${money(r.netPay)}`
            : `Salary ${money(r.current.salary)} · Deposited cash ${money(r.netPay)}`
      }</p><div class="table-scroll"><table class="review-lines"><thead><tr><th>Printed label</th><th>Category</th><th>Current</th><th>YTD</th></tr></thead><tbody>${r.lines
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
                ? `<div class="benefit-options"><label>Repeats<select data-benefit-schedule="${i}:${j}">${Object.entries(
                    {
                      review: "Confirm schedule",
                      paycheck: "Every paycheck",
                      monthly: "First paycheck each month",
                      quarterly: "Every 3 months",
                      annual: "Once a year",
                      once: "This payment only",
                    },
                  )
                    .map(
                      ([k, v]) =>
                        `<option value="${k}" ${(l.schedule || (["commuter", "parking"].includes(l.key) ? "review" : "paycheck")) === k ? "selected" : ""}>${v}</option>`,
                    )
                    .join(
                      "",
                    )}</select></label><label>Employer annual cap (optional)<input type="number" min="0" step=".01" data-benefit-cap="${i}:${j}" value="${l.annualCap ?? ""}"></label></div>`
                : ""
            }</td><td><input aria-label="Current ${escape(l.label)}" type="number" step=".01" data-review-value="${i}:${j}:current" value="${l.current ?? ""}"></td><td><input aria-label="YTD ${escape(l.label)}" type="number" step=".01" data-review-value="${i}:${j}:ytd" value="${l.ytd ?? ""}"></td></tr>`,
        )
        .join(
          "",
        )}</tbody></table></div>${v.valid ? "" : `<p class="review-error">${v.errors.map(escape).join(" ")}</p>`}</div></details></li>`;
    })
    .join("");
  const hints = PaystubParser.uploadHints([
      ...scenario.uploads.records.filter(
        (x) => !drafts.some((d) => d.date === x.date && d.kind === x.kind),
      ),
      ...drafts,
    ]),
    gapItems = hints
      .map(
        (h) =>
          `<li><strong>${escape(h.ask)}</strong><span>${escape(h.gap)}</span>${h.tip ? `<small>${escape(h.tip)}</small>` : ""}</li>`,
      )
      .join(""),
    hintList = hints.length
      ? `<div class="review-hints"><div class="review-hints-head"><span>These would make your results more accurate. You can add them now or later.</span><label class="button">Add more<input data-more-paystubs type="file" accept="application/pdf" multiple hidden></label></div><ol class="gap-list">${gapItems}</ol></div>`
      : "";
  // Off-cycle checks alone carry no salary or payday schedule to fill.
  const schedule = `<label class="check review-schedule"${drafts.some((r) => r.kind === "regular") ? "" : " hidden"}><input id="apply-schedule" type="checkbox" checked>Also update salary and pay schedule</label>`;
  // One row per paystub; a row opens to its line items only when asked, or
  // on its own when its totals don't add up.
  $("upload-review").innerHTML =
    `<section class="stub-card review-card"><div class="stub-card-head"><h3>Ready to add</h3><button id="apply-upload" class="primary">Use ${drafts.length === 1 ? "this paystub" : `these ${drafts.length} paystubs`}</button></div><ul class="stub-list review-list">${checks}</ul>${schedule}${hintList}</section>`;
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
          drafts[i].lines[j].scheduleSet = true;
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
  markFirstReview();
  $("upload-review")
    .querySelectorAll("[data-more-paystubs]")
    .forEach((el) => (el.onchange = (event) => readPaystubs(event, true)));
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
// The review card opens in view with its next step focused: the button when
// every paystub adds up, otherwise the first one to fix.
function showReview() {
  const card = $("upload-review").querySelector(".review-card"),
    apply = $("apply-upload");
  if (!card) return;
  card.scrollIntoView({ block: "start" });
  const next = apply.disabled
    ? [...card.querySelectorAll(".has-error select")].find(
        (x) => x.value === "review" || x.value === "",
      ) || card.querySelector(".has-error summary")
    : apply;
  next?.focus({ preventScroll: true });
}
// Before the first paystubs are used, the empty pay fields below the review
// only add scrolling.
function markFirstReview() {
  $("setup").classList.toggle(
    "first-review",
    drafts.length > 0 && !scenario.uploads.records.length,
  );
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
$("reset").onclick = () => {
  closeScenarioMenu();
  $("reset-dialog").showModal();
};
$("reset-export").onclick = () => $("export").click();
$("reset-cancel").onclick = () => $("reset-dialog").close();
// Clears the saved scenario and every per-session choice, then shows the
// welcome screen as on a first visit.
$("reset-confirm").onclick = () => {
  $("reset-dialog").close();
  drafts = [];
  keptValues = [];
  quickAsked.clear();
  quickSkipped.clear();
  quickCurrent = "";
  estimateTour = null;
  profileStep = 0;
  showLearned = false;
  compPeriod = "year";
  compOpen.clear();
  view = "welcome";
  commit(freshScenario());
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
  } else scenario = freshScenario();
  view = Profile.initialView(scenario);
  result = Projection.calculate(scenario);
  setup();
  render();
  if (warnings.length) $("status").textContent = warnings.join(" ");
} catch (error) {
  $("status").textContent =
    `Saved scenario could not be loaded: ${error.message}. Your original data has not been overwritten. Import a corrected scenario to continue.`;
}

// One paycheck item with linked inputs: type the number you have in any unit
// and the others are computed. The unit you typed is stored and highlighted.
function linkedField(key, totals, yearPayroll) {
  const e = scenario.uploads.elections[key];
  if (!e) return "";
  const [label, hint] = PAY_ITEMS[key] || [PaystubParser.labels[key], ""];
  const eq = Profile.equivalents(scenario, key, e),
    units = Profile.amountUnits(key),
    entered = e.unit || (e.mode === "percent" ? "percent" : "check");
  const shown = (u) =>
    eq[u] == null
      ? ""
      : Number((u === "percent" ? eq[u] * 100 : eq[u]).toFixed(2));
  const inputs = units
    .map(
      (u) =>
        `<label class="unit-input${u === entered ? " is-entered" : ""}">${u === "percent" ? "" : '<span class="affix">$</span>'}<input type="number" step="any" min="0" inputmode="decimal" data-linked="${key}" data-unit="${u}" data-key="linked:${key}:${u}" value="${shown(u)}" ${u === "percent" && eq.percent == null ? 'disabled placeholder="Add salary"' : ""} aria-label="${escape(label)}, ${UNIT_LABEL[u]}">${u === "percent" ? '<span class="affix">%</span>' : ""}<span class="unit">${UNIT_LABEL[u]}</span></label>`,
    )
    .join('<span class="unit-eq" aria-hidden="true">=</span>');
  const bonusNote =
    e.mode === "percent" && eq.year - eq.check * eq.checks > 0.005
      ? " Per year includes your bonus."
      : "";
  const origin = e.manual
    ? `You entered this ${entered === "percent" ? "as a percent of pay" : UNIT_LABEL[entered]}.`
    : e.sourceDate
      ? `From your ${longDate(e.sourceDate)} paystub.`
      : "";
  // Pre-tax and Roth share one limit, shown once under pre-tax.
  const shared = key === "roth" && scenario.uploads.elections.traditional;
  const limit = shared ? null : Profile.limitCheck(scenario, key, totals),
    plan = shared ? null : Profile.limitPlan(scenario, key, yearPayroll);
  const chart = limit && plan?.points.length ? limitChart(plan) : "";
  return `<div class="linked-amount${chart ? " has-chart" : ""}"><div class="la-main"><div class="linked-head"><strong>${escape(label)}</strong>${hint ? `<small>${escape(hint)}</small>` : ""}</div><div class="unit-row">${inputs}</div>${origin || bonusNote ? `<small class="field-origin">${escape(origin + bonusNote)}</small>` : ""}${limit ? limitStatus(key, limit, plan) : ""}</div>${chart}${limit ? limitDetails(key, limit, plan) : ""}</div>`;
}
function shortDate(d) {
  return longDate(d).replace(/, \d{4}$/, "");
}
// One line: where this year ends up against the limit, plus the per-paycheck
// amount that lands on it exactly.
function limitStatus(key, c, p) {
  const end = p ? p.endTotal + p.prior : c.used,
    by = p?.lastDate ? ` by ${shortDate(p.lastDate)}` : " this year",
    limit = `${c.approx ? "about " : ""}${dollars(c.limit)}`;
  const onTrack = Math.abs(end - c.limit) < 1;
  const text = c.over
    ? `<span class="limit-over">${dollars(-c.remaining)} over</span> · payroll stops at ${limit}${p?.reachDate ? ` on ${shortDate(p.reachDate)}` : ""}`
    : onTrack
      ? `<strong>${dollars(end)}</strong>${by} · at the limit`
      : `<strong>${dollars(end)}</strong> of ${limit}${by} · ${dollars(c.limit - end)} under`;
  // Evening out an overage is always offered; maxing out only when it's a
  // realistic share of pay.
  const fix =
    p?.perCheck != null &&
    p.future > 0 &&
    (c.over || p.reachDate || (!onTrack && !(p.percent > 0.5)));
  const button = fix
    ? `<button type="button" class="limit-fix" data-use-plan="${key}" data-amount="${p.perCheck}" title="${escape(`${money(p.perCheck)} on each of your ${p.future} remaining paychecks reaches ${dollars(c.limit)} on ${shortDate(p.lastDate)}${p.percent != null ? ` (about ${Number((p.percent * 100).toFixed(1))}% of pay)` : ""}.`)}">${c.over || p.reachDate ? "Even out" : "Max out"}: ${money(p.perCheck)}/paycheck</button>`
    : "";
  return `<div class="limit-status${c.over ? " is-over" : ""}"><span>${text}</span>${button}</div>`;
}
// The limit's basis, what happens past it, and each paycheck, behind a toggle.
function limitDetails(key, c, p) {
  const notes = [...c.notes];
  if (c.over)
    notes.push(
      key === "espp"
        ? "Money past the limit is usually refunded at purchase."
        : "Payroll stops this contribution once you reach the limit, and the projection does too.",
    );
  if (
    p?.reachDate &&
    key === "traditional" &&
    scenario.employerPlan.retirement.matchTrueUp === false
  )
    notes.push(
      "Your plan doesn't true up the match, so stopping early can cost you employer match.",
    );
  const started = p?.points.find((q) => q.actual && q.value > 0)?.date;
  if (started && started > `${scenario.taxProfile.year}-01-15`)
    notes.push(
      `Started ${shortDate(started)}, worked out from your year-to-date total.`,
    );
  return `<details class="la-details"><summary>How this is calculated</summary><ul class="limit-notes">${notes.map((n) => `<li>${escape(n)}</li>`).join("")}</ul>${
    p?.points.length
      ? table(
          ["Paycheck", "This check", "Total this year"],
          p.points.map((q) => [
            `${longDate(q.date)}${q.actual ? "" : " (projected)"}`,
            money(q.value),
            money(q.total + p.prior),
          ]),
        )
      : ""
  }</details>`;
}
// Cumulative contributions over the calendar year: solid for what paystubs
// confirm or imply, dotted for the projection, a dashed line for the limit.
function limitChart(p) {
  const year = Number(scenario.taxProfile.year),
    t0 = Date.UTC(year, 0, 1),
    t1 = Date.UTC(year + 1, 0, 1);
  const x = (d) => ((Date.parse(`${d}T00:00:00Z`) - t0) / (t1 - t0)) * 100;
  const top = Math.max(p.limit, p.endTotal + p.prior, 1) * 1.15;
  const y = (v) => 100 - ((v + p.prior) / top) * 100;
  const done = [
      { date: `${year}-01-01`, total: 0 },
      ...p.points.filter((q) => q.actual),
    ],
    from = done.at(-1),
    ahead = [from, ...p.points.filter((q) => !q.actual)];
  const path = (pts) =>
    pts
      .map(
        (q, i) =>
          `${i ? "L" : "M"}${x(q.date).toFixed(2)},${y(q.total).toFixed(2)}`,
      )
      .join("");
  const limitY = y(p.limit - p.prior).toFixed(2);
  const points = JSON.stringify(
    p.points.map((q) => [q.date, q.value, q.total + p.prior, q.actual]),
  );
  return `<div class="la-chart"><div class="limit-chart" data-limit-chart="${escape(points)}" role="img" aria-label="${escape(`${p.label}: ${dollars(from.total + p.prior)} from paystubs, ${dollars(p.endTotal + p.prior)} projected by year end, limit ${dollars(p.limit)}`)}"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line class="lc-limit" x1="0" x2="100" y1="${limitY}" y2="${limitY}"/>${done.length > 1 ? `<path class="lc-line lc-actual" d="${path(done)}"/>` : ""}${ahead.length > 1 ? `<path class="lc-line lc-projected" d="${path(ahead)}"/>` : ""}<line class="lc-cursor" x1="0" x2="0" y1="0" y2="100" hidden/></svg><span class="lc-limit-label" style="top:${limitY}%">${dollars(p.limit)}</span><div class="lc-tip" hidden></div></div><div class="lc-months" aria-hidden="true"><span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span></div></div>`;
}
function linkedGroup(title, note, body) {
  return body
    ? `<section class="paycheck-group linked-group"><h3>${escape(title)}</h3>${note ? `<p class="cf-note">${escape(note)}</p>` : ""}${body}</section>`
    : "";
}
// A plan section's pointer to the paycheck item it depends on.
function paycheckItemNote(keys) {
  const parts = keys
    .filter((k) => scenario.uploads.elections[k])
    .map((k) => {
      const e = scenario.uploads.elections[k],
        eq = Profile.equivalents(scenario, k, e);
      const unit = e.unit || (e.mode === "percent" ? "percent" : "check");
      const amount =
        unit === "percent"
          ? `${Number((e.value * 100).toFixed(2))}% of pay (${money(eq.check)} per paycheck)`
          : unit === "check"
            ? `${money(eq.check)} per paycheck`
            : `${money(eq[unit])} ${UNIT_LABEL[unit]} (${money(eq.check)} per paycheck)`;
      return `${escape((PAY_ITEMS[k] || [k])[0])}: ${amount}`;
    });
  return parts.length
    ? `<p class="paycheck-item-note">${parts.join(" · ")}. <button type="button" class="link-button" data-goto-step="0">Change in Your paychecks</button></p>`
    : "";
}
// Crosshair and tooltip for a limit chart: the nearest paycheck's amount and
// running total.
function bindLimitChart(chart) {
  const points = JSON.parse(chart.dataset.limitChart);
  const year = Number(scenario.taxProfile.year),
    t0 = Date.UTC(year, 0, 1),
    t1 = Date.UTC(year + 1, 0, 1);
  const at = (d) => (Date.parse(`${d}T00:00:00Z`) - t0) / (t1 - t0);
  const cursor = chart.querySelector(".lc-cursor"),
    tip = chart.querySelector(".lc-tip");
  chart.onpointermove = (event) => {
    const box = chart.getBoundingClientRect(),
      f = (event.clientX - box.left) / box.width;
    const [date, value, total, actual] = points.reduce((best, q) =>
      Math.abs(at(q[0]) - f) < Math.abs(at(best[0]) - f) ? q : best,
    );
    const pos = at(date) * 100;
    cursor.setAttribute("x1", pos);
    cursor.setAttribute("x2", pos);
    cursor.hidden = false;
    tip.innerHTML = `<strong>${escape(shortDate(date))} · ${actual ? "from paystubs" : "projected"}</strong><span>${money(value)} this check</span><span>${dollars(total)} so far</span>`;
    tip.style.left = `${Math.min(Math.max(pos, 12), 78)}%`;
    tip.hidden = false;
  };
  chart.onpointerleave = () => {
    cursor.hidden = true;
    tip.hidden = true;
  };
}
function compensationView() {
  const { payroll, flow } = result.ongoing;
  const c = Presentation.compensation(
    CompactFlow.build(payroll, flow, Scenario.engineInput(scenario)),
  );
  if (!(c.total > 0)) return "";
  const per = compPeriod === "month" ? 12 : 1,
    unit = compPeriod === "month" ? "a month" : "a year";
  const pct = (v) => {
    const n = (v / c.total) * 100;
    return n > 0 && n < 0.5 ? "<1%" : `${Math.round(n)}%`;
  };
  const bar = (groups, label) =>
    `<div class="comp-bar-row"><span class="comp-bar-label">${label}</span><div class="comp-bar" role="img" aria-label="${escape(`${label}: ${groups.map((g) => `${g.label} ${pct(g.value)}`).join(", ")}`)}">${groups
      .filter((g) => g.value > 0)
      .map(
        (g) =>
          `<span style="flex-grow:${g.value};background:var(--${MONEY_COLOR[g.id]})" title="${escape(g.label)}: ${dollars(g.value / per)}">${g.value / c.total >= 0.08 ? pct(g.value) : ""}</span>`,
      )
      .join("")}</div></div>`;
  const ledger = (title, groups) =>
    `<div class="ledger"><h3>${title}</h3>${groups
      .filter((g) => Math.abs(g.value) > 0.5)
      .map(
        (g) =>
          `<details class="ledger-group" data-comp-group="${g.id}" ${compOpen.has(g.id) ? "open" : ""}><summary><i style="background:var(--${MONEY_COLOR[g.id]})"></i><span>${escape(g.label)}</span><em>${pct(g.value)}</em><strong>${dollars(g.value / per)}</strong></summary><dl>${g.items
            .filter((i) => Math.abs(i.value) >= 0.5 * per)
            .map(
              (i) =>
                `<div><dt>${escape(i.label)}</dt><dd>${dollars(i.value / per)}</dd></div>`,
            )
            .join("")}</dl></details>`,
      )
      .join(
        "",
      )}<div class="ledger-total"><span>Total</span><strong>${dollars(c.total / per)}</strong></div></div>`;
  const pay = c.sources.find((g) => g.id === "pay").value,
    equity = c.sources.find((g) => g.id === "equity").value,
    employer = c.sources.find((g) => g.id === "employer").value;
  const parts = [
    `${dollars(pay / per)} cash pay`,
    equity > 0.5 && `${dollars(equity / per)} in equity`,
    employer > 0.5 && `${dollars(employer / per)} from your employer`,
  ].filter(Boolean);
  return `<section class="comp" aria-labelledby="comp-title"><div class="comp-head"><div><p class="eyebrow" id="comp-title">Total compensation</p><p class="comp-total"><strong>${dollars(c.total / per)}</strong> <span>${unit}</span></p><p class="comp-sub">${parts.join(" + ")}</p></div><div class="segmented" role="group" aria-label="Show amounts"><button type="button" data-comp-period="year" aria-pressed="${compPeriod === "year"}">Per year</button><button type="button" data-comp-period="month" aria-pressed="${compPeriod === "month"}">Per month</button></div></div><div class="comp-bars">${bar(c.sources, "You earn")}${bar(c.uses, "It goes to")}</div><div class="comp-ledgers">${ledger("What you earn", c.sources)}${ledger("Where it goes", c.uses)}</div><p class="cf-note">At your current earning pace, before living expenses. Equity uses the company share price on the slider.</p></section>`;
}
function factsView() {
  return `<section class="you-card" aria-labelledby="you-title"><h2 id="you-title">You</h2><dl class="facts">${Presentation.facts(
    scenario,
    Profile.hasIncome(scenario) ? result.ongoing.payroll : null,
  )
    .map(
      (f) =>
        `<div class="${f.missing ? "fact-missing" : ""}"><dt>${escape(f.label)}</dt><dd>${escape(f.value)}${f.source ? `<small>${escape(f.source)}</small>` : ""}</dd><button type="button" class="link-button" data-fact-step="${f.step}" data-fact-section="${f.section || ""}" data-fact-paths="${escape((f.paths || []).join(" "))}" aria-label="${f.missing ? "Add" : "Edit"} ${escape(f.label)}">${f.missing ? "Add" : "Edit"}</button></div>`,
    )
    .join("")}</dl></section>`;
}
function paycheckView(profile) {
  const p = Presentation.paycheck(profile.last),
    width = (v) => (p.gross > 0 ? Math.min(100, (v / p.gross) * 100) : 0);
  const row = (label, value, id, sign) =>
    `<tr class="${id ? "" : "wf-total"}"><th>${sign ? `<span class="wf-sign">${sign}</span>` : ""}${escape(label)}</th><td class="wf-track"><span style="width:${width(value)}%;background:var(--${id ? MONEY_COLOR[id] : "ink"})"></span></td><td>${money(value)}</td></tr>`;
  const schedule = profile.schedule.confirmed
    ? `Paid ${{ weekly: "every week", biweekly: "every two weeks", semimonthly: "twice a month", monthly: "once a month" }[profile.schedule.frequency] || profile.schedule.frequency}, read from your paystubs.`
    : "Pay frequency needs confirmation.";
  return `<section class="paycheck-card" aria-labelledby="paycheck-title"><div class="paycheck-head"><h2 id="paycheck-title">Latest paycheck</h2><span class="mono">${escape(longDate(profile.last.date))}</span></div><table class="waterfall"><tbody>${row("Gross pay", p.gross, "pay")}${p.steps.map((s) => row(s.label, s.value, s.id, "−")).join("")}${row("Deposited", p.deposit, "", "=")}</tbody></table><p class="cf-note">${p.employer > 0 ? `Your employer also put in ${money(p.employer)} for retirement and HSA. ` : ""}${profile.records} paycheck${profile.records === 1 ? "" : "s"} saved. ${schedule}</p></section>`;
}
function bindProfileOverview() {
  document.querySelectorAll("[data-comp-period]").forEach(
    (b) =>
      (b.onclick = () => {
        compPeriod = b.dataset.compPeriod;
        renderProfile();
      }),
  );
  document
    .querySelectorAll("[data-comp-group]")
    .forEach(
      (d) =>
        (d.ontoggle = () =>
          d.open
            ? compOpen.add(d.dataset.compGroup)
            : compOpen.delete(d.dataset.compGroup)),
    );
  document.querySelectorAll("[data-fact-step]").forEach(
    (b) =>
      (b.onclick = () => {
        const path = b.dataset.factPaths
          .split(" ")
          .find((p) => p && fieldFor(p));
        if (path) return jumpTo(path);
        profileStep = Number(b.dataset.factStep);
        renderProfile();
        const target = b.dataset.factSection && $(b.dataset.factSection);
        (target || $("setup")).scrollIntoView({ block: "start" });
      }),
  );
}
function renderProfile() {
  settleScroll();
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
  $("profile-overview").innerHTML =
    (Profile.hasIncome(scenario) ? compensationView() : "") + factsView();
  $("profile-summary").innerHTML =
    profileStep !== 0
      ? ""
      : profile.last
        ? paycheckView(profile)
        : `<div class="profile-empty"><strong>A paycheck fills in most of your profile.</strong><p>Upload a text-based PDF to extract earnings, deductions, withholding and YTD totals. Your documents stay on this device.</p></div>`;
  bindProfileOverview();
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
  } else document.querySelector('[data-view="monthly"]').click();
};
