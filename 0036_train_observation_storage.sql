BEGIN;

CREATE TABLE internal.train_observations (
    observation_id uuid NOT NULL
        REFERENCES public.transit_observations(id),
    trip_key text NOT NULL
        CHECK(length(trip_key) BETWEEN 1 AND 300),
    route_id text NOT NULL CHECK(route_id = '6'),
    stop_id text NOT NULL
        CHECK(stop_id ~ '^(630|631|632|633)[NS]$'),
    predicted_arrival_at timestamptz,
    predicted_departure_at timestamptz,
    vehicle_status integer
        CHECK(vehicle_status BETWEEN 0 AND 2),
    vehicle_movement_at timestamptz,
    vehicle_id text,

    PRIMARY KEY(observation_id, trip_key, stop_id),

    CHECK(
        predicted_arrival_at IS NOT NULL
        OR predicted_departure_at IS NOT NULL
        OR vehicle_status IS NOT NULL
    ),

    CHECK(
        vehicle_status IS NOT NULL
        OR (
            vehicle_movement_at IS NULL
            AND vehicle_id IS NULL
        )
    )
);

ALTER TABLE internal.train_observations
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON internal.train_observations
FROM PUBLIC, anon, authenticated;

CREATE INDEX idx_train_observations_stop
ON internal.train_observations(stop_id, observation_id);

CREATE FUNCTION public.ingest_train_observations(
    p_observation uuid,
    p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    r record;
    n integer := 0;
    v_count integer;
BEGIN
    IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Invalid train batch'
        USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_rows) > 500
    OR octet_length(p_rows::text) > 262144 THEN
        RAISE EXCEPTION 'Invalid train batch'
        USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.transit_observations
    WHERE id = p_observation
    AND source = 'MTA_GTFS_RT'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown MTA observation'
        USING ERRCODE = '22023';
    END IF;

    FOR r IN
        SELECT * FROM jsonb_to_recordset(p_rows) AS x(
            trip_key text,
            route_id text,
            stop_id text,
            predicted_arrival_at timestamptz,
            predicted_departure_at timestamptz,
            vehicle_status integer,
            vehicle_movement_at timestamptz,
            vehicle_id text
        )
    LOOP
        INSERT INTO internal.train_observations
        VALUES (
            p_observation,
            r.trip_key,
            r.route_id,
            r.stop_id,
            r.predicted_arrival_at,
            r.predicted_departure_at,
            r.vehicle_status,
            r.vehicle_movement_at,
            r.vehicle_id
        )
        ON CONFLICT DO NOTHING;

        GET DIAGNOSTICS v_count = ROW_COUNT;

        IF v_count = 0 AND NOT EXISTS (
            SELECT 1
            FROM internal.train_observations t
            WHERE t.observation_id = p_observation
            AND t.trip_key = r.trip_key
            AND t.stop_id = r.stop_id
            AND ROW(
                t.route_id,
                t.predicted_arrival_at,
                t.predicted_departure_at,
                t.vehicle_status,
                t.vehicle_movement_at,
                t.vehicle_id
            ) IS NOT DISTINCT FROM ROW(
                r.route_id,
                r.predicted_arrival_at,
                r.predicted_departure_at,
                r.vehicle_status,
                r.vehicle_movement_at,
                r.vehicle_id
            )
        ) THEN
            RAISE EXCEPTION
                'Conflicting train observation retry'
            USING ERRCODE = '23505';
        END IF;

        n := n + v_count;
    END LOOP;

    RETURN n;
END $$;

REVOKE ALL ON FUNCTION
    public.ingest_train_observations(uuid,jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.ingest_train_observations(uuid,jsonb)
TO service_role;

COMMIT;
