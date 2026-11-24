#!/usr/bin/env python3
"""Subway Exchange v0.4: 6-line station stop / departure pilot (RESEARCH ONLY).

The MTA VehiclePosition.timestamp is the time of last detected movement, NOT
an observed arrival or departure clock. Feed StopTimeUpdate times are forecasts.
A stop rolling off TripUpdate is a *departure proxy*, never ground truth.
No event produced here is eligible for ticket settlement.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import statistics
import sys
import unittest

from arrival_candidates import MAX_CONTIGUOUS_GAP_SEC, _build_fixture, decode_snapshot, load_from_r2
from arrival_reconcile import _clean, _extract

VERSION = '0.4'
STATIONS = {'630':'51 St', '631':'Grand Central–42 St', '632':'33 St', '633':'28 St'}
ROUTES = {'6'}


def _quantiles(nums):
    if not nums: return {'count': 0, 'min': None, 'median': None, 'p90': None, 'max': None}
    x=sorted(nums)
    return {'count':len(x), 'min':x[0], 'median':statistics.median(x),
            'p90':x[int((len(x)-1)*.9)], 'max':x[-1]}


def _is_pilot(stop, route):
    return route in ROUTES and isinstance(stop,str) and len(stop)>=4 and stop[:3] in STATIONS and stop[-1:] in ('N','S')


def _pair_gap(a,b):
    return max(0, a['start']-b['end'], b['start']-a['end'])


def run_pilot(observations, failures=0, scope=None):
    clean, duplicates, rollovers, transitions, conflicts, gaps = _extract(observations)
    clean.sort(key=lambda o:o['source_ts'])
    rollovers=[r for r in rollovers if _is_pilot(r['stop_id'],r['route_id'])]
    transitions=[v for v in transitions if _is_pilot(v['stop_id'],v['route_id'])]
    conflicts=[v for v in conflicts if _is_pilot(v['stop_id'],v['route_id'])]
    # Observe explicitly STATIONARY statuses, not just transition edges.
    stopped=defaultdict(list)
    stale_status=0
    raw_stop_records=0
    for snap in clean:
        for trip,v in snap['vehicles'].items():
            stop=v.get('stop_id')
            if not _is_pilot(stop,v.get('trip',{}).get('route_id')) or v.get('status') != 1:
                continue
            raw_stop_records+=1
            ts=v.get('timestamp')
            # Vehicle timestamp is movement age; don't reject a sustained stop merely because stale.
            if ts is None or ts > snap['source_ts']+10 or snap['source_ts']-ts > 120:
                stale_status+=1
            stopped[(trip,stop)].append({'feed_time':snap['source_ts'], 'movement_timestamp':ts,
                                        'vehicle_id':v.get('vehicle_id')})
    stop_edges=defaultdict(list)
    for v in transitions:
        stop_edges[(v['trip_key'],v['stop_id'])].append(v)
    depart_edges=defaultdict(list)
    for r in rollovers:
        depart_edges[(r['trip_key'],r['stop_id'])].append(r)
    events=[]
    # A trip/stop can reappear or roll over more than once; keep episodes separate.
    # Match closest preceding stopped evidence to each distinct departure proxy.
    for (trip, stop), departures in sorted(depart_edges.items()):
        observations_at_stop=sorted(stopped.get((trip,stop),[]),key=lambda p:p['feed_time'])
        arrival_edges=sorted(stop_edges.get((trip,stop),[]),key=lambda p:p['start'])
        previous_departure_end=None
        for dep in sorted(departures,key=lambda d:d['start']):
            # Seek stopped observations within the past 4min, never from an earlier episode.
            recent=[s for s in observations_at_stop if dep['start']-240 <= s['feed_time'] <= dep['end'] and
                    (previous_departure_end is None or s['feed_time'] > previous_departure_end)]
            arrivals=[a for a in arrival_edges if a['start'] <= dep['end'] and
                      a['end'] >= dep['start']-240 and
                      (previous_departure_end is None or a['end'] > previous_departure_end)]
            # Use latest arrival transition before the stop rolled off, if any.
            ar=arrivals[-1] if arrivals else None
            stop_observed=bool(recent)
            first_stopped=recent[0]['feed_time'] if recent else None
            last_stopped=recent[-1]['feed_time'] if recent else None
            ids={x['vehicle_id'] for x in recent if x['vehicle_id']}
            if ar and ar.get('vehicle_id'): ids.add(ar['vehicle_id'])
            if dep.get('vehicle_id'): ids.add(dep['vehicle_id'])
            identity_conflict=len(ids)>1
            # Departure proxy is bounded by two source observations, not vehicle movement timestamp.
            # Strict elapsed range from first observed stopped until confirmed stop rollover.
            observed_span=(dep['end']-first_stopped) if stop_observed else None
            # A one-minute polling loop cannot establish dwell time if both transitions occur between reads.
            lower_dwell=max(0,dep['start']-first_stopped) if stop_observed else None
            upper_dwell=dep['end']-(ar['start'] if ar else first_stopped) if stop_observed else None
            grade=('identity_conflict' if identity_conflict else
                   'stopped_then_departure_proxy' if ar and stop_observed else
                   'stopped_status_plus_departure_proxy' if stop_observed else
                   'departure_proxy_only')
            events.append({'trip_key':trip,'route_id':dep['route_id'],'stop_id':stop,
                           'station':STATIONS[stop[:3]],'direction':stop[-1],
                           'evidence_class':grade,'first_stopped_observation_unix':first_stopped,
                           'last_stopped_observation_unix':last_stopped,
                           'stopped_transition_interval':{'start':ar['start'],'end':ar['end']} if ar else None,
                           'departure_proxy_interval':{'start':dep['start'],'end':dep['end']},
                           'departure_window_seconds':dep['end']-dep['start'],
                           'first_stopped_to_departure_upper_elapsed_seconds':observed_span,
                           'dwell_possible_seconds':{'lower':lower_dwell,'upper':upper_dwell} if stop_observed and not identity_conflict else None,
                           'last_arrival_prediction_unix':dep.get('last_eta'),
                           'vehicle_movement_timestamps_not_arrival_timestamps':sorted({x['movement_timestamp'] for x in recent if x['movement_timestamp'] is not None}),
                           'verified_arrival':False,'verified_departure':False})
            previous_departure_end=dep['end']
    # Stop/status transitions without a downstream rollover, useful coverage warning.
    matched_keys={(e['trip_key'],e['stop_id']) for e in events}
    status_without_rollover=sum((key not in matched_keys) for key in stopped)
    classes=Counter(e['evidence_class'] for e in events)
    station_counts=defaultdict(Counter)
    by_route=Counter()
    for e in events:
        station_counts[(e['station'],e['direction'])][e['evidence_class']]+=1
        by_route[e['route_id']]+=1
    pairs=[e for e in events if e['dwell_possible_seconds'] is not None]
    result={'report_type':'RESEARCH_ONLY_NOT_FOR_SETTLEMENT','version':VERSION,
            'generated_at_utc':datetime.now(timezone.utc).isoformat(),
            'feed':'1234567','routes':sorted(ROUTES),'station_ids':STATIONS,
            'snapshot_count':len(clean),'duplicate_source_timestamps':duplicates,
            'skipped_or_invalid_files':failures,'large_gap_count':len(gaps),
            'source_time_start_unix':clean[0]['source_ts'] if clean else None,
            'source_time_end_unix':clean[-1]['source_ts'] if clean else None,
            'raw_stopped_at_status_records':raw_stop_records,
            'stopped_at_records_with_old_or_invalid_movement_timestamps':stale_status,
            'status_trip_stop_pairs_without_departure_proxy':status_without_rollover,
            'raw_pilot_stop_rollovers':len(rollovers),
            'raw_pilot_stopped_transitions':len(transitions),
            'raw_pilot_identity_conflicts':len(conflicts),
            'departure_candidate_count':len(events),
            'evidence_classes':dict(sorted(classes.items())),
            'stopped_plus_departure_pair_count':len(pairs),
            'departure_window_seconds':_quantiles([e['departure_window_seconds'] for e in events]),
            'observed_first_stop_to_departure_elapsed_seconds':_quantiles([e['first_stopped_to_departure_upper_elapsed_seconds'] for e in pairs]),
            'dwell_possible_lower_seconds':_quantiles([e['dwell_possible_seconds']['lower'] for e in pairs]),
            'dwell_possible_upper_seconds':_quantiles([e['dwell_possible_seconds']['upper'] for e in pairs]),
            'station_direction_counts':[{'station':station,'direction':direction,**dict(c)}
                                      for (station,direction),c in sorted(station_counts.items())],
            'events_sample':events[:100], 'all_event_count':len(events),
            'verified_arrivals':0,'verified_departures':0,
            'limitations':[
              'VehiclePosition.timestamp is last detected train movement; not observed arrival/departure.',
              'StopTimeUpdate arrival/departure fields are predictions, not physical observations.',
              'A stop rollover is a departure proxy; it may also reflect skips, reroutes, feed revisions.',
              '60-second polling frequently misses station stops lasting less than a minute.',
              'Dwell possible ranges are bounds/heuristics, not measured dwell distributions.',
              'No independent observational ground truth. Never settle tickets with this report.'
            ]}
    if scope: result['r2_read_scope']=scope
    return result


class PilotTests(unittest.TestCase):
    def obs(self,t,stops,vehicle=None,trip_id='T',route='6'):
        return decode_snapshot(_build_fixture(t,stops,vehicle=vehicle,trip_id=trip_id,route=route))
    def test_arrive_dwell_depart(self):
        obs=[self.obs(1000,[(1,'633N',1030),(2,'632N',1120)],('633N',2,1000)),
             self.obs(1060,[(1,'633N',1030),(2,'632N',1120)],('633N',1,1060)),
             self.obs(1120,[(2,'632N',1200)],('632N',2,1120))]
        r=run_pilot(obs)
        self.assertEqual(r['departure_candidate_count'],1)
        self.assertEqual(r['stopped_plus_departure_pair_count'],1)
        self.assertEqual(r['verified_arrivals'],0)
        self.assertEqual(r['verified_departures'],0)
        self.assertEqual(r['evidence_classes']['stopped_then_departure_proxy'],1)
    def test_missing_stop_does_not_invent_dwell(self):
        obs=[self.obs(1000,[(1,'633N',1030),(2,'632N',1120)]),
             self.obs(1060,[(2,'632N',1120)])]
        r=run_pilot(obs)
        self.assertEqual(r['departure_candidate_count'],1)
        self.assertEqual(r['stopped_plus_departure_pair_count'],0)
    def test_excludes_wrong_line(self):
        obs=[self.obs(1000,[(1,'633N',1030),(2,'632N',1120)],route='4'),
             self.obs(1060,[(2,'632N',1120)],route='4')]
        self.assertEqual(run_pilot(obs)['departure_candidate_count'],0)
    def test_excludes_wrong_station(self):
        obs=[self.obs(1000,[(1,'640N',1030),(2,'639N',1120)]),
             self.obs(1060,[(2,'639N',1120)])]
        self.assertEqual(run_pilot(obs)['departure_candidate_count'],0)
    def test_duplicate_source_removed(self):
        a=self.obs(1000,[(1,'633N',1030),(2,'632N',1120)])
        b=self.obs(1060,[(2,'632N',1120)])
        r=run_pilot([a,a,b])
        self.assertEqual(r['departure_candidate_count'],1)
        self.assertEqual(r['duplicate_source_timestamps'],1)
    def test_large_gap_excluded(self):
        a=self.obs(1000,[(1,'633N',1030),(2,'632N',1120)])
        b=self.obs(1150,[(2,'632N',1120)])
        self.assertEqual(run_pilot([a,b])['departure_candidate_count'],0)
    def test_old_movement_timestamp_not_arrival(self):
        obs=[self.obs(1000,[(1,'633N',1030),(2,'632N',1120)],('633N',2,1000)),
             self.obs(1060,[(1,'633N',1030),(2,'632N',1120)],('633N',1,1000)),
             self.obs(1120,[(2,'632N',1200)],('632N',2,1120))]
        r=run_pilot(obs)
        self.assertEqual(r['verified_arrivals'],0)
        self.assertGreaterEqual(r['raw_stopped_at_status_records'],1)
    def test_stopped_without_rollover_counted(self):
        obs=[self.obs(1000,[(1,'633N',1030),(2,'632N',1120)],('633N',2,1000)),
             self.obs(1060,[(1,'633N',1030),(2,'632N',1120)],('633N',1,1060))]
        r=run_pilot(obs)
        self.assertEqual(r['status_trip_stop_pairs_without_departure_proxy'],1)
    def test_no_spurious_departure_on_no_stop_change(self):
        obs=[self.obs(1000,[(1,'633N',1030),(2,'632N',1120)],('633N',1,1000)),
             self.obs(1060,[(1,'633N',1030),(2,'632N',1120)],('633N',1,1060))]
        self.assertEqual(run_pilot(obs)['departure_candidate_count'],0)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--minutes',type=int,default=90)
    p.add_argument('--max-snapshots',type=int,default=120)
    p.add_argument('--out',default='arrival-departure-pilot.json')
    args=p.parse_args()
    if args.self_test:
        suite=unittest.defaultTestLoader.loadTestsFromTestCase(PilotTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    if not 2<=args.minutes<=2880 or not 2<=args.max_snapshots<=2880:
        p.error('minutes and max-snapshots must be 2-2880')
    observations,problems,scope=load_from_r2(args.minutes,args.max_snapshots)
    report=run_pilot(observations,len(problems),scope)
    report['problems_sample']=problems[:25]
    Path(args.out).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('events_sample','station_direction_counts','problems_sample')},indent=2))
    return 0 if observations else 2

if __name__=='__main__':sys.exit(main())
