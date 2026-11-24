BEGIN;

CREATE INDEX idx_train_observations_trip_stop
ON internal.train_observations(
    trip_key, stop_id, observation_id
);

CREATE FUNCTION internal.extract_next_train_arrival_evidence(
    p_market uuid
)
RETURNS TABLE(
    market_id uuid,
    evidence_class text,
    prior_observation_id uuid,
    stopped_observation_id uuid,
    window_start timestamptz,
    window_end timestamptz,
    movement_timestamp timestamptz,
    estimated_arrival_at timestamptz,
    window_seconds double precision,
    prior_vehicle_status integer,
    prior_vehicle_id text,
    stopped_vehicle_id text,
    movement_within_window boolean,
    verified_arrival boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
WITH first_stop AS (
    SELECT
        m.id AS mid,
        m.generated_at,
        m.trip_key,
        m.stop_id,
        o.id AS oid,
        o.source,
        o.feed_id,
        o.source_time,
        o.collected_at,
        t.vehicle_movement_at,
        t.vehicle_id
    FROM internal.next_train_research m
    JOIN public.transit_observations origin
        ON origin.id = m.observation_id
    JOIN internal.train_observations t
        ON t.trip_key = m.trip_key
        AND t.stop_id = m.stop_id
        AND t.vehicle_status = 1
    JOIN public.transit_observations o
        ON o.id = t.observation_id
    WHERE m.id = p_market
    AND o.source = origin.source
    AND o.feed_id = origin.feed_id
    AND o.quality->>'collector' =
        origin.quality->>'collector'
    AND o.quality->>'status' = 'ok'
    AND o.source_time > origin.source_time
    AND o.collected_at > origin.collected_at
    AND o.source_time <= statement_timestamp()
    AND o.collected_at <= statement_timestamp()
    ORDER BY o.source_time, o.collected_at, o.id
    LIMIT 1
), paired AS (
    SELECT
        f.*,
        prev.id AS prior_id,
        prev.source_time AS prior_time,
        prev.quality->>'status' AS prior_quality,
        pt.vehicle_status AS prior_status,
        pt.vehicle_id AS prior_vid
    FROM first_stop f
    LEFT JOIN LATERAL (
        SELECT o.*
        FROM public.transit_observations o
        WHERE o.source = f.source
        AND o.feed_id = f.feed_id
        AND o.quality->>'collector' = 'live30-v1'
        AND o.collected_at < f.collected_at
        ORDER BY o.collected_at DESC, o.id DESC
        LIMIT 1
    ) prev ON true
    LEFT JOIN internal.train_observations pt
        ON pt.observation_id = prev.id
        AND pt.trip_key = f.trip_key
        AND pt.stop_id = f.stop_id
), classified AS (
    SELECT *,
        CASE
            WHEN prior_vid IS NOT NULL
            AND vehicle_id IS NOT NULL
            AND prior_vid <> vehicle_id
                THEN 'IDENTITY_CONFLICT'
            WHEN source_time < generated_at
                THEN 'STOPPED_BEFORE_GENERATION'
            WHEN prior_quality = 'ok'
            AND prior_status IN (0,2)
            AND source_time > prior_time
            AND source_time - prior_time
                <= interval '75 seconds'
                THEN 'STOPPED_TRANSITION'
            ELSE 'STOPPED_ONLY'
        END AS grade
    FROM paired
)
SELECT
    mid,
    grade,
    prior_id,
    oid,
    CASE
        WHEN grade = 'STOPPED_TRANSITION'
        THEN prior_time
    END,
    source_time,
    vehicle_movement_at,
    CASE
        WHEN grade = 'STOPPED_TRANSITION'
        AND vehicle_movement_at > prior_time
        AND vehicle_movement_at <= source_time
        THEN vehicle_movement_at
    END,
    CASE
        WHEN grade = 'STOPPED_TRANSITION'
        THEN extract(epoch FROM
            source_time - prior_time
        )::double precision
    END,
    prior_status,
    prior_vid,
    vehicle_id,
    coalesce(
        grade = 'STOPPED_TRANSITION'
        AND vehicle_movement_at > prior_time
        AND vehicle_movement_at <= source_time,
        false
    ),
    false
FROM classified;
$$;

REVOKE ALL ON FUNCTION
    internal.extract_next_train_arrival_evidence(uuid)
FROM PUBLIC, anon, authenticated;

COMMIT;
