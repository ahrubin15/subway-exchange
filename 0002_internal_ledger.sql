-- Subway Exchange v0.2: PostgreSQL-only PRIVATE transaction engine.
-- RESEARCH / STAGING ONLY. No player-facing API, auth binding, exposure caps,
-- immutable-price modeling or live settlement authorization is implemented.
-- Run after 0001_core_schema.sql on PostgreSQL 15+.
BEGIN;
CREATE SCHEMA IF NOT EXISTS internal;
REVOKE ALL ON SCHEMA internal FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA internal FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA internal REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- No browser client receives table privileges or a grant path from this migration.
-- In Supabase, review role memberships and exposed schemas before deploying.

CREATE OR REPLACE FUNCTION internal.period_key(p_at timestamptz, p_kind text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE d date;
BEGIN
  d := (p_at AT TIME ZONE 'America/New_York')::date;
  CASE p_kind
    WHEN 'OPENING_GRANT' THEN RETURN 'once';
    WHEN 'DAILY_GRANT' THEN RETURN d::text;
    WHEN 'WEEKLY_GRANT' THEN RETURN (d - extract(dow from d)::integer)::text;
    ELSE RAISE EXCEPTION 'Unsupported grant kind' USING ERRCODE = '22023';
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION internal.credit_grant(
  p_player uuid, p_kind text, p_at timestamptz DEFAULT clock_timestamp())
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, internal AS $$
DECLARE v_amount bigint; v_key text; v_current token_ledger%ROWTYPE;
BEGIN
  v_amount := CASE p_kind WHEN 'OPENING_GRANT' THEN 100000
                WHEN 'DAILY_GRANT' THEN 5000
                WHEN 'WEEKLY_GRANT' THEN 100000 ELSE NULL END;
  IF v_amount IS NULL THEN RAISE EXCEPTION 'Unsupported grant' USING ERRCODE='22023'; END IF;
  v_key := p_kind || ':' || internal.period_key(p_at,p_kind);
  -- Wallet row lock serializes all mutations for one player.
  INSERT INTO wallets(player_id) VALUES (p_player) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM wallets WHERE player_id=p_player FOR UPDATE;
  SELECT * INTO v_current FROM token_ledger
    WHERE player_id=p_player AND idempotency_key=v_key;
  IF FOUND THEN
    IF v_current.kind<>p_kind OR v_current.delta_minor<>v_amount THEN
       RAISE EXCEPTION 'Conflicting grant idempotency key' USING ERRCODE='23505';
    END IF;
    RETURN false;
  END IF;
  INSERT INTO token_ledger(player_id,kind,delta_minor,idempotency_key)
    VALUES(p_player,p_kind,v_amount,v_key);
  UPDATE wallets SET available_minor=available_minor+v_amount,
    version=version+1, updated_at=clock_timestamp() WHERE player_id=p_player;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION internal.accept_ticket(
  p_player uuid, p_request_key text, p_quote uuid, p_stake_minor bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, internal AS $$
DECLARE v_quote quotes%ROWTYPE; v_market markets%ROWTYPE;
        v_ticket tickets%ROWTYPE; v_wallet wallets%ROWTYPE;
        v_payout bigint; v_ticket_id uuid;
BEGIN
  IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'Invalid request key' USING ERRCODE='22023'; END IF;
  IF p_stake_minor IS NULL OR p_stake_minor < 1000 OR p_stake_minor > 25000 THEN
    RAISE EXCEPTION 'Stake outside provisional research bounds' USING ERRCODE='22023'; END IF;
  -- Lock market first. Settlement takes the same lock before touching tickets.
  SELECT * INTO v_quote FROM quotes WHERE id=p_quote;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown quote' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_market FROM markets WHERE id=v_quote.market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing market' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_ticket FROM tickets
    WHERE player_id=p_player AND client_request_key=p_request_key;
  IF FOUND THEN
    IF v_ticket.quote_id<>p_quote OR v_ticket.stake_minor<>p_stake_minor THEN
      RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505'; END IF;
    RETURN v_ticket.id;
  END IF;
  IF v_market.status <> 'OPEN' OR clock_timestamp() >= v_market.lock_at
    OR clock_timestamp() >= v_quote.expires_at OR clock_timestamp() < v_quote.issued_at THEN
    RAISE EXCEPTION 'Market or quote not open' USING ERRCODE='22023'; END IF;
  -- This calculation must subsequently be combined with aggregate market
  -- liability controls before real trades are allowed.
  v_payout := floor((p_stake_minor::numeric * 1000000 / v_quote.ask_ppm) + 0.5)::bigint;
  IF v_payout < p_stake_minor OR v_payout > 10000000 THEN
    RAISE EXCEPTION 'Payout outside research bounds' USING ERRCODE='22023'; END IF;
  INSERT INTO wallets(player_id) VALUES(p_player) ON CONFLICT DO NOTHING;
  SELECT * INTO v_wallet FROM wallets WHERE player_id=p_player FOR UPDATE;
  IF v_wallet.available_minor < p_stake_minor THEN
    RAISE EXCEPTION 'Insufficient Tokens' USING ERRCODE='22023'; END IF;
  INSERT INTO tickets(player_id,market_id,quote_id,side,stake_minor,gross_win_minor,
    client_request_key) VALUES(p_player,v_market.id,p_quote,v_quote.side,p_stake_minor,
    v_payout,p_request_key) RETURNING id INTO v_ticket_id;
  INSERT INTO token_ledger(player_id,ticket_id,market_id,kind,delta_minor,idempotency_key)
    VALUES(p_player,v_ticket_id,v_market.id,'STAKE',-p_stake_minor,'stake:'||p_request_key);
  UPDATE wallets SET available_minor=available_minor-p_stake_minor,
    version=version+1,updated_at=clock_timestamp() WHERE player_id=p_player;
  RETURN v_ticket_id;
END $$;

CREATE OR REPLACE FUNCTION internal.resolve_market(
  p_market uuid, p_decision text, p_version integer,
  p_evidence jsonb, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, internal AS $$
DECLARE v_market markets%ROWTYPE; v_old market_outcomes%ROWTYPE;
        v_ticket tickets%ROWTYPE; v_delta bigint; v_kind text; v_status text;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('YES','NO','VOID')
      OR p_version IS NULL OR p_version<=0
      OR p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object'
      OR p_reason IS NULL OR length(p_reason)=0 THEN
    RAISE EXCEPTION 'Invalid outcome' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_market FROM markets WHERE id=p_market FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown market' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_old FROM market_outcomes WHERE market_id=p_market;
  IF FOUND THEN
    IF v_old.decision<>p_decision OR v_old.rule_version<>p_version
       OR v_old.evidence<>p_evidence OR v_old.reason_code<>p_reason THEN
      RAISE EXCEPTION 'Conflicting outcome retry' USING ERRCODE='23505'; END IF;
    RETURN false;
  END IF;
  IF v_market.status NOT IN ('LOCKED','VERIFYING') THEN
    RAISE EXCEPTION 'Market not ready for settlement' USING ERRCODE='22023'; END IF;
  INSERT INTO market_outcomes(market_id,decision,rule_version,evidence,reason_code)
    VALUES(p_market,p_decision,p_version,p_evidence,p_reason);
  -- Consistent player ordering reduces concurrency deadlocks across markets.
  FOR v_ticket IN SELECT * FROM tickets WHERE market_id=p_market AND status='OPEN'
       ORDER BY player_id,id FOR UPDATE LOOP
    v_delta := NULL;
    IF p_decision='VOID' THEN
      v_status:='VOIDED'; v_kind:='VOID_REFUND'; v_delta:=v_ticket.stake_minor;
    ELSIF p_decision=v_ticket.side THEN
      v_status:='WON'; v_kind:='WIN_PAYOUT'; v_delta:=v_ticket.gross_win_minor;
    ELSE
      v_status:='LOST';
    END IF;
    IF v_delta IS NOT NULL THEN
      PERFORM 1 FROM wallets WHERE player_id=v_ticket.player_id FOR UPDATE;
      INSERT INTO token_ledger(player_id,ticket_id,market_id,kind,delta_minor,idempotency_key)
        VALUES(v_ticket.player_id,v_ticket.id,p_market,v_kind,v_delta,'settle:'||v_ticket.id::text);
      UPDATE wallets SET available_minor=available_minor+v_delta,
        version=version+1,updated_at=clock_timestamp()
        WHERE player_id=v_ticket.player_id;
    END IF;
    UPDATE tickets SET status=v_status,closed_at=clock_timestamp() WHERE id=v_ticket.id;
  END LOOP;
  UPDATE markets SET status=CASE WHEN p_decision='VOID' THEN 'VOIDED'
    WHEN p_decision='YES' THEN 'SETTLED_YES' ELSE 'SETTLED_NO' END WHERE id=p_market;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION internal.period_key(timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.credit_grant(uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.accept_ticket(uuid,text,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.resolve_market(uuid,text,integer,jsonb,text) FROM PUBLIC;
COMMIT;
