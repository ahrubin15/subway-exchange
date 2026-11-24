BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_username_ci
ON public.players (lower(username));

CREATE OR REPLACE FUNCTION public.transfer_crew_captain(
    p_crew uuid, p_member uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    a uuid;
    c uuid;
BEGIN
    SELECT id INTO a FROM public.players
    WHERE auth_user_id = auth.uid();

    IF a IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT captain_id INTO c
    FROM public.leagues
    WHERE id = p_crew FOR UPDATE;

    IF c IS DISTINCT FROM a THEN
        RAISE EXCEPTION 'Crew captain required';
    END IF;

    IF p_member = a THEN RETURN false; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.league_members
        WHERE league_id = p_crew
        AND player_id = p_member
    ) THEN
        RAISE EXCEPTION 'Crew member required';
    END IF;

    UPDATE public.leagues
    SET captain_id = p_member
    WHERE id = p_crew;

    UPDATE public.league_invites
    SET revoked_at = clock_timestamp()
    WHERE league_id = p_crew
    AND revoked_at IS NULL;

    RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.rename_crew(
    p_crew uuid, p_title text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    a uuid;
    c uuid;
    n integer;
BEGIN
    SELECT id INTO a FROM public.players
    WHERE auth_user_id = auth.uid();

    IF a IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT captain_id INTO c
    FROM public.leagues
    WHERE id = p_crew FOR UPDATE;

    IF c IS DISTINCT FROM a THEN
        RAISE EXCEPTION 'Crew captain required';
    END IF;

    IF p_title IS NULL
       OR length(btrim(p_title)) NOT BETWEEN 2 AND 80 THEN
        RAISE EXCEPTION 'Invalid Crew name';
    END IF;

    UPDATE public.leagues
    SET title = btrim(p_title)
    WHERE id = p_crew
    AND title IS DISTINCT FROM btrim(p_title);

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n = 1;
END $$;

CREATE OR REPLACE FUNCTION public.update_my_username(
    p_username text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    a uuid;
    n integer;
BEGIN
    SELECT id INTO a FROM public.players
    WHERE auth_user_id = auth.uid();

    IF a IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_username IS NULL
       OR btrim(p_username) !~ '^[A-Za-z0-9_]{3,40}$'
       OR lower(btrim(p_username)) LIKE 'guest\_%' ESCAPE '\'
    THEN
        RAISE EXCEPTION 'Invalid username';
    END IF;

    UPDATE public.players
    SET username = btrim(p_username)
    WHERE id = a
    AND username IS DISTINCT FROM btrim(p_username);

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n = 1;

EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Username unavailable';
END $$;

REVOKE ALL ON FUNCTION
    public.transfer_crew_captain(uuid,uuid),
    public.rename_crew(uuid,text),
    public.update_my_username(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.transfer_crew_captain(uuid,uuid),
    public.rename_crew(uuid,text),
    public.update_my_username(text)
TO authenticated;

COMMIT;
