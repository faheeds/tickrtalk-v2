-- ============================================================
-- TickrTalk — Supabase Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── USERS ─────────────────────────────────────────────────────────────────────
-- Created by Clerk webhook on sign-up; extended with subscription info
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,        -- Clerk user ID (user_xxx)
  email               TEXT NOT NULL,
  stripe_customer_id  TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'trial',   -- trial | active | canceled | past_due
  subscription_tier   TEXT NOT NULL DEFAULT 'basic',   -- basic | pro
  trial_ends_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own record" ON users
  FOR SELECT USING (auth.uid()::text = id);

-- ── BROKERAGE CONNECTIONS ─────────────────────────────────────────────────────
-- Stores encrypted API credentials per broker per user
CREATE TABLE IF NOT EXISTS brokerage_connections (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker                  TEXT NOT NULL,  -- alpaca | schwab | ibkr
  api_key_encrypted       TEXT,           -- AES-256-GCM encrypted
  api_secret_encrypted    TEXT,
  access_token_encrypted  TEXT,           -- OAuth access token (Schwab/IBKR)
  refresh_token_encrypted TEXT,
  token_expires_at        TIMESTAMPTZ,
  account_id              TEXT,
  paper_mode              BOOLEAN NOT NULL DEFAULT TRUE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  label                   TEXT DEFAULT 'Default',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, broker, label)
);

ALTER TABLE brokerage_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own connections" ON brokerage_connections
  FOR ALL USING (auth.uid()::text = user_id);

-- ── PORTFOLIOS ────────────────────────────────────────────────────────────────
-- One portfolio document per user (mirrors paper-portfolio.json)
CREATE TABLE IF NOT EXISTS portfolios (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  broker_connection_id  UUID REFERENCES brokerage_connections(id),
  data                  JSONB NOT NULL DEFAULT '{
    "capital": 100000,
    "positions": [],
    "journal": [],
    "params": {}
  }',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own portfolio" ON portfolios
  FOR ALL USING (auth.uid()::text = user_id);

-- ── WATCHLISTS ────────────────────────────────────────────────────────────────
-- Personal watchlist per user (mirrors personal-watchlist.json)
CREATE TABLE IF NOT EXISTS watchlists (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  symbols    TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own watchlist" ON watchlists
  FOR ALL USING (auth.uid()::text = user_id);

-- ── ALGO PARAMS ───────────────────────────────────────────────────────────────
-- Per-user algo configuration (overrides DEFAULT_PARAMS)
CREATE TABLE IF NOT EXISTS algo_params (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  params     JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE algo_params ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own algo params" ON algo_params
  FOR ALL USING (auth.uid()::text = user_id);

-- ── TRADES (JOURNAL) ─────────────────────────────────────────────────────────
-- Individual trade records for journal + analytics
CREATE TABLE IF NOT EXISTS trades (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_connection_id  UUID REFERENCES brokerage_connections(id),
  symbol                TEXT NOT NULL,
  side                  TEXT NOT NULL,          -- buy | sell
  qty                   INTEGER NOT NULL,
  entry_price           NUMERIC(12,4),
  exit_price            NUMERIC(12,4),
  stop_price            NUMERIC(12,4),
  target_price          NUMERIC(12,4),
  pnl                   NUMERIC(12,4),
  pnl_pct               NUMERIC(8,4),
  strategy              TEXT DEFAULT 'ALGO',
  halal_verdict         TEXT,                   -- HALAL | HARAM | DOUBTFUL | UNKNOWN
  entry_date            TIMESTAMPTZ,
  exit_date             TIMESTAMPTZ,
  days_held             INTEGER,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own trades" ON trades
  FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX trades_user_id_idx ON trades(user_id);
CREATE INDEX trades_symbol_idx  ON trades(symbol);

-- ── TRIGGERS: updated_at ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at               BEFORE UPDATE ON users                EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER brokerage_connections_updated_at BEFORE UPDATE ON brokerage_connections EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER portfolios_updated_at          BEFORE UPDATE ON portfolios           EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER watchlists_updated_at          BEFORE UPDATE ON watchlists           EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER algo_params_updated_at         BEFORE UPDATE ON algo_params          EXECUTE FUNCTION update_updated_at();


-- ── SNAPTRADE ──────────────────────────────────────────────────────────────────
-- Run this migration after the initial schema if upgrading from a prior version:
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS snaptrade_user_secret TEXT;
-- The column stores an AES-256-GCM encrypted SnapTrade userSecret per user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS snaptrade_user_secret TEXT;
