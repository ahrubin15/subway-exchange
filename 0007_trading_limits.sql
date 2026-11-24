BEGIN;

CREATE OR REPLACE FUNCTION internal.enforce_ticket_limits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_stake bigint;
    v_payout bigint;
BEGIN
    PERFORM 1 FROM public.markets
    WHERE id = NEW.market_id
    FOR UPDATE;

    IF NEW.stake_minor NOT BETWEEN 1000 AND 25000 THEN
        RAISE EXCEPTION 'Prediction must be between 10 and 250 Tokens';
    END IF;

    SELECT
        COALESCE(SUM(stake_minor), 0),
        COALESCE(SUM(gross_win_minor), 0)
    INTO v_stake, v_payout
    FROM public.tickets
    WHERE player_id = NEW.player_id
    AND market_id = NEW.market_id
    AND status = 'OPEN';

    IF v_stake + NEW.stake_minor > 50000 THEN
        RAISE EXCEPTION 'Market stake limit exceeded';
    END IF;

    IF v_payout + NEW.gross_win_minor > 250000 THEN
        RAISE EXCEPTION 'Market payout limit exceeded';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION internal.enforce_ticket_limits()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_ticket_limits
BEFORE INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION internal.enforce_ticket_limits();

COMMIT;
