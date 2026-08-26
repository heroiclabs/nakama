-- +migrate Up
-- LNBQSHA Economy Schema — Production
-- PostgreSQL ACID transaction untuk wallet, ledger, idempotency, intent

-- ============================================================
-- TABLE: lnbqsha_wallet
-- Current state / projection. BUKAN historical truth.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_wallet (
    user_id UUID PRIMARY KEY,
    soft_balance BIGINT NOT NULL DEFAULT 0 CHECK (soft_balance >= 0),
    premium_balance BIGINT NOT NULL DEFAULT 0 CHECK (premium_balance >= 0),
    last_operation_id UUID,  -- trace/index, BUKAN historical truth
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_wallet_user ON lnbqsha_wallet(user_id);

-- ============================================================
-- TABLE: lnbqsha_wallet_ledger
-- Historical truth. Immutable. Append-only.
-- UNIQUE(operation_id) menjamin satu ledger per operation.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_wallet_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL UNIQUE,  -- KUNCI: satu ledger per operation
    user_id UUID NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    currency VARCHAR(20) NOT NULL CHECK (currency IN ('soft', 'premium')),
    amount BIGINT NOT NULL,  -- positive = credit, negative = debit
    balance_after BIGINT NOT NULL,
    operation VARCHAR(30) NOT NULL CHECK (operation IN ('earn', 'spend', 'grant', 'refund', 'purchase', 'initial_balance')),
    source VARCHAR(50) NOT NULL CHECK (source IN ('game_result', 'tournament', 'payment_webhook', 'admin', 'promotion', 'migration', 'reconciliation')),
    reference_id VARCHAR(255),
    intent JSONB NOT NULL,  -- immutable snapshot of operation intent
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_idempotency (
    idempotency_key VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL,
    operation_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'completed', 'failed_retryable', 'failed_permanent')),
    intent JSONB NOT NULL,
    result JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (idempotency_key, user_id)  -- scoped ke user
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
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    error_details TEXT
);

-- ============================================================
-- DATABASE ROLE & PERMISSIONS (Production)
-- ============================================================

-- Buat role untuk economy service (JALANKAN SECARA TERPISAH)
-- DO NOT RUN IN MIGRATION — dijalankan oleh DBA
--
-- CREATE ROLE economy_service WITH LOGIN PASSWORD '...';
-- GRANT SELECT, UPDATE ON lnbqsha_wallet TO economy_service;
-- GRANT SELECT, INSERT ON lnbqsha_wallet_ledger TO economy_service;
-- GRANT SELECT, INSERT, UPDATE ON lnbqsha_idempotency TO economy_service;
-- GRANT SELECT, INSERT, UPDATE ON lnbqsha_migration_metadata TO economy_service;
--
-- REVOKE UPDATE, DELETE ON lnbqsha_wallet_ledger FROM economy_service;

-- ============================================================
-- +migrate Down
-- ============================================================

DROP TABLE IF EXISTS lnbqsha_idempotency;
DROP TABLE IF EXISTS lnbqsha_wallet_ledger;
DROP TABLE IF EXISTS lnbqsha_wallet;
DROP TABLE IF EXISTS lnbqsha_migration_metadata;
DROP FUNCTION IF EXISTS prevent_ledger_mutation();
