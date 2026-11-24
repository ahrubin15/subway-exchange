BEGIN;

CREATE OR REPLACE FUNCTION internal.founder_metrics()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
SELECT jsonb_build_object(
    'players', (
        SELECT count(*) FROM public.players
        WHERE NOT is_test
    ),
    'verified_players', (
        SELECT count(*) FROM public.players p
        JOIN auth.users u ON u.id = p.auth_user_id
        WHERE NOT p.is_test
        AND NOT u.is_anonymous
        AND u.email_confirmed_at IS NOT NULL
    ),
    'test_players', (
        SELECT count(*) FROM public.players
        WHERE is_test
    ),
    'production_markets_by_status', (
        SELECT coalesce(
            jsonb_object_agg(status,n), '{}'::jsonb
        )
        FROM (
            SELECT status, count(*) n
            FROM public.markets
            WHERE rule_snapshot->>'environment'
                = 'production'
            GROUP BY status
        ) s
    ),
    'production_predictions', (
        SELECT count(*) FROM public.tickets t
        JOIN public.markets m ON m.id = t.market_id
        JOIN public.players p ON p.id = t.player_id
        WHERE m.rule_snapshot->>'environment'
            = 'production'
        AND NOT p.is_test
    ),
    'wallet_total_minor', (
        SELECT coalesce(sum(w.available_minor),0)
        FROM public.wallets w
        JOIN public.players p ON p.id = w.player_id
        WHERE NOT p.is_test
    ),
    'wallet_mismatches', (
        SELECT count(*) FROM public.wallets w
        WHERE w.available_minor IS DISTINCT FROM (
            SELECT coalesce(sum(l.delta_minor),0)
            FROM public.token_ledger l
            WHERE l.player_id = w.player_id
        )
    ),
    'rewarded_referrals', (
        SELECT count(*) FROM public.referrals
        WHERE rewarded_at IS NOT NULL
    ),
    'latest_observation_at', (
        SELECT max(collected_at)
        FROM public.transit_observations
    )
);
$$;

REVOKE ALL ON FUNCTION internal.founder_metrics()
FROM PUBLIC, anon, authenticated;

COMMIT;
