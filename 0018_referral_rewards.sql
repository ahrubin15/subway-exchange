BEGIN;

CREATE OR REPLACE FUNCTION internal.reward_referral(
    p_player uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_referral public.referrals%ROWTYPE;
    v_recipient uuid;
BEGIN
    SELECT * INTO v_referral
    FROM public.referrals
    WHERE referred_id = p_player
    FOR UPDATE;

    IF NOT FOUND OR v_referral.rewarded_at IS NOT NULL THEN
        RETURN false;
    END IF;

    IF NOT internal.referral_is_qualified(p_player) THEN
        RETURN false;
    END IF;

    FOR v_recipient IN
        SELECT id
        FROM public.players
        WHERE id IN (
            v_referral.referrer_id,
            v_referral.referred_id
        )
        ORDER BY id
    LOOP
        INSERT INTO public.wallets(player_id)
        VALUES (v_recipient)
        ON CONFLICT DO NOTHING;

        PERFORM 1 FROM public.wallets
        WHERE player_id = v_recipient
        FOR UPDATE;

        INSERT INTO public.token_ledger (
            player_id, kind, delta_minor,
            idempotency_key, metadata
        )
        VALUES (
            v_recipient,
            'REFERRAL_GRANT',
            10000,
            'referral:' || v_referral.id::text,
            jsonb_build_object(
                'referral_id', v_referral.id
            )
        );

        UPDATE public.wallets
        SET available_minor = available_minor + 10000,
            version = version + 1,
            updated_at = clock_timestamp()
        WHERE player_id = v_recipient;
    END LOOP;

    UPDATE public.referrals
    SET qualified_at = COALESCE(
            qualified_at, clock_timestamp()
        ),
        rewarded_at = clock_timestamp()
    WHERE id = v_referral.id;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION
internal.reward_referral(uuid)
FROM PUBLIC, anon, authenticated;

COMMIT;
