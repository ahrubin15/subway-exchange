BEGIN;

CREATE FUNCTION public.get_research_market_preview()
RETURNS TABLE(
    market_id uuid,
    route_id text,
    stop_id text,
    station_name text,
    direction text,
    lock_at timestamptz,
    outcome_deadline timestamptz,
    yes_probability_ppm integer,
    yes_ask_ppm integer,
    no_ask_ppm integer,
    quote_expires_at timestamptz,
    server_time timestamptz,
    trading_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT
        m.id,
        '6'::text,
        m.stop_id,
        CASE left(m.stop_id,3)
            WHEN '630' THEN '51 St'
            WHEN '631' THEN 'Grand Central–42 St'
            WHEN '632' THEN '33 St'
            WHEN '633' THEN '28 St'
        END,
        CASE right(m.stop_id,1)
            WHEN 'N' THEN 'Uptown'
            WHEN 'S' THEN 'Downtown'
        END,
        m.lock_at,
        m.deadline,
        q.yes_probability_ppm,
        q.yes_ask_ppm,
        q.no_ask_ppm,
        q.expires_at,
        statement_timestamp(),
        false
    FROM internal.next_train_research m
    JOIN LATERAL (
        SELECT qt.*
        FROM internal.next_train_research_quotes qt
        WHERE qt.market_id = m.id
        AND qt.issued_at <= statement_timestamp()
        ORDER BY qt.issued_at DESC, qt.id DESC
        LIMIT 1
    ) q ON q.expires_at > statement_timestamp()
    WHERE m.generated_at <= statement_timestamp()
    AND m.lock_at > statement_timestamp()
    AND EXISTS (
        SELECT 1
        FROM public.players p
        WHERE p.auth_user_id = auth.uid()
        AND p.is_test = true
    )
    ORDER BY m.lock_at, m.id
    LIMIT 100;
$$;

REVOKE ALL ON FUNCTION
    public.get_research_market_preview()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.get_research_market_preview()
TO authenticated;

COMMIT;
