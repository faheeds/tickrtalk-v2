-- ============================================================
-- TickrTalk — Blend strategy (paper trading)
-- Run in the Supabase SQL Editor. Safe to re-run.
-- Requires: users table and update_updated_at() (see schema.sql).
-- ============================================================

-- Per-user settings
CREATE TABLE IF NOT EXISTS blend_config (
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled              BOOLEAN NOT NULL DEFAULT FALSE,   -- FALSE = no new entries; open positions are still managed to exit
  budget               NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  last_rebalance_month TEXT,                              -- 'YYYY-MM' of the last monthly momentum rebalance
  last_preview_at      TIMESTAMPTZ,                       -- throttles the on-demand preview (it reads ~95 symbols)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Position ledger. Alpaca nets all strategies into one position per symbol, so the
-- strategy keeps its own record of which shares belong to which sleeve.
CREATE TABLE IF NOT EXISTS blend_positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sleeve          TEXT NOT NULL CHECK (sleeve IN ('mom', 'down3', 'ibs', 'crsi')),
  symbol          TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending_entry', 'open', 'pending_exit', 'closed', 'cancelled')),
  target_qty      INTEGER NOT NULL CHECK (target_qty > 0),   -- shares ordered
  qty             INTEGER NOT NULL DEFAULT 0,                 -- shares actually filled
  ref_price       NUMERIC(14,4),                              -- last close used for sizing
  entry_price     NUMERIC(14,4),                              -- fill price
  entry_date      DATE NOT NULL,                              -- date the entry order was sent
  entry_reason    TEXT,
  entry_client_id TEXT UNIQUE,
  exit_price      NUMERIC(14,4),
  exit_date       DATE,
  exit_reason     TEXT,
  exit_client_id  TEXT UNIQUE,
  return_pct      NUMERIC(8,3),                               -- realised, after fills
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A sleeve can hold a symbol at most once at a time.
CREATE UNIQUE INDEX IF NOT EXISTS blend_positions_live_uniq
  ON blend_positions (user_id, sleeve, symbol)
  WHERE status IN ('pending_entry', 'open', 'pending_exit');

CREATE INDEX IF NOT EXISTS blend_positions_user_status_idx
  ON blend_positions (user_id, status, updated_at DESC);

-- One row per user per trading day: makes the daily run idempotent and gives a history.
CREATE TABLE IF NOT EXISTS blend_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_date     DATE NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('running', 'done', 'skipped', 'failed')),
  message      TEXT,
  regime       BOOLEAN,           -- SPY above its 200-day average?
  data_bar     DATE,              -- date of the daily bar the decisions were based on
  summary      JSONB,             -- counts, feed used, skipped orders
  orders       JSONB,             -- orders placed this run
  errors       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  UNIQUE (user_id, run_date)
);

-- Row Level Security ON with no policies: only the service-role key (our API routes,
-- which filter by the Clerk user id) can read or write. Same pattern as backtest_runs.
ALTER TABLE blend_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE blend_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE blend_runs      ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS blend_config_updated_at ON blend_config;
CREATE TRIGGER blend_config_updated_at
  BEFORE UPDATE ON blend_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS blend_positions_updated_at ON blend_positions;
CREATE TRIGGER blend_positions_updated_at
  BEFORE UPDATE ON blend_positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
