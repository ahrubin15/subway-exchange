BEGIN;

CREATE OR REPLACE FUNCTION public.get_open_markets()
RETURNS TABLE (
    market_id uuid,
    market_name text,
    rule_snapshot jsonb,
    lock_at timestamptz,
    outcome_deadline timestamptz,
    quote_id uuid,
    side text,
    ask_ppm integer,
    quote_expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT
        m.id,
        mt.name,
        m.rule_snapshot,
        m.lock_at,
        m.outcome_deadline,
        q.id,
        q.side,
        q.ask_ppm,
        q.expires_at
    FROM public.markets m
    JOIN public.market_templates mt
        ON mt.id = m.template_id
    JOIN LATERAL (
        SELECT DISTINCT ON (qt.side) qt.*
        FROM public.quotes qt
        WHERE qt.market_id = m.id
        AND qt.issued_at <= now()
        ORDER BY qt.side, qt.issued_at DESC, qt.id DESC
    ) q ON q.expires_at > now()
    WHERE m.status = 'OPEN'
    AND m.lock_at > now()
    AND m.rule_snapshot->>'environment' = 'test'
    AND EXISTS (
        SELECT 1 FROM public.players p
        WHERE p.auth_user_id = auth.uid()
        AND p.is_test = true
    )
    ORDER BY m.lock_at, m.id, q.side;
$$;

REVOKE ALL ON FUNCTION public.get_open_markets()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_open_markets()
TO authenticated;

COMMIT;
