-- Run after 0001 and 0002. Atomic regression; rolls back all fixtures.
BEGIN;
DO $$
DECLARE p uuid := gen_random_uuid(); m uuid := gen_random_uuid(); q uuid := gen_random_uuid();
        tmpl uuid := gen_random_uuid(); t uuid; t2 uuid; b bigint; n int;
        yes_evidence jsonb := '{"source":"synthetic","confidence":"test"}';
BEGIN
 INSERT INTO players(id,username,is_test) VALUES(p,'pg-ledger-test-'||substr(p::text,1,8),true);
 IF NOT internal.credit_grant(p,'OPENING_GRANT','2026-11-24T17:00:00Z') THEN RAISE EXCEPTION 'opening not created'; END IF;
 IF internal.credit_grant(p,'OPENING_GRANT','2026-11-24T17:00:00Z') THEN RAISE EXCEPTION 'duplicate opening'; END IF;
 IF NOT internal.credit_grant(p,'DAILY_GRANT','2026-11-01T04:30:00Z') THEN RAISE EXCEPTION 'daily'; END IF;
 IF internal.credit_grant(p,'DAILY_GRANT','2026-11-01T05:30:00Z') THEN RAISE EXCEPTION 'DST repeated daily grant'; END IF;
 IF NOT internal.credit_grant(p,'WEEKLY_GRANT','2026-11-01T05:30:00Z') THEN RAISE EXCEPTION 'weekly'; END IF;
 IF internal.credit_grant(p,'WEEKLY_GRANT','2026-11-07T17:00:00Z') THEN RAISE EXCEPTION 'same week grant'; END IF;
 IF NOT internal.credit_grant(p,'WEEKLY_GRANT','2026-11-08T17:00:00Z') THEN RAISE EXCEPTION 'new Sunday grant'; END IF;
 SELECT available_minor INTO b FROM wallets WHERE player_id=p;
 IF b <> 305000 THEN RAISE EXCEPTION 'grants wrong %',b; END IF;
 INSERT INTO market_templates(id,name,version,immutable_rule)
   VALUES(tmpl,'test-template-'||m,1,'{}');
 INSERT INTO markets(id,template_id,rule_snapshot,status,lock_at,outcome_deadline)
   VALUES(m,tmpl,'{}','OPEN',clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '1 hour');
 INSERT INTO quotes(id,market_id,side,ask_ppm,model_version,expires_at)
   VALUES(q,m,'YES',500000,'synthetic-test',clock_timestamp()+interval '5 minutes');
 t:=internal.accept_ticket(p,'test-request-001',q,10000);
 t2:=internal.accept_ticket(p,'test-request-001',q,10000);
 IF t<>t2 THEN RAISE EXCEPTION 'duplicate trade ticket'; END IF;
 SELECT available_minor INTO b FROM wallets WHERE player_id=p;
 IF b<>295000 THEN RAISE EXCEPTION 'stake wrong %',b; END IF;
 BEGIN
   PERFORM internal.accept_ticket(p,'test-request-001',q,11000);
   RAISE EXCEPTION 'conflict accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
   PERFORM internal.accept_ticket(p,'test-request-002',q,300000);
   RAISE EXCEPTION 'oversized stake accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 UPDATE markets SET status='LOCKED' WHERE id=m;
 IF NOT internal.resolve_market(m,'YES',1,yes_evidence,'TEST') THEN RAISE EXCEPTION 'not settled'; END IF;
 IF internal.resolve_market(m,'YES',1,yes_evidence,'TEST') THEN RAISE EXCEPTION 'duplicate settle'; END IF;
 SELECT available_minor INTO b FROM wallets WHERE player_id=p;
 IF b<>315000 THEN RAISE EXCEPTION 'payout wrong %',b; END IF;
 BEGIN
   PERFORM internal.resolve_market(m,'NO',1,yes_evidence,'TEST');
   RAISE EXCEPTION 'conflicting settlement accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 SELECT count(*) INTO n FROM token_ledger WHERE player_id=p AND kind='STAKE';
 IF n<>1 THEN RAISE EXCEPTION 'duplicate stakes'; END IF;
 SELECT count(*) INTO n FROM token_ledger WHERE player_id=p AND kind='WIN_PAYOUT';
 IF n<>1 THEN RAISE EXCEPTION 'duplicate payouts'; END IF;
 SELECT coalesce(sum(delta_minor),0) INTO b FROM token_ledger WHERE player_id=p;
 IF b<>315000 THEN RAISE EXCEPTION 'ledger reconciliation wrong %',b; END IF;
 -- Locked markets do not accept new orders, even with an unexpired quote.
 BEGIN
   PERFORM internal.accept_ticket(p,'test-request-003',q,10000);
   RAISE EXCEPTION 'accepted after lock';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 RAISE NOTICE 'Postgres end-to-end regression passed: grants, DST, ticket, lock, settlement, conservation';
END $$;
-- Check SECURITY DEFINER functions are not callable by PUBLIC and RLS is on.
DO $$
DECLARE fn record; t record;
BEGIN
 FOR fn IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='internal' LOOP
   IF EXISTS (SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid=fn.oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid=fn.oid)))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN
     RAISE EXCEPTION 'PUBLIC can execute %',fn.proname; END IF;
 END LOOP;
 FOR t IN SELECT relname,relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND relname IN ('players','wallets','tickets','token_ledger') LOOP
   IF NOT t.relrowsecurity THEN RAISE EXCEPTION 'RLS off: %',t.relname; END IF;
 END LOOP;
END $$;
ROLLBACK;
