BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_player()
RETURNS TABLE (
    player_id uuid,
    username text,
    available_minor bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT p.id, p.username, w.available_minor
    FROM public.players p
    JOIN public.wallets w ON w.player_id = p.id
    WHERE p.auth_user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_player()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_player()
TO authenticated;

COMMIT;
