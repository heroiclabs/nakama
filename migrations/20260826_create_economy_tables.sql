-- +migrate Up
-- LNBQSHA Economy Schema — Production
-- PostgreSQL ACID transaction untuk wallet, ledger, idempotency

-- ============================================================
-- TABLE: lnbqsha_wallet
-- Current state / projection. BUKAN historical truth.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_wallet (
    user_id UUID PRIMARY KEY,
    soft_balance BIGINT NOT NULL DEFAULT 0 CHECK (soft_balance >= 0),
    premium_balance BIGINT NOT NULL DEFAULT 0 CHECK (premium_balance >= 0),
    last_operation_id UUID,  -- trace/index SAHAJA, BUKAN historical truth
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_user ON lnbqsha_wallet(user_id);

-- ============================================================
-- TABLE: lnbqsha_wallet_ledger
-- Historical truth. Immutable. Append-only.
-- 1 operation_id = 1 currency mutation = 1 ledger row.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_wallet_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL UNIQUE,  -- KUNCI: satu ledger per operation
    user_id UUID NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    currency VARCHAR(20) NOT NULL CHECK (currency IN ('soft', 'premium')),
    amount BIGINT NOT NULL CHECK (amount <> 0),  -- positive = credit, negative = debit
    balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
    operation VARCHAR(30) NOT NULL CHECK (operation IN ('earn', 'spend', 'grant', 'refund', 'purchase', 'initial_balance')),
    source VARCHAR(50) NOT NULL CHECK (source IN ('game_result', 'tournament', 'payment_webhook', 'admin', 'promotion', 'migration', 'reconciliation')),
    reference_id VARCHAR(255),
    intent JSONB NOT NULL,  -- immutable snapshot of operation intent
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES lnbqsha_wallet(user_id) ON DELETE RESTRICT
);

CREATE INDEX idx_ledger_user ON lnbqsha_wallet_ledger(user_id, created_at DESC);
CREATE INDEX idx_ledger_operation ON lnbqsha_wallet_ledger(operation_id);
CREATE INDEX idx_ledger_idempotency ON lnbqsha_wallet_ledger(idempotency_key);

-- ============================================================
-- TRIGGER: Ledger Immutability
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Ledger is immutable. No UPDATE or DELETE allowed.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_immutable_update ON lnbqsha_wallet_ledger;
CREATE TRIGGER ledger_immutable_update
BEFORE UPDATE ON lnbqsha_wallet_ledger
EXECUTE FUNCTION prevent_ledger_mutation();

DROP TRIGGER IF EXISTS ledger_immutable_delete ON lnbqsha_wallet_ledger;
CREATE TRIGGER ledger_immutable_delete
BEFORE DELETE ON lnbqsha_wallet_ledger
EXECUTE FUNCTION prevent_ledger_mutation();

-- ============================================================
-- TABLE: lnbqsha_idempotency
-- Request processing state machine.
-- operation_id UNIQUE = one operation_id per idempotency record.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_idempotency (
    idempotency_key VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL,
    operation_id UUID NOT NULL UNIQUE,  -- ← UNIQUE untuk mencegah duplikasi operation_id
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'completed', 'failed_retryable', 'failed_permanent')),
    intent JSONB NOT NULL,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (idempotency_key, user_id),
    FOREIGN KEY (user_id) REFERENCES lnbqsha_wallet(user_id) ON DELETE RESTRICT
);

CREATE INDEX idx_idempotency_operation ON lnbqsha_idempotency(operation_id);
CREATE INDEX idx_idempotency_status ON lnbqsha_idempotency(status, created_at);

-- ============================================================
-- TABLE: lnbqsha_migration_metadata
-- Untuk tracking migration state
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_migration_metadata (
    id SERIAL PRIMARY KEY,
    phase VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    total_users INTEGER,
    processed_users INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_details TEXT
);

-- ============================================================
-- VIEW: wallet_projection (optional, untuk debug)
-- ============================================================

CREATE OR REPLACE VIEW lnbqsha_wallet_projection AS
SELECT
    w.user_id,
    w.soft_balance AS wallet_soft,
    w.premium_balance AS wallet_premium,
    COALESCE(SUM(l.amount) FILTER (WHERE l.currency = 'soft'), 0) AS ledger_soft_sum,
    COALESCE(SUM(l.amount) FILTER (WHERE l.currency = 'premium'), 0) AS ledger_premium_sum,
    w.version,
    w.last_operation_id
FROM lnbqsha_wallet w
LEFT JOIN lnbqsha_wallet_ledger l ON w.user_id = l.user_id
GROUP BY w.user_id;

-- ============================================================
-- +migrate Down
-- ============================================================

DROP VIEW IF EXISTS lnbqsha_wallet_projection;
DROP TABLE IF EXISTS lnbqsha_idempotency;
DROP TABLE IF EXISTS lnbqsha_wallet_ledger;
DROP TABLE IF EXISTS lnbqsha_wallet;
DROP TABLE IF EXISTS lnbqsha_migration_metadata;
DROP FUNCTION IF EXISTS prevent_ledger_mutation();
