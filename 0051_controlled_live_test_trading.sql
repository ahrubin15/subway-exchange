BEGIN;

CREATE TABLE internal.live_test_control (
    singleton boolean PRIMARY KEY CHECK(singleton),
    enabled boolean NOT NULL DEFAULT false
);

INSERT INTO internal.live_test_control
VALUES(true,false);

ALTER TABLE internal.live_test_control
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON internal.live_test_control
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION internal.enforce_live_test_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
BEGIN
    IF NOT EXISTS(
        SELECT 1
        FROM internal.research_market_links
        WHERE market_id=NEW.market_id
    ) THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS(
        SELECT 1
        FROM internal.live_test_control
        WHERE singleton AND enabled
        FOR SHARE
    )
    OR NOT EXISTS(
        SELECT 1
        FROM public.players p
        JOIN auth.users u ON u.id=p.auth_user_id
        WHERE p.id=NEW.player_id
        AND p.is_test
        AND NOT u.is_anonymous
        AND u.email_confirmed_at IS NOT NULL
    )
    OR NOT EXISTS(
        SELECT 1
        FROM internal.research_market_links l
        JOIN internal.research_quote_links x
            ON x.quote_id=NEW.quote_id
        JOIN internal.next_train_research_quotes q
            ON q.id=x.research_quote_id
            AND q.market_id=l.research_market_id
        WHERE l.market_id=NEW.market_id
        AND x.side=NEW.side
        AND q.issued_at<=clock_timestamp()
        AND q.expires_at>clock_timestamp()
        AND q.id=(
            SELECT z.id
            FROM internal.next_train_research_quotes z
            WHERE z.market_id=l.research_market_id
            AND z.issued_at<=clock_timestamp()
            ORDER BY z.issued_at DESC,z.id DESC
            LIMIT 1
        )
    ) THEN
        RAISE EXCEPTION
            'Live test trading unavailable or quote stale'
            USING ERRCODE='55000';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
    internal.enforce_live_test_ticket()
FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER enforce_live_test_ticket
BEFORE INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION internal.enforce_live_test_ticket();

CREATE FUNCTION internal.advance_live_test_markets()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
    n integer;
BEGIN
    PERFORM pg_advisory_xact_lock(740048,1);

    UPDATE public.markets m
    SET status='LOCKED'
    FROM internal.research_market_links l
    WHERE m.id=l.market_id
    AND m.status IN ('OPEN','SUSPENDED')
    AND m.lock_at<=clock_timestamp();

    UPDATE public.markets m
    SET status='CANCELLED_BEFORE_OPEN'
    FROM internal.research_market_links l
    WHERE m.id=l.market_id
    AND m.status='DRAFT'
    AND m.lock_at<=clock_timestamp();

    IF NOT EXISTS(
        SELECT 1
        FROM internal.live_test_control
        WHERE singleton AND enabled
        FOR SHARE
    )
    OR NOT EXISTS(
        SELECT 1
        FROM internal.trading_control
        WHERE singleton AND NOT paused
        FOR SHARE
    ) THEN
        RETURN 0;
    END IF;

    PERFORM internal.stage_next_train_test_markets();

    UPDATE public.markets m
    SET status='DRAFT'
    FROM internal.research_market_links l
    WHERE m.id=l.market_id
    AND m.status='OPEN'
    AND m.lock_at>clock_timestamp();

    PERFORM internal.sync_next_train_test_quotes();

    UPDATE public.markets m
    SET status='OPEN',
        published_at=coalesce(
            m.published_at,clock_timestamp()
        )
    FROM internal.research_market_links l
    WHERE m.id=l.market_id
    AND m.status='DRAFT'
    AND m.lock_at>clock_timestamp()
    AND (
        m.published_at IS NOT NULL
        OR EXISTS(
            SELECT 1
            FROM internal.next_train_research_quotes q
            WHERE q.market_id=l.research_market_id
            AND q.issued_at<=clock_timestamp()
            AND q.expires_at>clock_timestamp()
            AND q.id=(
                SELECT z.id
                FROM internal.next_train_research_quotes z
                WHERE z.market_id=l.research_market_id
                AND z.issued_at<=clock_timestamp()
                ORDER BY z.issued_at DESC,z.id DESC
                LIMIT 1
            )
            AND (
                SELECT count(*)
                FROM internal.research_quote_links x
                WHERE x.research_quote_id=q.id
            )=2
        )
    );

    GET DIAGNOSTICS n=ROW_COUNT;
    RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION
    internal.advance_live_test_markets()
FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION
    internal.after_research_engine_run_settle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=pg_catalog,pg_temp
AS $$
BEGIN
    IF NEW.status='ok' THEN
        BEGIN
            PERFORM internal.settle_next_train_shadow(100);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING
                'Shadow settlement failed: %',SQLSTATE;
        END;

        BEGIN
            PERFORM internal.settle_next_train_test_markets(100);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING
                'Test market settlement failed: %',SQLSTATE;
        END;

        BEGIN
            PERFORM internal.advance_live_test_markets();
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING
                'Live test publishing failed: %',SQLSTATE;
        END;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
    internal.after_research_engine_run_settle()
FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
