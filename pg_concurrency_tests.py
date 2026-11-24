#!/usr/bin/env python3
"""Subway Exchange PostgreSQL v0.3 regression tests (CI-only, synthetic data).

Run against disposable PostgreSQL after 0001 + 0002 migrations.
Requires psycopg 3. NEVER connect this harness to production.
"""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import datetime
import unittest

import psycopg
from psycopg import errors

DSN = os.environ.get('PG_TEST_DSN', '')
if not DSN or not any(x in DSN for x in ('localhost', '127.0.0.1')):
    raise RuntimeError('Refusing to run: PG_TEST_DSN must point to local disposable PostgreSQL')


def connect():
    return psycopg.connect(DSN, autocommit=True, options='-c statement_timeout=12000 -c lock_timeout=9000')


def player():
    pid = uuid.uuid4()
    with connect() as c:
        c.execute('INSERT INTO players(id,username,is_test) VALUES (%s,%s,true)', (pid, 'test-' + pid.hex[:20]))
        c.execute("SELECT internal.credit_grant(%s, 'OPENING_GRANT', clock_timestamp())", (pid,))
    return pid


def market_and_quote():
    tid, mid, qid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with connect() as c:
        c.execute('INSERT INTO market_templates(id,name,version,immutable_rule) VALUES (%s,%s,1,%s::jsonb)',
                  (tid, 'test-' + tid.hex, '{}'))
        c.execute('''INSERT INTO markets(id,template_id,rule_snapshot,status,lock_at,outcome_deadline)
                     VALUES (%s,%s,'{}','OPEN',now()+interval '1 hour',now()+interval '2 hours')''', (mid,tid))
        c.execute('''INSERT INTO quotes(id,market_id,side,ask_ppm,model_version,issued_at,expires_at)
                     VALUES (%s,%s,'YES',500000,'synthetic',now()-interval '1 second',now()+interval '1 hour')''', (qid,mid))
    return mid,qid


def accept(pid,key,qid,stake):
    with connect() as c:
        return c.execute('SELECT internal.accept_ticket(%s,%s,%s,%s)', (pid,key,qid,stake)).fetchone()[0]


def resolve(mid,decision='YES'):
    with connect() as c:
        return c.execute('SELECT internal.resolve_market(%s,%s,1,%s::jsonb,%s)',
                         (mid,decision,'{"source":"synthetic"}','synthetic-test')).fetchone()[0]


def balance(pid):
    with connect() as c:
        return c.execute('SELECT available_minor FROM wallets WHERE player_id=%s',(pid,)).fetchone()[0]


def reconciles(pid):
    with connect() as c:
        return c.execute('''SELECT w.available_minor=coalesce(sum(l.delta_minor),0)
                          FROM wallets w LEFT JOIN token_ledger l ON l.player_id=w.player_id
                          WHERE w.player_id=%s GROUP BY w.player_id,w.available_minor''',(pid,)).fetchone()[0]


class PostgresConcurrencyTests(unittest.TestCase):
    def test_simultaneous_identical_purchase_one_ticket_one_debit(self):
        pid = player(); _,qid = market_and_quote()
        barrier = Barrier(8)
        def run(_):
            barrier.wait(timeout=10)
            return accept(pid,'same-request-key',qid,1000)
        with ThreadPoolExecutor(max_workers=8) as e:
            results = list(e.map(run,range(8)))
        self.assertEqual(len(set(results)),1)
        self.assertEqual(balance(pid),99000)
        with connect() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM tickets WHERE player_id=%s',(pid,)).fetchone()[0],1)
            self.assertEqual(c.execute("SELECT count(*) FROM token_ledger WHERE player_id=%s AND kind='STAKE'",(pid,)).fetchone()[0],1)
        self.assertTrue(reconciles(pid))

    def test_simultaneous_distinct_purchases_cannot_overspend(self):
        pid = player(); _,qid = market_and_quote(); barrier = Barrier(8)
        def run(i):
            barrier.wait(timeout=10)
            try:
                accept(pid,f'unique-request-{i:02d}',qid,25000)
                return True
            except psycopg.Error as e:
                if e.sqlstate == '22023' and 'Insufficient Tokens' in str(e):
                    return False
                raise
        with ThreadPoolExecutor(max_workers=8) as e:
            results=list(e.map(run,range(8)))
        self.assertEqual(sum(results),4)
        self.assertEqual(balance(pid),0)
        self.assertTrue(reconciles(pid))

    def test_simultaneous_same_market_settlement_is_idempotent(self):
        pid=player(); mid,qid=market_and_quote()
        accept(pid,'settlement-request',qid,1000)
        with connect() as c:
            c.execute("UPDATE markets SET status='VERIFYING' WHERE id=%s",(mid,))
        barrier=Barrier(6)
        def run(_):
            barrier.wait(timeout=10)
            return resolve(mid)
        with ThreadPoolExecutor(max_workers=6) as e:
            results=list(e.map(run,range(6)))
        self.assertEqual(sum(results),1)
        self.assertEqual(balance(pid),101000)
        self.assertTrue(reconciles(pid))
        with connect() as c:
            self.assertEqual(c.execute("SELECT count(*) FROM token_ledger WHERE player_id=%s AND kind='WIN_PAYOUT'",(pid,)).fetchone()[0],1)

    def test_conflicting_settlement_rejected(self):
        pid=player();mid,qid=market_and_quote();accept(pid,'conflicting-outcome',qid,1000)
        with connect() as c: c.execute("UPDATE markets SET status='VERIFYING' WHERE id=%s",(mid,))
        self.assertTrue(resolve(mid,'YES'))
        with self.assertRaises(psycopg.Error): resolve(mid,'NO')
        self.assertTrue(reconciles(pid))

    def test_fake_browser_cannot_execute_private_functions(self):
        name='se_ci_browser_'+uuid.uuid4().hex[:12]
        with connect() as c:
            c.execute('CREATE ROLE '+name+' NOLOGIN NOINHERIT')
            c.execute('GRANT USAGE ON SCHEMA internal TO '+name)
            try:
                c.execute('SET ROLE '+name)
                with self.assertRaises(psycopg.Error) as exc:
                    c.execute("SELECT internal.credit_grant(gen_random_uuid(), 'OPENING_GRANT',now())")
                self.assertEqual(exc.exception.sqlstate,'42501')
            finally:
                c.execute('RESET ROLE')
                c.execute('REVOKE USAGE ON SCHEMA internal FROM '+name)
                c.execute('DROP ROLE '+name)

    def test_invalid_request_rolls_back(self):
        pid=player();_,qid=market_and_quote()
        with self.assertRaises(psycopg.Error): accept(pid,'short',qid,1000)
        self.assertEqual(balance(pid),100000)
        self.assertTrue(reconciles(pid))


if __name__ == '__main__':
    unittest.main(verbosity=2)
