BEGIN;

CREATE FUNCTION internal.price_next_train_research(
    p_market uuid,
    p_observation uuid,
    p_margin_ppm integer DEFAULT 40000
)
RETURNS TABLE(
    yes_probability_ppm integer,
    yes_ask_ppm integer,
    no_ask_ppm integer,
    model_version text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
WITH inputs AS (
    SELECT
        extract(epoch FROM
            m.deadline - t.predicted_arrival_at
        )::double precision AS slack,
        greatest(
            60.0,
            extract(epoch FROM
                t.predicted_arrival_at
                - statement_timestamp()
            )::double precision * 0.35,
            abs(extract(epoch FROM
                t.predicted_arrival_at
                - m.predicted_arrival_at
            )::double precision) * 0.5
        ) AS scale
    FROM internal.next_train_research m
    JOIN internal.train_observations t
        ON t.trip_key = m.trip_key
        AND t.stop_id = m.stop_id
        AND t.observation_id = p_observation
    JOIN public.transit_observations o
        ON o.id = t.observation_id
    JOIN public.transit_observations origin
        ON origin.id = m.observation_id
    WHERE m.id = p_market
    AND statement_timestamp() < m.lock_at
    AND p_margin_ppm BETWEEN 0 AND 100000
    AND o.source = origin.source
    AND o.feed_id = origin.feed_id
    AND o.quality->>'status' = 'ok'
    AND o.source_time >= origin.source_time
    AND o.collected_at >= origin.collected_at
    AND o.source_time BETWEEN
        statement_timestamp() - interval '120 seconds'
        AND statement_timestamp()
    AND o.collected_at BETWEEN
        statement_timestamp() - interval '120 seconds'
        AND statement_timestamp()
    AND t.predicted_arrival_at > statement_timestamp()
    AND t.vehicle_status IS DISTINCT FROM 1
), probs AS (
    SELECT round(
        1000000 * greatest(
            0.05,
            least(
                0.95,
                1.0 / (
                    1.0 + exp(
                        -greatest(
                            -20.0,
                            least(20.0, slack / scale)
                        )
                    )
                )
            )
        )
    )::integer AS p
    FROM inputs
)
SELECT
    p,
    least(990000, p + p_margin_ppm / 2),
    least(990000, 1000000 - p + p_margin_ppm / 2),
    'research-logistic-v1'::text
FROM probs;
$$;

REVOKE ALL ON FUNCTION
    internal.price_next_train_research(uuid,uuid,integer)
FROM PUBLIC, anon, authenticated;

COMMIT;
