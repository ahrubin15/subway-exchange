BEGIN;

CREATE OR REPLACE FUNCTION public.purchase_my_prediction(
    p_request_key text,
    p_quote uuid,
    p_stake_minor bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_player uuid;
BEGIN
    SELECT id INTO v_player
    FROM public.players
    WHERE auth_user_id = auth.uid()
    AND is_test = true;

    IF v_player IS NULL THEN
        RAISE EXCEPTION 'Authorized test player required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.quotes q
        JOIN public.markets m ON m.id = q.market_id
        WHERE q.id = p_quote
        AND m.rule_snapshot->>'environment' = 'test'
    ) THEN
        RAISE EXCEPTION 'Test market required';
    END IF;

    RETURN internal.accept_ticket(
        v_player,
        p_request_key,
        p_quote,
        p_stake_minor
    );
END;
$$;

REVOKE ALL ON FUNCTION
public.purchase_my_prediction(text, uuid, bigint)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.purchase_my_prediction(text, uuid, bigint)
TO authenticated;

COMMIT;
