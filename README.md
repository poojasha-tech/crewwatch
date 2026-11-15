# CrewWatch

> Real-time health monitoring for people isolated from medical professionals — astronauts on space missions and communities in remote areas where a doctor cannot reach in time.

Built for **NASA Space Apps Challenge 2026** — Challenge: *Create Health Monitoring Software for Astronauts on Space Missions*

---

## The Problem

Astronauts on long-duration missions face health risks from microgravity, radiation, isolation, and sleep disruption — often without immediate access to a physician. The same isolation problem exists on Earth: in remote villages, rural clinics, and disaster zones where medical help is hours away.

CrewWatch gives both groups the same thing: a tool to monitor their own health, detect problems early, and know exactly what to do.

---

## What It Does

- **Real-time vitals monitoring** — heart rate, blood pressure, SpO2, temperature, respiration, radiation dose
- **Per-person anomaly detection** — z-score analysis against each user's own rolling baseline, not generic thresholds
- **Trend detection** — catches slow deterioration before it crosses a danger threshold
- **Composite risk score** — single 0–100 score per person (green / yellow / red)
- **Plain-English first aid guidance** — every alert tells you what happened and what to do right now
- **Symptom checker** — no medical devices needed, works with yes/no questions
- **Environment modes** — Space (NASA ranges) / Village / Disaster Zone
- **Offline capable** — works without internet via service worker cache
- **Health history export** — printable report to bring to a doctor

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Language | TypeScript |
| Framework | Express |
| Database | PostgreSQL 16 |
| Real-time | WebSocket (ws) |
| Infrastructure | Docker + Docker Compose |
| Frontend | HTML / CSS / Chart.js |

---

## Running Locally

**Requirements:** Docker Desktop

```bash
git clone https://github.com/poojasha-tech/crewwatch.git
cd crewwatch
cp .env.example .env
docker compose up --build
```

Open `http://localhost:3000` in your browser.

That's it. One command starts the database, the backend, and the data simulator.

---

## How the Intelligence Works

Most health monitoring tools fire alerts when a value crosses a fixed threshold (e.g. "heart rate > 100"). CrewWatch is different:

**Per-person baseline** — the system learns each person's normal over time using a rolling statistical mean and standard deviation. An alert fires when a reading deviates from *that person's* normal, not a population average.

```
z = (current_reading - personal_mean) / personal_stddev
Alert fires when |z| > 2.5
```

**Trend detection** — checks if a vital has been consistently moving in one direction over the last 20 readings. Catches problems that never cross a threshold but are clearly getting worse.

**Risk score** — combines all active alerts into a single 0–100 number per person. Flight surgeons and health workers see who needs attention at a glance.

---

## NASA References

- NASA-STD-3001 Vol. 2 — Human Factors, Habitability, and Environmental Health (physiological ranges)
- NASA Open Science Data Repository (OSDR) — Inspiration4 mission physiological data
- NASA Human Research Program — Five Hazards of Human Spaceflight

---

## Project Status

🚧 **In active development** — NASA Space Apps Challenge 2026 (Nov 14–15)

- [x] Docker + Postgres infrastructure
- [x] Database schema (crew, vitals, baselines, alerts)
- [x] Data simulator with anomaly injection
- [x] REST API
- [ ] Intelligence engine (baseline + anomaly + trend)
- [ ] WebSocket real-time layer
- [ ] Dashboard frontend
- [ ] First aid guidance engine
- [ ] Symptom checker
- [ ] Offline support

---

## Author

Pooja Sharma — [github.com/poojasha-tech](https://github.com/poojasha-tech)
