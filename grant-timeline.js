(function (root) {
  "use strict";
  const colors = [
    "var(--cash)",
    "var(--retire)",
    "var(--equity)",
    "var(--employer)",
    "var(--tax)",
    "var(--equity-2)",
  ];
  const { escape, money } = root.Util;
  function render(host, grants, date, annual, onChange) {
    if (!host) return;
    if (!grants.length) {
      host.innerHTML =
        '<p class="cf-note">Add a grant to see its quarterly vesting timeline.</p>';
      return;
    }
    const buckets = root.EquitySchedule.timeline(grants, date, annual),
      maximum = Math.max(1, ...buckets.map((b) => b.total));
    host.innerHTML = `<div class="grant-timeline-heading"><h3>Vesting timeline</h3><label>Group by <select aria-label="Vesting timeline grouping"><option value="quarter">Quarter</option><option value="year" ${annual ? "selected" : ""}>Year</option></select></label></div><p class="cf-note">As of ${escape(date)} · One year back and four calendar years ahead, including this year. Whole vests belong to the quarter containing their vest date. Faded blocks have vested; bright blocks are upcoming. Vest values use the company share price on the slider.</p><div class="grant-legend">${grants.map((g, i) => `<span><i style="background:${colors[i % colors.length]}"></i>${escape(g.name || `Grant ${i + 1}`)}</span>`).join("")}</div><div class="grant-timeline-grid" style="--buckets:${buckets.length}">${buckets.map((b, i) => `<button class="grant-bucket" data-bucket="${i}" aria-label="${b.year} ${b.quarter ? `Q${b.quarter}` : ""}: ${money(b.total)}"><span class="grant-stack">${b.parts.map((p) => `<span style="height:${(p.value / maximum) * 100}%;background:${colors[p.index % colors.length]};opacity:${p.vested ? 0.4 : 1}" title="${escape(p.name)}: ${money(p.value)} on ${p.date}"></span>`).join("")}</span><span>${b.quarter ? `Q${b.quarter}` : b.year}</span>${b.quarter ? `<small>${b.year}</small>` : ""}</button>`).join("")}</div><div class="grant-bucket-details" aria-live="polite">Select a quarter or year for the grant breakdown.</div>`;
    host.querySelector("select").onchange = (e) =>
      onChange(e.target.value === "year");
    host.querySelectorAll("[data-bucket]").forEach(
      (button) =>
        (button.onclick = () => {
          const b = buckets[Number(button.dataset.bucket)];
          host
            .querySelectorAll("[data-bucket]")
            .forEach((x) =>
              x.setAttribute("aria-pressed", String(x === button)),
            );
          host.querySelector(".grant-bucket-details").innerHTML =
            `<h4>${b.year}${b.quarter ? ` Q${b.quarter}` : ""} · ${money(b.total)}</h4>${b.parts.length ? `<table><thead><tr><th>Grant</th><th>Vest date</th><th>Status</th><th>Grant value</th><th>Market value</th></tr></thead><tbody>${b.parts.map((p) => `<tr><td>${escape(p.name)}</td><td>${p.date}</td><td>${p.vested ? "Vested" : "Upcoming"}</td><td>${money(p.grantValue)}</td><td>${money(p.value)}</td></tr>`).join("")}</tbody></table>` : "<p>No scheduled vests.</p>"}`;
        }),
    );
  }
  root.GrantTimeline = { render };
})(typeof window !== "undefined" ? window : globalThis);
