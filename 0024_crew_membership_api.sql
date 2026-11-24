BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_crews()
RETURNS TABLE (
    crew_id uuid,
    crew_name text,
    is_captain boolean,
    member_count bigint,
    joined_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT
        l.id,
        l.title,
        l.captain_id = p.id,
        (SELECT count(*)
         FROM public.league_members lm
         WHERE lm.league_id = l.id),
        m.joined_at
    FROM public.players p
    JOIN public.league_members m
        ON m.player_id = p.id
    JOIN public.leagues l
        ON l.id = m.league_id
    WHERE p.auth_user_id = auth.uid()
    ORDER BY m.joined_at DESC, l.id;
$$;

REVOKE ALL ON FUNCTION public.get_my_crews()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_crews()
TO authenticated;

COMMIT;
