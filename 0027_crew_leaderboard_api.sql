BEGIN;

CREATE OR REPLACE FUNCTION public.get_crew_leaderboard(
    p_crew uuid,
    p_period text DEFAULT 'WEEKLY'
)
RETURNS TABLE (
    rank bigint,
    player_id uuid,
    username text,
    net_minor bigint,
    completed_predictions bigint,
    is_me boolean,
    is_captain boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT
        rank() OVER (ORDER BY s.net_minor DESC),
        s.player_id,
        s.username,
        s.net_minor,
        s.completed_predictions,
        p.auth_user_id = auth.uid(),
        l.captain_id = s.player_id
    FROM internal.player_prediction_scores(p_period) s
    JOIN public.players p ON p.id = s.player_id
    JOIN public.league_members m
        ON m.player_id = s.player_id
    JOIN public.leagues l ON l.id = m.league_id
    WHERE m.league_id = p_crew
    AND EXISTS (
        SELECT 1
        FROM public.league_members lm
        JOIN public.players caller
            ON caller.id = lm.player_id
        WHERE lm.league_id = p_crew
        AND caller.auth_user_id = auth.uid()
    )
    ORDER BY s.net_minor DESC, s.player_id;
$$;

REVOKE ALL ON FUNCTION
public.get_crew_leaderboard(uuid,text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.get_crew_leaderboard(uuid,text)
TO authenticated;

COMMIT;
