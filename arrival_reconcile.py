#!/usr/bin/env python3
"""Subway Exchange arrival evidence reconciliation v0.3 — RESEARCH ONLY.

Read-only analysis of 60-second R2 MTA GTFS-RT snapshots. Reconciles
STOPPED_AT transitions with stop-update rollovers across adjacent observations.
No records are verified physical arrivals. NEVER use to settle tickets.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import unittest

from arrival_candidates import (MAX_CONTIGUOUS_GAP_SEC, _build_fixture,
                                decode_snapshot, load_from_r2)

VERSION = '0.3'
MATCH_WINDOW_SECONDS = 180  # permissive correlation window, NOT arrival uncertainty

def _clean(observations):
    unique, dups = [], 0
    for obs in sorted(observations, key=lambda o: (o['source_ts'], o.get('sha256', ''))):
        if unique and unique[-1]['source_ts'] == obs['source_ts']:
            dups += 1
        else:
            unique.append(obs)
    return unique, dups

def _stable_id(a, b):
    x = a.get('vehicle_id') if a else None
    y = b.get('vehicle_id') if b else None
    return not (x and y and x != y)

def _extract(observations):
    """Extract independent signals, preserving both even in the same interval."""
    clean, duplicates = _clean(observations)
    rollovers, vehicles, conflicts, gaps = [], [], [], []
    for a, b in zip(clean, clean[1:]):
        t0, t1 = a['source_ts'], b['source_ts']
        delta = t1 - t0
        if not 0 < delta <= MAX_CONTIGUOUS_GAP_SEC:
            gaps.append({'from': t0, 'to': t1, 'seconds': delta})
            continue
        for trip_key, before in a['trips'].items():
            after = b['trips'].get(trip_key)
            if not after or not before['stops'] or not after['stops']:
                continue
            first = after['stops'][0]
            before_ids = [s['stop_id'] for s in before['stops']]
            after_ids = {s['stop_id'] for s in after['stops']}
            for s in before['stops'][:2]:
                stop = s['stop_id']
                if stop in after_ids or stop == first['stop_id']:
                    continue
                seq, first_seq = s['stop_sequence'], first['stop_sequence']
                if seq is not None and first_seq is not None:
                    if first_seq <= seq:
                        continue
                elif first['stop_id'] not in before_ids or before_ids.index(first['stop_id']) <= before_ids.index(stop):
                    continue
                eta = s['prediction']
                if eta is None or not t0 - 60 <= eta <= t1 + 180:
                    continue
                rollovers.append({'type': 'stop_rollover', 'trip_key': trip_key,
                                  'route_id': before['trip']['route_id'], 'stop_id': stop,
                                  'start': t0, 'end': t1, 'last_eta': eta,
                                  'vehicle_id': before.get('vehicle_id') or after.get('vehicle_id')})
        for trip_key, v in b['vehicles'].items():
            old = a['vehicles'].get(trip_key)
            if not old or v.get('status') != 1 or not v.get('stop_id'):
                continue
            if old.get('status') == 1 and old.get('stop_id') == v['stop_id']:
                continue
            ts = v.get('timestamp')
            if ts is None or not t0 - 10 <= ts <= t1 + 10:
                continue
            record = {'type': 'vehicle_transition', 'trip_key': trip_key,
                      'route_id': v['trip']['route_id'], 'stop_id': v['stop_id'],
                      'start': t0, 'end': t1, 'vehicle_timestamp': ts,
                      'vehicle_id': v.get('vehicle_id') or old.get('vehicle_id')}
            if not _stable_id(old, v):
                conflicts.append({**record, 'conflict': 'vehicle_id_changed_between_snapshots',
                                  'before_vehicle_id': old.get('vehicle_id'), 'after_vehicle_id': v.get('vehicle_id')})
            else:
                vehicles.append(record)
    return clean, duplicates, rollovers, vehicles, conflicts, gaps

def _separation(a, b):
    return max(0, a['start'] - b['end'], b['start'] - a['end'])

def _compatible(a, b):
    return not (a.get('vehicle_id') and b.get('vehicle_id') and a['vehicle_id'] != b['vehicle_id'])

def _bin(n):
    if n <= 15: return '0-15s'
    if n <= 30: return '16-30s'
    if n <= 60: return '31-60s'
    if n <= 90: return '61-90s'
    if n <= 180: return '91-180s'
    return '181s+'

def reconcile(observations, failures=0, scope=None):
    clean, duplicates, rolls, vps, conflicts, gaps = _extract(observations)
    by_key = defaultdict(list)
    for i, s in enumerate(vps):
        by_key[(s['trip_key'], s['stop_id'])].append((i, s))
    # Greedy one-to-one, closest matching pair, deterministic tie breakers.
    pairs = []
    for ri, roll in enumerate(rolls):
        for vi, vp in by_key.get((roll['trip_key'], roll['stop_id']), []):
            dist = _separation(roll, vp)
            if dist <= MATCH_WINDOW_SECONDS and _compatible(roll, vp):
                pairs.append((dist, abs(roll['end'] - vp['end']), ri, vi))
    used_roll, used_vp, matches = set(), set(), []
    for dist, _, ri, vi in sorted(pairs):
        if ri not in used_roll and vi not in used_vp:
            used_roll.add(ri); used_vp.add(vi)
            matches.append((ri, vi, dist))
    events = []
    for ri, vi, dist in matches:
        r, v = rolls[ri], vps[vi]
        events.append(_event([r, v], 'corroborated_two_feed_signals', dist))
    for i, r in enumerate(rolls):
        if i not in used_roll: events.append(_event([r], 'stop_rollover_only', None))
    for i, v in enumerate(vps):
        if i not in used_vp: events.append(_event([v], 'vehicle_transition_only', None))
    for c in conflicts:
        events.append(_event([c], 'identity_conflict', None))
    events.sort(key=lambda e: (e['window_start_unix'], e['trip_key'], e['stop_id'], e['evidence_class']))
    counts = Counter(e['evidence_class'] for e in events)
    bins = Counter(_bin(e['window_seconds']) for e in events)
    by_route, by_station = defaultdict(Counter), defaultdict(Counter)
    for e in events:
        by_route[e['route_id']]['total'] += 1
        by_route[e['route_id']][e['evidence_class']] += 1
        by_station[(e['route_id'], e['stop_id'])]['total'] += 1
        by_station[(e['route_id'], e['stop_id'])][e['evidence_class']] += 1
    station_rows = [dict(route_id=route, stop_id=stop, **dict(c)) for (route, stop), c in by_station.items()]
    station_rows.sort(key=lambda row: (-row.get('corroborated_two_feed_signals', 0), -row['total'], row['route_id'], row['stop_id']))
    result = {
        'report_type': 'RESEARCH_ONLY_NOT_FOR_SETTLEMENT', 'research_version': VERSION,
        'generated_at_utc': datetime.now(timezone.utc).isoformat(), 'feed': '1234567',
        'snapshot_count': len(clean), 'duplicate_source_timestamps': duplicates,
        'skipped_or_invalid_files': failures, 'large_gaps': gaps[:25], 'large_gap_count': len(gaps),
        'matching_window_seconds': MATCH_WINDOW_SECONDS,
        'raw_signal_counts': {'stop_rollovers': len(rolls), 'vehicle_transitions': len(vps), 'identity_conflicts': len(conflicts)},
        'reconciled_event_count': len(events), 'matched_pairs': len(matches),
        'evidence_classes': {k: counts[k] for k in ('corroborated_two_feed_signals', 'stop_rollover_only', 'vehicle_transition_only', 'identity_conflict')},
        'matched_pairs_same_snapshot_interval': sum(rolls[r]['start'] == vps[v]['start'] and rolls[r]['end'] == vps[v]['end'] for r,v,_ in matches),
        'matched_pairs_across_intervals': sum(not (rolls[r]['start'] == vps[v]['start'] and rolls[r]['end'] == vps[v]['end']) for r,v,_ in matches),
        'corroborated_share_of_events_pct': round(100 * len(matches) / len(events), 2) if events else None,
        'window_distribution': {k: bins[k] for k in ('0-15s','16-30s','31-60s','61-90s','91-180s','181s+')},
        'by_route': {k: dict(v) for k, v in sorted(by_route.items())},
        'by_station': station_rows, 'event_detail_sample': events[:100],
        'full_event_count': len(events), 'verified_arrivals': 0,
        'caveat': ('Both signals derive from the same MTA GTFS-RT feed and are not independent ground truth. '
                   'Correlated signals may describe a passage or a feed revision, not an exact actual arrival. '
                   'Matching-window length is not arrival-time accuracy. Do not settle tickets from this report.'),
    }
    if scope: result['r2_read_scope'] = scope
    return result

def _event(signals, classification, gap):
    a = signals[0]
    start = min(s['start'] for s in signals)
    end = max(s['end'] for s in signals)
    return {'trip_key': a['trip_key'], 'route_id': a['route_id'], 'stop_id': a['stop_id'],
            'window_start_unix': start, 'window_end_unix': end, 'window_seconds': end - start,
            'signal_interval_gap_seconds': gap, 'evidence_class': classification,
            'signals': signals, 'verified_arrival': False}

class ReconcileTests(unittest.TestCase):
    def obs(self, t, stops, vehicle=None, trip_id='T', route='6'):
        return decode_snapshot(_build_fixture(t, stops, vehicle=vehicle, trip_id=trip_id, route=route))
    def test_same_interval_is_merged(self):
        a=self.obs(1000,[(1,'631N',1040),(2,'630N',1140)],('631N',2,1000))
        b=self.obs(1060,[(2,'630N',1140)],('631N',1,1060))
        r=reconcile([a,b]); self.assertEqual(r['matched_pairs'],1)
        self.assertEqual(r['reconciled_event_count'],1)
        self.assertEqual(r['matched_pairs_same_snapshot_interval'],1)
    def test_delayed_rollover_is_merged(self):
        a=self.obs(1000,[(1,'631N',1040),(2,'630N',1140)],('631N',2,1000))
        b=self.obs(1060,[(1,'631N',1040),(2,'630N',1140)],('631N',1,1060))
        c=self.obs(1120,[(2,'630N',1140)],('630N',2,1120))
        r=reconcile([a,b,c]); self.assertEqual(r['matched_pairs'],1)
        self.assertEqual(r['matched_pairs_across_intervals'],1)
    def test_no_cross_trip_match(self):
        a=self.obs(1000,[(1,'631N',1040),(2,'630N',1140)],('631N',2,1000),trip_id='A')
        b=self.obs(1060,[(2,'630N',1140)],('631N',1,1060),trip_id='B')
        self.assertEqual(reconcile([a,b])['matched_pairs'],0)
    def test_no_cross_station_match(self):
        a=self.obs(1000,[(1,'631N',1040),(2,'630N',1140)],('630N',2,1000))
        b=self.obs(1060,[(2,'630N',1140)],('630N',1,1060))
        r=reconcile([a,b]); self.assertEqual(r['matched_pairs'],0)
    def test_stale_vehicle_timestamp_rejected(self):
        a=self.obs(1000,[(1,'631N',1040),(2,'630N',1140)],('631N',2,1000))
        b=self.obs(1060,[(2,'630N',1140)],('631N',1,100))
        r=reconcile([a,b]); self.assertEqual(r['matched_pairs'],0)
    def test_gap_prevents_signal(self):
        a=self.obs(1000,[(1,'631N',1040),(2,'630N',1140)],('631N',2,1000))
        b=self.obs(1140,[(2,'630N',1140)],('631N',1,1140))
        r=reconcile([a,b]); self.assertEqual(r['reconciled_event_count'],0)
    def test_duplicate_snapshot_has_no_duplicate_signal(self):
        a=self.obs(1000,[(1,'631N',1040),(2,'630N',1140)],('631N',2,1000))
        b=self.obs(1060,[(2,'630N',1140)],('631N',1,1060))
        r=reconcile([a,a,b]); self.assertEqual(r['matched_pairs'],1)
        self.assertEqual(r['duplicate_source_timestamps'],1)
    def test_expired_match_window_no_merge(self):
        # Long delayed stop rollover beyond 180s; ETA still plausible.
        a=self.obs(1000,[(1,'631N',1040),(2,'630N',1500)],('631N',2,1000))
        b=self.obs(1060,[(1,'631N',1040),(2,'630N',1500)],('631N',1,1060))
        c=self.obs(1120,[(1,'631N',1040),(2,'630N',1500)],('630N',2,1120))
        d=self.obs(1180,[(1,'631N',1180),(2,'630N',1500)],('630N',2,1180))
        e=self.obs(1240,[(1,'631N',1240),(2,'630N',1500)],('630N',2,1240))
        f=self.obs(1300,[(1,'631N',1300),(2,'630N',1500)],('630N',2,1300))
        g=self.obs(1360,[(2,'630N',1500)],('630N',2,1360))
        r=reconcile([a,b,c,d,e,f,g]); self.assertEqual(r['matched_pairs'],0)
    def test_no_settlement(self):
        a=self.obs(1000,[(1,'631N',1040),(2,'630N',1140)],('631N',2,1000))
        b=self.obs(1060,[(2,'630N',1140)],('631N',1,1060))
        r=reconcile([a,b]); self.assertEqual(r['verified_arrivals'],0)
        self.assertTrue(all(not e['verified_arrival'] for e in r['event_detail_sample']))
    def test_counts_reconcile(self):
        a=self.obs(1000,[(1,'631N',1040),(2,'630N',1140)],('631N',2,1000))
        b=self.obs(1060,[(2,'630N',1140)],('631N',1,1060))
        r=reconcile([a,b]); self.assertEqual(sum(r['evidence_classes'].values()),r['reconciled_event_count'])
        self.assertEqual(sum(r['window_distribution'].values()),r['reconciled_event_count'])

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--minutes',type=int,default=90)
    p.add_argument('--max-snapshots',type=int,default=120)
    p.add_argument('--out',default='arrival-reconciliation.json')
    a=p.parse_args()
    if a.self_test:
        suite=unittest.defaultTestLoader.loadTestsFromTestCase(ReconcileTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    if not 2<=a.minutes<=2880 or not 2<=a.max_snapshots<=2880: p.error('minutes and max-snapshots must be 2–2880')
    obs, problems, scope=load_from_r2(a.minutes,a.max_snapshots)
    report=reconcile(obs,len(problems),scope)
    report['problems_sample']=problems[:25]
    Path(a.out).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('by_station','event_detail_sample','large_gaps','problems_sample')},indent=2))
    return 0 if obs else 2

if __name__=='__main__': sys.exit(main())
