#!/usr/bin/env python3
"""Subway Exchange — Arrival evidence research v0.2 (NO ticket settlement).

Reads existing 60-second MTA snapshots from private Cloudflare R2 using
arrival_candidates.py's read-only loader; classifies and audits *candidate*
station passages using source-time continuity and independent vehicle signals.
It cannot certify a train's real arrival timestamp or predict 10–15s accuracy.

  python arrival_evidence.py --self-test
  python arrival_evidence.py --minutes 90 --max-snapshots 120 --out arrival-evidence.json

Requires arrival_candidates.py and mta_collector.py in repository root.
Requires boto3 and the existing R2_* environment variables for live analysis.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import unittest

from arrival_candidates import (
    MAX_CONTIGUOUS_GAP_SEC, MAX_FRESHNESS_SEC, decode_snapshot,
    detect_candidates, load_from_r2, _build_fixture,
)

VERSION = "0.2"
BINS = (15, 30, 60, 90)


def bucket(seconds):
    if seconds <= 15:
        return "0-15s"
    if seconds <= 30:
        return "16-30s"
    if seconds <= 60:
        return "31-60s"
    if seconds <= 90:
        return "61-90s"
    return "91s+"


def stable_vehicle(before, after):
    """A changed nonblank vehicle_id invalidates identity corroboration."""
    if not before or not after:
        return True
    left, right = before.get("vehicle_id"), after.get("vehicle_id")
    return not (left and right and left != right)


def vehicle_transition_evidence(before, after, stop, interval_start, interval_end):
    """Return supported STOPPED_AT transition flags; no exact arrival claims.

    GTFS-RT status: 0 incoming at, 1 stopped at, 2 in transit to.
    The timestamps are vehicle *observations*, not guaranteed arrival times.
    A missing or old timestamp cannot corroborate the arrival candidate.
    """
    if not before or not after:
        return "absent"
    if not stable_vehicle(before, after):
        return "identity_conflict"
    if after.get("stop_id") != stop or after.get("status") != 1:
        return "non_matching_vehicle_status"
    prev_same = before.get("status") == 1 and before.get("stop_id") == stop
    if prev_same:
        return "already_stopped_before_window"
    ts = after.get("timestamp")
    if ts is None or not interval_start - 10 <= ts <= interval_end + 10:
        return "stale_vehicle_timestamp"
    return "stopped_at_transition"


def _snapshot_pair_index(observations):
    """Duplicate timestamps are excluded; pairs crossing long gaps excluded."""
    ordered = sorted(observations, key=lambda s: (s["source_ts"], s.get("sha256", "")))
    clean = []
    for s in ordered:
        if clean and s["source_ts"] == clean[-1]["source_ts"]:
            continue
        clean.append(s)
    return {(a["source_ts"], b["source_ts"]): (a, b)
            for a, b in zip(clean, clean[1:])
            if 0 < b["source_ts"] - a["source_ts"] <= MAX_CONTIGUOUS_GAP_SEC}


def report_from_observations(observations, failures=0, scope=None):
    candidates_report = detect_candidates(observations)
    pairs = _snapshot_pair_index(observations)
    counts = Counter()
    routes = defaultdict(lambda: Counter())
    stations = defaultdict(lambda: Counter())
    vehicle_evidence = Counter()
    duration_buckets = Counter()
    durations = []
    event_records = []

    for c in candidates_report["candidates"]:
        key = (c["window_start_unix"], c["window_end_unix"])
        before, after = pairs.get(key, (None, None))
        trip = c["trip_key"]
        stop = c["stop_id"]
        route = c["route_id"]
        sample = c.get("evidence")
        v_prev = before["vehicles"].get(trip) if before else None
        v_next = after["vehicles"].get(trip) if after else None
        vp = vehicle_transition_evidence(v_prev, v_next, stop, *key)
        trip_prev = before["trips"].get(trip) if before else None
        trip_next = after["trips"].get(trip) if after else None
        trip_continuity = bool(trip_prev and trip_next)
        stop_rollover = sample == "upcoming_stop_removed_trip_continues"
        status_transition = sample == "vehicle_stopped_at_transition" or vp == "stopped_at_transition"
        if not stable_vehicle(v_prev, v_next):
            grade = "identity_conflict"
        elif stop_rollover and status_transition and trip_continuity:
            grade = "dual_signal"
        elif stop_rollover and trip_continuity:
            grade = "stop_rollover_only"
        elif status_transition:
            grade = "vehicle_transition_only"
        else:
            grade = "insufficient_evidence"
        # Even dual-signal is NOT 'verified'; a vehicle status transition is not
        # an independent physical arrival timestamp.
        duration = c["uncertainty_seconds"]
        duration_buckets[bucket(duration)] += 1
        durations.append(duration)
        counts[grade] += 1
        routes[route]["candidates"] += 1
        routes[route][grade] += 1
        stations[(route,stop)]["candidates"] += 1
        stations[(route,stop)][grade] += 1
        vehicle_evidence[vp] += 1
        event_records.append({
            "route_id": route, "stop_id": stop, "trip_key": trip,
            "window_start_unix": c["window_start_unix"],
            "window_end_unix": c["window_end_unix"], "window_seconds": duration,
            "candidate_source": sample, "vehicle_signal": vp,
            "trip_continuity": trip_continuity, "evidence_class": grade,
            "verified_arrival": False,
            "last_predicted_time_unix": c.get("last_predicted_time_unix"),
        })

    def summarize_group(counter):
        total = counter["candidates"]
        return {"candidates": total,
                "dual_signal": counter["dual_signal"],
                "dual_signal_share_of_candidates_pct": round(100 * counter["dual_signal"] / total, 1) if total else None,
                "identity_conflicts": counter["identity_conflict"],
                "stop_rollover_only": counter["stop_rollover_only"],
                "vehicle_transition_only": counter["vehicle_transition_only"],
                "insufficient_evidence": counter["insufficient_evidence"]}

    # These counts are *conditional on candidate detection* and do NOT measure
    # reliability, recall, false positives or the total number of real arrivals.
    station_rows = [dict(route_id=route, stop_id=stop, **summarize_group(ct))
                    for (route, stop), ct in stations.items()]
    station_rows.sort(key=lambda x: (-x["candidates"], x["route_id"], x["stop_id"]))
    # Preserve complete route and station totals. Do not sample the events to
    # compute distributions (v0.1 exported only first 100 detailed candidates).
    total = len(event_records)
    result = {
        "report_type": "RESEARCH_ONLY_NOT_FOR_SETTLEMENT",
        "research_version": VERSION,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "feed": "1234567",
        "observation_count": candidates_report["observation_count"],
        "duplicate_source_timestamps": candidates_report["duplicate_source_timestamps"],
        "source_gaps_over_100s": candidates_report["gaps_over_100s"],
        "parse_failures_or_skipped_files": failures,
        "candidate_count": total,
        "verified_arrivals": 0,
        "evidence_classes": {k: counts[k] for k in ("dual_signal", "stop_rollover_only", "vehicle_transition_only", "identity_conflict", "insufficient_evidence")},
        "vehicle_signal_breakdown": dict(sorted(vehicle_evidence.items())),
        "candidate_window_distribution": {b: duration_buckets[b] for b in ("0-15s", "16-30s", "31-60s", "61-90s", "91s+")},
        "window_seconds": {
            "minimum": min(durations, default=None),
            "median": sorted(durations)[total // 2] if total else None,
            "maximum": max(durations, default=None),
            "at_most_15s_pct": round(100 * sum(d <= 15 for d in durations) / total, 1) if total else None,
            "at_most_30s_pct": round(100 * sum(d <= 30 for d in durations) / total, 1) if total else None,
        },
        "by_route": {route: summarize_group(ct) for route, ct in sorted(routes.items())},
        "by_station": station_rows,
        "station_sample_minimum_for_comparison": 5,
        "top_station_comparison": [s for s in station_rows if s["candidates"] >= 5][:30],
        "event_detail_sample": event_records[:100],
        "full_event_detail_count": total,
        "caveat": ("Counts measure passage candidates, not confirmed arrivals. A 'dual_signal' "
                   "means overlapping trip-stop-rollover and vehicle STOPPED_AT evidence, "
                   "not independent ground truth. Candidate-only denominators cannot establish "
                   "station or route reliability, false-positive rates, recall, or 10–15s accuracy. "
                   "No ticket settlement is permitted from this report."),
    }
    if scope: result["r2_read_scope"] = scope
    return result


class EvidenceTests(unittest.TestCase):
    def _obs(self, t, stops, vehicle=None, trip_id="TEST", route="6"):
        return decode_snapshot(_build_fixture(t, stops, vehicle=vehicle, trip_id=trip_id, route=route))

    def test_dual_signal(self):
        a = self._obs(1000, [(1,"631N",1030),(2,"630N",1100)], ("631N",2,1000))
        b = self._obs(1060, [(2,"630N",1100)], ("631N",1,1060))
        r = report_from_observations([a,b]); self.assertEqual(r["evidence_classes"]["dual_signal"],1)
        self.assertEqual(r["verified_arrivals"],0)

    def test_stop_rollover_only(self):
        a = self._obs(1000,[(1,"631N",1030),(2,"630N",1100)])
        b = self._obs(1060,[(2,"630N",1100)])
        r=report_from_observations([a,b]); self.assertEqual(r["evidence_classes"]["stop_rollover_only"],1)

    def test_vehicle_only(self):
        a=self._obs(1000,[(1,"631N",1100),(2,"630N",1150)], ("631N",2,1000))
        b=self._obs(1060,[(1,"631N",1100),(2,"630N",1150)], ("631N",1,1060))
        r=report_from_observations([a,b]); self.assertEqual(r["evidence_classes"]["vehicle_transition_only"],1)

    def test_status_unchanged_no_event(self):
        a=self._obs(1000,[(1,"631N",1040)], ("631N",1,1000))
        b=self._obs(1060,[(1,"631N",1040)], ("631N",1,1060))
        self.assertEqual(report_from_observations([a,b])["candidate_count"],0)

    def test_gap_no_candidate(self):
        a=self._obs(1000,[(1,"631N",1030),(2,"630N",1100)])
        b=self._obs(1130,[(2,"630N",1100)])
        self.assertEqual(report_from_observations([a,b])["candidate_count"],0)

    def test_duplicate_source_timestamp(self):
        a=self._obs(1000,[(1,"631N",1030),(2,"630N",1100)])
        b=self._obs(1060,[(2,"630N",1100)])
        r=report_from_observations([a,a,b]);self.assertEqual(r["candidate_count"],1)
        self.assertEqual(r["duplicate_source_timestamps"],1)

    def test_vehicle_conflict_function(self):
        a={"vehicle_id":"car-1"};b={"vehicle_id":"car-2"}
        self.assertFalse(stable_vehicle(a,b))
        self.assertEqual(vehicle_transition_evidence(a,b,"631N",1000,1060),"identity_conflict")

    def test_window_distribution_complete_not_sampled(self):
        obs=[]
        for i in range(105):
            # 105 separate train events in same pair; use distinctive trips
            # construct one event pair per trip at two times
            a=self._obs(1000+i*200,[(1,"631N",1030+i*200),(2,"630N",1100+i*200)],trip_id=f"T{i}")
            b=self._obs(1060+i*200,[(2,"630N",1100+i*200)],trip_id=f"T{i}")
            obs.extend([a,b])
        r=report_from_observations(obs)
        self.assertEqual(r["candidate_count"],105)
        self.assertEqual(sum(r["candidate_window_distribution"].values()),105)
        self.assertEqual(len(r["event_detail_sample"]),100)

    def test_no_evidence_is_verified(self):
        a=self._obs(1000,[(1,"631N",1030),(2,"630N",1100)], ("631N",2,1000))
        b=self._obs(1060,[(2,"630N",1100)], ("631N",1,1060))
        assert all(e["verified_arrival"] is False for e in report_from_observations([a,b])["event_detail_sample"])


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--self-test", action="store_true")
    p.add_argument("--minutes", type=int, default=90)
    p.add_argument("--max-snapshots", type=int, default=120)
    p.add_argument("--out", default="arrival-evidence.json")
    args=p.parse_args()
    if args.self_test:
        suite=unittest.defaultTestLoader.loadTestsFromTestCase(EvidenceTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    if not (2 <= args.minutes <= 2880 and 2 <= args.max_snapshots <= 2880):
        p.error("Minutes and max-snapshots must be 2–2880")
    obs, problems, scope=load_from_r2(args.minutes, args.max_snapshots)
    r=report_from_observations(obs,len(problems),scope)
    r["problems_sample"]=problems[:25]
    Path(args.out).write_text(json.dumps(r,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in r.items() if k not in ("by_station","event_detail_sample","source_gaps_over_100s","problems_sample")},indent=2))
    return 0 if obs else 2

if __name__=="__main__":
    sys.exit(main())
