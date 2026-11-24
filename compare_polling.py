#!/usr/bin/env python3
"""Subway Exchange v0.5: paired 30s-vs-60s arrival/departure study.

RESEARCH ONLY. Reads the 2-hour 30-second pilot from private R2. Compares
*the same pilot feed* to a counterfactual 60-second subset (first sample in
successive minute slots). This controls for time of day and route activity;
these are not independent measurements of physical train movements.

Use after the pilot has accumulated observations:
  python compare_polling.py --out pilot30-comparison.json
  python compare_polling.py --self-test

Needs boto3, arrival_candidates.py, arrival_reconcile.py, and
arrival_departure_pilot.py from the existing development branch.
"""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import statistics
import sys
import unittest

from arrival_candidates import MAX_READ_BYTES, MAX_FRESHNESS_SEC, decode_snapshot, _build_fixture
from arrival_departure_pilot import run_pilot

PILOT_PREFIX = 'subway-exchange/high-frequency/pilot30/v1/'
CONTROL_KEY = 'subway-exchange/pilot-control/line6-30s-v1.json'
VERSION = '0.5'


def _percentiles(values):
    if not values:
        return {'count': 0, 'min': None, 'median': None, 'p90': None, 'max': None}
    xs = sorted(values)
    return {'count': len(xs), 'min': xs[0], 'median': statistics.median(xs),
            'p90': xs[int((len(xs) - 1) * .9)], 'max': xs[-1]}


def _r2_client():
    import boto3
    required = ('R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET')
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        raise RuntimeError('Missing R2 environment variables: ' + ', '.join(missing))
    return boto3.client('s3', endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                        region_name='auto', aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'])


def _read_json(client, bucket, key):
    return json.loads(client.get_object(Bucket=bucket, Key=key)['Body'].read())


def read_pilot(client, bucket, max_health=400):
    """Read pilot archive; never depend on now-window (2d retention applies)."""
    pager = client.get_paginator('list_objects_v2')
    keys = []
    for page in pager.paginate(Bucket=bucket, Prefix=PILOT_PREFIX):
        keys.extend(x['Key'] for x in page.get('Contents', []) if x['Key'].endswith('.health.json'))
    keys.sort()
    if len(keys) > max_health:
        raise ValueError(f'{len(keys)} health files exceeds configured safety cap {max_health}; use --max-health')
    records, problems, statuses = [], [], Counter()
    for key in keys:
        try:
            health = _read_json(client, bucket, key)
            statuses[health.get('status', 'unknown')] += 1
            if health.get('status') != 'ok' or not health.get('raw_archive'):
                problems.append({'health_key': key, 'reason': 'health not ok / raw missing'})
                continue
            collected = datetime.fromisoformat(health['collected_at'].replace('Z', '+00:00')).timestamp()
            source = health.get('feed_timestamp_unix')
            if source is None or abs(source - collected) > MAX_FRESHNESS_SEC:
                problems.append({'health_key': key, 'reason': 'missing/stale source timestamp'})
                continue
            resp = client.get_object(Bucket=bucket, Key=health['raw_archive'])
            raw = resp['Body'].read(MAX_READ_BYTES + 1)
            if not raw or len(raw) > MAX_READ_BYTES:
                raise ValueError('empty/oversized protobuf')
            obs = decode_snapshot(raw)
            if obs['source_ts'] != source:
                raise ValueError('health and protobuf timestamps differ')
            obs['sha256'] = hashlib.sha256(raw).hexdigest()
            records.append({'collected_at_unix': collected, 'source_ts': source,
                            'key': health['raw_archive'], 'observation': obs})
        except Exception as exc:
            problems.append({'health_key': key, 'reason': f'{type(exc).__name__}: {str(exc)[:120]}'})
    records.sort(key=lambda x: (x['collected_at_unix'], x['key']))
    try:
        control = _read_json(client, bucket, CONTROL_KEY)
    except client.exceptions.NoSuchKey:
        control = None
    return records, problems, dict(statuses), control, len(keys)


def downsample_60(records):
    """First sample per minute slot anchored to first successful sample.

    Select by collection time, not MTA source time; source time is an independent
    measurement used to identify repeated feed versions.
    """
    if not records:
        return []
    anchor = records[0]['collected_at_unix']
    picked, seen_slots = [], set()
    for record in records:
        slot = int((record['collected_at_unix'] - anchor) // 60)
        if slot not in seen_slots:
            picked.append(record)
            seen_slots.add(slot)
    return picked


def distinct_source_observations(records):
    """Remove repeated source timestamps, not repeated collection timestamps."""
    seen, unique, dup_count = set(), [], 0
    for r in records:
        s = r['source_ts']
        if s in seen:
            dup_count += 1
        else:
            seen.add(s)
            unique.append(r['observation'])
    unique.sort(key=lambda o: o['source_ts'])
    return unique, dup_count


def report(records, problems=None, health_statuses=None, control=None, health_count=None):
    problems = problems or []
    health_statuses = health_statuses or {}
    selected = downsample_60(records)
    obs30, repeated30 = distinct_source_observations(records)
    obs60, repeated60 = distinct_source_observations(selected)
    results30 = run_pilot(obs30)
    results60 = run_pilot(obs60)
    collection_gaps = [round(b['collected_at_unix'] - a['collected_at_unix'], 2)
                       for a, b in zip(records, records[1:])]
    source_gaps30 = [b['source_ts'] - a['source_ts'] for a, b in zip(
        sorted(obs30, key=lambda x: x['source_ts']),
        sorted(obs30, key=lambda x: x['source_ts'])[1:])]
    source_gaps60 = [b['source_ts'] - a['source_ts'] for a, b in zip(
        sorted(obs60, key=lambda x: x['source_ts']),
        sorted(obs60, key=lambda x: x['source_ts'])[1:])]
    started_ms = control.get('started_at_ms') if isinstance(control, dict) else None
    duration_ms = control.get('duration_ms') if isinstance(control, dict) else None
    end_time = records[-1]['collected_at_unix'] if records else None
    elapsed_min = ((end_time * 1000 - started_ms) / 60000
                   if end_time is not None and isinstance(started_ms, (int, float)) else None)
    started = (datetime.fromtimestamp(started_ms / 1000, timezone.utc).isoformat()
               if isinstance(started_ms, (int, float)) else None)
    deadline = (datetime.fromtimestamp((started_ms + duration_ms) / 1000, timezone.utc).isoformat()
                if isinstance(started_ms, (int, float)) and isinstance(duration_ms, (int, float)) else None)

    def summary(r):
        return {'source_snapshots': r['snapshot_count'],
                'departure_candidates': r['departure_candidate_count'],
                'stopped_departure_matches': r['stopped_plus_departure_pair_count'],
                'matched_share_of_departure_candidates_pct': round(
                    100*r['stopped_plus_departure_pair_count']/r['departure_candidate_count'],1)
                    if r['departure_candidate_count'] else None,
                'departure_window_seconds': r['departure_window_seconds'],
                'stopped_to_departure_elapsed_seconds': r['observed_first_stop_to_departure_elapsed_seconds'],
                'evidence_classes': r['evidence_classes'],
                'station_direction_counts': r['station_direction_counts'],
                'events_sample': r['events_sample'][:15],
                'verified_arrivals': 0, 'verified_departures': 0}

    report = {
        'research_version': VERSION, 'report_type': 'RESEARCH_ONLY_NOT_FOR_SETTLEMENT',
        'generated_at_utc': datetime.now(timezone.utc).isoformat(),
        'study': 'same-feed 30-second vs counterfactual 60-second subsampling',
        'pilot_prefix': PILOT_PREFIX, 'control_key': CONTROL_KEY,
        'health_objects_seen': len(records) + len(problems) if health_count is None else health_count,
        'health_status_counts': health_statuses, 'invalid_or_skipped_health': len(problems),
        'problems_sample': problems[:25],
        'first_collected_at_utc': datetime.fromtimestamp(records[0]['collected_at_unix'], timezone.utc).isoformat() if records else None,
        'last_collected_at_utc': datetime.fromtimestamp(records[-1]['collected_at_unix'], timezone.utc).isoformat() if records else None,
        'pilot_started_at_utc': started, 'pilot_deadline_utc': deadline,
        'pilot_elapsed_at_last_sample_minutes': round(elapsed_min, 1) if elapsed_min is not None else None,
        'pilot_has_reached_deadline_at_report_time': bool(
            isinstance(started_ms,(int,float)) and isinstance(duration_ms,(int,float)) and
            datetime.now(timezone.utc).timestamp()*1000 >= started_ms + duration_ms),
        'collection_interval_seconds': _percentiles(collection_gaps),
        'raw_records_30s': len(records), 'selected_records_60s': len(selected),
        'repeated_feed_timestamps_30s': repeated30,
        'repeated_feed_timestamps_60s': repeated60,
        'distinct_source_snapshots_30s': len(obs30),
        'distinct_source_snapshots_60s': len(obs60),
        'comparison_ready': len(obs30) >= 20 and len(obs60) >= 10,
        'comparison_stage': ('enough_for_preliminary_comparison' if len(obs30) >= 20 and len(obs60) >= 10
                             else 'insufficient_data_check_pilot_cron_and_rerun'),
        'source_update_spacing_30s': _percentiles(source_gaps30),
        'source_update_spacing_60s': _percentiles(source_gaps60),
        'seconds_with_no_new_feed_content': None,  # requires byte/semantic comparison; do not infer from timestamps alone
        'results_30s': summary(results30), 'results_60s_counterfactual': summary(results60),
        'validation': 'No independent ground truth; no accuracy or dwell-time claim permitted.',
        'limitations': [
            'This counterfactual compares two samples of the same 30-second capture series, not a randomized controlled trial.',
            'Raw capture interval is not equivalent to GTFS source-update cadence; feed may repeat timestamps.',
            'Departure rollovers and STOPPED_AT are feed-derived proxies; neither confirms physical arrival/departure.',
            'Different observed counts reflect detection sensitivity and may include false positives; no ticket settlement.',
            'Two-day R2 lifecycle retention applies to pilot data. Run before it expires.'
        ], 'settlement_enabled': False,
    }
    return report


class CompareTests(unittest.TestCase):
    @staticmethod
    def rec(t, stops, vehicle=None, collected_offset=0):
        o = decode_snapshot(_build_fixture(t, stops, vehicle=vehicle))
        return {'collected_at_unix': float(t+collected_offset), 'source_ts':t,
                'key': f'fixture-{t}', 'observation':o}

    def test_downsample_first_per_minute(self):
        arr=[self.rec(1000,[(1,'633N',1040),(2,'632N',1120)]),
             self.rec(1030,[(1,'633N',1040),(2,'632N',1120)]),
             self.rec(1060,[(1,'633N',1040),(2,'632N',1120)])]
        self.assertEqual([r['source_ts'] for r in downsample_60(arr)],[1000,1060])

    def test_feed_timestamp_dedup(self):
        a=self.rec(1000,[(1,'633N',1040),(2,'632N',1120)])
        b={**a,'collected_at_unix':1030,'key':'later'}
        u,d=distinct_source_observations([a,b])
        self.assertEqual(len(u),1)
        self.assertEqual(d,1)

    def test_thirty_second_observation_can_detect_missed_stop(self):
        a=self.rec(1000,[(1,'633N',1040),(2,'632N',1120)],('633N',2,1000))
        b=self.rec(1030,[(1,'633N',1040),(2,'632N',1120)],('633N',1,1030))
        c=self.rec(1060,[(2,'632N',1120)],('632N',2,1060))
        r=report([a,b,c])
        self.assertEqual(r['results_30s']['stopped_departure_matches'],1)
        self.assertEqual(r['results_60s_counterfactual']['stopped_departure_matches'],0)
        self.assertEqual(r['results_30s']['verified_arrivals'],0)

    def test_no_snapshot_means_no_claim(self):
        r=report([])
        self.assertEqual(r['raw_records_30s'],0)
        self.assertIsNone(r['results_30s']['matched_share_of_departure_candidates_pct'])

    def test_does_not_fabricate_events(self):
        a=self.rec(1000,[(1,'633N',1040),(2,'632N',1120)])
        b=self.rec(1030,[(1,'633N',1040),(2,'632N',1120)])
        self.assertEqual(report([a,b])['results_30s']['departure_candidates'],0)

    def test_report_has_no_settlement(self):
        a=self.rec(1000,[(1,'633N',1040),(2,'632N',1120)])
        self.assertFalse(report([a])['settlement_enabled'])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',default='pilot30-comparison.json')
    parser.add_argument('--max-health',type=int,default=400)
    parser.add_argument('--self-test',action='store_true')
    args=parser.parse_args()
    if args.self_test:
        test=unittest.defaultTestLoader.loadTestsFromTestCase(CompareTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(test).wasSuccessful() else 1
    if not 1<=args.max_health<=1000: parser.error('max-health must be 1–1000')
    client=_r2_client()
    rows,problems,statuses,control,total=read_pilot(client, os.environ['R2_BUCKET'], args.max_health)
    result=report(rows,problems,statuses,control,total)
    Path(args.out).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k not in ('problems_sample',)},indent=2)[:10000])
    # Even if Cron has not started, save a truthful diagnostic report rather than
    # presenting a workflow failure as a code failure. Check comparison_ready.
    return 0

if __name__=='__main__':
    sys.exit(main())


