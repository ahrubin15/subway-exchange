BEGIN;

CREATE TABLE internal.trading_control (
    singleton boolean PRIMARY KEY DEFAULT true
        CHECK(singleton),
    paused boolean NOT NULL DEFAULT false
);

INSERT INTO internal.trading_control(singleton)
VALUES(true);

CREATE TABLE internal.admin_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor uuid NOT NULL,
    action text NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL
        DEFAULT clock_timestamp()
);

ALTER TABLE internal.trading_control
ENABLE ROW LEVEL SECURITY;

ALTER TABLE internal.admin_audit
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
    internal.trading_control,
    internal.admin_audit
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_trading_paused(
    p_paused boolean,
    p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM internal.founder_accounts f
        JOIN auth.users u ON u.id = f.auth_user_id
        WHERE f.auth_user_id = auth.uid()
        AND NOT u.is_anonymous
        AND u.email_confirmed_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Founder access required'
        USING ERRCODE = '42501';
    END IF;

    IF p_paused IS NULL
       OR p_reason IS NULL
       OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500
    THEN
        RAISE EXCEPTION 'Invalid pause request';
    END IF;

    UPDATE internal.trading_control
    SET paused = p_paused
    WHERE singleton
    AND paused IS DISTINCT FROM p_paused;

    IF NOT FOUND THEN RETURN false; END IF;

    INSERT INTO internal.admin_audit(
        actor, action, reason
    )
    VALUES (
        auth.uid(),
        CASE WHEN p_paused
            THEN 'TRADING_PAUSED'
            ELSE 'TRADING_RESUMED'
        END,
        btrim(p_reason)
    );

    RETURN true;
END $$;

CREATE FUNCTION internal.enforce_trading_control()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_paused boolean;
BEGIN
    SELECT paused INTO v_paused
    FROM internal.trading_control
    WHERE singleton FOR SHARE;

    IF v_paused IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Trading temporarily paused'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER enforce_trading_control
BEFORE INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION internal.enforce_trading_control();

REVOKE ALL ON FUNCTION
    internal.enforce_trading_control(),
    public.set_trading_paused(boolean,text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.set_trading_paused(boolean,text)
TO authenticated;

COMMIT;
