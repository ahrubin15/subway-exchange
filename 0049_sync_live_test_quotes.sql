BEGIN;

CREATE FUNCTION internal.sync_next_train_test_quotes()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    r record;
    v_quote uuid;
    v_count integer := 0;
    v_now timestamptz := clock_timestamp();
BEGIN
    PERFORM pg_advisory_xact_lock(740048,1);
    v_now := clock_timestamp();

    FOR r IN
        SELECT
            m.id AS market_id,
            q.id AS research_quote_id,
            q.issued_at,
            q.expires_at,
            q.model_version,
            s.side,
            s.ask_ppm
        FROM internal.research_market_links l
        JOIN public.markets m
            ON m.id = l.market_id
        JOIN internal.next_train_research rm
            ON rm.id = l.research_market_id
        CROSS JOIN LATERAL (
            SELECT q0.*
            FROM internal.next_train_research_quotes q0
            WHERE q0.market_id = rm.id
            AND q0.issued_at <= v_now
            ORDER BY q0.issued_at DESC, q0.id DESC
            LIMIT 1
        ) q
        CROSS JOIN LATERAL (
            VALUES
                ('YES', q.yes_ask_ppm),
                ('NO', q.no_ask_ppm)
        ) s(side, ask_ppm)
        WHERE m.status = 'DRAFT'
        AND m.rule_snapshot->>'environment' = 'test'
        AND m.lock_at = rm.lock_at
        AND m.outcome_deadline = rm.deadline
        AND m.lock_at > v_now
        AND q.expires_at > v_now
        AND q.issued_at >= rm.generated_at
        AND q.expires_at <= m.lock_at
        AND NOT EXISTS (
            SELECT 1
            FROM internal.research_quote_links x
            WHERE x.research_quote_id = q.id
            AND x.side = s.side
        )
        ORDER BY m.lock_at, m.id, s.side
    LOOP
        INSERT INTO public.quotes(
            market_id,
            side,
            ask_ppm,
            model_version,
            issued_at,
            expires_at
        )
        VALUES (
            r.market_id,
            r.side,
            r.ask_ppm,
            r.model_version,
            r.issued_at,
            r.expires_at
        )
        RETURNING id INTO v_quote;

        INSERT INTO internal.research_quote_links(
            research_quote_id,
            side,
            quote_id
        )
        VALUES (
            r.research_quote_id,
            r.side,
            v_quote
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION
    internal.sync_next_train_test_quotes()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
