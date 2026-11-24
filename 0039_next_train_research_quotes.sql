BEGIN;

CREATE TABLE internal.next_train_research_quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id uuid NOT NULL
        REFERENCES internal.next_train_research(id),
    observation_id uuid NOT NULL
        REFERENCES public.transit_observations(id),
    yes_probability_ppm integer NOT NULL
        CHECK(yes_probability_ppm BETWEEN 50000 AND 950000),
    yes_ask_ppm integer NOT NULL
        CHECK(yes_ask_ppm BETWEEN 1 AND 990000),
    no_ask_ppm integer NOT NULL
        CHECK(no_ask_ppm BETWEEN 1 AND 990000),
    model_version text NOT NULL,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
        CHECK(expires_at > issued_at),
    UNIQUE(market_id, observation_id, model_version)
);

ALTER TABLE internal.next_train_research_quotes
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON internal.next_train_research_quotes
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION internal.reject_research_quote_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'Research quotes are immutable'
    USING ERRCODE = '55000';
END $$;

REVOKE ALL ON FUNCTION
    internal.reject_research_quote_mutation()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER immutable_research_quotes
BEFORE UPDATE OR DELETE
ON internal.next_train_research_quotes
FOR EACH ROW EXECUTE FUNCTION
    internal.reject_research_quote_mutation();

CREATE FUNCTION internal.issue_next_train_research_quotes(
    p_observation uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    t timestamptz := clock_timestamp();
    n integer;
BEGIN
    INSERT INTO internal.next_train_research_quotes(
        market_id,
        observation_id,
        yes_probability_ppm,
        yes_ask_ppm,
        no_ask_ppm,
        model_version,
        issued_at,
        expires_at
    )
    SELECT
        m.id,
        p_observation,
        p.yes_probability_ppm,
        p.yes_ask_ppm,
        p.no_ask_ppm,
        p.model_version,
        t,
        least(
            t + interval '30 seconds',
            m.lock_at,
            o.source_time + interval '120 seconds',
            o.collected_at + interval '120 seconds'
        )
    FROM internal.next_train_research m
    JOIN public.transit_observations o
        ON o.id = p_observation
    CROSS JOIN LATERAL
        internal.price_next_train_research(
            m.id, p_observation
        ) p
    WHERE m.lock_at > t
    AND o.source_time + interval '120 seconds' > t
    AND o.collected_at + interval '120 seconds' > t
    AND NOT EXISTS (
        SELECT 1
        FROM internal.next_train_research_quotes q
        JOIN public.transit_observations prev
            ON prev.id = q.observation_id
        WHERE q.market_id = m.id
        AND prev.source_time >= o.source_time
    )
    ON CONFLICT(
        market_id, observation_id, model_version
    ) DO NOTHING;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

REVOKE ALL ON FUNCTION
    internal.issue_next_train_research_quotes(uuid)
FROM PUBLIC, anon, authenticated;

COMMIT;
