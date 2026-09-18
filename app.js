let model, chart, currentResults = [], currentView = 'total';
const ASSET_GROUPS = [
  {label:'Liquid cash',color:'#38bdf8',keys:['cash']},
  {label:'Taxable investments',color:'#f59e0b',keys:['brokerage','companyEquity']},
  {label:'Retirement',color:'#a78bfa',keys:['pretax401k','rothAccounts','traditionalIRA']},
  {label:'HSA',color:'#2dd4bf',keys:['hsa']},
  {label:'Home equity',color:'#f472b6',keys:['homeEquity']}
];
const assetValue = (r,group) => group.keys.reduce((sum,key)=>sum+(r.balances?.[key] || 0),0);
let displayMode = 'real'; // 'nominal' or 'real' (today's dollars)
let currentTimeWindow = 'full';
let currentTemplateReversal = null;
let currentTemplateEffects = null;
let currentScrubberIndex = 0;

const STORAGE_KEY = 'netWorthModel:v1';

// Assumption sliders. Percentage sliders store value/100; raw sliders store the
// value as-is. Defined at module scope so both the input wiring and the
// restore-from-storage sync can use them.
const pct = (v) => v.toFixed(1) + '%';
const ASSUMPTION_SLIDERS = [
  { id: 'slider-base-rent', displayId: 'val-base-rent', key: 'expenses.housing', raw: true, format: (v) => formatCurrencyFull(v) },
  { id: 'slider-inflation', displayId: 'val-inflation', key: 'inflation', format: pct },
  { id: 'slider-market-return', displayId: 'val-market-return', key: 'marketReturn', format: pct },
  { id: 'slider-salary-growth', displayId: 'val-salary-growth', key: 'salaryGrowth', format: pct },
  { id: 'slider-real-estate', displayId: 'val-real-estate', key: 'realEstateAppreciation', format: pct },
  { id: 'slider-retirement-age', displayId: 'val-retirement-age', key: 'retirementAge', raw: true, format: (v) => String(v) },
  { id: 'slider-social-security', displayId: 'val-social-security', key: 'socialSecurityAnnual', raw: true, format: (v) => formatCurrencyFull(v) }
];

/**
 * Converts a nominal figure to today's dollars when the real-dollars toggle is
 * on, using the year's cumulative inflation factor.
 */
function displayValue(value, result) {
  if (displayMode === 'real' && result && result.inflationFactor) {
    return value / result.inflationFactor;
  }
  return value;
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.LifetimeModel !== 'undefined') {
    model = new window.LifetimeModel();
  } else {
    console.error('model.js failed to load; the app cannot run.');
    showLoadError();
    return; // don't wire up a UI that can't compute anything
  }
  setupChart();
  setupEventListeners();
  populateTemplateDropdown();
  populateTypeDropdown();
  loadState();            // restore a saved scenario, if any, into model + controls
  displayMode = model.getConfig().displayMode || 'real';
  document.querySelectorAll('#dollar-toggle .tab-btn').forEach(b => b.classList.toggle('active',b.dataset.mode===displayMode));
  setupCompensationUI();
  setupMarketUI();
  syncControlsFromConfig();
  runSimulation();
  const initialView=new URLSearchParams(location.search).get('view');
  if(['limits','paychecks'].includes(initialView))showCompensationView(initialView);
});

function getStartAge() {
  return model.getConfig ? model.getConfig().age : 25;
}

/** Renders a visible banner when the simulation engine fails to load. */
function showLoadError() {
  const banner = document.createElement('div');
  banner.className = 'load-error';
  banner.setAttribute('role', 'alert');
  banner.textContent = 'Could not load the projection engine (model.js). Reload the page; if it persists, check that model.js is present next to index.html.';
  document.body.prepend(banner);
}

// ─── Persistence (localStorage + export/import) ────────────────

/** Serializes the current scenario (assumptions + events) to localStorage. */
function saveState() {
  if (!model.getConfig) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      config: model.getConfig(),
      events: model.getEvents ? model.getEvents() : []
    }));
  } catch (e) {
    // Storage can be unavailable (private mode, quota); persistence is a
    // convenience, so fail quietly.
  }
}

/** Restores a saved scenario from localStorage into the model, if present. */
function loadState() {
  let saved;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) {
    saved = null;
  }
  applyScenario(ScenarioDefaults.resolve(saved,window.DEVELOPMENT_SCENARIO));
}

/** Applies a {config, events} scenario object to the model. */
function applyScenario(scenario) {
  if (!scenario || !model.updateConfig) return;
  if (scenario.config) {
    const config = { ...scenario.config, compensation: Compensation.fromLegacy(scenario.config) };
    model.updateConfig(config);
  }
  if (model.clearEvents) model.clearEvents();
  if (Array.isArray(scenario.events) && model.addEvent) {
    scenario.events.forEach(e => model.addEvent(e));
  }
}

/** Pushes the model's config values back into the slider controls. */
function syncControlsFromConfig() {
  if (!model.getConfig) return;
  const cfg = model.getConfig();
  ASSUMPTION_SLIDERS.forEach(s => {
    const el = document.getElementById(s.id);
    const disp = document.getElementById(s.displayId);
    let configVal = cfg;
    if (s.key.includes('.')) {
      const parts = s.key.split('.');
      configVal = cfg[parts[0]] ? cfg[parts[0]][parts[1]] : undefined;
    } else {
      configVal = cfg[s.key];
    }
    if (!el || configVal === undefined || configVal === null) return;
    const raw = s.raw ? configVal : configVal * 100;
    el.value = raw;
    if (disp) disp.innerText = s.format(raw);
  });
  if (document.getElementById('rsu-grants')) {
    ensureCompensation(); renderGrantFields(); syncCompensationFields();
  }
}

/** Downloads the current scenario as a JSON file. */
function exportScenario() {
  const data = JSON.stringify({ config: model.getConfig(), events: model.getEvents() }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'net-worth-scenario.json';
  a.click();
  URL.revokeObjectURL(url);
}

/** Loads a scenario from a user-selected JSON file. */
function importScenario(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      applyScenario(JSON.parse(reader.result));
      syncControlsFromConfig();
      runSimulation();
    } catch (e) {
      alert('Could not read that scenario file - it is not valid JSON.');
    }
  };
  reader.readAsText(file);
}

/** Clears the saved scenario and resets the model to defaults. */
function resetScenario() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  if (window.LifetimeModel) model = new window.LifetimeModel();
  applyScenario(ScenarioDefaults.resolve(null,window.DEVELOPMENT_SCENARIO));
  syncControlsFromConfig();
  runSimulation();
}

function setupChart() {
  const ctx = document.getElementById('nw-chart').getContext('2d');

  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = "'Inter', sans-serif";

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [] },
    plugins: [{
      id: 'verticalLinePlugin',
      afterDraw: (chart) => {
        if (!currentResults || currentResults.length === 0) return;
        const ctx = chart.ctx;
        const xAxis = chart.scales.x;
        const yAxis = chart.scales.y;
        
        // Only draw if the scrubber index is visible in the current zoom window
        const label = `Age ${currentResults[currentScrubberIndex].age}`;
        const xPos = xAxis.getPixelForValue(currentScrubberIndex);
        
        // In Chart.js, if a tick is out of view, getPixelForTick might still return a value, 
        // but it might be outside the chart area.
        if (xPos >= xAxis.left && xPos <= xAxis.right) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(xPos, yAxis.top);
          ctx.lineTo(xPos, yAxis.bottom);
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          
          ctx.beginPath();
          ctx.arc(xPos, yAxis.top, 5, 0, 2 * Math.PI);
          ctx.fillStyle = '#38bdf8';
          ctx.fill();
          ctx.restore();
        }
      }
    }],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 750 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(30, 41, 59, 0.9)',
          titleColor: '#f8fafc',
          bodyColor: '#f8fafc',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) label += ': ';
              if (context.parsed.y !== null) label += formatCurrencyFull(context.parsed.y);
              return label;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false } },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
          ticks: { callback: function(value) { return formatCurrency(value); } },
          beginAtZero: true,
          grace: '15%'
        }
      }
    }
  });
}

function runSimulation() {
  if (model && model.simulate) {
    ensureCompensation();
    currentResults = model.simulate();
    
    // Update scrubber max based on projection years
    const scrubber = document.getElementById('timeline-scrubber');
    if (scrubber) {
      scrubber.max = currentResults.length - 1;
      if (currentScrubberIndex >= currentResults.length) {
        currentScrubberIndex = currentResults.length - 1;
        scrubber.value = currentScrubberIndex;
      }
    }
    
    updateChart();
    updateTimelineSnapshot();
    updateDataTable();
    renderEventsList();
    renderCompensation();
    saveState();
  }
}

function createGradient(ctx, color) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  return gradient;
}

function hexToRgba(hex, alpha) {
  let r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function updateChart() {
  if (!currentResults || currentResults.length === 0) return;

  const labels = currentResults.map(r => r.isInitial ? 'Start' : `Age ${r.age}`);
  
  const scrollContainer = document.getElementById('chart-scrollbar-container');
  const scrollContent = document.getElementById('chart-scrollbar-content');

  if (currentTimeWindow !== 'full' && scrollContainer && scrollContent) {
    const years = parseInt(currentTimeWindow);
    const totalPoints = currentResults.length;
    const pointsInView = years + 1;
    
    scrollContainer.style.display = 'block';
    const ratio = totalPoints / pointsInView;
    scrollContent.style.width = `${ratio * 100}%`;

    const maxScrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth;
    let scrollPct = 0;
    if (maxScrollLeft > 0) {
      scrollPct = scrollContainer.scrollLeft / maxScrollLeft;
    }
    
    const maxStartIndex = Math.max(0, totalPoints - pointsInView);
    const startIndex = Math.max(0, Math.min(maxStartIndex, Math.round(scrollPct * maxStartIndex)));
    const endIndex = Math.min(totalPoints - 1, startIndex + pointsInView - 1);

    chart.options.scales.x.min = labels[startIndex];
    chart.options.scales.x.max = labels[endIndex];
  } else {
    if (scrollContainer) scrollContainer.style.display = 'none';
    delete chart.options.scales.x.min;
    delete chart.options.scales.x.max;
  }

  let datasets = [];
  const ctx = document.getElementById('nw-chart').getContext('2d');

  if (currentView === 'total') {
    chart.options.plugins.legend.display = false;
    chart.options.scales.y.stacked = false;
    datasets = [{
      label: 'Net Worth',
      data: currentResults.map(r => displayValue(r.netWorth, r)),
      borderColor: '#38bdf8',
      borderWidth: 3,
      backgroundColor: createGradient(ctx, 'rgba(56, 189, 248, 0.3)'),
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 6,
      tension: 0
    }];
  } else if (currentView === 'breakdown') {
    chart.options.plugins.legend.display = true;
    chart.options.scales.y.stacked = true;

    const accounts = ASSET_GROUPS;

    datasets = accounts.map(acc => ({
      label: acc.label,
      data: currentResults.map(r => displayValue(assetValue(r,acc), r)),
      backgroundColor: hexToRgba(acc.color, 0.6),
      borderColor: acc.color,
      borderWidth: 1,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0
    }));
  } else if (currentView === 'income') {
    chart.options.plugins.legend.display = true;
    chart.options.scales.y.stacked = false;
    datasets = [
      {
        label: 'Gross Income',
        data: currentResults.map(r => displayValue((r.income ? r.income.gross || 0 : 0) + (r.income ? r.income.investment || 0 : 0), r)),
        borderColor: '#10b981',
        backgroundColor: createGradient(ctx, 'rgba(16, 185, 129, 0.1)'),
        borderWidth: 2, fill: true, pointRadius: 0, pointHoverRadius: 5, tension: 0
      },
      {
        label: 'Total Expenses',
        data: currentResults.map(r => displayValue(r.expenses ? r.expenses.total || 0 : 0, r)),
        borderColor: '#ef4444',
        backgroundColor: createGradient(ctx, 'rgba(239, 68, 68, 0.1)'),
        borderWidth: 2, fill: true, pointRadius: 0, pointHoverRadius: 5, tension: 0
      }
    ];
  }

  delete chart.options.scales.y.max;
  delete chart.options.scales.y.min;

  chart.data.labels = labels;
  chart.data.datasets = datasets;
  chart.update();
}

function updateTimelineSnapshot() {
  if (!currentResults || currentResults.length === 0) return;

  const r = currentResults[currentScrubberIndex];
  if (!r) return;

  const balanceLabels = {companyEquity:'Held company shares',cash:'Cash',brokerage:'Brokerage',pretax401k:'Pre-tax 401(k)',rothAccounts:'Roth accounts',traditionalIRA:'Traditional IRA',hsa:'HSA',homeEquity:'Home equity'};
  document.getElementById('balance-snapshot').innerHTML = `<div class="balance-total"><span>${r.isInitial?'Starting net worth':'Net worth'}</span><strong>${formatCurrencyFull(displayValue(r.netWorth,r))}</strong></div>` + ASSET_GROUPS.map(group=>`<div style="border-top:3px solid ${group.color}"><span>${group.label}</span><strong>${formatCurrencyFull(displayValue(assetValue(r,group),r))}</strong></div>`).join('') + `<details class="balance-details"><summary>Account breakdown</summary>` + Object.entries(balanceLabels).map(([key,label])=>`<div><span>${label}</span><strong>${formatCurrencyFull(displayValue(r.balances[key] || 0,r))}</strong></div>`).join('') + '</details>';
  document.querySelector('.snapshot-cards').hidden = r.isInitial;
  // Update labels
  document.getElementById('timeline-start-label').innerText = `Start of ${currentResults[0].year}`;
  document.getElementById('timeline-end-label').innerText = `Age ${currentResults[currentResults.length - 1].age}`;
  document.getElementById('timeline-current-label').innerText = r.isInitial ? `Starting balances (${r.year})` : `Age ${r.age} (Year ${r.year})`;

  // Income vs Savings
  const grossIn = (r.income.gross || 0) + (r.income.investment || 0);
  const saved = (r.savings.total || 0) + (r.savings.postTax || 0); // Need to calculate post tax savings if it exists
  const isPostTax = (r.income.gross - r.taxes - r.expenses.total - r.savings.total);
  const totalSaved = r.savings.total + Math.max(0, isPostTax);
  
  document.getElementById('snap-gross-in').innerText = formatCurrency(displayValue(grossIn, r));
  document.getElementById('snap-saved').innerText = formatCurrency(displayValue(totalSaved, r));

  // Housing
  const housing = r.expenses.breakdown && r.expenses.breakdown.housing ? r.expenses.breakdown.housing * 12 : 0;
  document.getElementById('snap-housing').innerText = formatCurrency(displayValue(housing, r));

  // Living & Auto
  const auto = r.expenses.breakdown && r.expenses.breakdown.auto ? r.expenses.breakdown.auto * 12 : 0;
  // Total expenses minus housing and auto
  const living = r.expenses.total - housing - auto;
  
  document.getElementById('snap-auto').innerText = formatCurrency(displayValue(auto, r));
  document.getElementById('snap-living').innerText = formatCurrency(displayValue(living, r));

  // Taxes
  document.getElementById('snap-taxes').innerText = formatCurrency(displayValue(r.taxes, r));
  const cashGross = r.income.gross || 0;
  const effectiveRate = cashGross > 0 ? (r.taxes / cashGross) * 100 : 0;
  document.getElementById('snap-tax-rate').innerText = `Effective Rate: ${effectiveRate.toFixed(1)}%`;

  // Calculate Cumulatives
  let cumGrossIn = 0, cumSaved = 0, cumHousing = 0, cumAuto = 0, cumLiving = 0, cumTaxes = 0;
  for (let i = 1; i <= currentScrubberIndex; i++) {
     const row = currentResults[i];
     const rowGrossIn = (row.income.gross || 0) + (row.income.investment || 0);
     cumGrossIn += displayValue(rowGrossIn, row);
     const rowIsPostTax = (row.income.gross - row.taxes - row.expenses.total - row.savings.total);
     cumSaved += displayValue(row.savings.total + Math.max(0, rowIsPostTax), row);
     
     const rowHousing = row.expenses.breakdown && row.expenses.breakdown.housing ? row.expenses.breakdown.housing * 12 : 0;
     const rowAuto = row.expenses.breakdown && row.expenses.breakdown.auto ? row.expenses.breakdown.auto * 12 : 0;
     cumHousing += displayValue(rowHousing, row);
     cumAuto += displayValue(rowAuto, row);
     cumLiving += displayValue(row.expenses.total - rowHousing - rowAuto, row);
     cumTaxes += displayValue(row.taxes, row);
  }
  
  document.getElementById('snap-cum-gross-in').innerText = formatCurrency(cumGrossIn);
  document.getElementById('snap-cum-saved').innerText = formatCurrency(cumSaved);
  document.getElementById('snap-cum-housing').innerText = formatCurrency(cumHousing);
  document.getElementById('snap-cum-auto').innerText = formatCurrency(cumAuto);
  document.getElementById('snap-cum-living').innerText = formatCurrency(cumLiving);
  document.getElementById('snap-cum-taxes').innerText = formatCurrency(cumTaxes);

  // Events
  const eventsList = document.getElementById('snap-events-list');
  if (r.events && r.events.length > 0) {
    eventsList.innerHTML = r.events.map(e => `<span class="event-badge ${getTypeForEventName(e)}">${e}</span>`).join('');
  } else {
    eventsList.innerHTML = '<span class="no-events">-</span>';
  }
}

function updateDataTable() {
  if (!currentResults || currentResults.length === 0) return;

  const tbody = document.getElementById('data-table-body');
  tbody.innerHTML = '';

  const showAll = document.getElementById('show-all-years').checked;
  let prevNw = currentResults[0].netWorth;

  currentResults.forEach((r, i) => {
    const hasEvents = r.events && r.events.length > 0;
    const isFifthYear = i % 5 === 0;
    const isLastYear = i === currentResults.length - 1;

    if (!showAll && !hasEvents && !isFifthYear && !isLastYear && i !== 0) {
      prevNw = r.netWorth;
      return;
    }

    const tr = document.createElement('tr');
    if (hasEvents) tr.classList.add('event-row');

    const nwClass = r.netWorth >= prevNw ? 'positive-growth' : 'negative-growth';
    const eventBadges = hasEvents
      ? r.events.map(e => `<span class="event-badge ${getTypeForEventName(e)}">${e}</span>`).join(' ')
      : '-';

    tr.innerHTML = `
      <td>${r.age}</td>
      <td>${r.year}</td>
      <td>${formatCurrencyFull(displayValue((r.income.gross || 0) + (r.income.investment || 0), r))}</td>
      <td>${formatCurrencyFull(displayValue(r.taxes, r))}</td>
      <td>${formatCurrencyFull(displayValue(r.expenses.total, r))}</td>
      <td>${formatCurrencyFull(displayValue(r.savings.total, r))}</td>
      <td class="${nwClass} font-semibold">${formatCurrencyFull(displayValue(r.netWorth, r))}</td>
      <td>${eventBadges}</td>
    `;
    tbody.appendChild(tr);
    prevNw = r.netWorth;
  });
}

function getTypeForEventName(eventName) {
  const events = model.getEvents ? model.getEvents() : [];
  const evt = events.find(e => e.name === eventName);
  return evt ? evt.type : 'career';
}

function renderEventsList() {
  const container = document.getElementById('events-list');
  const events = model.getEvents ? model.getEvents() : [];
  const startAge = getStartAge();

  if (events.length === 0) {
    container.innerHTML = `<p class="empty-state">No events added yet. Add life events to see how they shape your trajectory.</p>`;
    return;
  }

  container.innerHTML = '';
  events.forEach(e => {
    const eventAge = (e.year || 0) + startAge;
    const div = document.createElement('div');
    div.className = 'event-item';
    div.dataset.id = e.id;
    div.innerHTML = `
      <span class="event-badge ${e.type}">${e.type}</span>
      <div class="event-info">
        <strong>${e.name}</strong>
        <span>Age ${eventAge}${e.duration ? ` · ${e.duration}yr` : ''} · ${e.description || ''}</span>
      </div>
      <div class="event-actions">
        <button class="btn-edit" title="Edit" aria-label="Edit ${e.name}">✏️</button>
        <button class="btn-remove" title="Remove" aria-label="Remove ${e.name}">🗑️</button>
      </div>
    `;

    div.querySelector('.btn-edit').addEventListener('click', () => openEventModal(e.id));
    div.querySelector('.btn-remove').addEventListener('click', () => {
      model.removeEvent(e.id);
      runSimulation();
    });

    container.appendChild(div);
  });
}

// ─── Event Listeners ──────────────────────────────────────────

function setupEventListeners() {
  // Panel toggles
  document.querySelectorAll('.panel-header').forEach(header => {
    header.addEventListener('click', () => {
      const panelId = header.getAttribute('data-panel');
      const content = document.getElementById(panelId);
      if (content) {
        content.classList.toggle('collapsed');
        const icon = header.querySelector('.toggle-icon');
        if (content.classList.contains('collapsed')) {
          icon.style.transform = panelId === 'data-table-container' ? 'rotate(0deg)' : 'rotate(-90deg)';
        } else {
          icon.style.transform = panelId === 'data-table-container' ? 'rotate(90deg)' : 'rotate(0deg)';
        }
      }
    });
  });

  // Assumption sliders (defined at module scope in ASSUMPTION_SLIDERS).
  ASSUMPTION_SLIDERS.forEach(s => {
    const el = document.getElementById(s.id);
    const disp = document.getElementById(s.displayId);
    if (el) {
      el.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        disp.innerText = s.format(val);
        if (model && model.updateConfig) {
          if (s.key.includes('.')) {
            const parts = s.key.split('.');
            model.updateConfig({ [parts[0]]: { [parts[1]]: s.raw ? val : val / 100 } });
          } else {
            model.updateConfig({ [s.key]: s.raw ? val : val / 100 });
          }
          runSimulation();
        }
      });
    }
  });

  // Chart tab toggles (view selector)
  document.querySelectorAll('#chart-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#chart-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentView = e.target.getAttribute('data-view');
      updateChart();
    });
  });

  // Time window toggles
  document.querySelectorAll('#time-window-toggle .tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#time-window-toggle .tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentTimeWindow = e.target.getAttribute('data-window');
      
      const scrollContainer = document.getElementById('chart-scrollbar-container');
      if (scrollContainer) scrollContainer.scrollLeft = 0;
      
      updateChart();
    });
  });

  // Chart native scrollbar sync
  const scrollContainer = document.getElementById('chart-scrollbar-container');
  if (scrollContainer) {
    scrollContainer.addEventListener('scroll', () => {
      if (currentTimeWindow === 'full' || !currentResults || currentResults.length === 0) return;
      
      const years = parseInt(currentTimeWindow);
      const totalPoints = currentResults.length;
      const pointsInView = years + 1;
      
      const maxScrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth;
      let scrollPct = 0;
      if (maxScrollLeft > 0) {
        scrollPct = scrollContainer.scrollLeft / maxScrollLeft;
      }
      
      const maxStartIndex = Math.max(0, totalPoints - pointsInView);
      const startIndex = Math.max(0, Math.min(maxStartIndex, Math.round(scrollPct * maxStartIndex)));
      const endIndex = Math.min(totalPoints - 1, startIndex + pointsInView - 1);
      
      chart.options.scales.x.min = chart.data.labels[startIndex];
      chart.options.scales.x.max = chart.data.labels[endIndex];
      chart.update('none');
    });
  }

  // Nominal / today's-dollars toggle (affects chart, cards, and table)
  document.querySelectorAll('#dollar-toggle .tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#dollar-toggle .tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      displayMode = e.target.getAttribute('data-mode');
      updateChart();
      updateTimelineSnapshot();
      updateDataTable();
      model.updateConfig({displayMode});
      renderCompensation();
      saveState();
    });
  });

  // Timeline scrubber
  const scrubber = document.getElementById('timeline-scrubber');
  if (scrubber) {
    scrubber.addEventListener('input', (e) => {
      currentScrubberIndex = parseInt(e.target.value);
      renderCompensation();
      updateTimelineSnapshot();
      if (chart) chart.draw(); // Just redraw chart to update the vertical line
    });
  }

  // Data table controls
  document.getElementById('show-all-years').addEventListener('change', updateDataTable);

  // Event modal buttons
  document.getElementById('btn-add-event').addEventListener('click', () => openEventModal());
  document.getElementById('btn-cancel-event').addEventListener('click', closeEventModal);

  document.getElementById('event-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveEvent();
  });

  document.getElementById('btn-delete-event').addEventListener('click', () => {
    const id = document.getElementById('event-id').value;
    if (id && model && model.removeEvent) {
      model.removeEvent(parseInt(id));
      closeEventModal();
      runSimulation();
    }
  });

  document.getElementById('event-template').addEventListener('change', (e) => {
    applyTemplate(e.target.value);
  });

  document.getElementById('event-type').addEventListener('change', (e) => {
    renderEffectFields(e.target.value);
  });

  // Scenario export / import / reset
  document.getElementById('btn-export').addEventListener('click', exportScenario);
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importScenario(e.target.files[0]);
    e.target.value = ''; // allow re-importing the same file
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Reset all assumptions and events to defaults?')) resetScenario();
  });
}

// ─── Template & Type Dropdowns ─────────────────────────────────

function populateTemplateDropdown() {
  const select = document.getElementById('event-template');
  if (window.EVENT_TEMPLATES) {
    Object.keys(window.EVENT_TEMPLATES).forEach(key => {
      const tmpl = window.EVENT_TEMPLATES[key];
      const opt = document.createElement('option');
      opt.value = key;
      opt.text = tmpl.name;
      select.appendChild(opt);
    });
  }
}

function populateTypeDropdown() {
  const select = document.getElementById('event-type');
  const types = window.EVENT_TYPES || ['career', 'housing', 'family', 'health', 'purchase', 'market', 'windfall'];
  types.forEach(type => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.text = type.charAt(0).toUpperCase() + type.slice(1);
    select.appendChild(opt);
  });
}

// ─── Event Modal ───────────────────────────────────────────────

function openEventModal(eventId = null) {
  const modal = document.getElementById('event-modal');
  const form = document.getElementById('event-form');
  const title = document.getElementById('modal-title');
  const btnDelete = document.getElementById('btn-delete-event');
  const startAge = getStartAge();

  form.reset();
  document.getElementById('effects-container').innerHTML = '';
  document.getElementById('event-template').value = '';
  currentTemplateReversal = null;
  currentTemplateEffects = null;

  if (eventId) {
    title.innerText = 'Edit Life Event';
    btnDelete.style.display = 'block';

    const events = model.getEvents();
    const event = events.find(e => e.id === eventId);
    if (event) {
      document.getElementById('event-id').value = event.id;
      document.getElementById('event-name').value = event.name || '';
      document.getElementById('event-year').value = (event.year || 0) + startAge;
      document.getElementById('event-type').value = event.type || 'career';
      document.getElementById('event-duration').value = event.duration || 0;
      document.getElementById('event-description').value = event.description || '';

      // Preserve reversal from the existing event for re-saving
      if (event.reversal) currentTemplateReversal = event.reversal;
      if (event.effects) currentTemplateEffects = JSON.parse(JSON.stringify(event.effects));

      renderEffectFields(event.type, event.effects || {});
    }
  } else {
    title.innerText = 'Add Life Event';
    btnDelete.style.display = 'none';
    document.getElementById('event-id').value = '';
    document.getElementById('event-year').value = startAge + 2;
    renderEffectFields(document.getElementById('event-type').value);
  }

  modal.style.display = 'flex';
}

function closeEventModal() {
  document.getElementById('event-modal').style.display = 'none';
  currentTemplateReversal = null;
  currentTemplateEffects = null;
}

function applyTemplate(templateKey) {
  if (!templateKey || !window.EVENT_TEMPLATES) {
    currentTemplateReversal = null;
    currentTemplateEffects = null;
    renderEffectFields(document.getElementById('event-type').value);
    return;
  }
  const tmpl = window.EVENT_TEMPLATES[templateKey];
  if (!tmpl) return;

  document.getElementById('event-name').value = tmpl.name || '';
  document.getElementById('event-type').value = tmpl.type || 'career';
  document.getElementById('event-description').value = tmpl.description || '';
  document.getElementById('event-duration').value = tmpl.duration || 0;

  currentTemplateReversal = tmpl.reversal ? JSON.parse(JSON.stringify(tmpl.reversal)) : null;
  currentTemplateEffects = tmpl.effects ? JSON.parse(JSON.stringify(tmpl.effects)) : null;

  renderEffectFields(tmpl.type, tmpl.effects || {});
}

// ─── Effect Fields (type-specific) ─────────────────────────────

function pctDisplay(val) {
  if (val === undefined || val === null) return '';
  return (val * 100).toString();
}

function renderEffectFields(type, existingEffects = {}) {
  const container = document.getElementById('effects-container');
  let html = '';

  if (type === 'career') {
    const e = existingEffects;
    const raisePct = e.salaryMultiplier !== undefined ? Math.round((e.salaryMultiplier - 1) * 1000) / 10 : '';
    html = `
      <div class="form-row">
        <div class="form-group"><label>Raise (%)</label><input type="number" step="1" data-effect="salaryMultiplier" value="${raisePct}"></div>
        <div class="form-group"><label>Base Salary (absolute)</label><input type="number" data-effect="baseSalary" value="${e.baseSalary || ''}"></div>
      </div>
      <div class="form-hint">Use Raise % for promotions (scales the salary at that age). Base Salary sets an exact figure, e.g. a job offer.</div>
      <div class="form-row">
        <div class="form-group"><label>Bonus Percent (%)</label><input type="number" step="0.1" data-effect="bonusPercent" value="${e.bonusPercent !== undefined ? pctDisplay(e.bonusPercent) : ''}"></div>
        <div class="form-group"><label>RSU Annual Gross</label><input type="number" data-effect="rsuAnnualGross" value="${e.rsuAnnualGross || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Signing Bonus</label><input type="number" data-effect="signingBonus" value="${e.signingBonus || ''}"></div>
        <div class="form-group"><label>Severance</label><input type="number" data-effect="severance" value="${e.severance || ''}"></div>
      </div>
    `;
  } else if (type === 'housing') {
    const hp = existingEffects.homePurchase || {};
    html = `
      <div class="form-row">
        <div class="form-group"><label>Purchase Price</label><input type="number" data-effect="hp_price" value="${hp.price || ''}"></div>
        <div class="form-group"><label>Down Payment (%)</label><input type="number" step="0.1" data-effect="hp_downPercent" value="${hp.downPercent !== undefined ? pctDisplay(hp.downPercent) : ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Interest Rate (%)</label><input type="number" step="0.1" data-effect="hp_rate" value="${hp.rate !== undefined ? pctDisplay(hp.rate) : ''}"></div>
        <div class="form-group"><label>Monthly HOA</label><input type="number" data-effect="hp_hoa" value="${hp.hoa || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Property Tax Rate (%)</label><input type="number" step="0.01" data-effect="hp_propertyTaxRate" value="${hp.propertyTaxRate !== undefined ? pctDisplay(hp.propertyTaxRate) : ''}"></div>
        <div class="form-group"><label>Your Ownership Share (%)</label><input type="number" step="1" data-effect="hp_yourShare" value="${hp.yourShare !== undefined ? pctDisplay(hp.yourShare) : '100'}"></div>
      </div>
    `;
  } else if (type === 'family') {
    const m = existingEffects.marriage || {};
    const c = existingEffects.child || {};
    html = `
      <div class="form-row">
        <div class="form-group"><label>Spouse Income</label><input type="number" data-effect="fam_spouseIncome" value="${m.spouseIncome || ''}"></div>
        <div class="form-group"><label>Wedding Cost</label><input type="number" data-effect="fam_weddingCost" value="${m.weddingCost || ''}"></div>
      </div>
      <div class="form-group"><label>Child Annual Cost</label><input type="number" data-effect="fam_childAnnualCost" value="${c.annualCost || ''}"></div>
    `;
  } else if (type === 'purchase') {
    html = `<div class="form-group"><label>One-Time Cost</label><input type="number" data-effect="oneTimeCost" value="${existingEffects.oneTimeCost || ''}"></div>`;
  } else if (type === 'market') {
    html = `<div class="form-group"><label>Market Return (%)</label><input type="number" step="0.1" data-effect="marketReturn" value="${existingEffects.marketReturn !== undefined ? pctDisplay(existingEffects.marketReturn) : ''}"></div>`;
  } else if (type === 'windfall') {
    html = `<div class="form-group"><label>One-Time Income</label><input type="number" data-effect="oneTimeIncome" value="${existingEffects.oneTimeIncome || ''}"></div>`;
  } else if (type === 'health') {
    html = `<div class="form-group"><label>One-Time Cost</label><input type="number" data-effect="oneTimeCost" value="${existingEffects.oneTimeCost || ''}"></div>`;
  } else if (type === 'vehicle') {
    const v = existingEffects.vehiclePurchase || {};
    html = `
      <div class="form-row">
        <div class="form-group"><label>Car Price (Cash)</label><input type="number" data-effect="veh_price" id="veh-price-input" value="${v.price || ''}"></div>
        <div class="form-group">
          <label>Fuel Type</label>
          <select data-effect="veh_fuelType" id="veh-fuel-toggle">
            <option value="gas" ${v.fuelType === 'gas' ? 'selected' : ''}>Gas</option>
            <option value="ev" ${v.fuelType === 'ev' ? 'selected' : ''}>EV</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Monthly Insurance</label><input type="number" data-effect="veh_insurance" id="veh-insurance" value="${v.insurance !== undefined ? v.insurance : ''}"></div>
        <div class="form-group"><label>Monthly Maintenance</label><input type="number" data-effect="veh_maintenance" id="veh-maintenance" value="${v.maintenance !== undefined ? v.maintenance : ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Monthly Fuel/Charging</label><input type="number" data-effect="veh_fuel" id="veh-fuel" value="${v.fuel !== undefined ? v.fuel : ''}"></div>
      </div>
      <div class="form-hint">Insurance is estimated at ~3% of car price annually. Maintenance ~1.5%. EV charging is typically ~60% cheaper than gas.</div>
    `;
    
    // Auto-calculate on price/fuel change if empty
    setTimeout(() => {
      const priceInput = document.getElementById('veh-price-input');
      const fuelToggle = document.getElementById('veh-fuel-toggle');
      const insInput = document.getElementById('veh-insurance');
      const maintInput = document.getElementById('veh-maintenance');
      const fuelInput = document.getElementById('veh-fuel');
      
      const updateAutoCosts = () => {
        const price = parseFloat(priceInput.value) || 0;
        insInput.value = Math.round((price * 0.03) / 12);
        maintInput.value = Math.round((price * 0.015) / 12);
        fuelInput.value = fuelToggle.value === 'ev' ? 60 : 150;
      };

      if (priceInput) priceInput.addEventListener('change', updateAutoCosts);
      if (fuelToggle) fuelToggle.addEventListener('change', updateAutoCosts);
    }, 0);
  }

  container.innerHTML = html;
}

// ─── Save Event ────────────────────────────────────────────────

function saveEvent() {
  const id = document.getElementById('event-id').value;
  const startAge = getStartAge();
  const cfg = model.getConfig ? model.getConfig() : { projectionYears: 75 };
  const endAge = startAge + cfg.projectionYears;
  const inputAge = parseInt(document.getElementById('event-year').value) || startAge;
  const duration = parseInt(document.getElementById('event-duration').value) || 0;

  // Keep events inside the projection window so they actually take effect.
  if (inputAge < startAge || inputAge > endAge) {
    alert(`Event age must be between ${startAge} and ${endAge}.`);
    return;
  }

  const type = document.getElementById('event-type').value;

  const eventObj = {
    name: document.getElementById('event-name').value,
    year: inputAge - startAge,
    type: type,
    duration: duration,
    description: document.getElementById('event-description').value,
    effects: {}
  };

  // Build effects based on event type
  if (type === 'career') {
    // Start with template effects (preserves 'employed: false' for layoffs, etc.)
    if (currentTemplateEffects) {
      eventObj.effects = { ...currentTemplateEffects };
    }
    // Overlay form values
    document.querySelectorAll('#effects-container input[data-effect]').forEach(input => {
      const val = input.value;
      if (val === '') return;
      let numVal = parseFloat(val);
      if (input.dataset.effect === 'bonusPercent') numVal = numVal / 100;
      if (input.dataset.effect === 'salaryMultiplier') numVal = 1 + numVal / 100; // Raise % -> multiplier
      eventObj.effects[input.dataset.effect] = numVal;
    });
  } else if (type === 'housing') {
    const hp = {};
    document.querySelectorAll('#effects-container input[data-effect]').forEach(input => {
      const val = input.value;
      if (val === '') return;
      const key = input.dataset.effect.replace('hp_', '');
      let numVal = parseFloat(val);
      if (['downPercent', 'rate', 'propertyTaxRate', 'yourShare'].includes(key)) {
        numVal = numVal / 100;
      }
      hp[key] = numVal;
    });
    eventObj.effects = { homePurchase: hp };
  } else if (type === 'family') {
    document.querySelectorAll('#effects-container input[data-effect]').forEach(input => {
      const val = input.value;
      if (val === '') return;
      const numVal = parseFloat(val);
      const key = input.dataset.effect;
      if (key === 'fam_spouseIncome') {
        if (!eventObj.effects.marriage) eventObj.effects.marriage = {};
        eventObj.effects.marriage.spouseIncome = numVal;
      } else if (key === 'fam_weddingCost') {
        if (!eventObj.effects.marriage) eventObj.effects.marriage = {};
        eventObj.effects.marriage.weddingCost = numVal;
      } else if (key === 'fam_childAnnualCost') {
        eventObj.effects.child = { annualCost: numVal };
      }
    });
  } else if (type === 'market') {
    document.querySelectorAll('#effects-container input[data-effect]').forEach(input => {
      const val = input.value;
      if (val === '') return;
      let numVal = parseFloat(val);
      if (input.dataset.effect === 'marketReturn') numVal = numVal / 100;
      eventObj.effects[input.dataset.effect] = numVal;
    });
    // No manual reversal needed: the model snapshots the real prior value for
    // any duration event and restores it when the effect expires.
  } else if (type === 'vehicle') {
    const v = {};
    document.querySelectorAll('#effects-container input[data-effect], #effects-container select[data-effect]').forEach(input => {
      const val = input.value;
      if (val === '') return;
      const key = input.dataset.effect.replace('veh_', '');
      if (key === 'fuelType') {
        v[key] = val;
      } else {
        v[key] = parseFloat(val);
      }
    });
    eventObj.effects = { vehiclePurchase: v };
  } else {
    // Flat effects: purchase, windfall, health
    document.querySelectorAll('#effects-container input[data-effect]').forEach(input => {
      const val = input.value;
      if (val === '') return;
      eventObj.effects[input.dataset.effect] = parseFloat(val);
    });
  }

  // Attach reversal for duration-based events
  if (duration > 0 && currentTemplateReversal) {
    eventObj.reversal = currentTemplateReversal;
  }

  if (id) {
    model.updateEvent(parseInt(id), eventObj);
  } else {
    model.addEvent(eventObj);
  }

  closeEventModal();
  runSimulation();
}

// ─── Utility Functions ─────────────────────────────────────────

function formatCurrency(value) {
  if (value === undefined || value === null) return '$0';
  const isNegative = value < 0;
  const abs = Math.abs(value);
  let formatted = '';

  if (abs < 1000) {
    formatted = Math.round(abs).toString();
  } else if (abs < 1000000) {
    formatted = (abs / 1000).toFixed(abs < 10000 ? 1 : 0) + 'K';
  } else if (abs < 1000000000) {
    formatted = (abs / 1000000).toFixed(1) + 'M';
  } else {
    formatted = (abs / 1000000000).toFixed(1) + 'B';
  }

  return (isNegative ? '-$' : '$') + formatted;
}

function formatCurrencyFull(value) {
  if (value === undefined || value === null) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}
