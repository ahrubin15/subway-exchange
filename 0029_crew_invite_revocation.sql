BEGIN;

CREATE OR REPLACE FUNCTION public.revoke_crew_invites(
    p_crew uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_player uuid;
    v_revoked integer;
BEGIN
    SELECT id INTO v_player
    FROM public.players
    WHERE auth_user_id = auth.uid();

    IF NOT EXISTS (
        SELECT 1 FROM public.leagues
        WHERE id = p_crew
        AND captain_id = v_player
    ) THEN
        RAISE EXCEPTION 'Crew captain required';
    END IF;

    UPDATE public.league_invites
    SET revoked_at = clock_timestamp()
    WHERE league_id = p_crew
    AND revoked_at IS NULL;

    GET DIAGNOSTICS v_revoked = ROW_COUNT;

    RETURN v_revoked;
END;
$$;

REVOKE ALL ON FUNCTION
public.revoke_crew_invites(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.revoke_crew_invites(uuid)
TO authenticated;

COMMIT;
