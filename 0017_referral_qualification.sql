BEGIN;

CREATE OR REPLACE FUNCTION internal.referral_is_qualified(
    p_player uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.players p
        JOIN auth.users u
            ON u.id = p.auth_user_id
        JOIN public.referrals r
            ON r.referred_id = p.id
        WHERE p.id = p_player
        AND p.is_test = false
        AND u.is_anonymous = false
        AND u.email_confirmed_at IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.tickets t
            JOIN public.markets m
                ON m.id = t.market_id
            WHERE t.player_id = p.id
            AND m.rule_snapshot->>'environment' = 'production'
            AND t.status IN ('OPEN', 'WON', 'LOST', 'CASHED_OUT')
        )
    );
$$;

REVOKE ALL ON FUNCTION
internal.referral_is_qualified(uuid)
FROM PUBLIC, anon, authenticated;

COMMIT;
