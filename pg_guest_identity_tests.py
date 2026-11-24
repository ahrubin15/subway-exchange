import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
import psycopg

DSN = os.environ['PG_TEST_DSN']

def initialize(identity):
    with psycopg.connect(DSN) as conn:
        return conn.execute('SELECT internal.initialize_guest(%s)', (identity,)).fetchone()[0]

class GuestIdentityTests(unittest.TestCase):
    def test_concurrent_initialization_and_grant(self):
        identity = uuid.uuid4()
        with ThreadPoolExecutor(max_workers=8) as pool:
            players = list(pool.map(initialize, [identity]*16))
        self.assertEqual(len(set(players)), 1)
        player = players[0]
        with psycopg.connect(DSN) as conn:
            self.assertEqual(conn.execute('SELECT available_minor FROM wallets WHERE player_id=%s', (player,)).fetchone()[0],100000)
            self.assertEqual(conn.execute("SELECT count(*) FROM token_ledger WHERE player_id=%s AND kind='OPENING_GRANT'", (player,)).fetchone()[0],1)
        self.assertEqual(initialize(identity),player)

    def test_distinct_identity(self):
        self.assertNotEqual(initialize(uuid.uuid4()), initialize(uuid.uuid4()))

    def test_null_rejected(self):
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            initialize(None)

    def test_no_public_access(self):
        identity = uuid.uuid4()
        initialize(identity)
        with psycopg.connect(DSN) as conn:
            conn.execute('CREATE ROLE guest_identity_test_client NOLOGIN')
            for statement in [
                'SELECT internal.initialize_guest(%s)',
                'SELECT * FROM public.wallets WHERE player_id=%s',
                'SELECT * FROM public.tickets WHERE player_id=%s',
                'UPDATE public.wallets SET available_minor=999999 WHERE player_id=%s',
            ]:
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    with conn.transaction():
                        conn.execute('SET LOCAL ROLE guest_identity_test_client')
                        conn.execute(statement,(identity,))
            conn.execute('DROP ROLE guest_identity_test_client')

if __name__ == '__main__':
    unittest.main(verbosity=2)
