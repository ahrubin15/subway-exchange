BEGIN;

CREATE OR REPLACE FUNCTION public.check_my_referral_reward()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_player uuid;
BEGIN
    SELECT id INTO v_player
    FROM public.players
    WHERE auth_user_id = auth.uid();

    IF v_player IS NULL THEN
        RAISE EXCEPTION 'Authenticated player required';
    END IF;

    RETURN internal.reward_referral(v_player);
END;
$$;

REVOKE ALL ON FUNCTION public.check_my_referral_reward()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_my_referral_reward()
TO authenticated;

COMMIT;
