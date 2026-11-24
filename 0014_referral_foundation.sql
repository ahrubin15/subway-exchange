BEGIN;

CREATE TABLE public.referrals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id uuid NOT NULL
        REFERENCES public.players(id),
    referred_id uuid NOT NULL UNIQUE
        REFERENCES public.players(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    qualified_at timestamptz,
    rewarded_at timestamptz,
    CHECK (referrer_id <> referred_id),
    CHECK (
        rewarded_at IS NULL OR
        (qualified_at IS NOT NULL
         AND rewarded_at >= qualified_at)
    )
);

CREATE INDEX idx_referrals_referrer
ON public.referrals(referrer_id);

ALTER TABLE public.referrals
ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.referrals
FROM PUBLIC, anon, authenticated;

COMMIT;
