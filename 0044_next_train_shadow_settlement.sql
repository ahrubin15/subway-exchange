BEGIN;

CREATE TABLE internal.next_train_shadow_outcomes (
    market_id uuid PRIMARY KEY
        REFERENCES internal.next_train_research(id),
    conservative_outcome text NOT NULL
        CHECK(conservative_outcome IN ('YES','NO','VOID')),
    movement_outcome text NOT NULL
        CHECK(movement_outcome IN ('YES','NO','VOID')),
    reason_code text NOT NULL,
    evidence jsonb NOT NULL,
    decided_at timestamptz NOT NULL
        DEFAULT clock_timestamp(),
    rule_version text NOT NULL DEFAULT 'shadow-v1'
);

ALTER TABLE internal.next_train_shadow_outcomes
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON internal.next_train_shadow_outcomes
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION internal.settle_next_train_shadow(
    p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    n integer;
BEGIN
    IF p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'Invalid settlement batch size';
    END IF;

    WITH due AS (
        SELECT m.*
        FROM internal.next_train_research m
        WHERE m.deadline + interval '5 minutes'
            <= statement_timestamp()
        AND NOT EXISTS (
            SELECT 1
            FROM internal.next_train_shadow_outcomes s
            WHERE s.market_id = m.id
        )
        ORDER BY m.deadline, m.id
        LIMIT p_limit
    ), evidence AS (
        SELECT
            d.id,
            d.deadline,
            e.evidence_class,
            e.window_start,
            e.window_end,
            e.estimated_arrival_at,
            CASE
                WHEN e.market_id IS NULL
                THEN '{}'::jsonb
                ELSE to_jsonb(e)
            END AS detail
        FROM due d
        LEFT JOIN LATERAL
            internal.extract_next_train_arrival_evidence(
                d.id
            ) e
        ON e.window_end <=
            d.deadline + interval '5 minutes'
        AND EXISTS (
            SELECT 1
            FROM public.transit_observations o
            WHERE o.id = e.stopped_observation_id
            AND o.collected_at <=
                d.deadline + interval '5 minutes'
        )
    ), decisions AS (
        SELECT *,
            CASE
                WHEN evidence_class = 'STOPPED_TRANSITION'
                AND window_end <= deadline
                    THEN 'YES'
                WHEN evidence_class = 'STOPPED_TRANSITION'
                AND window_start >= deadline
                    THEN 'NO'
                ELSE 'VOID'
            END AS conservative,
            CASE
                WHEN evidence_class = 'STOPPED_TRANSITION'
                AND estimated_arrival_at IS NOT NULL
                THEN CASE
                    WHEN estimated_arrival_at <= deadline
                    THEN 'YES'
                    ELSE 'NO'
                END
                ELSE 'VOID'
            END AS movement,
            CASE
                WHEN evidence_class = 'STOPPED_TRANSITION'
                AND window_end <= deadline
                    THEN 'WINDOW_BEFORE_DEADLINE'
                WHEN evidence_class = 'STOPPED_TRANSITION'
                AND window_start >= deadline
                    THEN 'WINDOW_AFTER_DEADLINE'
                WHEN evidence_class = 'STOPPED_TRANSITION'
                    THEN 'WINDOW_STRADDLES_DEADLINE'
                ELSE coalesce(
                    evidence_class,
                    'NO_STOPPED_EVIDENCE'
                )
            END AS reason
        FROM evidence
    )
    INSERT INTO internal.next_train_shadow_outcomes(
        market_id,
        conservative_outcome,
        movement_outcome,
        reason_code,
        evidence
    )
    SELECT
        id,
        conservative,
        movement,
        reason,
        detail
    FROM decisions
    ON CONFLICT(market_id) DO NOTHING;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

REVOKE ALL ON FUNCTION
    internal.settle_next_train_shadow(integer)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW
    internal.next_train_research_lifecycle
WITH (security_invoker = true)
AS
SELECT
    m.*,
    CASE
        WHEN s.market_id IS NOT NULL THEN 'RESOLVED'
        ELSE internal.next_train_research_phase(
            m.generated_at,
            m.lock_at,
            m.deadline,
            statement_timestamp()
        )
    END AS phase
FROM internal.next_train_research m
LEFT JOIN internal.next_train_shadow_outcomes s
    ON s.market_id = m.id;

REVOKE ALL ON internal.next_train_research_lifecycle
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION internal.after_research_engine_run_settle()
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
                'Shadow settlement failed: %',
                SQLSTATE;
        END;
    END IF;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION
    internal.after_research_engine_run_settle()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER research_engine_shadow_settlement
AFTER INSERT OR UPDATE
ON internal.research_engine_runs
FOR EACH ROW EXECUTE FUNCTION
    internal.after_research_engine_run_settle();

COMMIT;
