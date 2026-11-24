BEGIN;

CREATE OR REPLACE FUNCTION public.get_global_crew_leaderboard(
    p_period text DEFAULT 'WEEKLY'
)
RETURNS TABLE (
    rank bigint,
    crew_id uuid,
    crew_name text,
    member_count bigint,
    average_net_minor numeric,
    completed_predictions bigint,
    is_my_crew boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    WITH scores AS (
        SELECT
            l.id AS crew_id,
            l.title AS crew_name,
            count(*) AS member_count,
            avg(s.net_minor) AS average_net_minor,
            sum(s.completed_predictions)::bigint
                AS completed_predictions
        FROM public.leagues l
        JOIN public.league_members m
            ON m.league_id = l.id
        JOIN internal.player_prediction_scores(p_period) s
            ON s.player_id = m.player_id
        GROUP BY l.id, l.title
        HAVING sum(s.completed_predictions) > 0
    )
    SELECT
        rank() OVER (
            ORDER BY s.average_net_minor DESC
        ),
        s.crew_id,
        s.crew_name,
        s.member_count,
        s.average_net_minor,
        s.completed_predictions,
        EXISTS (
            SELECT 1
            FROM public.league_members m
            JOIN public.players p
                ON p.id = m.player_id
            WHERE m.league_id = s.crew_id
            AND p.auth_user_id = auth.uid()
        )
    FROM scores s
    WHERE auth.uid() IS NOT NULL
    ORDER BY s.average_net_minor DESC, s.crew_id
    LIMIT 100;
$$;

REVOKE ALL ON FUNCTION
public.get_global_crew_leaderboard(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.get_global_crew_leaderboard(text)
TO authenticated;

COMMIT;
