BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_referral_status()
RETURNS TABLE (
    referral_code uuid,
    total_referrals bigint,
    qualified_referrals bigint,
    rewarded_referrals bigint,
    earned_minor bigint,
    referred_by_someone boolean,
    my_referral_rewarded boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT
        p.id,
        (SELECT count(*) FROM public.referrals r
         WHERE r.referrer_id = p.id),
        (SELECT count(*) FROM public.referrals r
         WHERE r.referrer_id = p.id
         AND r.qualified_at IS NOT NULL),
        (SELECT count(*) FROM public.referrals r
         WHERE r.referrer_id = p.id
         AND r.rewarded_at IS NOT NULL),
        (SELECT COALESCE(SUM(l.delta_minor), 0)::bigint
         FROM public.token_ledger l
         WHERE l.player_id = p.id
         AND l.kind = 'REFERRAL_GRANT'),
        EXISTS (
            SELECT 1 FROM public.referrals r
            WHERE r.referred_id = p.id
        ),
        EXISTS (
            SELECT 1 FROM public.referrals r
            WHERE r.referred_id = p.id
            AND r.rewarded_at IS NOT NULL
        )
    FROM public.players p
    WHERE p.auth_user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_referral_status()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_referral_status()
TO authenticated;

COMMIT;
