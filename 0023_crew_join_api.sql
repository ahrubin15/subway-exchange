BEGIN;

CREATE OR REPLACE FUNCTION public.join_crew(
    p_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_player uuid;
    v_crew uuid;
BEGIN
    SELECT id INTO v_player
    FROM public.players
    WHERE auth_user_id = auth.uid();

    IF v_player IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_code IS NULL
       OR p_code !~ '^[a-f0-9]{32}$' THEN
        RAISE EXCEPTION 'Invalid invitation';
    END IF;

    SELECT league_id INTO v_crew
    FROM public.league_invites
    WHERE code_hash =
        encode(sha256(convert_to(p_code, 'UTF8')), 'hex')
    AND revoked_at IS NULL
    AND expires_at > clock_timestamp()
    FOR UPDATE;

    IF v_crew IS NULL THEN
        RAISE EXCEPTION 'Invalid or expired invitation';
    END IF;

    INSERT INTO public.league_members
        (league_id, player_id)
    VALUES (v_crew, v_player)
    ON CONFLICT (league_id, player_id) DO NOTHING;

    RETURN v_crew;
END;
$$;

REVOKE ALL ON FUNCTION public.join_crew(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.join_crew(text)
TO authenticated;

COMMIT;
