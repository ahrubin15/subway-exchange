BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_reward_status()
RETURNS TABLE (
    reward_kind text,
    amount_minor bigint,
    available boolean,
    next_reset_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT
        r.kind,
        r.amount,
        NOT EXISTS (
            SELECT 1
            FROM public.token_ledger l
            WHERE l.player_id = p.id
            AND l.idempotency_key =
                r.kind || ':' ||
                internal.period_key(now(), r.kind)
        ),
        r.reset_at AT TIME ZONE 'America/New_York'
    FROM public.players p
    CROSS JOIN LATERAL (
        VALUES
        (
            'DAILY_GRANT',
            5000::bigint,
            date_trunc('day',
                now() AT TIME ZONE 'America/New_York')
                + interval '1 day'
        ),
        (
            'WEEKLY_GRANT',
            100000::bigint,
            date_trunc('week',
                (now() AT TIME ZONE 'America/New_York')
                + interval '1 day')
                + interval '6 days'
        )
    ) r(kind, amount, reset_at)
    WHERE p.auth_user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_reward_status()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_reward_status()
TO authenticated;

COMMIT;
