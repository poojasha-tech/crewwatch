-- CrewWatch Database Schema
-- NASA Space Apps Challenge 2026
-- Based on NASA-STD-3001 Vol. 2 health indicators

-- Astronaut / user profiles
-- Works for both space crew and remote village users depending on mode
CREATE TABLE IF NOT EXISTS crew (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  age         INT,
  role        VARCHAR(100),
  environment VARCHAR(20) NOT NULL DEFAULT 'space', -- 'space' | 'village' | 'disaster'
  mission     VARCHAR(100),
  risk_score  INT NOT NULL DEFAULT 0,               -- 0–100, updated after every pipeline run
  risk_level  VARCHAR(10) NOT NULL DEFAULT 'green', -- 'green' | 'yellow' | 'red'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every vitals reading ever taken, one row per measurement event
-- NULL is allowed on each vital because a user may only log some (e.g. no BP device in a village)
CREATE TABLE IF NOT EXISTS vitals_readings (
  id               SERIAL PRIMARY KEY,
  crew_id          INT NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
  heart_rate       NUMERIC(5,1),   -- bpm
  systolic_bp      NUMERIC(5,1),   -- mmHg
  diastolic_bp     NUMERIC(5,1),   -- mmHg
  spo2             NUMERIC(4,1),   -- %
  body_temp        NUMERIC(4,1),   -- °C
  respiration_rate NUMERIC(4,1),   -- breaths/min
  radiation_dose   NUMERIC(6,3),   -- mSv/day (space mode)
  sleep_hours      NUMERIC(3,1),   -- hours
  mood             SMALLINT CHECK (mood BETWEEN 1 AND 5),
  source           VARCHAR(20) NOT NULL DEFAULT 'simulator', -- 'simulator' | 'manual' | 'device'
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast time-series queries per astronaut
CREATE INDEX IF NOT EXISTS idx_vitals_crew_time
  ON vitals_readings(crew_id, recorded_at DESC);

-- Rolling statistical baseline per person per vital
-- Updated after every new reading (last 100 readings window)
-- This is what makes our anomaly detection personal, not generic
CREATE TABLE IF NOT EXISTS baselines (
  crew_id      INT NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
  vital_name   VARCHAR(30) NOT NULL,
  mean         NUMERIC(8,3) NOT NULL DEFAULT 0,
  stddev       NUMERIC(8,3) NOT NULL DEFAULT 1,
  sample_count INT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (crew_id, vital_name)
);

-- Alerts triggered by anomaly detection or trend detection
CREATE TABLE IF NOT EXISTS alerts (
  id           SERIAL PRIMARY KEY,
  crew_id      INT NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
  vital_name   VARCHAR(30) NOT NULL,
  alert_type   VARCHAR(20) NOT NULL,  -- 'anomaly' | 'trend' | 'symptom'
  severity     VARCHAR(10) NOT NULL,  -- 'low' | 'medium' | 'high'
  message      TEXT NOT NULL,         -- plain English: what happened
  guidance     TEXT NOT NULL,         -- plain English: what to do now
  value        NUMERIC(8,3),          -- the reading that triggered this
  z_score      NUMERIC(6,3),          -- how many stddevs from baseline
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ            -- NULL = still active
);

CREATE INDEX IF NOT EXISTS idx_alerts_crew_active
  ON alerts(crew_id, resolved_at)
  WHERE resolved_at IS NULL;

-- Seed: 3 crew members (2 space, 1 village)
INSERT INTO crew (name, age, role, environment, mission) VALUES
  ('Maya Chen',    34, 'Commander',         'space',   'Artemis IV'),
  ('Raj Patel',    29, 'Flight Engineer',   'space',   'Artemis IV'),
  ('Amara Diallo', 45, 'Village Health Worker', 'village', 'Remote Clinic — Sahel Region')
ON CONFLICT DO NOTHING;
