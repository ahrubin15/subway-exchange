BEGIN;

CREATE OR REPLACE FUNCTION public.ingest_transit_observation(
    p_feed_id text,
    p_source_time timestamptz,
    p_collected_at timestamptz,
    p_r2_key text,
    p_sha256 text,
    p_quality jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_feed_id IS NULL
    OR length(p_feed_id) NOT BETWEEN 1 AND 100
    OR p_source_time IS NULL
    OR p_collected_at IS NULL
    OR p_source_time >
        p_collected_at + interval '60 seconds'
    OR p_collected_at >
        clock_timestamp() + interval '60 seconds'
    OR p_r2_key IS NULL
    OR length(p_r2_key) NOT BETWEEN 1 AND 1024
    OR p_sha256 IS NULL
    OR p_sha256 !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_quality) IS DISTINCT FROM 'object'
    OR octet_length(p_quality::text) > 65536
    THEN
        RAISE EXCEPTION 'Invalid transit observation'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.transit_observations(
        source, feed_id, source_time,
        collected_at, r2_key, sha256, quality
    )
    VALUES (
        'MTA_GTFS_RT', p_feed_id, p_source_time,
        p_collected_at, p_r2_key, p_sha256, p_quality
    )
    ON CONFLICT(r2_key) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT id INTO v_id
        FROM public.transit_observations
        WHERE r2_key = p_r2_key
        AND source = 'MTA_GTFS_RT'
        AND feed_id = p_feed_id
        AND source_time = p_source_time
        AND collected_at = p_collected_at
        AND sha256 = p_sha256
        AND quality = p_quality;

        IF v_id IS NULL THEN
            RAISE EXCEPTION 'Conflicting observation retry'
            USING ERRCODE = '23505';
        END IF;
    END IF;

    RETURN v_id;
END $$;

CREATE INDEX IF NOT EXISTS idx_transit_feed_source_time
ON public.transit_observations(feed_id, source_time DESC);

REVOKE ALL ON FUNCTION public.ingest_transit_observation(
    text, timestamptz, timestamptz, text, text, jsonb
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ingest_transit_observation(
    text, timestamptz, timestamptz, text, text, jsonb
)
TO service_role;

COMMIT;
