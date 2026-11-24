BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_tickets()
RETURNS TABLE (
    ticket_id uuid,
    market_id uuid,
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
        t.id,
        t.market_id,
        t.side,
        t.stake_minor,
        t.gross_win_minor,
        CASE WHEN t.status = 'OPEN' THEN NULL
             ELSE r.amount END,
        CASE WHEN t.status = 'OPEN' THEN NULL
             ELSE r.amount - t.stake_minor END,
        q.ask_ppm,
        t.status,
        t.accepted_at,
        t.closed_at,
        o.decision,
        o.evidence,
        o.reason_code
    FROM public.tickets t
    JOIN public.players p ON p.id = t.player_id
    JOIN public.quotes q ON q.id = t.quote_id
    LEFT JOIN public.market_outcomes o
        ON o.market_id = t.market_id
    CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(l.delta_minor), 0)::bigint
            AS amount
        FROM public.token_ledger l
        WHERE l.ticket_id = t.id
        AND l.player_id = t.player_id
        AND l.kind IN (
            'WIN_PAYOUT', 'VOID_REFUND', 'CASH_OUT'
        )
    ) r
    WHERE p.auth_user_id = auth.uid()
    ORDER BY t.accepted_at DESC, t.id DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_tickets()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_tickets()
TO authenticated;

COMMIT;
