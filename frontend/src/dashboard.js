/* ── CrewWatch Dashboard ─────────────────────────────────────── *
 * Responsibilities:
 *   1. Fetch crew list on load, render sidebar
 *   2. Connect WebSocket, receive live reading events
 *   3. On crew selection: fetch vitals history, fetch alerts,
 *      render vitals cards, render charts, render alert list
 *   4. On WS reading event: update cards + charts if same crew
 *   5. Handle manual reading form submission
 * ──────────────────────────────────────────────────────────────*/

'use strict';

// ── State ─────────────────────────────────────────────────────
let selectedCrewId = null;        // which crew member is showing in main panel
let crewData       = {};          // { [id]: crew object from GET /crew }
const charts       = {};          // { vital_name: Chart instance }

// ── DOM refs ──────────────────────────────────────────────────
const $crewList    = document.getElementById('crew-list');
const $crewCount   = document.getElementById('crew-count');
const $lastUpdate  = document.getElementById('last-update');
const $wsDot       = document.getElementById('ws-dot');
const $wsLabel     = document.getElementById('ws-label');
const $emptyState  = document.getElementById('empty-state');
const $crewDetail  = document.getElementById('crew-detail');
const $detailName  = document.getElementById('detail-name');
const $detailRole  = document.getElementById('detail-role');
const $detailEnv   = document.getElementById('detail-env');
const $riskGauge   = document.getElementById('risk-gauge');
const $riskScore   = document.getElementById('risk-score');
const $alertList   = document.getElementById('alert-list');
const $noAlerts    = document.getElementById('no-alerts');
const $alertBadge  = document.getElementById('alert-count-badge');
const $readingForm = document.getElementById('reading-form');
const $formFeedback= document.getElementById('form-feedback');

// ── Helpers ───────────────────────────────────────────────────

function fmt(val, decimals = 1) {
  if (val === null || val === undefined) return '—';
  const n = parseFloat(val);
  return isNaN(n) ? '—' : n.toFixed(decimals);
}

function timeLabel(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function setWsStatus(state, label) {
  $wsDot.className   = `ws-dot ${state}`;
  $wsLabel.textContent = label;
}

// ── Crew sidebar ──────────────────────────────────────────────

async function loadCrew() {
  const res  = await fetch('/crew');
  const list = await res.json();

  // Store by id for quick lookup
  list.forEach(c => { crewData[c.id] = c; });

  $crewCount.textContent = `${list.length} crew members`;

  $crewList.innerHTML = '';
  list.forEach(c => {
    const li = document.createElement('li');
    li.className = 'crew-item';
    li.dataset.id = c.id;

    const alertCount = parseInt(c.alert_count) || 0;
    const level      = c.risk_level || 'green';

    li.innerHTML = `
      <span class="crew-name">${c.name}</span>
      <span class="crew-role-line">${c.role} · ${c.mission}</span>
      <div class="crew-risk-line">
        <span class="risk-dot ${level}"></span>
        <span class="crew-risk-text">Risk ${c.risk_score ?? 0} · ${level.toUpperCase()}</span>
        <span class="crew-alert-pill ${alertCount > 0 ? 'visible' : ''}">${alertCount}</span>
      </div>
    `;

    li.addEventListener('click', () => selectCrew(c.id));
    $crewList.appendChild(li);
  });

  // Auto-select first crew member
  if (list.length > 0) selectCrew(list[0].id);
}

function updateCrewSidebarItem(crewId, riskScore, riskLevel) {
  const li = $crewList.querySelector(`[data-id="${crewId}"]`);
  if (!li) return;
  const dot  = li.querySelector('.risk-dot');
  const text = li.querySelector('.crew-risk-text');
  if (dot)  dot.className  = `risk-dot ${riskLevel}`;
  if (text) text.textContent = `Risk ${riskScore} · ${riskLevel.toUpperCase()}`;

  // Update in-memory store
  if (crewData[crewId]) {
    crewData[crewId].risk_score = riskScore;
    crewData[crewId].risk_level = riskLevel;
  }
}

// ── Select crew member ────────────────────────────────────────

async function selectCrew(id) {
  selectedCrewId = id;

  // Highlight sidebar item
  document.querySelectorAll('.crew-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id == id);
  });

  // Show detail panel
  $emptyState.classList.add('hidden');
  $crewDetail.classList.remove('hidden');

  const crew = crewData[id];
  if (crew) renderCrewHeader(crew);

  // Load history and alerts in parallel
  await Promise.all([
    loadVitalsHistory(id),
    loadAlerts(id),
  ]);
}

function renderCrewHeader(crew) {
  $detailName.textContent = crew.name;
  $detailRole.textContent = `${crew.role} — ${crew.mission}`;
  $detailEnv.textContent  = crew.environment === 'space' ? 'Space Mission' : 'Village Clinic';
  $detailEnv.className    = `env-badge ${crew.environment}`;
  setRiskGauge(crew.risk_score ?? 0, crew.risk_level ?? 'green');
}

function setRiskGauge(score, level) {
  $riskScore.textContent = score;
  $riskGauge.className   = `risk-gauge ${level}`;
}

// ── Vitals cards ──────────────────────────────────────────────

function renderVitalsCards(vitals) {
  document.getElementById('val-heart_rate').textContent       = fmt(vitals.heart_rate, 0);
  document.getElementById('val-spo2').textContent             = fmt(vitals.spo2, 1);
  document.getElementById('val-bp').textContent               = `${fmt(vitals.systolic_bp, 0)}/${fmt(vitals.diastolic_bp, 0)}`;
  document.getElementById('val-body_temp').textContent        = fmt(vitals.body_temp, 1);
  document.getElementById('val-respiration_rate').textContent = fmt(vitals.respiration_rate, 0);
  document.getElementById('val-radiation_dose').textContent   = vitals.radiation_dose !== null ? fmt(vitals.radiation_dose, 2) : '—';
  document.getElementById('val-sleep_hours').textContent      = vitals.sleep_hours !== null ? fmt(vitals.sleep_hours, 1) : '—';
  document.getElementById('val-mood').textContent             = vitals.mood !== null ? vitals.mood : '—';

  $lastUpdate.textContent = `Updated ${timeLabel(vitals.recorded_at || new Date())}`;
}

// ── Charts ────────────────────────────────────────────────────

const CHART_CONFIG = {
  heart_rate:   { color: '#ff6b8a', label: 'Heart Rate' },
  spo2:         { color: '#4b8eff', label: 'SpO₂'       },
  systolic_bp:  { color: '#f7c948', label: 'Systolic BP' },
  body_temp:    { color: '#00e896', label: 'Body Temp'   },
};

function buildChart(canvasId, vital) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const cfg = CHART_CONFIG[vital];

  return new Chart(canvas, {
    type: 'line',
    data: {
      labels:   [],
      datasets: [{
        label:           cfg.label,
        data:            [],
        borderColor:     cfg.color,
        backgroundColor: cfg.color + '22',
        borderWidth:     1.5,
        pointRadius:     0,
        tension:         0.3,
        fill:            true,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           { duration: 200 },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          display: false,
        },
        y: {
          grid:    { color: '#1e2d50' },
          ticks:   { color: '#5a6a90', font: { size: 10 } },
          border:  { display: false },
        },
      },
    },
  });
}

function initCharts() {
  // Destroy old chart instances if switching crew members
  Object.values(charts).forEach(c => c.destroy());

  charts['heart_rate']  = buildChart('chart-heart_rate',  'heart_rate');
  charts['spo2']        = buildChart('chart-spo2',        'spo2');
  charts['systolic_bp'] = buildChart('chart-systolic_bp', 'systolic_bp');
  charts['body_temp']   = buildChart('chart-body_temp',   'body_temp');
}

function populateCharts(readings) {
  // readings is already in time-ascending order (backend reverses DESC fetch)
  const labels = readings.map(r => timeLabel(r.recorded_at));

  Object.entries(charts).forEach(([vital, chart]) => {
    const values = readings.map(r => parseFloat(r[vital]) || null);
    chart.data.labels            = labels;
    chart.data.datasets[0].data  = values;
    chart.update('none');
  });
}

function appendChartPoint(reading) {
  const label = timeLabel(reading.recorded_at || new Date().toISOString());
  const MAX   = 60; // keep last 60 points on live stream

  Object.entries(charts).forEach(([vital, chart]) => {
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(parseFloat(reading[vital]) || null);

    if (chart.data.labels.length > MAX) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }
    chart.update('none');
  });
}

// ── Vitals history (initial load) ─────────────────────────────

async function loadVitalsHistory(crewId) {
  initCharts();

  const res      = await fetch(`/crew/${crewId}/vitals?limit=20`);
  const readings = await res.json();

  if (readings.length > 0) {
    renderVitalsCards(readings[readings.length - 1]);
    populateCharts(readings);
  }
}

// ── Alerts ────────────────────────────────────────────────────

async function loadAlerts(crewId) {
  const res    = await fetch(`/alerts?crew_id=${crewId}`);
  const alerts = await res.json();
  renderAlerts(alerts);
}

function renderAlerts(alerts) {
  $alertList.innerHTML = '';

  if (!alerts || alerts.length === 0) {
    $noAlerts.classList.remove('hidden');
    $alertBadge.classList.add('hidden');
    return;
  }

  $noAlerts.classList.add('hidden');
  $alertBadge.classList.remove('hidden');
  $alertBadge.textContent = alerts.length;

  alerts.forEach(a => {
    const li = document.createElement('li');
    li.className = `alert-item severity-${a.severity}`;

    // Replace underscores with spaces for display (heart_rate → heart rate)
    const vitalDisplay = (a.vital_name || '').replace(/_/g, ' ');

    li.innerHTML = `
      <div class="alert-top">
        <span class="alert-severity-pill ${a.severity}">${a.severity.toUpperCase()}</span>
        <span class="alert-vital-name">${vitalDisplay}</span>
        <span class="alert-type-pill">${a.alert_type}</span>
      </div>
      <p class="alert-message">${a.message}</p>
      <p class="alert-guidance">${a.guidance}</p>
    `;

    $alertList.appendChild(li);
  });
}

// ── WebSocket ─────────────────────────────────────────────────

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws    = new WebSocket(`${proto}//${location.host}`);

  ws.addEventListener('open', () => {
    setWsStatus('connected', 'Live');
  });

  ws.addEventListener('close', () => {
    setWsStatus('disconnected', 'Reconnecting…');
    setTimeout(connectWebSocket, 3000); // auto-reconnect after 3s
  });

  ws.addEventListener('error', () => {
    setWsStatus('error', 'Connection error');
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'connected') return; // initial handshake, ignore

    if (msg.type === 'reading') {
      // Always update sidebar risk indicator for every crew member
      updateCrewSidebarItem(msg.crewId, msg.riskScore, msg.riskLevel);

      // Only update main panel if this is the selected crew member
      if (msg.crewId === selectedCrewId) {
        // Update vitals cards
        const vitals = {
          ...msg.vitals,
          recorded_at: new Date().toISOString(),
        };
        renderVitalsCards(vitals);

        // Append point to live charts
        appendChartPoint({ ...msg.vitals, recorded_at: new Date().toISOString() });

        // Update risk gauge
        setRiskGauge(msg.riskScore, msg.riskLevel);

        // Refresh alerts if risk level changed (new alert may have fired)
        loadAlerts(selectedCrewId);
      }
    }
  });
}

// ── Manual reading form (Task 17) ─────────────────────────────

$readingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedCrewId) return;

  const btn = $readingForm.querySelector('.btn-submit');
  btn.disabled = true;
  $formFeedback.textContent = '';
  $formFeedback.className   = 'form-feedback';

  // Collect only fields with actual values (all optional)
  const body = {};
  ['heart_rate','spo2','systolic_bp','diastolic_bp',
   'body_temp','respiration_rate','sleep_hours','mood'].forEach(field => {
    const el = document.getElementById(`f-${field}`);
    if (el && el.value !== '' && el.value !== null) {
      body[field] = field === 'mood' ? parseInt(el.value) : parseFloat(el.value);
    }
  });

  if (Object.keys(body).length === 0) {
    $formFeedback.textContent = 'Please fill in at least one field.';
    $formFeedback.className   = 'form-feedback error';
    btn.disabled = false;
    return;
  }

  try {
    const res  = await fetch(`/crew/${selectedCrewId}/readings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();

    if (res.ok) {
      $formFeedback.textContent = `✓ Reading #${data.id} saved. Processing alerts…`;
      $formFeedback.className   = 'form-feedback success';
      $readingForm.reset();
      // Alerts will refresh via WebSocket event automatically
    } else {
      $formFeedback.textContent = `Error: ${data.error || 'Unknown error'}`;
      $formFeedback.className   = 'form-feedback error';
    }
  } catch (err) {
    $formFeedback.textContent = 'Network error — could not submit.';
    $formFeedback.className   = 'form-feedback error';
  }

  btn.disabled = false;
});

// ── Boot ──────────────────────────────────────────────────────

(async () => {
  await loadCrew();
  connectWebSocket();
})();
