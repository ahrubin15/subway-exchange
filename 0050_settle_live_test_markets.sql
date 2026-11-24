BEGIN;

CREATE FUNCTION internal.settle_next_train_test_markets(
    p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    r record;
    v_count integer := 0;
BEGIN
    IF p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'Invalid settlement limit'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(740048,1);

    FOR r IN
        SELECT
            m.id AS market_id,
            m.status,
            s.market_id AS research_id,
            s.conservative_outcome,
            s.reason_code,
            s.evidence,
            s.decided_at,
            s.rule_version
        FROM internal.research_market_links l
        JOIN public.markets m
            ON m.id = l.market_id
        JOIN internal.next_train_research rm
            ON rm.id = l.research_market_id
        JOIN internal.next_train_shadow_outcomes s
            ON s.market_id = rm.id
        WHERE m.status IN (
            'OPEN','SUSPENDED','LOCKED','VERIFYING'
        )
        AND m.rule_snapshot->>'environment' = 'test'
        AND m.rule_snapshot->>'settlement_method'
            = 'conservative'
        AND m.rule_snapshot->>'shadow_rule'
            = s.rule_version
        AND s.rule_version = 'shadow-v1'
        AND m.lock_at = rm.lock_at
        AND m.outcome_deadline = rm.deadline
        AND m.outcome_deadline + interval '5 minutes'
            <= statement_timestamp()
        AND s.decided_at >=
            m.outcome_deadline + interval '5 minutes'
        AND s.decided_at <= statement_timestamp()
        AND NOT EXISTS (
            SELECT 1
            FROM public.market_outcomes o
            WHERE o.market_id = m.id
        )
        ORDER BY m.outcome_deadline, m.id
        LIMIT p_limit
        FOR UPDATE OF m
    LOOP
        UPDATE public.markets
        SET status = 'VERIFYING'
        WHERE id = r.market_id;

        IF internal.resolve_market(
            r.market_id,
            r.conservative_outcome,
            1,
            jsonb_build_object(
                'research_market_id',r.research_id,
                'shadow_rule',r.rule_version,
                'settlement_method','conservative',
                'shadow_decided_at',r.decided_at,
                'arrival_evidence',r.evidence,
                'environment','test'
            ),
            r.reason_code
        ) THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION
    internal.settle_next_train_test_markets(integer)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION
    internal.after_research_engine_run_settle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.status = 'ok' THEN
        BEGIN
            PERFORM internal.settle_next_train_shadow(100);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING
                'Shadow settlement failed: %',SQLSTATE;
        END;

        BEGIN
            PERFORM internal.settle_next_train_test_markets(100);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING
                'Test market settlement failed: %',SQLSTATE;
        END;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
    internal.after_research_engine_run_settle()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
