# CrewWatch

> Real-time health monitoring for people isolated from medical professionals —
> astronauts on space missions and communities in remote areas where a doctor cannot reach in time.

Built for **NASA Space Apps Challenge 2026**
Challenge: *Create Health Monitoring Software for Astronauts on Space Missions*

---

## The Problem

An astronaut on a six-month mission to the Moon or Mars cannot call a doctor at 2 AM.
A villager in rural Sahel cannot either.
Both face the same core problem: **health emergencies happening far from medical help**, with no way to know if something is going wrong until it has already gone wrong.

CrewWatch is a monitoring system that runs continuously, learns each person's normal, and alerts them — with specific guidance — the moment something starts to change.

---

## One command to run

**Requirements:** Docker Desktop (free, Mac / Windows / Linux)

```bash
git clone https://github.com/poojasha-tech/crewwatch.git
cd crewwatch
cp .env.example .env
docker compose up --build
```

Open **http://localhost:3000**

That single command starts three things in the right order:
1. PostgreSQL 16 database (waits until healthy before anything else starts)
2. Node.js backend with Express API + WebSocket server
3. Data simulator that generates a live vitals feed every 5 seconds

No other installs needed. No separate frontend server. No manual database setup.

---

## What You See

A live dashboard with three panels:

**Left — Crew sidebar**
Every crew member listed with their current risk level (green / yellow / red), risk score (0–100), and active alert count. Updates in real time via WebSocket.

**Centre — Vitals detail**
Eight vital signs for the selected person, updating every 5 seconds:
heart rate · blood pressure · SpO₂ · body temperature · respiration rate · radiation dose · sleep hours · mood

Four live trend charts (Chart.js) show the last 60 readings scrolling in real time.

**Right column (within main panel) — Alerts**
Every active alert for the selected person, with:
- Severity badge (LOW / MEDIUM / HIGH)
- Plain-English description of what is happening
- Step-by-step first aid guidance — what to do right now, specific numbers, when to escalate

A manual entry form at the bottom lets a crew member or health worker log their own readings from a thermometer, pulse oximeter, or blood pressure cuff.

---

## How the Intelligence Works

Most health monitoring tools compare readings against fixed population thresholds (e.g. "heart rate > 100 = alert"). That approach produces many false positives for people whose normal is naturally higher, and misses early deterioration in people whose values are still "in range."

CrewWatch uses three layers of detection:

### 1 — Personal baseline (Welford's online algorithm)

For each person and each vital, the system maintains a rolling mean and standard deviation using Welford's algorithm — a technique that updates in O(1) per reading without storing all history.

An alert fires when a reading is statistically unusual *for that specific person*:

```
z = (current_reading − personal_mean) / personal_stddev

|z| ≥ 2.5  →  LOW alert    (unusual — 1.2% random chance)
|z| ≥ 3.0  →  MEDIUM alert  (very unusual — 0.27% random chance)
|z| ≥ 3.5  →  HIGH alert    (extremely unusual — 0.05% random chance)
```

A reading of heart rate 85 bpm might be normal for one person and alarming for another. The z-score captures this.

### 2 — Trend detection (linear regression slope)

An anomaly alert fires when a single reading is extreme. A trend alert fires when a vital has been consistently moving in one direction over the last 20 readings — even if each individual reading is still within normal range.

This catches slow deterioration. SpO₂ dropping 0.15% per reading over 20 readings is a critical warning sign that threshold-based monitoring would miss entirely.

```
slope = Σ(x − x̄)(y − ȳ) / Σ(x − x̄)²   (least-squares linear regression)

If |slope| ≥ threshold for this vital  →  trend alert fires
```

Slope thresholds are calibrated per vital because each vital has a different scale and rate of normal variation.

### 3 — Composite risk score

All active alerts are combined into a single 0–100 risk score per person:

```
LOW alert    →  +10 points
MEDIUM alert →  +25 points
HIGH alert   →  +50 points
Capped at 100

0–29   →  GREEN   (normal)
30–59  →  YELLOW  (needs attention)
60–100 →  RED     (urgent)
```

This score is stored on the crew table and broadcast in every WebSocket event, so the sidebar risk badges stay current without an extra database query.

---

## First Aid Guidance

Every alert carries two fields written in plain language (no medical jargon):

**message** — what is happening, in one sentence:
> "Your blood oxygen level has been slowly declining. Even small drops over time are significant."

**guidance** — what to do right now, step by step:
> "Sit upright. Take slow deep breaths. Move to better ventilation if possible. Re-check in 5 minutes. If decline continues below 94%, contact medical support immediately."

Guidance is calibrated per vital, per direction (high vs. low, rising vs. falling), and is written to be usable by a non-medical person — an astronaut alone in a spacecraft, or a village health worker with no clinical training.

Sleep deprivation and low mood are also monitored — both are critical health indicators in isolated environments.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser                             │
│  index.html · style.css · dashboard.js · Chart.js       │
│  WebSocket client ─────────────────────────────────┐    │
└───────────────────────┬─────────────────────────────│───┘
                        │ HTTP (REST API)              │ WS
                        ▼                             ▼
┌─────────────────────────────────────────────────────────┐
│              Node.js 20 · TypeScript · Express 5         │
│                                                          │
│  GET /crew          GET /crew/:id                        │
│  GET /crew/:id/vitals   POST /crew/:id/readings          │
│  GET /alerts                                             │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │            Alert Pipeline                        │    │
│  │  updateBaseline() → Welford rolling mean/stddev  │    │
│  │  checkAnomaly()   → z-score per vital            │    │
│  │  checkTrend()     → linear regression slope      │    │
│  │  updateRiskScore()→ composite 0–100 score        │    │
│  │  broadcast()      → WebSocket push to all clients│    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  Simulator: Gaussian noise (Box-Muller) + 5% anomaly    │
│  injection, one reading per crew member per 5 seconds   │
└───────────────────────┬─────────────────────────────────┘
                        │ SQL (pg)
                        ▼
┌─────────────────────────────────────────────────────────┐
│                 PostgreSQL 16                             │
│  crew · vitals_readings · baselines · alerts             │
└─────────────────────────────────────────────────────────┘
```

---

## Demo Data

Three crew members seed automatically on first run:

| Name | Environment | Role |
|---|---|---|
| Maya Chen | Space — Artemis IV | Commander |
| Raj Patel | Space — Artemis IV | Flight Engineer |
| Amara Diallo | Village — Sahel Region | Health Worker |

The simulator generates realistic vitals with Gaussian noise and injects anomalies randomly (5% probability per reading, with 4 anomaly types: tachycardia, hypoxia, hyperthermia, hypertension). Baselines build after 20 readings, then the detection system becomes live.

---

## NASA References

| Standard | Use in CrewWatch |
|---|---|
| NASA-STD-3001 Vol. 2 Rev. B — Human Factors, Habitability and Environmental Health | Physiological ranges for all nine monitored vitals |
| NASA Human Research Program — Five Hazards of Human Spaceflight | Radiation dose monitoring; sleep and mood as mission-critical psychosocial indicators |
| NASA Open Science Data Repository (OSDR) — Inspiration4 Mission | Reference for typical in-flight physiological variation ranges used in simulator calibration |

---

## Author

Pooja Sharma — [github.com/poojasha-tech](https://github.com/poojasha-tech)
