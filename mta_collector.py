#!/usr/bin/env python3
"""Subway Exchange: dependency-free MTA GTFS-RT snapshot collector (engineering alpha).

Usage:
  python mta_collector.py --self-test
  python mta_collector.py --once --feed 1234567
  python mta_collector.py --once --feed 1234567 --feed l --out-dir mta-data
  python mta_collector.py --interval 60 --feed 1234567  # run on a SERVER, not an iPad

Stores raw gzip-compressed protobuf and JSON snapshot summaries. It does NOT
infer actual arrivals, determine settlement, or store secrets. It is a first
proof-of-collection component, not a production GTFS parser or market engine.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import sys
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F/"
FEEDS = {
    "1234567": "gtfs", "ace": "gtfs-ace", "bdfm": "gtfs-bdfm",
    "g": "gtfs-g", "jz": "gtfs-jz", "l": "gtfs-l", "nqrw": "gtfs-nqrw",
}
MAX_BYTES = 8_000_000


class DecodeError(ValueError):
    """Invalid or unsupported Protocol Buffers wire data."""


def _varint(data: bytes, pos: int) -> tuple[int, int]:
    value, shift = 0, 0
    for _ in range(10):
        if pos >= len(data):
            raise DecodeError("truncated varint")
        b = data[pos]
        pos += 1
        value |= (b & 127) << shift
        if not b & 128:
            return value, pos
        shift += 7
    raise DecodeError("varint overflow")


def _fields(data: bytes):
    """Yield standard protobuf (field-number, wire-type, value) tuples.

    Only fields needed by the first MTA snapshot proof are interpreted. The
    original compressed feed is retained for full extension-aware parsing.
    """
    pos = 0
    while pos < len(data):
        tag, pos = _varint(data, pos)
        number, kind = tag >> 3, tag & 7
        if number == 0:
            raise DecodeError("invalid zero field number")
        if kind == 0:
            value, pos = _varint(data, pos)
        elif kind == 1:
            if pos + 8 > len(data):
                raise DecodeError("truncated 64-bit field")
            value = data[pos:pos+8]
            pos += 8
        elif kind == 2:
            length, pos = _varint(data, pos)
            if length > len(data) - pos:
                raise DecodeError("truncated length-delimited field")
            value = data[pos:pos+length]
            pos += length
        elif kind == 5:
            if pos + 4 > len(data):
                raise DecodeError("truncated 32-bit field")
            value = data[pos:pos+4]
            pos += 4
        else:
            raise DecodeError(f"unsupported wire type {kind}")
        yield number, kind, value


def _utf8(data: bytes) -> str:
    return data.decode("utf-8", "replace")


def _event_time(data: bytes) -> int | None:
    return next((v for n, k, v in _fields(data) if n == 2 and k == 0), None)


def _stop(data: bytes) -> dict:
    stop_id, arrival, departure = None, None, None
    for n, k, v in _fields(data):
        if n == 4 and k == 2:
            stop_id = _utf8(v)
        elif n == 2 and k == 2:
            arrival = _event_time(v)
        elif n == 3 and k == 2:
            departure = _event_time(v)
    return {"stop_id": stop_id, "predicted_arrival_unix": arrival,
            "predicted_departure_unix": departure}


def _trip_descriptor(data: bytes) -> dict:
    result = {"trip_id": None, "route_id": None, "start_date": None}
    for n, k, v in _fields(data):
        if k == 2 and n in (1, 3, 5):
            result[{1: "trip_id", 3: "start_date", 5: "route_id"}[n]] = _utf8(v)
    return result


def _trip_update(data: bytes) -> dict:
    result = {"trip_id": None, "route_id": None, "start_date": None, "stops": []}
    for n, k, v in _fields(data):
        if n == 1 and k == 2:
            result.update(_trip_descriptor(v))
        elif n == 2 and k == 2:
            result["stops"].append(_stop(v))
    return result


def decode_summary(data: bytes, max_sample_trips: int = 12) -> dict:
    """Read a bounded sample of GTFS-RT trip updates without extra packages.

    GTFS-RT stop arrival/departure times are *predictions*, not observed actuals.
    This intentionally ignores NYCT extension fields, vehicle positions,
    alerts and timing revisions; never use it directly for market settlement.
    """
    version, feed_timestamp, trips_seen, sample = None, None, 0, []
    for n, k, v in _fields(data):
        if n == 1 and k == 2:
            for hn, hk, hv in _fields(v):
                if hn == 1 and hk == 2:
                    version = _utf8(hv)
                elif hn == 3 and hk == 0:
                    feed_timestamp = hv
        elif n == 2 and k == 2:
            for en, ek, ev in _fields(v):
                if en == 3 and ek == 2:  # FeedEntity.trip_update
                    trips_seen += 1
                    if len(sample) < max_sample_trips:
                        t = _trip_update(ev)
                        t["stops"] = t["stops"][:3]
                        sample.append(t)
    if not version:
        raise DecodeError("no GTFS-RT header/version")
    return {"gtfs_realtime_version": version, "feed_timestamp_unix": feed_timestamp,
            "trip_update_count": trips_seen, "sample_trip_updates": sample}


def fetch_feed(feed: str, timeout: int = 20) -> bytes:
    if feed not in FEEDS:
        raise ValueError("Unknown feed")
    url = BASE + FEEDS[feed]
    req = Request(url, headers={"Accept": "application/x-protobuf,application/octet-stream",
                                "User-Agent": "SubwayExchangeAlphaCollector/0.1"})
    with urlopen(req, timeout=timeout) as response:
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Feed exceeds configured safety limit")
    if not raw:
        raise ValueError("MTA returned empty feed")
    return raw


def collect_once(feed: str, out_dir: Path, now: datetime | None = None,
                 fetcher=fetch_feed) -> dict:
    now = now or datetime.now(timezone.utc)
    started = time.monotonic()
    stamp = now.strftime("%Y%m%dT%H%M%S%fZ")
    root = out_dir / feed / now.strftime("%Y-%m-%d")
    root.mkdir(parents=True, exist_ok=True)
    record = {"feed": feed, "url": BASE + FEEDS[feed], "collected_at": now.isoformat(),
              "status": "error", "fetch_duration_ms": None}
    try:
        raw = fetcher(feed)
        digest = hashlib.sha256(raw).hexdigest()
        summary = decode_summary(raw)
        raw_path = root / f"{stamp}-{digest[:12]}.pb.gz"
        with gzip.open(raw_path, "wb") as file:
            file.write(raw)
        record.update(summary)
        record.update({"status": "ok", "raw_sha256": digest,
                       "raw_bytes": len(raw), "raw_archive": str(raw_path)})
        if summary["feed_timestamp_unix"] is not None:
            record["feed_age_seconds"] = round(now.timestamp() - summary["feed_timestamp_unix"], 2)
            record["stale_warning"] = record["feed_age_seconds"] > 120
    except (URLError, HTTPError, TimeoutError, ValueError, OSError) as exc:
        record["error"] = f"{type(exc).__name__}: {str(exc)[:300]}"
    finally:
        record["fetch_duration_ms"] = round((time.monotonic() - started) * 1000)
        # One JSONL append per attempt, including failures, for feed-health analysis.
        with (out_dir / "collection-log.jsonl").open("a", encoding="utf-8") as file:
            file.write(json.dumps({k: v for k, v in record.items()
                                   if k != "sample_trip_updates"}, separators=(",", ":")) + "\n")
        if record["status"] == "ok":
            (root / f"{stamp}-summary.json").write_text(
                json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return record


# Synthetic protobuf fixtures, not MTA data; no internet required for tests.
def _encvar(v):
    b = bytearray()
    while v >= 128:
        b.append((v & 127) | 128)
        v >>= 7
    b.append(v)
    return bytes(b)


def _fld(n, value):
    if isinstance(value, int):
        return _encvar(n << 3) + _encvar(value)
    return _encvar((n << 3) | 2) + _encvar(len(value)) + value


def _fixture():
    header = _fld(1, b"2.0") + _fld(3, 1795449000)
    trip = _fld(1, b"TEST_TRIP") + _fld(3, b"20261123") + _fld(5, b"6")
    stop = _fld(4, b"631N") + _fld(2, _fld(2, 1795449060))
    update = _fld(1, trip) + _fld(2, stop)
    entity = _fld(1, b"test-entity") + _fld(3, update)
    return _fld(1, header) + _fld(2, entity)


class CollectorTests(unittest.TestCase):
    def test_decode(self):
        r = decode_summary(_fixture())
        self.assertEqual(r["trip_update_count"], 1)
        self.assertEqual(r["sample_trip_updates"][0]["route_id"], "6")
        self.assertEqual(r["sample_trip_updates"][0]["stops"][0]["stop_id"], "631N")
        self.assertEqual(r["sample_trip_updates"][0]["stops"][0]["predicted_arrival_unix"], 1795449060)

    def test_reject_truncated(self):
        with self.assertRaises(DecodeError):
            decode_summary(_fixture()[:-1])

    def test_archive_and_health_log(self):
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as temp:
            out = Path(temp)
            r = collect_once("1234567", out, datetime(2026, 11, 23, tzinfo=timezone.utc),
                             fetcher=lambda _: _fixture())
            self.assertEqual(r["status"], "ok")
            self.assertEqual(gzip.open(r["raw_archive"], "rb").read(), _fixture())
            self.assertTrue((out / "collection-log.jsonl").is_file())

    def test_error_is_logged(self):
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as temp:
            def fail(_):
                raise URLError("simulated outage")
            r = collect_once("1234567", Path(temp), fetcher=fail)
            self.assertEqual(r["status"], "error")
            self.assertIn("outage", (Path(temp) / "collection-log.jsonl").read_text())

    def test_reject_unknown_feed(self):
        with self.assertRaises(ValueError):
            fetch_feed("not-a-feed")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--self-test", action="store_true", help="Run synthetic tests without network")
    parser.add_argument("--once", action="store_true", help="Collect feeds once, then exit")
    parser.add_argument("--interval", type=int, metavar="SECONDS", help="Repeat on a continuously running server")
    parser.add_argument("--feed", action="append", choices=sorted(FEEDS), help="MTA feed group; repeat as needed")
    parser.add_argument("--out-dir", type=Path, default=Path("mta-data"))
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(CollectorTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    if not args.once and not args.interval:
        parser.error("Choose --once, --interval SECONDS or --self-test")
    if args.interval is not None and args.interval < 30:
        parser.error("Interval must be at least 30 seconds")
    feeds = args.feed or ["1234567"]
    while True:
        failures = 0
        for feed in feeds:
            record = collect_once(feed, args.out_dir)
            print(json.dumps({k: v for k, v in record.items() if k != "sample_trip_updates"}), flush=True)
            if record["status"] != "ok":
                failures += 1
        if args.once:
            return 1 if failures else 0
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
