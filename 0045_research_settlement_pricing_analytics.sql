BEGIN;

CREATE VIEW internal.next_train_market_analytics
WITH (security_invoker = true)
AS
SELECT
    m.id AS market_id,
    m.stop_id,
    m.generated_at,
    m.lock_at,
    m.deadline,
    l.phase,
    s.conservative_outcome,
    s.movement_outcome,
    s.reason_code,
    s.rule_version,
    s.decided_at,
    extract(epoch FROM
        s.decided_at - m.deadline
    )::double precision AS settlement_seconds,
    f.yes_probability_ppm / 1000000.0
        AS opening_probability,
    f.model_version AS opening_model,
    z.yes_probability_ppm / 1000000.0
        AS final_probability,
    z.model_version AS final_model,
    extract(epoch FROM
        m.lock_at - z.issued_at
    )::double precision AS final_quote_lead_seconds,
    s.conservative_outcome = 'VOID'
        AND s.movement_outcome IN ('YES','NO')
        AS movement_rescued,
    s.conservative_outcome IN ('YES','NO')
        AND s.movement_outcome IN ('YES','NO')
        AND s.conservative_outcome <> s.movement_outcome
        AS decisive_disagreement
FROM internal.next_train_research m
JOIN internal.next_train_research_lifecycle l
    ON l.id = m.id
LEFT JOIN internal.next_train_shadow_outcomes s
    ON s.market_id = m.id
LEFT JOIN LATERAL (
    SELECT
        q.yes_probability_ppm,
        q.model_version,
        q.issued_at
    FROM internal.next_train_research_quotes q
    WHERE q.market_id = m.id
    AND q.issued_at >= m.generated_at
    AND q.issued_at < m.lock_at
    ORDER BY q.issued_at, q.id
    LIMIT 1
) f ON true
LEFT JOIN LATERAL (
    SELECT
        q.yes_probability_ppm,
        q.model_version,
        q.issued_at
    FROM internal.next_train_research_quotes q
    WHERE q.market_id = m.id
    AND q.issued_at >= m.generated_at
    AND q.issued_at < m.lock_at
    ORDER BY q.issued_at DESC, q.id DESC
    LIMIT 1
) z ON true;

REVOKE ALL ON internal.next_train_market_analytics
FROM PUBLIC, anon, authenticated;

CREATE VIEW internal.next_train_settlement_summary
WITH (security_invoker = true)
AS
SELECT
    stop_id,
    count(*) AS markets,
    count(decided_at) AS settled,
    count(*) FILTER (
        WHERE conservative_outcome = 'YES'
    ) AS yes_count,
    count(*) FILTER (
        WHERE conservative_outcome = 'NO'
    ) AS no_count,
    count(*) FILTER (
        WHERE conservative_outcome = 'VOID'
    ) AS void_count,
    count(*) FILTER (
        WHERE movement_outcome IN ('YES','NO')
    ) AS movement_decisive,
    count(*) FILTER (
        WHERE movement_rescued
    ) AS movement_rescued,
    count(*) FILTER (
        WHERE decisive_disagreement
    ) AS decisive_disagreements,
    count(*) FILTER (
        WHERE conservative_outcome IN ('YES','NO')
        OR movement_rescued
    ) AS hybrid_decisive,
    avg(settlement_seconds) AS avg_settlement_seconds
FROM internal.next_train_market_analytics
GROUP BY GROUPING SETS ((stop_id),());

REVOKE ALL ON internal.next_train_settlement_summary
FROM PUBLIC, anon, authenticated;

CREATE VIEW internal.next_train_pricing_calibration
WITH (security_invoker = true)
AS
SELECT
    a.rule_version,
    p.model_version,
    p.quote_stage,
    o.method,
    least(
        9,
        floor(p.probability * 10)::integer
    ) AS probability_bucket,
    count(*) AS market_count,
    avg(p.probability) AS mean_probability,
    avg((o.outcome = 'YES')::integer)
        AS observed_yes_rate,
    avg(power(
        p.probability -
        (o.outcome = 'YES')::integer,
        2
    )) AS brier_score
FROM internal.next_train_market_analytics a
CROSS JOIN LATERAL (
    VALUES
        (
            'OPENING',
            a.opening_model,
            a.opening_probability
        ),
        (
            'FINAL',
            a.final_model,
            a.final_probability
        )
) p(quote_stage, model_version, probability)
CROSS JOIN LATERAL (
    VALUES
        ('CONSERVATIVE', a.conservative_outcome),
        ('MOVEMENT', a.movement_outcome)
) o(method, outcome)
WHERE p.probability IS NOT NULL
AND o.outcome IN ('YES','NO')
GROUP BY
    a.rule_version,
    p.model_version,
    p.quote_stage,
    o.method,
    least(9, floor(p.probability * 10)::integer);

REVOKE ALL ON internal.next_train_pricing_calibration
FROM PUBLIC, anon, authenticated;

COMMIT;
