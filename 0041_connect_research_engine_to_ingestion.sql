BEGIN;

ALTER FUNCTION
    public.ingest_train_observations(uuid,jsonb)
SET SCHEMA internal;

ALTER FUNCTION
    internal.ingest_train_observations(uuid,jsonb)
RENAME TO store_train_observations;

REVOKE ALL ON FUNCTION
    internal.store_train_observations(uuid,jsonb)
FROM PUBLIC, anon, authenticated, service_role;

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
    n integer;
BEGIN
    n := internal.store_train_observations(
        p_observation,
        p_rows
    );

    IF jsonb_array_length(p_rows) > 0 THEN
        BEGIN
            PERFORM internal.process_next_train_research(
                p_observation
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING
                'Research engine failed for observation %: %',
                p_observation,
                SQLSTATE;
        END;
    END IF;

    RETURN n;
END $$;

REVOKE ALL ON FUNCTION
    public.ingest_train_observations(uuid,jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.ingest_train_observations(uuid,jsonb)
TO service_role;

COMMIT;
