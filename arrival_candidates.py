#!/usr/bin/env python3
"""Subway Exchange: research-only MTA train passage/arrival candidate detector.

Reads high-frequency raw protobuf snapshots from *private* Cloudflare R2.
Never treats predictions, stopped-at status, or vanished stops as definitive
arrival time. NEVER use its output to settle prediction tickets.

Usage:
  python arrival_candidates.py --self-test
  python arrival_candidates.py --minutes 90 --out arrival-report.json

Only dependency for R2 mode: boto3. Uses R2_* secrets set in GitHub Actions.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest

from mta_collector import _fields, DecodeError

PREFIX = "subway-exchange/high-frequency/v1/feed=1234567/"
MAX_READ_BYTES = 2_000_000
# These are *research* cutoffs, not settlement thresholds.
MAX_CONTIGUOUS_GAP_SEC = 100
MAX_FRESHNESS_SEC = 120
MAX_WINDOW_SEC = 90


def _text(b):
    return b.decode("utf-8", "replace")


def _trip_descriptor(raw):
    out = {"trip_id": None, "route_id": None, "start_date": None, "start_time": None}
    for n, k, v in _fields(raw):
        if k == 2 and n in (1, 2, 3, 5):
            out[{1: "trip_id", 2: "start_time", 3: "start_date", 5: "route_id"}[n]] = _text(v)
    return out


def _stop_event(raw):
    for n, k, v in _fields(raw):
        if n == 2 and k == 0:  # StopTimeEvent.time, NOT actual observed time
            return v
    return None


def _stop_update(raw):
    stop = {"stop_id": None, "stop_sequence": None, "prediction": None}
    for n, k, v in _fields(raw):
        if n == 1 and k == 0:
            stop["stop_sequence"] = v
        elif n == 4 and k == 2:
            stop["stop_id"] = _text(v)
        elif n in (2, 3) and k == 2:
            t = _stop_event(v)
            if t is not None and (n == 2 or stop["prediction"] is None):
                stop["prediction"] = t
    return stop


def _vehicle_descriptor(raw):
    for n, k, v in _fields(raw):
        if n == 1 and k == 2:
            return _text(v)
    return None


def _trip_update(raw):
    trip = None
    stops = []
    vehicle_id = None
    for n, k, v in _fields(raw):
        if n == 1 and k == 2:
            trip = _trip_descriptor(v)
        elif n == 2 and k == 2:
            s = _stop_update(v)
            if s["stop_id"]:
                stops.append(s)
        elif n == 3 and k == 2:
            vehicle_id = _vehicle_descriptor(v)
    return {"trip": trip, "stops": stops, "vehicle_id": vehicle_id}


def _vehicle_position(raw):
    trip, stop_id, status, timestamp, vehicle_id = None, None, None, None, None
    for n, k, v in _fields(raw):
        if n == 1 and k == 2:
            trip = _trip_descriptor(v)
        elif n == 4 and k == 0:
            status = v  # GTFS-RT 0 incoming, 1 stopped, 2 in transit
        elif n == 5 and k == 0:
            timestamp = v
        elif n == 7 and k == 2:
            stop_id = _text(v)
        elif n == 8 and k == 2:
            vehicle_id = _vehicle_descriptor(v)
    return {"trip": trip, "stop_id": stop_id, "status": status,
            "timestamp": timestamp, "vehicle_id": vehicle_id}


def trip_key(trip):
    if not trip or not trip.get("trip_id") or not trip.get("route_id"):
        return None
    return "|".join(str(trip.get(f) or "") for f in
                    ("trip_id", "start_date", "start_time", "route_id"))


def decode_snapshot(raw):
    """Decode all relevant trip and vehicle records, not just a sample."""
    header_ts, version = None, None
    trips, vehicles = {}, {}
    for n, k, v in _fields(raw):
        if n == 1 and k == 2:
            for hn, hk, hv in _fields(v):
                if hn == 1 and hk == 2:
                    version = _text(hv)
                elif hn == 3 and hk == 0:
                    header_ts = hv
        elif n == 2 and k == 2:
            for en, ek, ev in _fields(v):
                if en == 3 and ek == 2:
                    t = _trip_update(ev)
                    key = trip_key(t["trip"])
                    if key:
                        trips[key] = t
                elif en == 4 and ek == 2:
                    p = _vehicle_position(ev)
                    key = trip_key(p["trip"])
                    if key:
                        vehicles[key] = p
    if not version or header_ts is None:
        raise DecodeError("Missing GTFS-RT header/version/timestamp")
    return {"source_ts": header_ts, "version": version, "trips": trips,
            "vehicles": vehicles}


def detect_candidates(observations):
    """Return conservative *possible passage* evidence. No VERIFIED grade."""
    obs = sorted(observations, key=lambda o: o["source_ts"])
    deduped, duplicates = [], 0
    seen = set()
    for o in obs:
        key = (o["source_ts"], o.get("sha256"))
        if key in seen or (deduped and o["source_ts"] == deduped[-1]["source_ts"]):
            duplicates += 1
            continue
        seen.add(key)
        deduped.append(o)
    events, seen_events = [], set()
    gaps = []
    vehicle_count = 0
    for prev, cur in zip(deduped, deduped[1:]):
        delta = cur["source_ts"] - prev["source_ts"]
        if delta <= 0:
            continue
        if delta > MAX_CONTIGUOUS_GAP_SEC:
            gaps.append({"start": prev["source_ts"], "end": cur["source_ts"], "gap_seconds": delta})
            continue
        vehicle_count += len(cur["vehicles"])
        # Signal A: previously upcoming stop has gone away AND the trip continues
        for key, before in prev["trips"].items():
            after = cur["trips"].get(key)
            if not after or not before["stops"] or not after["stops"]:
                continue  # trip disappearance is never arrival evidence
            first_after = after["stops"][0]
            after_ids = {s["stop_id"] for s in after["stops"]}
            for s in before["stops"][:2]:  # only near-term stops, bounded processing
                stop = s["stop_id"]
                if stop in after_ids or stop == first_after["stop_id"]:
                    continue
                if s["stop_sequence"] is not None and first_after["stop_sequence"] is not None:
                    if first_after["stop_sequence"] <= s["stop_sequence"]:
                        continue
                else:
                    ids = [x["stop_id"] for x in before["stops"]]
                    if first_after["stop_id"] not in ids or ids.index(first_after["stop_id"]) <= ids.index(stop):
                        continue
                eta = s["prediction"]
                if eta is None or not prev["source_ts"] - 60 <= eta <= cur["source_ts"] + 180:
                    continue
                event_id = (key, stop)
                if event_id in seen_events:
                    continue
                seen_events.add(event_id)
                events.append({"trip_key": key, "route_id": before["trip"]["route_id"],
                               "stop_id": stop, "evidence": "upcoming_stop_removed_trip_continues",
                               "window_start_unix": prev["source_ts"],
                               "window_end_unix": cur["source_ts"],
                               "uncertainty_seconds": delta,
                               "last_predicted_time_unix": eta,
                               "grade": "candidate_only", "verified_arrival": False})
        # Signal B: vehicle reported STOPPED_AT the same stop, transitioned
        for key, v in cur["vehicles"].items():
            old = prev["vehicles"].get(key)
            if not old or v["status"] != 1 or not v["stop_id"] or (
                old["status"] == 1 and old["stop_id"] == v["stop_id"]
            ) or v["timestamp"] is None:
                continue
            if not prev["source_ts"] - 10 <= v["timestamp"] <= cur["source_ts"] + 10:
                continue
            event_id = (key, v["stop_id"])
            if event_id in seen_events:
                # Keep both corroborating signals when available.
                e = next(e for e in events if e["trip_key"] == key and e["stop_id"] == v["stop_id"])
                e["corroborating_vehicle_stopped_at"] = True
                continue
            seen_events.add(event_id)
            events.append({"trip_key": key, "route_id": v["trip"]["route_id"],
                           "stop_id": v["stop_id"], "evidence": "vehicle_stopped_at_transition",
                           "window_start_unix": prev["source_ts"],
                           "window_end_unix": cur["source_ts"], "uncertainty_seconds": delta,
                           "grade": "candidate_only", "verified_arrival": False})
    return {"observation_count": len(deduped), "duplicate_source_timestamps": duplicates,
            "gaps_over_100s": gaps, "vehicle_position_records_seen": vehicle_count,
            "candidates": events}


def report_from_observations(observations, failures=0):
    result = detect_candidates(observations)
    counts = Counter(e["route_id"] for e in result["candidates"])
    result["report_type"] = "RESEARCH_ONLY_NOT_FOR_SETTLEMENT"
    result["feed"] = "1234567"
    result["parse_failures_or_skipped_files"] = failures
    result["candidate_count"] = len(result["candidates"])
    result["candidates_by_route"] = dict(sorted(counts.items()))
    result["verified_arrivals"] = 0
    result["min_possible_uncertainty_seconds"] = min(
        (e["uncertainty_seconds"] for e in result["candidates"]), default=None)
    result["warning"] = (
        "Stop removal may indicate passage, cancellation, re-route or feed revision. "
        "STOPPED_AT may indicate a status at source timestamp, not exact arrival. "
        "Never use these candidates to settle tickets or claim 10–15s accuracy."
    )
    return result


def load_from_r2(minutes=90, max_snapshots=120):
    import boto3  # only required when querying R2
    required = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
    missing = [n for n in required if not os.getenv(n)]
    if missing:
        raise RuntimeError("Missing R2 settings: " + ", ".join(missing))
    client = boto3.client("s3", endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                          aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                          aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
    from time import time
    cutoff = time() - minutes * 60
    health_keys = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=os.environ["R2_BUCKET"], Prefix=PREFIX):
        for item in page.get("Contents", []):
            if item["Key"].endswith(".health.json") and item["LastModified"].timestamp() >= cutoff:
                health_keys.append((item["LastModified"], item["Key"]))
    health_keys.sort()
    health_keys = health_keys[-max_snapshots:]
    observations, problems, included = [], [], 0
    for _, health_key in health_keys:
        try:
            health = json.loads(client.get_object(Bucket=os.environ["R2_BUCKET"], Key=health_key)["Body"].read())
            if health.get("status") != "ok" or not health.get("raw_archive"):
                problems.append({"health_key": health_key, "reason": "non-ok or missing raw archive"})
                continue
            collected_ts = datetime.fromisoformat(health["collected_at"].replace("Z", "+00:00")).timestamp()
            source_ts = health.get("feed_timestamp_unix")
            if source_ts is None or abs(collected_ts - source_ts) > MAX_FRESHNESS_SEC:
                problems.append({"health_key": health_key, "reason": "stale feed"})
                continue
            obj = client.get_object(Bucket=os.environ["R2_BUCKET"], Key=health["raw_archive"])
            raw = obj["Body"].read(MAX_READ_BYTES + 1)
            if len(raw) > MAX_READ_BYTES:
                raise ValueError("snapshot oversized")
            sha = hashlib.sha256(raw).hexdigest()
            parsed = decode_snapshot(raw)
            if parsed["source_ts"] != source_ts:
                raise ValueError("raw source timestamp differs from health")
            parsed["sha256"] = sha
            observations.append(parsed)
            included += 1
        except Exception as exc:
            problems.append({"health_key": health_key, "reason": type(exc).__name__ + ": " + str(exc)[:150]})
    return observations, problems, {"health_objects_seen": len(health_keys),
                                    "good_raw_snapshots": included, "analysis_window_minutes": minutes}


# Minimal reproducible protobuf fixtures using existing synthetic serializer.
from mta_collector import _fld

def _build_fixture(timestamp, stops, *, vehicle=None, route="6", trip_id="TEST", start="20261124"):
    header = _fld(1, b"2.0") + _fld(3, timestamp)
    trip_descriptor = _fld(1, trip_id.encode()) + _fld(3, start.encode()) + _fld(5, route.encode())
    sdata = b""
    for seq, stop, predicted in stops:
        sdata += _fld(2, _fld(1, seq) + _fld(2, _fld(2, predicted)) + _fld(4, stop.encode()))
    update = _fld(1, trip_descriptor) + sdata
    ent = _fld(1, b"test-trip") + _fld(3, update)
    if vehicle:
        # stop_id, status, source timestamp
        stop, status, vts = vehicle
        vp = _fld(1, trip_descriptor) + _fld(4, status) + _fld(5, vts) + _fld(7, stop.encode())
        ent += _fld(4, vp)
    return _fld(1, header) + _fld(2, ent)


class ArrivalCandidateTests(unittest.TestCase):
    def test_stop_rollover_candidate_bounded_not_verified(self):
        a = decode_snapshot(_build_fixture(1000, [(1, "631N", 1040), (2, "630N", 1110)]))
        b = decode_snapshot(_build_fixture(1060, [(2, "630N", 1110), (3, "629N", 1200)]))
        r = report_from_observations([a, b])
        self.assertEqual(r["candidate_count"], 1)
        self.assertEqual(r["candidates"][0]["uncertainty_seconds"], 60)
        self.assertFalse(r["candidates"][0]["verified_arrival"])
        self.assertEqual(r["verified_arrivals"], 0)

    def test_missing_trip_is_not_arrival(self):
        a = decode_snapshot(_build_fixture(1000, [(1, "631N", 1040)]))
        b = decode_snapshot(_fld(1, _fld(1, b"2.0") + _fld(3, 1060)))
        self.assertEqual(report_from_observations([a, b])["candidate_count"], 0)

    def test_large_gap_blocks_candidate(self):
        a = decode_snapshot(_build_fixture(1000, [(1, "631N", 1040), (2, "630N", 1110)]))
        b = decode_snapshot(_build_fixture(1140, [(2, "630N", 1170)]))
        r = report_from_observations([a, b])
        self.assertEqual(r["candidate_count"], 0)
        self.assertEqual(len(r["gaps_over_100s"]), 1)

    def test_vehicle_stopped_transition_correlates(self):
        a = decode_snapshot(_build_fixture(1000, [(1, "631N", 1040), (2, "630N", 1110)], vehicle=("631N", 2, 1000)))
        b = decode_snapshot(_build_fixture(1060, [(2, "630N", 1110)], vehicle=("631N", 1, 1060)))
        r = report_from_observations([a, b])
        self.assertEqual(r["candidate_count"], 1)
        self.assertTrue(r["candidates"][0]["corroborating_vehicle_stopped_at"])
        self.assertFalse(r["candidates"][0]["verified_arrival"])

    def test_duplicate_feed_snapshot_does_not_make_event(self):
        a = decode_snapshot(_build_fixture(1000, [(1, "631N", 1040)]))
        self.assertEqual(report_from_observations([a, a])["candidate_count"], 0)

    def test_unrelated_change_not_candidate(self):
        a = decode_snapshot(_build_fixture(1000, [(1, "631N", 1200), (2, "630N", 1270)]))
        b = decode_snapshot(_build_fixture(1060, [(1, "631N", 1190), (2, "630N", 1270)]))
        self.assertEqual(report_from_observations([a, b])["candidate_count"], 0)

    def test_invalid_protobuf_rejected(self):
        with self.assertRaises(DecodeError):
            decode_snapshot(b"garbage")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--minutes", type=int, default=90, help="R2 window, default last 90 minutes")
    parser.add_argument("--max-snapshots", type=int, default=120)
    parser.add_argument("--out", default="arrival-report.json")
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(ArrivalCandidateTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    if not 2 <= args.minutes <= 2880 or not 2 <= args.max_snapshots <= 2880:
        parser.error("Provide 2–2880 minutes and max-snapshots")
    obs, problems, scope = load_from_r2(args.minutes, args.max_snapshots)
    result = report_from_observations(obs, len(problems))
    result.update(scope)
    result["problems_sample"] = problems[:20]
    result["candidates"] = result["candidates"][:100]
    Path(args.out).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k not in ("candidates", "gaps_over_100s", "problems_sample")}, indent=2))
    return 0 if obs else 2


if __name__ == "__main__":
    sys.exit(main())
