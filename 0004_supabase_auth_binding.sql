BEGIN;

CREATE OR REPLACE FUNCTION public.initialize_my_player()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    RETURN internal.initialize_guest(auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_my_player()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.initialize_my_player()
TO authenticated;

COMMIT;
