BEGIN;

CREATE OR REPLACE FUNCTION public.create_my_crew(
    p_title text
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
        RAISE EXCEPTION 'Authenticated player required';
    END IF;

    IF p_title IS NULL
       OR length(btrim(p_title)) NOT BETWEEN 2 AND 80 THEN
        RAISE EXCEPTION 'Invalid Crew name';
    END IF;

    INSERT INTO public.leagues (title, captain_id)
    VALUES (btrim(p_title), v_player)
    RETURNING id INTO v_crew;

    INSERT INTO public.league_members
        (league_id, player_id)
    VALUES (v_crew, v_player);

    RETURN v_crew;
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_crew(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_my_crew(text)
TO authenticated;

COMMIT;
