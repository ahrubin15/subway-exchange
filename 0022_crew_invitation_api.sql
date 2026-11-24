BEGIN;

CREATE OR REPLACE FUNCTION public.create_crew_invite(
    p_crew uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_player uuid;
    v_code text;
BEGIN
    SELECT id INTO v_player
    FROM public.players
    WHERE auth_user_id = auth.uid();

    IF v_player IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.leagues
        WHERE id = p_crew
        AND captain_id = v_player
    ) THEN
        RAISE EXCEPTION 'Crew captain required';
    END IF;

    v_code := replace(gen_random_uuid()::text, '-', '');

    INSERT INTO public.league_invites (
        league_id, code_hash, created_by, expires_at
    )
    VALUES (
        p_crew,
        encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
        v_player,
        clock_timestamp() + interval '30 days'
    );

    RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.create_crew_invite(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_crew_invite(uuid)
TO authenticated;

COMMIT;
