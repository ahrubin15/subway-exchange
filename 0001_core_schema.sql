-- Subway Exchange | Core model v0.1 | DESIGN MIGRATION, NOT YET DEPLOYED
-- PostgreSQL 15+; no authentication or client-facing writes are enabled here.
-- Token minor unit: 1/100 of a Token. e.g. 1,000 T = 100000 units.
-- Review privilege ownership and application roles before deploying to Supabase.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE, -- later binds to an authenticated identity; no auth logic here
  username text NOT NULL UNIQUE,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(username) BETWEEN 3 AND 40)
);

CREATE TABLE IF NOT EXISTS wallets (
  player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE RESTRICT,
  available_minor bigint NOT NULL DEFAULT 0 CHECK (available_minor >= 0),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  immutable_rule jsonb NOT NULL CHECK(jsonb_typeof(immutable_rule) = 'object'),
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES market_templates(id),
  rule_snapshot jsonb NOT NULL CHECK(jsonb_typeof(rule_snapshot) = 'object'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','QUALITY_CHECK','OPEN','SUSPENDED','LOCKED','VERIFYING','SETTLED_YES','SETTLED_NO','VOIDED','CANCELLED_BEFORE_OPEN')),
  published_at timestamptz,
  lock_at timestamptz NOT NULL,
  outcome_deadline timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lock_at < outcome_deadline)
);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id),
  side text NOT NULL CHECK(side IN ('YES','NO')),
  ask_ppm integer NOT NULL CHECK(ask_ppm BETWEEN 1 AND 999999),
  model_version text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > issued_at)
);

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES players(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  quote_id uuid NOT NULL REFERENCES quotes(id),
  side text NOT NULL CHECK(side IN ('YES','NO')),
  stake_minor bigint NOT NULL CHECK(stake_minor > 0),
  gross_win_minor bigint NOT NULL CHECK(gross_win_minor >= stake_minor),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','WON','LOST','VOIDED','CASHED_OUT')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  client_request_key text NOT NULL,
  UNIQUE (player_id, client_request_key)
);

CREATE TABLE IF NOT EXISTS market_outcomes (
  market_id uuid PRIMARY KEY REFERENCES markets(id),
  decision text NOT NULL CHECK(decision IN ('YES','NO','VOID')),
  rule_version integer NOT NULL CHECK (rule_version > 0),
  evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence) = 'object'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  reason_code text NOT NULL,
  CHECK (length(reason_code) > 0)
);

CREATE TABLE IF NOT EXISTS token_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES players(id),
  ticket_id uuid REFERENCES tickets(id),
  market_id uuid REFERENCES markets(id),
  kind text NOT NULL CHECK(kind IN
    ('OPENING_GRANT','DAILY_GRANT','WEEKLY_GRANT','REFERRAL_GRANT','STAKE','WIN_PAYOUT','VOID_REFUND','CASH_OUT','CORRECTION')),
  delta_minor bigint NOT NULL CHECK (delta_minor <> 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (player_id, idempotency_key),
  CHECK (
    (kind = 'STAKE' AND delta_minor < 0) OR
    (kind <> 'STAKE' AND delta_minor > 0) OR
    (kind = 'CORRECTION')
  )
);

CREATE TABLE IF NOT EXISTS transit_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  feed_id text NOT NULL,
  source_time timestamptz NOT NULL,
  collected_at timestamptz NOT NULL,
  r2_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  quality jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK(length(title) BETWEEN 2 AND 80),
  captain_id uuid NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS league_members (
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id,player_id)
);
CREATE TABLE IF NOT EXISTS league_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id),
  code_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES players(id),
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tickets_market_status ON tickets(market_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_player_accepted ON tickets(player_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_player_time ON token_ledger(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_markets_status_lock ON markets(status,lock_at);

-- Fail closed. Future migrations must add narrowly scoped player SELECT policies
-- and server-only transactional write functions after an auth and RLS review.
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE transit_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_invites ENABLE ROW LEVEL SECURITY;
COMMIT;
