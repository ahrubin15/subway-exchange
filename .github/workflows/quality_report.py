#!/usr/bin/env python3
"""Summarize Subway Exchange's private MTA feed collection health.

Usage:
  python quality_report.py --self-test
  python quality_report.py --hours 24 --out quality-report.json

Requires boto3 for R2 mode and R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
R2_SECRET_ACCESS_KEY, R2_BUCKET environment variables. Never prints secrets.
This measures ingestion health, NOT observed train arrivals or settlement.
"""
from __future__ import annotations
import argparse
import json
import os
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path
from statistics import median
import sys
import unittest

PREFIX = "subway-exchange/collection-runs/"

def as_utc(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)

def summarize(records, now, hours=24, expected_minutes=15):
    start = now - timedelta(hours=hours)
    # A retry can supersede an earlier attempt; for equal run ID, keep highest attempt.
    per_run = {}
    skipped = 0
    for record in records:
        try:
            entries = record["records"]
            if not entries: raise ValueError("empty records")
            timestamp = as_utc(entries[0]["collected_at"])
            if not start <= timestamp <= now + timedelta(minutes=2): continue
            run_id = str(record["run_id"])
            attempt = int(record.get("run_attempt", 1))
            if run_id not in per_run or attempt >= per_run[run_id][0]:
                per_run[run_id] = (attempt, timestamp, entries, int(record.get("raw_snapshot_files", 0)))
        except (KeyError, ValueError, TypeError, IndexError):
            skipped += 1
    attempts = sorted(per_run.values(), key=lambda x: x[1])
    feeds = {}
    for _, timestamp, entries, raw_count in attempts:
        for entry in entries:
            feed = entry.get("feed", "unknown")
            feeds.setdefault(feed, []).append((timestamp, entry, raw_count))
    result = {"as_of_utc": now.isoformat(), "window_hours": hours,
        "expected_interval_minutes": expected_minutes, "runs_in_window": len(attempts),
        "skipped_malformed_reports": skipped, "feeds": {},
        "important_limitations": [
            "15-minute best-effort snapshots do not reliably establish actual train arrival times.",
            "GTFS-RT stop arrival and departure values are predictions, not actual event proofs.",
            "Missing scheduled jobs cannot be inferred exactly without GitHub run history; interval estimates are approximate.",
            "A small sample window gives preliminary health metrics, not settlement approval."
        ]}
    for feed, data in feeds.items():
        data.sort(key=lambda x: x[0]); n = len(data)
        good = [(t,e) for t,e,_ in data if e.get("status") == "ok"]
        fresh = [(t,e) for t,e in good if e.get("feed_age_seconds") is not None and
                 0 <= float(e["feed_age_seconds"]) <= 120]
        age = [round(float(e["feed_age_seconds"]), 1) for _,e in good if isinstance(e.get("feed_age_seconds"),(int,float))]
        gaps = [round((data[i][0]-data[i-1][0]).total_seconds()/60, 2) for i in range(1,n)]
        raw_hashes = [e.get("raw_sha256") for _,e in good if e.get("raw_sha256")]
        duplicates = sum(raw_hashes[i] == raw_hashes[i-1] for i in range(1,len(raw_hashes)))
        trip_counts = [e.get("trip_update_count") for _,e in good if isinstance(e.get("trip_update_count"),int)]
        intervals_missing = sum(max(0, round(g / expected_minutes) - 1) for g in gaps)
        expected_window = max(1, round(hours * 60 / expected_minutes))
        result["feeds"][feed] = {
            "observed_runs": n, "healthy_fetches": len(good), "failed_fetches": n-len(good),
            "success_percent": round(100*len(good)/n,1),
            "fresh_fetches": len(fresh), "fresh_percent_of_successful": round(100*len(fresh)/len(good),1) if good else None,
            "median_feed_age_seconds": round(median(age),1) if age else None,
            "max_feed_age_seconds": max(age) if age else None,
            "median_trip_updates": median(trip_counts) if trip_counts else None,
            "adjacent_identical_raw_snapshots": duplicates,
            "max_observed_gap_minutes": max(gaps) if gaps else None,
            "gaps_over_1_5_intervals": sum(g > expected_minutes*1.5 for g in gaps),
            "estimated_missing_intervals_between_observations": intervals_missing,
            "rough_window_run_coverage_percent": round(min(100,100*n/expected_window),1),
            "latest_observation_utc": data[-1][0].isoformat(),
            "latest_status": data[-1][1].get("status"),
            "raw_snapshots_reported": sum(1 for _,e,rc in data if e.get("status")=="ok" and rc>0),
            "sample_failures": [str(e.get("error","unknown"))[:180] for _,e,_ in data if e.get("status")!="ok"][-3:]
        }
    result["assessment"] = "COLLECTING: not sufficient to approve real-world market settlement"
    return result

def read_r2(hours, now, max_reports=1000):
    missing = [x for x in ("R2_ACCOUNT_ID","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_BUCKET") if not os.environ.get(x)]
    if missing: raise RuntimeError("Missing configuration: " + ", ".join(missing))
    import boto3
    client=boto3.client("s3",endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],region_name="auto")
    bucket=os.environ["R2_BUCKET"]
    candidates=[]
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket,Prefix=PREFIX):
        for obj in page.get("Contents",[]):
            if obj["Key"].endswith("/health.json"):
                candidates.append(obj)
    # R2's ListObjects API doesn't filter by collection timestamp; read newest objects.
    candidates.sort(key=lambda x:x["LastModified"],reverse=True)
    records=[]
    for obj in candidates[:max_reports]:
        records.append(json.loads(client.get_object(Bucket=bucket,Key=obj["Key"])["Body"].read()))
    return records, len(candidates)>max_reports

class QualityTests(unittest.TestCase):
    def test_summary_gaps_and_duplicate(self):
        now=datetime(2026,11,24,18,0,tzinfo=timezone.utc)
        def r(n, minute, sha="a", age=20, status="ok", attempt=1):
            return {"run_id":n,"run_attempt":attempt,"raw_snapshot_files":1,
                "records":[{"feed":"1234567","collected_at":(now-timedelta(minutes=minute)).isoformat(),
                "status":status,"feed_age_seconds":age,"raw_sha256":sha,"trip_update_count":42}]}
        s=summarize([r(1,45),r(2,30),r(2,30,attempt=2),r(3,0,sha="b",age=180)],now,hours=1)
        f=s["feeds"]["1234567"]
        self.assertEqual(f["observed_runs"],3)
        self.assertEqual(f["gaps_over_1_5_intervals"],1)
        self.assertEqual(f["adjacent_identical_raw_snapshots"],1)
        self.assertEqual(f["fresh_fetches"],2)
        self.assertEqual(f["estimated_missing_intervals_between_observations"],1)
    def test_empty(self):
        s=summarize([],datetime.now(timezone.utc))
        self.assertEqual(s["runs_in_window"],0)
        self.assertEqual(s["feeds"],{})
    def test_malformed_ignored(self):
        s=summarize([{}, {"run_id":1,"records":[]}],datetime.now(timezone.utc))
        self.assertEqual(s["skipped_malformed_reports"],2)
    def test_failure(self):
        now=datetime(2026,11,24,18,tzinfo=timezone.utc)
        rec={"run_id":"a","records":[{"feed":"1234567","collected_at":now.isoformat(),"status":"error","error":"timeout"}]}
        f=summarize([rec],now)["feeds"]["1234567"]
        self.assertEqual(f["failed_fetches"],1)
        self.assertEqual(f["sample_failures"],["timeout"])

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--self-test",action="store_true")
    ap.add_argument("--hours",type=int,default=24)
    ap.add_argument("--max-reports",type=int,default=1000)
    ap.add_argument("--out",type=Path,default=Path("quality-report.json"))
    args=ap.parse_args()
    if args.self_test:
        suite=unittest.defaultTestLoader.loadTestsFromTestCase(QualityTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    if args.hours<1 or args.max_reports<1: ap.error("Positive --hours and --max-reports required")
    now=datetime.now(timezone.utc)
    records,truncated=read_r2(args.hours,now,args.max_reports)
    report=summarize(records,now,args.hours)
    report["reports_truncated_by_limit"]=truncated
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(f"Archive health report saved to {args.out}: {report['runs_in_window']} runs, {len(report['feeds'])} feeds")
    for feed,info in report["feeds"].items():
        print(f"{feed}: {info['healthy_fetches']}/{info['observed_runs']} successful; "
              f"{info['fresh_fetches']} fresh; max gap {info['max_observed_gap_minutes']} min")
    return 0
if __name__=="__main__":sys.exit(main())
