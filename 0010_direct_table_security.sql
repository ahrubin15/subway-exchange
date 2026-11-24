BEGIN;

REVOKE ALL PRIVILEGES ON TABLE
    public.players,
    public.wallets,
    public.tickets,
    public.token_ledger,
    public.markets,
    public.quotes,
    public.market_templates,
    public.market_outcomes,
    public.transit_observations,
    public.leagues,
    public.league_members,
    public.league_invites
FROM PUBLIC, anon, authenticated;

COMMIT;
