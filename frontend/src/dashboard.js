'use strict';

/* ══════════════════════════════════════════════════════════════
   CrewWatch Dashboard
   ══════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────
let selectedCrewId  = null;
let selectedCrewEnv = 'space';      // 'space' | 'village'
let envOverride     = 'auto';       // 'auto' | 'disaster'
let simpleMode      = false;
let crewData        = {};           // { [id]: crew object }
const charts        = {};           // { vital_name: Chart }
let activeAlertMap  = {};           // { vital_name: severity } for simple-mode status
let lastKnownVitals = null;         // for export and offline fallback
let lastKnownAlerts = [];

// ── DOM refs ──────────────────────────────────────────────────
const $crewList     = document.getElementById('crew-list');
const $crewCount    = document.getElementById('crew-count');
const $lastUpdate   = document.getElementById('last-update');
const $wsDot        = document.getElementById('ws-dot');
const $wsLabel      = document.getElementById('ws-label');
const $emptyState   = document.getElementById('empty-state');
const $crewDetail   = document.getElementById('crew-detail');
const $detailName   = document.getElementById('detail-name');
const $detailRole   = document.getElementById('detail-role');
const $detailEnv    = document.getElementById('detail-env');
const $riskGauge    = document.getElementById('risk-gauge');
const $riskScore    = document.getElementById('risk-score');
const $alertList    = document.getElementById('alert-list');
const $noAlerts     = document.getElementById('no-alerts');
const $alertBadge   = document.getElementById('alert-count-badge');
const $readingForm  = document.getElementById('reading-form');
const $formFeedback = document.getElementById('form-feedback');
const $offlineBadge = document.getElementById('offline-badge');
const $disasterBanner = document.getElementById('disaster-banner');

// ── Helpers ───────────────────────────────────────────────────

function fmt(val, decimals = 1) {
  if (val === null || val === undefined) return '—';
  const n = parseFloat(val);
  return isNaN(n) ? '—' : n.toFixed(decimals);
}

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function dateLabel(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setWsStatus(state, label) {
  $wsDot.className   = `ws-dot ${state}`;
  $wsLabel.textContent = label;
}

// ── Crew sidebar ──────────────────────────────────────────────

async function loadCrew() {
  const res  = await fetch('/crew');
  const list = await res.json();
  list.forEach(c => { crewData[c.id] = c; });
  $crewCount.textContent = `${list.length} crew members`;

  $crewList.innerHTML = '';
  list.forEach(c => {
    const li       = document.createElement('li');
    li.className   = 'crew-item';
    li.dataset.id  = c.id;
    const count    = parseInt(c.alert_count) || 0;
    const level    = c.risk_level || 'green';
    li.innerHTML = `
      <span class="crew-name">${c.name}</span>
      <span class="crew-role-line">${c.role} · ${c.mission}</span>
      <div class="crew-risk-line">
        <span class="risk-dot ${level}"></span>
        <span class="crew-risk-text">Risk ${c.risk_score ?? 0} · ${level.toUpperCase()}</span>
        <span class="crew-alert-pill ${count > 0 ? 'visible' : ''}">${count}</span>
      </div>`;
    li.addEventListener('click', () => selectCrew(c.id));
    $crewList.appendChild(li);
  });

  if (list.length > 0) selectCrew(list[0].id);
}

function updateCrewSidebarItem(crewId, riskScore, riskLevel) {
  const li   = $crewList.querySelector(`[data-id="${crewId}"]`);
  if (!li) return;
  const dot  = li.querySelector('.risk-dot');
  const text = li.querySelector('.crew-risk-text');
  if (dot)  dot.className  = `risk-dot ${riskLevel}`;
  if (text) text.textContent = `Risk ${riskScore} · ${riskLevel.toUpperCase()}`;
  if (crewData[crewId]) {
    crewData[crewId].risk_score = riskScore;
    crewData[crewId].risk_level = riskLevel;
  }
}

// ── Environment mode (#23) ────────────────────────────────────

function effectiveEnv() {
  if (envOverride === 'disaster') return 'disaster';
  return selectedCrewEnv; // 'space' or 'village'
}

function applyEnvMode() {
  const env = effectiveEnv();
  $crewDetail.dataset.env = env;

  const isDisaster = env === 'disaster';
  $disasterBanner.classList.toggle('hidden', !isDisaster);

  // Update topbar mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === envOverride);
  });
}

document.getElementById('mode-switcher').addEventListener('click', e => {
  const btn = e.target.closest('.mode-btn');
  if (!btn) return;
  envOverride = btn.dataset.mode;
  applyEnvMode();
});

// ── Simple (plain-language) view (#25) ───────────────────────

document.getElementById('simple-toggle').addEventListener('click', () => {
  simpleMode = !simpleMode;
  document.body.classList.toggle('simple-mode', simpleMode);
  document.getElementById('simple-toggle').classList.toggle('active', simpleMode);
  document.getElementById('simple-toggle').textContent = simpleMode ? 'Full View' : 'Simple View';
  // Re-apply status badges from current alert map
  refreshVitalStatuses();
});

function refreshVitalStatuses() {
  const vitals = ['heart_rate','spo2','bp','body_temp','respiration_rate',
                  'radiation_dose','sleep_hours','mood'];
  vitals.forEach(v => {
    const $s = document.getElementById(`status-${v}`);
    if (!$s) return;
    // Map bp to systolic_bp for alert lookup
    const alertKey = v === 'bp' ? 'systolic_bp' : v;
    const severity = activeAlertMap[alertKey] ?? null;
    setVitalStatus($s, severity);
  });
}

function setVitalStatus($el, severity) {
  if (!severity) {
    $el.textContent = 'Normal';
    $el.className   = 'vital-status status-normal';
  } else if (severity === 'low') {
    $el.textContent = 'Watch';
    $el.className   = 'vital-status status-watch';
  } else if (severity === 'medium') {
    $el.textContent = 'Concern';
    $el.className   = 'vital-status status-concern';
  } else {
    $el.textContent = 'Critical';
    $el.className   = 'vital-status status-critical';
  }
}

// ── Select crew member ────────────────────────────────────────

async function selectCrew(id) {
  selectedCrewId  = id;
  selectedCrewEnv = crewData[id]?.environment ?? 'space';

  document.querySelectorAll('.crew-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id == id));

  $emptyState.classList.add('hidden');
  $crewDetail.classList.remove('hidden');

  const crew = crewData[id];
  if (crew) renderCrewHeader(crew);

  applyEnvMode();

  await Promise.all([loadVitalsHistory(id), loadAlerts(id)]);
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
  document.getElementById('val-bp').textContent               =
    `${fmt(vitals.systolic_bp, 0)}/${fmt(vitals.diastolic_bp, 0)}`;
  document.getElementById('val-body_temp').textContent        = fmt(vitals.body_temp, 1);
  document.getElementById('val-respiration_rate').textContent = fmt(vitals.respiration_rate, 0);
  document.getElementById('val-radiation_dose').textContent   =
    vitals.radiation_dose !== null ? fmt(vitals.radiation_dose, 2) : '—';
  document.getElementById('val-sleep_hours').textContent      =
    vitals.sleep_hours !== null ? fmt(vitals.sleep_hours, 1) : '—';
  document.getElementById('val-mood').textContent             =
    vitals.mood !== null ? vitals.mood : '—';

  $lastUpdate.textContent = `Updated ${timeLabel(vitals.recorded_at || new Date())}`;
  lastKnownVitals = vitals;
}

// ── Charts ────────────────────────────────────────────────────

const CHART_CFG = {
  heart_rate:  { color: '#ff6b8a' },
  spo2:        { color: '#4b8eff' },
  systolic_bp: { color: '#f7c948' },
  body_temp:   { color: '#00e896' },
};

function buildChart(canvasId, vital) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels:   [],
      datasets: [{
        data:            [],
        borderColor:     CHART_CFG[vital].color,
        backgroundColor: CHART_CFG[vital].color + '22',
        borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 200 },
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { grid: { color: '#1e2d50' }, ticks: { color: '#5a6a90', font: { size: 10 } }, border: { display: false } },
      },
    },
  });
}

function initCharts() {
  Object.values(charts).forEach(c => c.destroy());
  charts['heart_rate']  = buildChart('chart-heart_rate',  'heart_rate');
  charts['spo2']        = buildChart('chart-spo2',        'spo2');
  charts['systolic_bp'] = buildChart('chart-systolic_bp', 'systolic_bp');
  charts['body_temp']   = buildChart('chart-body_temp',   'body_temp');
}

function populateCharts(readings) {
  const labels = readings.map(r => timeLabel(r.recorded_at));
  Object.entries(charts).forEach(([vital, chart]) => {
    chart.data.labels           = labels;
    chart.data.datasets[0].data = readings.map(r => parseFloat(r[vital]) || null);
    chart.update('none');
  });
}

function appendChartPoint(reading) {
  const MAX   = 60;
  const label = timeLabel(reading.recorded_at || new Date().toISOString());
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

// ── Vitals history ────────────────────────────────────────────

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
  lastKnownAlerts = alerts;
  renderAlerts(alerts);
}

function renderAlerts(alerts) {
  $alertList.innerHTML = '';
  activeAlertMap = {};

  if (!alerts || alerts.length === 0) {
    $noAlerts.classList.remove('hidden');
    $alertBadge.classList.add('hidden');
    refreshVitalStatuses();
    return;
  }

  $noAlerts.classList.add('hidden');
  $alertBadge.classList.remove('hidden');
  $alertBadge.textContent = alerts.length;

  // Build alert map for simple-mode status badges
  alerts.forEach(a => {
    const existing = activeAlertMap[a.vital_name];
    const rank = { high: 3, medium: 2, low: 1 };
    if (!existing || rank[a.severity] > rank[existing]) {
      activeAlertMap[a.vital_name] = a.severity;
    }
  });

  // Also map diastolic_bp → bp for status badge
  if (activeAlertMap['diastolic_bp'] && !activeAlertMap['systolic_bp']) {
    activeAlertMap['systolic_bp'] = activeAlertMap['diastolic_bp'];
  }

  refreshVitalStatuses();

  alerts.forEach(a => {
    const li = document.createElement('li');
    li.className = `alert-item severity-${a.severity}`;
    const vitalDisplay = (a.vital_name || '').replace(/_/g, ' ');
    li.innerHTML = `
      <div class="alert-top">
        <span class="alert-severity-pill ${a.severity}">${a.severity.toUpperCase()}</span>
        <span class="alert-vital-name">${vitalDisplay}</span>
        <span class="alert-type-pill">${a.alert_type}</span>
      </div>
      <p class="alert-message">${a.message}</p>
      <p class="alert-guidance">${a.guidance}</p>`;
    $alertList.appendChild(li);
  });
}

// ── WebSocket ─────────────────────────────────────────────────

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws    = new WebSocket(`${proto}//${location.host}`);

  ws.addEventListener('open',    ()  => setWsStatus('connected', 'Live'));
  ws.addEventListener('close',   ()  => { setWsStatus('disconnected', 'Reconnecting…'); setTimeout(connectWebSocket, 3000); });
  ws.addEventListener('error',   ()  => setWsStatus('error', 'Connection error'));

  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type !== 'reading') return;

    updateCrewSidebarItem(msg.crewId, msg.riskScore, msg.riskLevel);

    if (msg.crewId === selectedCrewId) {
      const vitals = { ...msg.vitals, recorded_at: new Date().toISOString() };
      renderVitalsCards(vitals);
      appendChartPoint(vitals);
      setRiskGauge(msg.riskScore, msg.riskLevel);
      loadAlerts(selectedCrewId);
    }
  });
}

// ── Manual reading form ───────────────────────────────────────

$readingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedCrewId) return;

  const btn = $readingForm.querySelector('.btn-submit');
  btn.disabled = true;
  $formFeedback.textContent = '';
  $formFeedback.className   = 'form-feedback';

  const body = {};
  ['heart_rate','spo2','systolic_bp','diastolic_bp',
   'body_temp','respiration_rate','sleep_hours','mood'].forEach(field => {
    const el = document.getElementById(`f-${field}`);
    if (el && el.value !== '') {
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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      $formFeedback.textContent = `✓ Reading #${data.id} saved.`;
      $formFeedback.className   = 'form-feedback success';
      $readingForm.reset();
    } else {
      $formFeedback.textContent = `Error: ${data.error || 'Unknown error'}`;
      $formFeedback.className   = 'form-feedback error';
    }
  } catch {
    $formFeedback.textContent = 'Network error — could not submit.';
    $formFeedback.className   = 'form-feedback error';
  }

  btn.disabled = false;
});

// ── Symptom checker (#24) ─────────────────────────────────────

const QUESTIONS = [
  {
    id: 'overall',
    text: 'How are you feeling right now?',
    options: [
      { label: 'Fine — no complaints', score: 0 },
      { label: 'A little off', score: 1 },
      { label: 'Unwell', score: 2 },
      { label: 'Very unwell', score: 3 },
    ],
  },
  {
    id: 'chest',
    text: 'Do you have chest pain or trouble breathing?',
    options: [
      { label: 'No', score: 0 },
      { label: 'Mild discomfort', score: 2 },
      { label: 'Yes — significant', score: 6, emergency: true },
    ],
  },
  {
    id: 'head',
    text: 'Do you have a headache or blurred vision?',
    options: [
      { label: 'No', score: 0 },
      { label: 'Mild headache', score: 1 },
      { label: 'Severe or vision changes', score: 3, emergency: true },
    ],
  },
  {
    id: 'heart',
    text: 'Is your heart racing, pounding, or skipping beats?',
    options: [
      { label: 'No', score: 0 },
      { label: 'Occasionally', score: 1 },
      { label: 'Yes, persistently', score: 2 },
    ],
  },
  {
    id: 'fever',
    text: 'Are you feeling hot, feverish, or shivering?',
    options: [
      { label: 'No', score: 0 },
      { label: 'A little warm', score: 1 },
      { label: 'Yes, clearly feverish or shivering', score: 2 },
    ],
  },
  {
    id: 'sleep',
    text: 'How much sleep did you get last night?',
    options: [
      { label: '7 hours or more', score: 0, value: 8 },
      { label: '5–7 hours', score: 0, value: 6 },
      { label: '3–5 hours', score: 1, value: 4 },
      { label: 'Less than 3 hours', score: 2, value: 2 },
    ],
  },
  {
    id: 'mood',
    text: 'How is your mood right now?',
    options: [
      { label: 'Good', score: 0, value: 5 },
      { label: 'Okay', score: 0, value: 3 },
      { label: 'Low', score: 1, value: 2 },
      { label: 'Very low or hopeless', score: 2, value: 1 },
    ],
  },
];

const RESULTS = [
  {
    maxScore: 2,
    level: 'green',
    icon: '✓',
    title: 'You seem okay',
    message: 'No significant symptoms detected. Keep monitoring your vitals and stay hydrated.',
    guidance: 'Continue normal activities. Log your vitals if you have devices. Check in again if anything changes.',
  },
  {
    maxScore: 5,
    level: 'yellow',
    icon: '⚠',
    title: 'Some concerns',
    message: 'A few symptoms worth watching. Rest and monitor closely.',
    guidance: 'Rest for the next hour. Drink water. Check your vitals if possible. Avoid high-risk or complex tasks. Alert your team if you feel worse.',
  },
  {
    maxScore: 9,
    level: 'yellow',
    icon: '⚠',
    title: 'Multiple symptoms',
    message: 'Several symptoms are present. You need to rest and alert your support team.',
    guidance: 'Stop non-essential activities. Rest in a comfortable position. Drink water. Check all vitals if devices are available. Alert your team or mission control now.',
  },
  {
    maxScore: Infinity,
    level: 'red',
    icon: '✕',
    title: 'Seek help now',
    message: 'Your symptoms suggest a potentially serious situation.',
    guidance: 'Alert medical support or mission control immediately. Do not be alone. Lie down if you feel faint. If you have chest pain or severe breathing difficulty — this is an emergency.',
  },
];

let symptomStep    = 0;
let symptomScore   = 0;
let symptomEmergency = false;
let symptomAnswers = {};   // { sleep: { value: 6 }, mood: { value: 2 } }

document.getElementById('symptom-btn').addEventListener('click', openSymptomChecker);
document.getElementById('modal-close').addEventListener('click', closeSymptomChecker);
document.getElementById('symptom-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('symptom-modal')) closeSymptomChecker();
});

function openSymptomChecker() {
  symptomStep      = 0;
  symptomScore     = 0;
  symptomEmergency = false;
  symptomAnswers   = {};
  document.getElementById('symptom-modal').classList.remove('hidden');
  renderSymptomStep();
}

function closeSymptomChecker() {
  document.getElementById('symptom-modal').classList.add('hidden');
}

function renderSymptomStep() {
  const $content = document.getElementById('symptom-content');

  if (symptomStep >= QUESTIONS.length) {
    renderSymptomResult($content);
    return;
  }

  const q   = QUESTIONS[symptomStep];
  const pct = symptomStep / QUESTIONS.length;

  const dots = QUESTIONS.map((_, i) => {
    const cls = i < symptomStep ? 'done' : i === symptomStep ? 'current' : '';
    return `<div class="symptom-progress-dot ${cls}"></div>`;
  }).join('');

  $content.innerHTML = `
    <div class="symptom-step-label">Question ${symptomStep + 1} of ${QUESTIONS.length}</div>
    <div class="symptom-progress">${dots}</div>
    <div class="symptom-question">${q.text}</div>
    <div class="symptom-options">
      ${q.options.map((opt, i) => `
        <button class="symptom-option" data-idx="${i}">${opt.label}</button>
      `).join('')}
    </div>`;

  $content.querySelectorAll('.symptom-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const opt = q.options[parseInt(btn.dataset.idx)];
      symptomScore += opt.score;
      if (opt.emergency) symptomEmergency = true;
      // Store sleep/mood values for optional submission
      if (q.id === 'sleep' && opt.value !== undefined) symptomAnswers.sleep_hours = opt.value;
      if (q.id === 'mood'  && opt.value !== undefined) symptomAnswers.mood = opt.value;
      symptomStep++;
      renderSymptomStep();
    });
  });
}

function renderSymptomResult($content) {
  const result = symptomEmergency
    ? RESULTS[RESULTS.length - 1]
    : RESULTS.find(r => symptomScore <= r.maxScore) ?? RESULTS[RESULTS.length - 1];

  $content.innerHTML = `
    <div class="symptom-result">
      <div class="result-icon">${result.icon}</div>
      <div class="result-level ${result.level}">${result.title}</div>
      <p class="result-message">${result.message}</p>
      <div class="result-guidance">${result.guidance}</div>
      <div class="result-actions">
        ${selectedCrewId && Object.keys(symptomAnswers).length > 0 ? `
          <button class="btn-result-primary" id="save-symptom-btn">
            Save sleep &amp; mood to record
          </button>
        ` : ''}
        <button class="btn-result-secondary" id="close-result-btn">Close</button>
      </div>
    </div>`;

  $content.querySelector('#close-result-btn')
    ?.addEventListener('click', closeSymptomChecker);

  $content.querySelector('#save-symptom-btn')
    ?.addEventListener('click', async () => {
      const btn = $content.querySelector('#save-symptom-btn');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await fetch(`/crew/${selectedCrewId}/readings`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(symptomAnswers),
        });
        btn.textContent = '✓ Saved';
      } catch {
        btn.textContent = 'Error — try again';
      }
    });
}

// ── Export / print report (#27) ───────────────────────────────

document.getElementById('export-btn').addEventListener('click', () => {
  if (!selectedCrewId) return;
  buildPrintReport();
  window.print();
});

function buildPrintReport() {
  const crew  = crewData[selectedCrewId];
  const v     = lastKnownVitals;
  const alerts = lastKnownAlerts;
  const now   = new Date().toLocaleString();

  if (!crew) return;

  const vitalsHtml = v ? `
    <div class="pr-vitals-grid">
      <div class="pr-vital"><div class="pr-vital-value">${fmt(v.heart_rate,0)}</div><div class="pr-vital-label">Heart Rate (bpm)</div></div>
      <div class="pr-vital"><div class="pr-vital-value">${fmt(v.spo2,1)}</div><div class="pr-vital-label">SpO₂ (%)</div></div>
      <div class="pr-vital"><div class="pr-vital-value">${fmt(v.systolic_bp,0)}/${fmt(v.diastolic_bp,0)}</div><div class="pr-vital-label">Blood Pressure (mmHg)</div></div>
      <div class="pr-vital"><div class="pr-vital-value">${fmt(v.body_temp,1)}</div><div class="pr-vital-label">Body Temp (°C)</div></div>
      <div class="pr-vital"><div class="pr-vital-value">${fmt(v.respiration_rate,0)}</div><div class="pr-vital-label">Respiration (br/min)</div></div>
      <div class="pr-vital"><div class="pr-vital-value">${v.radiation_dose !== null ? fmt(v.radiation_dose,3) : '—'}</div><div class="pr-vital-label">Radiation (mSv)</div></div>
      <div class="pr-vital"><div class="pr-vital-value">${v.sleep_hours !== null ? fmt(v.sleep_hours,1) : '—'}</div><div class="pr-vital-label">Sleep (hrs)</div></div>
      <div class="pr-vital"><div class="pr-vital-value">${v.mood !== null ? v.mood : '—'}</div><div class="pr-vital-label">Mood (1–5)</div></div>
    </div>` : '<p>No vitals data available.</p>';

  const alertsHtml = alerts.length === 0
    ? '<p>No active alerts.</p>'
    : alerts.map(a => `
        <div class="pr-alert ${a.severity}">
          <div class="pr-alert-title">${a.severity.toUpperCase()} — ${(a.vital_name||'').replace(/_/g,' ')} (${a.alert_type})</div>
          <div class="pr-alert-message">${a.message}</div>
          <div class="pr-alert-guidance">Guidance: ${a.guidance}</div>
        </div>`).join('');

  const riskLevel = crew.risk_level ?? 'green';

  document.getElementById('print-content').innerHTML = `
    <div class="pr-header">
      <div>
        <div class="pr-title">CrewWatch Health Report</div>
        <div class="pr-sub">${crew.name} — ${crew.role} — ${crew.mission}</div>
      </div>
      <div class="pr-date">Generated: ${now}</div>
    </div>

    <div class="pr-section-heading">Risk Assessment</div>
    <div class="pr-risk-row">
      <div class="pr-risk-score">${crew.risk_score ?? 0}</div>
      <div class="pr-risk-level ${riskLevel}">${riskLevel.toUpperCase()}</div>
      <div style="font-size:11px;color:#666">Score 0–100 · Based on active alerts</div>
    </div>

    <div class="pr-section-heading">Latest Vitals</div>
    ${vitalsHtml}

    <div class="pr-section-heading">Active Alerts (${alerts.length})</div>
    ${alertsHtml}

    <div class="pr-footer">
      <span>CrewWatch — NASA Space Apps Challenge 2026</span>
      <span>This report is for reference only. Always consult a medical professional.</span>
      <span>${now}</span>
    </div>`;
}

// ── Offline support (#26) ─────────────────────────────────────

window.addEventListener('online',  () => $offlineBadge.classList.add('hidden'));
window.addEventListener('offline', () => $offlineBadge.classList.remove('hidden'));

if (!navigator.onLine) $offlineBadge.classList.remove('hidden');

// ── Boot ──────────────────────────────────────────────────────

(async () => {
  await loadCrew();
  connectWebSocket();
})();
