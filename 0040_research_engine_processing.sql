BEGIN;

CREATE TABLE internal.research_engine_runs (
    observation_id uuid PRIMARY KEY
        REFERENCES public.transit_observations(id),
    processed_at timestamptz NOT NULL
        DEFAULT clock_timestamp(),
    status text NOT NULL
        CHECK(status IN ('ok','error')),
    markets_created integer NOT NULL DEFAULT 0,
    quotes_created integer NOT NULL DEFAULT 0,
    error_code text
);

ALTER TABLE internal.research_engine_runs
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON internal.research_engine_runs
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION internal.process_next_train_research(
    p_observation uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    n integer;
    q integer;
    v_source timestamptz;
BEGIN
    PERFORM pg_advisory_xact_lock(740039,1);

    SELECT source_time INTO v_source
    FROM public.transit_observations
    WHERE id = p_observation
    AND source = 'MTA_GTFS_RT'
    AND feed_id = '1234567'
    AND quality->>'collector' = 'live30-v1'
    AND quality->>'status' = 'ok'
    AND source_time BETWEEN
        clock_timestamp() - interval '120 seconds'
        AND clock_timestamp()
    AND collected_at BETWEEN
        clock_timestamp() - interval '120 seconds'
        AND clock_timestamp();

    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM internal.train_observations
        WHERE observation_id = p_observation
    ) THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM internal.research_engine_runs
        WHERE observation_id = p_observation
        AND status = 'ok'
    ) THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM internal.research_engine_runs r
        JOIN public.transit_observations o
            ON o.id = r.observation_id
        WHERE r.status = 'ok'
        AND o.source_time >= v_source
    ) THEN
        RETURN;
    END IF;

    BEGIN
        n := internal.generate_next_train_research(
            p_observation
        );

        q := internal.issue_next_train_research_quotes(
            p_observation
        );

        INSERT INTO internal.research_engine_runs
        VALUES (
            p_observation,
            clock_timestamp(),
            'ok',
            n,
            q,
            NULL
        )
        ON CONFLICT(observation_id) DO UPDATE SET
            processed_at = excluded.processed_at,
            status = 'ok',
            markets_created = excluded.markets_created,
            quotes_created = excluded.quotes_created,
            error_code = NULL;

    EXCEPTION WHEN OTHERS THEN

        INSERT INTO internal.research_engine_runs
        VALUES (
            p_observation,
            clock_timestamp(),
            'error',
            0,
            0,
            SQLSTATE
        )
        ON CONFLICT(observation_id) DO UPDATE SET
            processed_at = excluded.processed_at,
            status = 'error',
            markets_created = 0,
            quotes_created = 0,
            error_code = excluded.error_code;
    END;
END $$;

REVOKE ALL ON FUNCTION
    internal.process_next_train_research(uuid)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION internal.after_train_observation_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    o uuid;
BEGIN
    FOR o IN
        SELECT DISTINCT observation_id
        FROM new_train_rows
    LOOP
        PERFORM internal.process_next_train_research(o);
    END LOOP;
    RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION
    internal.after_train_observation_batch()
FROM PUBLIC, anon, authenticated;

COMMIT;
