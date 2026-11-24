BEGIN;

CREATE OR REPLACE FUNCTION public.attribute_my_referral(
    p_referrer_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_player uuid;
    v_created_at timestamptz;
    v_inserted integer;
BEGIN
    SELECT id, created_at
    INTO v_player, v_created_at
    FROM public.players
    WHERE auth_user_id = auth.uid()
    FOR UPDATE;

    IF v_player IS NULL THEN
        RAISE EXCEPTION 'Authenticated player required';
    END IF;

    IF p_referrer_id IS NULL
       OR p_referrer_id = v_player THEN
        RAISE EXCEPTION 'Invalid referral';
    END IF;

    IF clock_timestamp() >=
        v_created_at + interval '24 hours' THEN
        RETURN false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.players
        WHERE id = p_referrer_id
    ) THEN
        RAISE EXCEPTION 'Invalid referrer';
    END IF;

    INSERT INTO public.referrals
        (referrer_id, referred_id)
    VALUES (p_referrer_id, v_player)
    ON CONFLICT (referred_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    RETURN v_inserted = 1;
END;
$$;

REVOKE ALL ON FUNCTION
public.attribute_my_referral(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.attribute_my_referral(uuid)
TO authenticated;

COMMIT;
