BEGIN;

CREATE OR REPLACE FUNCTION internal.prevent_quote_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'Quotes are immutable';
END;
$$;

REVOKE ALL ON FUNCTION internal.prevent_quote_mutation()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER prevent_quote_mutation
BEFORE UPDATE OR DELETE ON public.quotes
FOR EACH ROW
EXECUTE FUNCTION internal.prevent_quote_mutation();

COMMIT;
