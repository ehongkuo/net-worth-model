let model, chart, currentResults = [], currentView = 'total';
let currentTemplateReversal = null;
let currentTemplateEffects = null;

document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.LifetimeModel !== 'undefined') {
    model = new window.LifetimeModel();
  } else {
    console.error("model.js not loaded properly.");
    model = {
      simulate: () => [], getEvents: () => [], addEvent: () => {},
      removeEvent: () => {}, updateEvent: () => {}, updateConfig: () => {},
      getConfig: () => window.DEFAULT_CONFIG || { age: 25 }
    };
  }
  setupChart();
  setupEventListeners();
  populateTemplateDropdown();
  populateTypeDropdown();
  runSimulation();
});

function getStartAge() {
  return model.getConfig ? model.getConfig().age : 25;
}

function setupChart() {
  const ctx = document.getElementById('nw-chart').getContext('2d');

  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = "'Inter', sans-serif";

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [] },
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
          ticks: { callback: function(value) { return formatCurrency(value); } }
        }
      }
    }
  });
}

function runSimulation() {
  if (model && model.simulate) {
    currentResults = model.simulate();
    updateChart();
    updateSummaryCards();
    updateDataTable();
    renderEventsList();
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

  const labels = currentResults.map(r => `Age ${r.age}`);
  let datasets = [];
  const ctx = document.getElementById('nw-chart').getContext('2d');

  if (currentView === 'total') {
    chart.options.plugins.legend.display = false;
    chart.options.scales.y.stacked = false;
    datasets = [{
      label: 'Net Worth',
      data: currentResults.map(r => r.netWorth),
      borderColor: '#38bdf8',
      borderWidth: 3,
      backgroundColor: createGradient(ctx, 'rgba(56, 189, 248, 0.3)'),
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 6,
      tension: 0.4
    }];
  } else if (currentView === 'breakdown') {
    chart.options.plugins.legend.display = true;
    chart.options.scales.y.stacked = true;

    const accounts = [
      { key: 'hsa', label: 'HSA', color: '#06b6d4' },
      { key: 'traditionalIRA', label: 'Traditional IRA', color: '#8b5cf6' },
      { key: 'pretax401k', label: '401(k) Pre-Tax', color: '#3b82f6' },
      { key: 'rothAccounts', label: 'Roth Accounts', color: '#10b981' },
      { key: 'brokerage', label: 'Brokerage', color: '#f59e0b' },
      { key: 'cash', label: 'Cash', color: '#64748b' },
      { key: 'homeEquity', label: 'Home Equity', color: '#ec4899' }
    ];

    datasets = accounts.map(acc => ({
      label: acc.label,
      data: currentResults.map(r => r.balances ? (r.balances[acc.key] || 0) : 0),
      backgroundColor: hexToRgba(acc.color, 0.6),
      borderColor: acc.color,
      borderWidth: 1,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.1
    }));
  } else if (currentView === 'income') {
    chart.options.plugins.legend.display = true;
    chart.options.scales.y.stacked = false;
    datasets = [
      {
        label: 'Gross Income',
        data: currentResults.map(r => r.income ? r.income.gross || 0 : 0),
        borderColor: '#10b981',
        backgroundColor: createGradient(ctx, 'rgba(16, 185, 129, 0.1)'),
        borderWidth: 2, fill: true, pointRadius: 0, pointHoverRadius: 5, tension: 0.3
      },
      {
        label: 'Total Expenses',
        data: currentResults.map(r => r.expenses ? r.expenses.total || 0 : 0),
        borderColor: '#ef4444',
        backgroundColor: createGradient(ctx, 'rgba(239, 68, 68, 0.1)'),
        borderWidth: 2, fill: true, pointRadius: 0, pointHoverRadius: 5, tension: 0.3
      }
    ];
  }

  chart.data.labels = labels;
  chart.data.datasets = datasets;
  chart.update();
}

function updateSummaryCards() {
  if (!currentResults || currentResults.length === 0) return;

  const start = currentResults[0];
  const age35 = currentResults.find(r => r.age === 35);
  const age50 = currentResults.find(r => r.age === 50);
  const age65 = currentResults.find(r => r.age === 65);

  let peak = currentResults[0];
  currentResults.forEach(r => { if (r.netWorth > peak.netWorth) peak = r; });

  document.getElementById('val-start-nw').innerText = formatCurrency(start.netWorth);
  document.getElementById('val-start-age').innerText = `Age ${start.age}`;

  if (age35) {
    document.getElementById('val-nw-35').innerText = formatCurrency(age35.netWorth);
    document.getElementById('val-35-income').innerText = `Income: ${formatCurrency(age35.income.gross)}`;
  }
  if (age50) {
    document.getElementById('val-nw-50').innerText = formatCurrency(age50.netWorth);
    document.getElementById('val-50-income').innerText = `Income: ${formatCurrency(age50.income.gross)}`;
  }
  if (age65) {
    document.getElementById('val-nw-65').innerText = formatCurrency(age65.netWorth);
    document.getElementById('val-65-income').innerText = `Income: ${formatCurrency(age65.income.gross)}`;
  }

  document.getElementById('val-peak-nw').innerText = formatCurrency(peak.netWorth);
  document.getElementById('val-peak-age').innerText = `Age ${peak.age}`;
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
      <td>${formatCurrencyFull(r.income.gross)}</td>
      <td>${formatCurrencyFull(r.taxes)}</td>
      <td>${formatCurrencyFull(r.expenses.total)}</td>
      <td>${formatCurrencyFull(r.savings.total)}</td>
      <td class="${nwClass} font-semibold">${formatCurrencyFull(r.netWorth)}</td>
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
        <button class="btn-edit" title="Edit">✏️</button>
        <button class="btn-remove" title="Remove">🗑️</button>
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

  // Assumption sliders
  const sliders = [
    { id: 'slider-inflation', displayId: 'val-inflation', key: 'inflation' },
    { id: 'slider-market-return', displayId: 'val-market-return', key: 'marketReturn' },
    { id: 'slider-salary-growth', displayId: 'val-salary-growth', key: 'salaryGrowth' },
    { id: 'slider-real-estate', displayId: 'val-real-estate', key: 'realEstateAppreciation' }
  ];

  sliders.forEach(s => {
    const el = document.getElementById(s.id);
    const disp = document.getElementById(s.displayId);
    if (el) {
      el.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        disp.innerText = val.toFixed(1) + '%';
        if (model && model.updateConfig) {
          model.updateConfig({ [s.key]: val / 100 });
          runSimulation();
        }
      });
    }
  });

  // Chart tab toggles
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentView = e.target.getAttribute('data-view');
      updateChart();
    });
  });

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
    html = `
      <div class="form-row">
        <div class="form-group"><label>Base Salary</label><input type="number" data-effect="baseSalary" value="${e.baseSalary || ''}"></div>
        <div class="form-group"><label>Bonus Percent (%)</label><input type="number" step="0.1" data-effect="bonusPercent" value="${e.bonusPercent !== undefined ? pctDisplay(e.bonusPercent) : ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>RSU Annual Gross</label><input type="number" data-effect="rsuAnnualGross" value="${e.rsuAnnualGross || ''}"></div>
        <div class="form-group"><label>Signing Bonus</label><input type="number" data-effect="signingBonus" value="${e.signingBonus || ''}"></div>
      </div>
      <div class="form-group"><label>Severance</label><input type="number" data-effect="severance" value="${e.severance || ''}"></div>
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
  }

  container.innerHTML = html;
}

// ─── Save Event ────────────────────────────────────────────────

function saveEvent() {
  const id = document.getElementById('event-id').value;
  const startAge = getStartAge();
  const inputAge = parseInt(document.getElementById('event-year').value) || startAge;
  const type = document.getElementById('event-type').value;
  const duration = parseInt(document.getElementById('event-duration').value) || 0;

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
    // Auto-generate reversal for duration market events
    if (duration > 0 && !currentTemplateReversal) {
      currentTemplateReversal = { marketReturn: model.getConfig().marketReturn };
    }
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
