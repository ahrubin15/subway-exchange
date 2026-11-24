BEGIN;

CREATE TABLE internal.next_train_research (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    observation_id uuid NOT NULL
        REFERENCES public.transit_observations(id),
    trip_key text NOT NULL,
    stop_id text NOT NULL,
    predicted_arrival_at timestamptz NOT NULL,
    generated_at timestamptz NOT NULL,
    lock_at timestamptz NOT NULL,
    deadline timestamptz NOT NULL,
    UNIQUE(trip_key, stop_id),
    CHECK(generated_at < lock_at AND lock_at < deadline)
);

ALTER TABLE internal.next_train_research
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON internal.next_train_research
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION internal.generate_next_train_research(
    p_observation uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_now timestamptz := clock_timestamp();
    n integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.transit_observations o
        WHERE o.id = p_observation
        AND o.source = 'MTA_GTFS_RT'
        AND o.quality->>'status' = 'ok'
        AND o.source_time BETWEEN
            v_now - interval '120 seconds' AND v_now
        AND o.collected_at BETWEEN
            v_now - interval '120 seconds' AND v_now
    ) THEN
        RETURN 0;
    END IF;

    INSERT INTO internal.next_train_research(
        observation_id,
        trip_key,
        stop_id,
        predicted_arrival_at,
        generated_at,
        lock_at,
        deadline
    )
    SELECT
        p_observation,
        s.trip_key,
        s.stop_id,
        s.predicted_arrival_at,
        v_now,
        s.predicted_arrival_at - interval '60 seconds',
        s.predicted_arrival_at + interval '60 seconds'
    FROM (
        SELECT DISTINCT ON(stop_id)
            trip_key,
            stop_id,
            predicted_arrival_at,
            vehicle_status
        FROM internal.train_observations
        WHERE observation_id = p_observation
        AND predicted_arrival_at >= v_now
        ORDER BY stop_id, predicted_arrival_at, trip_key
    ) s
    WHERE s.predicted_arrival_at BETWEEN
        v_now + interval '120 seconds'
        AND v_now + interval '600 seconds'
    AND s.vehicle_status IS DISTINCT FROM 1
    ON CONFLICT(trip_key, stop_id) DO NOTHING;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

REVOKE ALL ON FUNCTION
    internal.generate_next_train_research(uuid)
FROM PUBLIC, anon, authenticated;

COMMIT;
