BEGIN;

CREATE FUNCTION internal.next_train_research_phase(
    p_generated_at timestamptz,
    p_lock_at timestamptz,
    p_deadline timestamptz,
    p_at timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE
        WHEN p_at < p_generated_at THEN 'PENDING'
        WHEN p_at < p_lock_at THEN 'OPEN'
        WHEN p_at < p_deadline THEN 'LOCKED'
        ELSE 'VERIFYING'
    END;
$$;

REVOKE ALL ON FUNCTION
    internal.next_train_research_phase(
        timestamptz,
        timestamptz,
        timestamptz,
        timestamptz
    )
FROM PUBLIC, anon, authenticated;

CREATE VIEW internal.next_train_research_lifecycle
WITH (security_invoker = true)
AS
SELECT
    m.*,
    internal.next_train_research_phase(
        m.generated_at,
        m.lock_at,
        m.deadline,
        statement_timestamp()
    ) AS phase
FROM internal.next_train_research m;

REVOKE ALL ON internal.next_train_research_lifecycle
FROM PUBLIC, anon, authenticated;

CREATE INDEX idx_next_train_research_deadline
ON internal.next_train_research(deadline);

CREATE INDEX idx_next_train_research_lock_at
ON internal.next_train_research(lock_at);

COMMIT;
