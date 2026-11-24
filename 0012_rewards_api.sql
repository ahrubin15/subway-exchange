BEGIN;

CREATE OR REPLACE FUNCTION public.claim_my_reward(
    p_kind text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_player uuid;
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN (
        'DAILY_GRANT', 'WEEKLY_GRANT'
    ) THEN
        RAISE EXCEPTION 'Invalid reward type';
    END IF;

    SELECT id INTO v_player
    FROM public.players
    WHERE auth_user_id = auth.uid();

    IF v_player IS NULL THEN
        RAISE EXCEPTION 'Authenticated player required';
    END IF;

    RETURN internal.credit_grant(
        v_player, p_kind, clock_timestamp()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_my_reward(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_my_reward(text)
TO authenticated;

COMMIT;
