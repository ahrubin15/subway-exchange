BEGIN;

CREATE OR REPLACE FUNCTION public.get_player_leaderboard(
    p_period text DEFAULT 'WEEKLY'
)
RETURNS TABLE (
    rank bigint,
    player_id uuid,
    username text,
    net_minor bigint,
    completed_predictions bigint,
    is_me boolean
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
        p.auth_user_id = auth.uid()
    FROM internal.player_prediction_scores(p_period) s
    JOIN public.players p ON p.id = s.player_id
    WHERE s.completed_predictions > 0
    AND auth.uid() IS NOT NULL
    ORDER BY s.net_minor DESC, s.player_id
    LIMIT 100;
$$;

REVOKE ALL ON FUNCTION
public.get_player_leaderboard(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.get_player_leaderboard(text)
TO authenticated;

COMMIT;
