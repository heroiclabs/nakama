-- +migrate Up
-- ============================================================
-- LNBQSHA ECONOMY SCHEMA — PRODUCTION
-- Version: 2026-08-27
-- Target: PostgreSQL 16+
--
-- Purpose:
--   Production-grade economy foundation using PostgreSQL.
--
-- Core guarantees:
--   - ACID wallet mutation
--   - Immutable append-only ledger
--   - Idempotent requests
--   - Multi-currency transactions
--   - Server-generated transaction/mutation identities
--   - Deterministic reconciliation
--   - No client-controlled economic values
--
-- IMPORTANT:
--   This schema does NOT by itself guarantee atomicity.
--   All economy mutations MUST be executed inside one PostgreSQL
--   transaction containing wallet + ledger + idempotency changes.
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================

-- pgcrypto required for gen_random_uuid()
-- If your environment restricts extension creation by migration,
-- install this extension manually before running migration.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- TABLE: lnbqsha_wallet
--
-- Current wallet state / projection.
--
-- Historical truth is the ledger.
-- Wallet contains the current materialized balance.
--
-- last_transaction_id is ONLY an auxiliary trace/index.
-- It is NOT historical truth.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_wallet (
    user_id UUID PRIMARY KEY,

    soft_balance BIGINT NOT NULL DEFAULT 0
        CHECK (soft_balance >= 0),

    premium_balance BIGINT NOT NULL DEFAULT 0
        CHECK (premium_balance >= 0),

    -- Auxiliary trace only.
    -- Nullable for initial wallet creation.
    last_transaction_id UUID,

    -- Optimistic/versioning metadata.
    version BIGINT NOT NULL DEFAULT 1
        CHECK (version >= 1),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PRIMARY KEY (user_id) already creates unique index.
-- Additional index for last_transaction_id trace lookups.
CREATE INDEX IF NOT EXISTS idx_wallet_last_transaction
    ON lnbqsha_wallet(last_transaction_id);


-- ============================================================
-- TABLE: lnbqsha_wallet_ledger
--
-- Historical source of truth.
--
-- transaction_id:
--   One logical economic transaction.
--
-- operation_id:
--   One individual currency mutation.
--
-- Example:
--
--   transaction_id = TXN-1
--       ├── operation_id = OP-SOFT
--       │      └── soft -100
--       │
--       └── operation_id = OP-PREMIUM
--              └── premium +10
--
-- Therefore:
--
--   One transaction_id MAY have many ledger rows.
--   One operation_id MUST have exactly one ledger row.
--
-- Ledger is append-only and immutable.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_wallet_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    transaction_id UUID NOT NULL,

    operation_id UUID NOT NULL UNIQUE,

    user_id UUID NOT NULL,

    idempotency_key VARCHAR(255) NOT NULL,

    currency VARCHAR(20) NOT NULL
        CHECK (currency IN ('soft', 'premium')),

    -- Positive = credit
    -- Negative = debit
    amount BIGINT NOT NULL
        CHECK (amount <> 0),

    balance_after BIGINT NOT NULL
        CHECK (balance_after >= 0),

    operation VARCHAR(30) NOT NULL
        CHECK (
            operation IN (
                'earn',
                'spend',
                'grant',
                'refund',
                'purchase',
                'initial_balance'
            )
        ),

    source VARCHAR(50) NOT NULL
        CHECK (
            source IN (
                'game_result',
                'tournament',
                'payment_webhook',
                'admin',
                'promotion',
                'migration',
                'reconciliation'
            )
        ),

    reference_id VARCHAR(255),

    -- Immutable snapshot of the economic intent.
    intent JSONB NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_ledger_wallet
        FOREIGN KEY (user_id)
        REFERENCES lnbqsha_wallet(user_id)
        ON DELETE RESTRICT
);

-- UNIQUE(operation_id) already creates unique index.
-- Additional indexes for common query patterns.
CREATE INDEX IF NOT EXISTS idx_ledger_user_created
    ON lnbqsha_wallet_ledger(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_transaction
    ON lnbqsha_wallet_ledger(transaction_id);

CREATE INDEX IF NOT EXISTS idx_ledger_idempotency
    ON lnbqsha_wallet_ledger(idempotency_key);


-- ============================================================
-- LEDGER IMMUTABILITY
--
-- INSERT is allowed.
-- UPDATE and DELETE are forbidden.
--
-- This is enforced at database level in addition to
-- application-level permissions.
-- ============================================================

CREATE OR REPLACE FUNCTION lnbqsha_prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'lnbqsha_wallet_ledger is immutable: UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;


DROP TRIGGER IF EXISTS lnbqsha_ledger_immutable_update
    ON lnbqsha_wallet_ledger;

CREATE TRIGGER lnbqsha_ledger_immutable_update
BEFORE UPDATE ON lnbqsha_wallet_ledger
FOR EACH ROW
EXECUTE FUNCTION lnbqsha_prevent_ledger_mutation();


DROP TRIGGER IF EXISTS lnbqsha_ledger_immutable_delete
    ON lnbqsha_wallet_ledger;

CREATE TRIGGER lnbqsha_ledger_immutable_delete
BEFORE DELETE ON lnbqsha_wallet_ledger
FOR EACH ROW
EXECUTE FUNCTION lnbqsha_prevent_ledger_mutation();


-- ============================================================
-- TABLE: lnbqsha_idempotency
--
-- Stores the lifecycle of a client economic request.
--
-- idempotency_key + user_id:
--   Unique client retry identity.
--
-- transaction_id:
--   Server-generated logical transaction identity.
--
-- IMPORTANT:
--   operation_id is intentionally NOT stored here because
--   one transaction can contain multiple currency mutations.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_idempotency (
    idempotency_key VARCHAR(255) NOT NULL,

    user_id UUID NOT NULL,

    transaction_id UUID NOT NULL UNIQUE,

    status VARCHAR(20) NOT NULL
        CHECK (
            status IN (
                'pending',
                'completed',
                'failed_retryable',
                'failed_permanent'
            )
        ),

    -- Immutable request/operation intent.
    intent JSONB NOT NULL,

    -- Cached result returned to duplicate requests.
    result JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    completed_at TIMESTAMPTZ,

    PRIMARY KEY (
        idempotency_key,
        user_id
    ),

    CONSTRAINT fk_idempotency_wallet
        FOREIGN KEY (user_id)
        REFERENCES lnbqsha_wallet(user_id)
        ON DELETE RESTRICT
);

-- UNIQUE(transaction_id) already creates unique index.
-- Additional indexes for common query patterns.
CREATE INDEX IF NOT EXISTS idx_idempotency_status
    ON lnbqsha_idempotency(status, created_at);


-- ============================================================
-- TABLE: lnbqsha_migration_metadata
--
-- Tracks migration execution state.
-- Used by migration tooling/reconciliation.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_migration_metadata (
    id BIGSERIAL PRIMARY KEY,

    phase VARCHAR(50) NOT NULL,

    status VARCHAR(20) NOT NULL,

    total_users BIGINT,

    processed_users BIGINT,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    completed_at TIMESTAMPTZ,

    error_details TEXT
);

CREATE INDEX IF NOT EXISTS idx_migration_phase_status
    ON lnbqsha_migration_metadata(phase, status);


-- ============================================================
-- VIEW: lnbqsha_wallet_projection
--
-- Reconciliation/debugging view.
--
-- Compares current wallet projection with ledger totals.
--
-- NOTE:
--   INITIAL_BALANCE rows represent the imported starting state.
--   Therefore ledger sums should reconcile to current wallet
--   balances after all valid mutations.
-- ============================================================

CREATE OR REPLACE VIEW lnbqsha_wallet_projection AS
SELECT
    w.user_id,

    w.soft_balance AS wallet_soft_balance,

    w.premium_balance AS wallet_premium_balance,

    COALESCE(
        SUM(l.amount)
        FILTER (WHERE l.currency = 'soft'),
        0
    ) AS ledger_soft_balance,

    COALESCE(
        SUM(l.amount)
        FILTER (WHERE l.currency = 'premium'),
        0
    ) AS ledger_premium_balance,

    w.version,

    w.last_transaction_id,

    w.created_at,

    w.updated_at

FROM lnbqsha_wallet w

LEFT JOIN lnbqsha_wallet_ledger l
    ON l.user_id = w.user_id

GROUP BY
    w.user_id,
    w.soft_balance,
    w.premium_balance,
    w.version,
    w.last_transaction_id,
    w.created_at,
    w.updated_at;


-- ============================================================
-- +migrate Down
--
-- ⚠️  WARNING: This destroys production economy data.
-- ⚠️  Production rollback must follow deployment policy.
-- ⚠️  Do NOT run this on production without explicit approval.
-- ============================================================

DROP VIEW IF EXISTS lnbqsha_wallet_projection;

DROP TRIGGER IF EXISTS lnbqsha_ledger_immutable_update
    ON lnbqsha_wallet_ledger;

DROP TRIGGER IF EXISTS lnbqsha_ledger_immutable_delete
    ON lnbqsha_wallet_ledger;

DROP FUNCTION IF EXISTS lnbqsha_prevent_ledger_mutation();

DROP TABLE IF EXISTS lnbqsha_idempotency;

DROP TABLE IF EXISTS lnbqsha_wallet_ledger;

DROP TABLE IF EXISTS lnbqsha_wallet;

DROP TABLE IF EXISTS lnbqsha_migration_metadata;
