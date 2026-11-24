#!/usr/bin/env python3
"""Dependency-free SQLite transaction-model tests; NOT production PostgreSQL authorization.
Tests token-unit math, event idempotency, atomic wallet/ledger/ticket mutation,
concurrent double submit, double settlement, VOID, and NYC-local grant rollover.
"""
import argparse
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")


def units(tokens):
    n = Decimal(str(tokens)) * 100
    if n != n.to_integral_value():
        raise ValueError("Token fractions smaller than 0.01 not supported")
    return int(n)


def gross_return(stake_minor, ask_ppm):
    if not 1 <= ask_ppm <= 999999 or stake_minor <= 0:
        raise ValueError("Invalid stake or quote")
    return int((Decimal(stake_minor) * 1000000 / Decimal(ask_ppm)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def local_period(iso_timestamp):
    dt = datetime.fromisoformat(iso_timestamp.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError("Timestamp must have UTC offset")
    local = dt.astimezone(NY)
    # Sunday-anchored competition week
    days_back = (local.weekday() + 1) % 7
    from datetime import timedelta
    return local.date().isoformat(), (local.date() - timedelta(days=days_back)).isoformat()


class Ledger:
    def __init__(self, path):
        self.path = str(path)
        with self.connect() as c:
            c.executescript('''
                CREATE TABLE IF NOT EXISTS wallets(player TEXT PRIMARY KEY, amount INTEGER NOT NULL CHECK(amount >= 0));
                CREATE TABLE IF NOT EXISTS events(player TEXT, event_key TEXT, kind TEXT, delta INTEGER NOT NULL,
                    PRIMARY KEY(player,event_key));
                CREATE TABLE IF NOT EXISTS tickets(player TEXT, request_key TEXT, market TEXT, side TEXT, stake INTEGER,
                    payout INTEGER, status TEXT NOT NULL, PRIMARY KEY(player,request_key));
                CREATE TABLE IF NOT EXISTS outcomes(market TEXT PRIMARY KEY, decision TEXT NOT NULL);
            ''')
    def connect(self):
        c = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        c.execute('PRAGMA busy_timeout=15000')
        return c
    def _apply(self, c, player, event_key, kind, amount):
        exists = c.execute('SELECT delta,kind FROM events WHERE player=? AND event_key=?',(player,event_key)).fetchone()
        if exists:
            if exists != (amount,kind):
                raise ValueError('Idempotency key reused for different event')
            return False
        c.execute('INSERT OR IGNORE INTO wallets VALUES (?,0)',(player,))
        updated = c.execute('UPDATE wallets SET amount=amount+? WHERE player=? AND amount+?>=0',(amount,player,amount)).rowcount
        if updated != 1:
            raise ValueError('Insufficient Tokens')
        c.execute('INSERT INTO events VALUES (?,?,?,?)',(player,event_key,kind,amount))
        return True
    def transaction(self, work):
        with self.connect() as c:
            try:
                c.execute('BEGIN IMMEDIATE')
                result = work(c)
                c.execute('COMMIT')
                return result
            except BaseException:
                c.execute('ROLLBACK')
                raise
    def grant(self, player, kind, period):
        amount = {'OPENING_GRANT':100000,'DAILY_GRANT':5000,'WEEKLY_GRANT':100000}[kind]
        return self.transaction(lambda c: self._apply(c,player,kind+':'+period,kind,amount))
    def session_grants(self, player, at):
        day, week = local_period(at)
        return (self.grant(player,'OPENING_GRANT','once'),
                self.grant(player,'DAILY_GRANT',day),
                self.grant(player,'WEEKLY_GRANT',week))
    def trade(self, player, req, market, side, stake, ask_ppm):
        payout = gross_return(stake, ask_ppm)
        def work(c):
            old = c.execute('SELECT market,side,stake,payout FROM tickets WHERE player=? AND request_key=?',(player,req)).fetchone()
            if old:
                if old != (market,side,stake,payout): raise ValueError('Conflicting trade retry')
                return False
            self._apply(c,player,'stake:'+req,'STAKE',-stake)
            c.execute('INSERT INTO tickets VALUES (?,?,?,?,?,?,?)',(player,req,market,side,stake,payout,'OPEN'))
            return True
        return self.transaction(work)
    def settle(self, market, decision):
        if decision not in ('YES','NO','VOID'): raise ValueError('Invalid outcome')
        def work(c):
            previous = c.execute('SELECT decision FROM outcomes WHERE market=?',(market,)).fetchone()
            if previous:
                if previous[0] != decision: raise ValueError('Conflicting outcome')
                return False
            c.execute('INSERT INTO outcomes VALUES (?,?)',(market,decision))
            tickets = c.execute('SELECT player,request_key,side,stake,payout FROM tickets WHERE market=? AND status="OPEN"',(market,)).fetchall()
            for player,req,side,stake,payout in tickets:
                if decision == 'VOID':
                    self._apply(c,player,'settle:'+req,'VOID_REFUND',stake)
                    status = 'VOIDED'
                elif decision == side:
                    self._apply(c,player,'settle:'+req,'WIN_PAYOUT',payout)
                    status = 'WON'
                else: status = 'LOST'
                c.execute('UPDATE tickets SET status=? WHERE player=? AND request_key=?',(status,player,req))
            return True
        return self.transaction(work)
    def balance(self,player):
        with self.connect() as c:
            row=c.execute('SELECT amount FROM wallets WHERE player=?',(player,)).fetchone()
            return row[0] if row else 0
    def reconcile(self):
        with self.connect() as c:
            return c.execute('''SELECT COUNT(*) FROM wallets w WHERE w.amount !=
                COALESCE((SELECT SUM(delta) FROM events e WHERE e.player=w.player),0)''').fetchone()[0]


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.ledger = Ledger(Path(self.t.name)/'ledger.sqlite')
        self.ledger.session_grants('a','2026-11-24T17:00:00Z')
    def tearDown(self): self.t.cleanup()
    def test_grants_one_time(self):
        self.assertEqual(self.ledger.session_grants('a','2026-11-24T17:00:00Z'),(False,False,False))
        self.assertEqual(self.ledger.balance('a'),205000)
    def test_ny_sunday_and_dst(self):
        self.assertEqual(local_period('2026-11-01T04:30:00Z'),('2026-11-01','2026-11-01'))
        self.assertEqual(local_period('2026-11-01T05:30:00Z'),('2026-11-01','2026-11-01'))
        self.assertEqual(local_period('2026-11-01T03:30:00Z'),('2026-10-31','2026-10-25'))
    def test_new_day_not_new_week(self):
        self.assertEqual(self.ledger.session_grants('a','2026-11-25T17:00:00Z'),(False,True,False))
    def test_new_week_and_new_day(self):
        self.assertEqual(self.ledger.session_grants('a','2026-11-29T17:00:00Z'),(False,True,True))
    def test_trade_is_idempotent(self):
        self.assertTrue(self.ledger.trade('a','req1','m1','YES',1000,500000))
        self.assertFalse(self.ledger.trade('a','req1','m1','YES',1000,500000))
        self.assertEqual(self.ledger.balance('a'),204000)
    def test_conflicting_retry_rejected(self):
        self.ledger.trade('a','req1','m1','YES',1000,500000)
        with self.assertRaises(ValueError):self.ledger.trade('a','req1','m2','YES',1000,500000)
    def test_insufficient_funds_atomic(self):
        with self.assertRaises(ValueError):self.ledger.trade('a','reqx','m1','NO',300000,500000)
        self.assertEqual(self.ledger.reconcile(),0)
    def test_win_and_repeat_settlement(self):
        self.ledger.trade('a','r','m','YES',1000,500000)
        self.assertTrue(self.ledger.settle('m','YES'))
        self.assertFalse(self.ledger.settle('m','YES'))
        self.assertEqual(self.ledger.balance('a'),206000)
    def test_loss_and_void(self):
        self.ledger.trade('a','r1','m','NO',1000,500000)
        self.ledger.trade('a','r2','n','NO',1000,500000)
        self.ledger.settle('m','YES')
        self.ledger.settle('n','VOID')
        self.assertEqual(self.ledger.balance('a'),204000)
    def test_conflicting_outcome_rejected(self):
        self.ledger.settle('m','VOID')
        with self.assertRaises(ValueError):self.ledger.settle('m','YES')
    def test_concurrent_double_submit(self):
        results=[]; errors=[]
        def f():
            try:results.append(self.ledger.trade('a','same','m','YES',1000,500000))
            except Exception as e:errors.append(e)
        threads=[threading.Thread(target=f) for _ in range(12)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertFalse(errors, errors)
        self.assertEqual(sum(results),1)
        self.assertEqual(self.ledger.balance('a'),204000)
    def test_ledger_conserves_balance(self):
        for i in range(20):self.ledger.trade('a',str(i),'m'+str(i%3),'YES',100,400000)
        for i in range(3):self.ledger.settle('m'+str(i),'YES' if i%2 else 'VOID')
        self.assertEqual(self.ledger.reconcile(),0)
    def test_reject_subcent_fraction(self):
        with self.assertRaises(ValueError):units('1.001')
    def test_exact_two_decimal_amount(self):self.assertEqual(units('1.25'),125)
    def test_rounding(self):self.assertEqual(gross_return(100,300000),333)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--self-test',action='store_true')
    args=ap.parse_args()
    if not args.self_test:ap.error('Use --self-test; prototype exposes no live write path')
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(LedgerTests))
    raise SystemExit(0 if result.wasSuccessful() else 1)
if __name__=='__main__':main()
