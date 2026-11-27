# Subway Exchange — Offline Replay Prototype

Research only. No database connections, network calls, production writes, or deployment.

Run `python -m unittest -v` in this folder (Python 3.10+; standard library only).
Run `python replay.py /path/to/raw-snapshots --output replay-results.json --stops approved-stops.json`.
Input filenames must contain the collector's UTC timestamp (`2026-11-27T21-00-05-795Z`); raw `.pb` or `.pb.gz` supported. Approved stops JSON maps route strings to lists of directional station IDs. Without it, all numeric directional stops on routes 1,2,3,4,6,7 are considered, not just live stations.

The prototype evaluates -90 through +60 seconds in 15-second increments, with 5/7/10-minute verification windows. Only completed observation windows enter the experiment. It uses a conservative arrival interval from stopped, upstream and downstream evidence; ambiguous outcomes are void. The simplified research labeler is not yet proven equivalent to production V4 (no static route topology fallback; sequence evidence and conflicts require further validation). Baseline probabilities are an opening-time logistic benchmark, not trained calibration or live executable quotes. No dynamic deadline selector is promoted or fitted yet. The candidate generator uses first eligible trip/stop and a 6–16 minute initial ETA window, not the exact production market selection policy.

Next: verify archived snapshot parsing against real data; obtain the exact approved station registry; benchmark coverage and evidence labels against production audits; optimize replay with indexed per-trip histories; fit on chronological training cohorts and evaluate on separate later days, grouping trips to avoid leakage. Evaluate candidate opening balance, void rates, Brier score, calibration, market coverage and route-level degradation before proposing deployment. Retain 4 percentage points combined margin (2 per side) independently of fair probability.
