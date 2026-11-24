BEGIN;

CREATE OR REPLACE FUNCTION internal.player_prediction_scores(
    p_period text
)
RETURNS TABLE (
    player_id uuid,
    username text,
    net_minor bigint,
    completed_predictions bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT
        p.id,
        p.username,
        COALESCE(SUM(
            CASE WHEN t.id IS NOT NULL
            THEN r.amount - t.stake_minor
            ELSE 0 END
        ), 0)::bigint,
        count(t.id)
    FROM public.players p
    LEFT JOIN public.tickets t
        ON t.player_id = p.id
        AND t.status IN (
            'WON', 'LOST', 'VOIDED', 'CASHED_OUT'
        )
        AND t.closed_at IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.markets m
            WHERE m.id = t.market_id
            AND m.rule_snapshot->>'environment'
                = 'production'
        )
        AND (
            p_period = 'ALL_TIME'
            OR (
                p_period = 'WEEKLY'
                AND t.closed_at >= (
                    date_trunc('week',
                        (now() AT TIME ZONE
                            'America/New_York')
                        + interval '1 day')
                    - interval '1 day'
                ) AT TIME ZONE 'America/New_York'
            )
        )
    CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(l.delta_minor), 0)::bigint
            AS amount
        FROM public.token_ledger l
        WHERE l.ticket_id = t.id
        AND l.player_id = p.id
        AND l.kind IN (
            'WIN_PAYOUT', 'VOID_REFUND', 'CASH_OUT'
        )
    ) r
    WHERE p.is_test = false
    AND p_period IN ('WEEKLY', 'ALL_TIME')
    GROUP BY p.id, p.username;
$$;

REVOKE ALL ON FUNCTION
internal.player_prediction_scores(text)
FROM PUBLIC, anon, authenticated;

COMMIT;
