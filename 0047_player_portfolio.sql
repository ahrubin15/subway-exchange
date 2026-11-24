BEGIN;

CREATE FUNCTION public.get_my_portfolio()
RETURNS TABLE (
    ticket_id uuid,
    market_id uuid,
    market_name text,
    market_question text,
    station_name text,
    route_id text,
    environment text,
    market_status text,
    side text,
    stake_minor bigint,
    gross_win_minor bigint,
    returned_minor bigint,
    net_minor bigint,
    ask_ppm integer,
    status text,
    accepted_at timestamptz,
    closed_at timestamptz,
    outcome text,
    evidence jsonb,
    reason_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT
        t.ticket_id,
        t.market_id,
        mt.name,
        m.rule_snapshot->>'question',
        m.rule_snapshot->>'station_name',
        m.rule_snapshot->>'route_id',
        m.rule_snapshot->>'environment',
        m.status,
        t.side,
        t.stake_minor,
        t.gross_win_minor,
        t.returned_minor,
        t.net_minor,
        t.ask_ppm,
        t.status,
        t.accepted_at,
        t.closed_at,
        t.outcome,
        t.evidence,
        t.reason_code
    FROM public.get_my_tickets() t
    JOIN public.markets m
        ON m.id = t.market_id
    JOIN public.market_templates mt
        ON mt.id = m.template_id
    WHERE auth.uid() IS NOT NULL
    ORDER BY t.accepted_at DESC, t.ticket_id DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_portfolio()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_portfolio()
TO authenticated;

COMMIT;
