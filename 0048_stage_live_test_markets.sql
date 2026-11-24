BEGIN;

INSERT INTO public.market_templates(
    name, version, immutable_rule
)
VALUES (
    'Next Train Live Test',
    1,
    '{
        "environment":"test",
        "settlement_method":"conservative",
        "shadow_rule":"shadow-v1",
        "event":"selected_train_arrival_by_deadline"
    }'::jsonb
)
ON CONFLICT(name, version) DO NOTHING;

CREATE TABLE internal.research_market_links (
    research_market_id uuid PRIMARY KEY
        REFERENCES internal.next_train_research(id),
    market_id uuid NOT NULL UNIQUE
        REFERENCES public.markets(id)
);

ALTER TABLE internal.research_market_links
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON internal.research_market_links
FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE internal.research_quote_links (
    research_quote_id uuid NOT NULL
        REFERENCES internal.next_train_research_quotes(id),
    side text NOT NULL
        CHECK(side IN ('YES','NO')),
    quote_id uuid NOT NULL UNIQUE
        REFERENCES public.quotes(id),
    PRIMARY KEY(research_quote_id, side)
);

ALTER TABLE internal.research_quote_links
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON internal.research_quote_links
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION internal.stage_next_train_test_markets()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    r record;
    v_template uuid;
    v_market uuid;
    v_count integer := 0;
    v_now timestamptz := statement_timestamp();
    v_station text;
    v_direction text;
BEGIN
    PERFORM pg_advisory_xact_lock(740048,1);

    SELECT id INTO STRICT v_template
    FROM public.market_templates
    WHERE name = 'Next Train Live Test'
    AND version = 1;

    FOR r IN
        SELECT m.*
        FROM internal.next_train_research m
        WHERE m.generated_at <= v_now
        AND m.lock_at > v_now
        AND EXISTS (
            SELECT 1
            FROM internal.next_train_research_quotes q
            WHERE q.market_id = m.id
            AND q.issued_at <= v_now
            AND q.expires_at > v_now
        )
        AND NOT EXISTS (
            SELECT 1
            FROM internal.research_market_links l
            WHERE l.research_market_id = m.id
        )
        ORDER BY m.lock_at, m.id
        LIMIT 100
    LOOP
        v_station := CASE left(r.stop_id,3)
            WHEN '630' THEN '51 St'
            WHEN '631' THEN 'Grand Central-42 St'
            WHEN '632' THEN '33 St'
            WHEN '633' THEN '28 St'
        END;

        v_direction := CASE right(r.stop_id,1)
            WHEN 'N' THEN 'Uptown'
            WHEN 'S' THEN 'Downtown'
        END;

        IF v_station IS NULL
        OR v_direction IS NULL THEN
            CONTINUE;
        END IF;

        INSERT INTO public.markets(
            template_id,
            rule_snapshot,
            status,
            lock_at,
            outcome_deadline
        )
        VALUES (
            v_template,
            jsonb_build_object(
                'environment','test',
                'research_market_id',r.id,
                'trip_key',r.trip_key,
                'stop_id',r.stop_id,
                'route_id','6',
                'station_name',v_station,
                'direction',v_direction,
                'question',format(
                    'Will the selected %s 6 train arrive at %s by %s ET?',
                    lower(v_direction),
                    v_station,
                    to_char(
                        r.deadline AT TIME ZONE
                        'America/New_York',
                        'HH12:MI:SS AM'
                    )
                ),
                'deadline',r.deadline,
                'lock_at',r.lock_at,
                'settlement_method','conservative',
                'shadow_rule','shadow-v1'
            ),
            'DRAFT',
            r.lock_at,
            r.deadline
        )
        RETURNING id INTO v_market;

        INSERT INTO internal.research_market_links
        VALUES (r.id,v_market);

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION
    internal.stage_next_train_test_markets()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
