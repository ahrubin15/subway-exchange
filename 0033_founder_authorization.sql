BEGIN;

CREATE TABLE IF NOT EXISTS internal.founder_accounts (
    auth_user_id uuid PRIMARY KEY
        REFERENCES auth.users(id) ON DELETE CASCADE,
    granted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE internal.founder_accounts
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE internal.founder_accounts
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_founder_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
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

    RETURN internal.founder_metrics();
END $$;

REVOKE ALL ON FUNCTION public.get_founder_metrics()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_founder_metrics()
TO authenticated;

COMMIT;
