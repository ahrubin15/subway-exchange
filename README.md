# Subway Exchange — Development Foundation

A free-to-play fictional-token NYC transit prediction game. **Not real-money betting.**

## Current Status

- `index.html` — approved v0.6.1 frontend review; deployable unchanged using GitHub Pages `main / (root)`.
- All frontend markets, odds, accounts, settlements, and tokens in this file are **DEMO ONLY**, maintained in the browser.
- `docs/design/v0.6.1.html` — immutable design reference snapshot.
- `frontend/`, `backend/`, `data/`, `tests/` — foundation for future real integration, not functioning backend services yet.
- `.github/workflows/checks.yml` — no-dependency safety checks for commits/PRs.

## Preserve Your Current Website

A GitHub Pages deployment from `main / (root)` needs `index.html` at repository root. This package intentionally keeps it there. **Do not delete or rename that file.**

Before replacing the existing repository, create a backup branch or use GitHub's commit history to preserve the current version. Only overwrite the site after verifying you want this exact baseline.

## Run Local Checks

```bash
python3 -m unittest discover -s tests -v
```

Checks validate file presence, markup entrypoints and that the original approved HTML is byte-for-byte preserved. They **do not** prove live MTA feeds, real settlement, secure authentication, or mobile Safari gestures.

## Recommended Build Order

1. Confirm deployment/environment choice and costs (see `docs/architecture.md`).
2. Create isolated development secrets/credentials; never commit `.env` or API keys.
3. Implement MTA feed polling/archive and evidence-health reporting.
4. Forward-only shadow markets against real future events.
5. Implement server-side predictions, atomic wallet, and settlement; then connect frontend.
6. Add persistent user identity, Crews and rankings, in-app notifications, analytics and owner controls.

## Deploy

For the **current demo** keep GitHub Pages set to `Deploy from a branch` / `main` / `/(root)`. After a commit, check the Pages status. This foundation does not require GitHub Actions to deploy Pages.

## Important Restrictions

- Never expose credentials or service-role secrets in browser code.
- Never let clients specify final outcome, balance, payouts, or ledger entries.
- Public beta requires real data-use/legal review, settlement evidence gates, and account protection.
- $100 USD per month ceiling is an operating requirement; **billing alerts are not hard spending caps**.
