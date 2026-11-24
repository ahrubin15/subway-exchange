-- Private guest identity foundation. Only a trusted backend may supply a verified auth UUID.
BEGIN;
CREATE OR REPLACE FUNCTION internal.initialize_guest(p_auth_user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_player uuid;
BEGIN
  IF p_auth_user IS NULL THEN
    RAISE EXCEPTION 'Authenticated identity required' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.players(auth_user_id, username)
    VALUES(p_auth_user, 'guest_' || replace(gen_random_uuid()::text,'-',''))
    ON CONFLICT (auth_user_id) DO NOTHING;
  SELECT id INTO STRICT v_player FROM public.players
    WHERE auth_user_id=p_auth_user FOR UPDATE;
  PERFORM internal.credit_grant(v_player,'OPENING_GRANT');
  RETURN v_player;
END $$;
REVOKE ALL ON FUNCTION internal.initialize_guest(uuid) FROM PUBLIC;
COMMIT;
