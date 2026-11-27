import unittest
from replay import *
K=('6','trip','20261127','')
S='631N'
def frame(t,vehicles=(),seq=10,rel=0,cancel=False):
    return {'source':t,'collected':t,'trips':{K:{'stops':{S:(seq,rel,1400)},'vehicles':list(vehicles),'cancel':cancel,'conflict':False}}}
class ReplayTests(unittest.TestCase):
    def test_early_stop(self): self.assertEqual(label(arrival_bounds([frame(1100,[(S,10,1,1099,'v')])],K,S,1000,1500),1200),'YES')
    def test_late_approach(self): self.assertEqual(label(arrival_bounds([frame(1300,[(S,10,0,1299,'v')])],K,S,1000,1500),1200),'NO')
    def test_late_stop_not_no(self): self.assertEqual(label(arrival_bounds([frame(1300,[(S,10,1,1299,'v')])],K,S,1000,1500),1200),'VOID')
    def test_upstream(self): self.assertEqual(label(arrival_bounds([frame(1300,[('632N',9,1,1299,'v')])],K,S,1000,1500),1200),'NO')
    def test_downstream(self): self.assertEqual(label(arrival_bounds([frame(1100,[('630N',11,2,1099,'v')])],K,S,1000,1500),1200),'YES')
    def test_cancel(self): self.assertEqual(label(arrival_bounds([frame(1100,[(S,10,1,1099,'v')]),frame(1300,cancel=True)],K,S,1000,1500),1200),'VOID')
    def test_eta_alone(self): self.assertEqual(label(arrival_bounds([frame(1100)],K,S,1000,1500),1200),'VOID')
    def test_conflicting_vehicle(self): self.assertEqual(label(arrival_bounds([frame(1100,[(S,10,1,1099,'v')]),frame(1150,[(S,10,1,1149,'w')])],K,S,1000,1500),1200),'VOID')
    def test_future_evidence_excluded(self): self.assertEqual(label(arrival_bounds([frame(1600,[(S,10,0,1599,'v')])],K,S,1000,1500),1200),'VOID')
    def test_equal_deadline(self): self.assertEqual(label((None,1200,False),1200),'YES'); self.assertEqual(label((1200,None,False),1200),'VOID')
    def test_grid(self):
        rs=replay([frame(1000),frame(1350,[(S,10,1,1349,'v')]),frame(2100)]); self.assertEqual(len(rs),33); self.assertEqual(len(summary(rs)),33)
    def test_censored(self): self.assertEqual(replay([frame(1000),frame(1350)]),[])
    def test_bad_proto(self):
        with self.assertRaises(ValueError): fields(b'\x0a\x05\x01')
if __name__=='__main__': unittest.main()
