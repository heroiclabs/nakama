-- +migrate Up

-- ============================================================
-- LNBQSHA ECONOMY — PRODUCTION POSTGRESQL SCHEMA
-- Migration: 20260826_create_economy_tables
--
-- Design principles:
--   - PostgreSQL is the production source of truth.
--   - Wallet is the current projection.
--   - Ledger is immutable historical truth.
--   - Idempotency is scoped per user.
--   - One operation_id represents exactly one currency mutation.
--   - Client never controls authoritative economic values.
--   - Runtime service must use ACID transactions.
--
-- IMPORTANT:
--   This migration does NOT create the runtime database role.
--   Runtime credentials must be provisioned separately by DBA/
--   deployment infrastructure.
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- TABLE: lnbqsha_wallet
--
-- Current wallet projection.
--
-- IMPORTANT:
--   This table is NOT historical truth.
--   Historical truth lives in lnbqsha_wallet_ledger.
--
-- last_operation_id:
--   Auxiliary trace/index only.
--   It MUST NOT be interpreted as proof that an operation
--   was or was not historically applied.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_wallet (
    user_id UUID PRIMARY KEY,

    soft_balance BIGINT NOT NULL DEFAULT 0
        CHECK (soft_balance >= 0),

    premium_balance BIGINT NOT NULL DEFAULT 0
        CHECK (premium_balance >= 0),

    last_operation_id UUID,

    version BIGINT NOT NULL DEFAULT 1
        CHECK (version >= 1),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- TABLE: lnbqsha_wallet_ledger
--
-- Immutable append-only historical ledger.
--
-- INVARIANT:
--   One operation_id = one currency mutation = one ledger row.
--
-- Therefore operation_id is globally UNIQUE.
--
-- Positive amount:
--   credit
--
-- Negative amount:
--   debit
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_wallet_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    operation_id UUID NOT NULL UNIQUE,

    user_id UUID NOT NULL,

    idempotency_key VARCHAR(255) NOT NULL,

    currency VARCHAR(20) NOT NULL
        CHECK (currency IN ('soft', 'premium')),

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

    -- Immutable snapshot of the authoritative operation intent.
    intent JSONB NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_ledger_wallet
        FOREIGN KEY (user_id)
        REFERENCES lnbqsha_wallet(user_id)
        ON DELETE RESTRICT
);


-- ============================================================
-- LEDGER INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_ledger_user_created
    ON lnbqsha_wallet_ledger(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_operation
    ON lnbqsha_wallet_ledger(operation_id);

CREATE INDEX IF NOT EXISTS idx_ledger_idempotency
    ON lnbqsha_wallet_ledger(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_ledger_reference
    ON lnbqsha_wallet_ledger(reference_id);


-- ============================================================
-- TABLE: lnbqsha_idempotency
--
-- Application-level idempotency state.
--
-- Primary key:
--   (idempotency_key, user_id)
--
-- This prevents one user from submitting the same logical
-- operation multiple times.
--
-- operation_id is also UNIQUE so that one server-generated
-- operation cannot belong to multiple idempotency records.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_idempotency (
    idempotency_key VARCHAR(255) NOT NULL,

    user_id UUID NOT NULL,

    operation_id UUID NOT NULL,

    status VARCHAR(20) NOT NULL
        CHECK (
            status IN (
                'pending',
                'completed',
                'failed_retryable',
                'failed_permanent'
            )
        ),

    -- Immutable operation snapshot.
    intent JSONB NOT NULL,

    -- Cached final response.
    result JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    completed_at TIMESTAMPTZ,

    PRIMARY KEY (idempotency_key, user_id),

    CONSTRAINT uq_idempotency_operation
        UNIQUE (operation_id),

    CONSTRAINT fk_idempotency_wallet
        FOREIGN KEY (user_id)
        REFERENCES lnbqsha_wallet(user_id)
        ON DELETE RESTRICT
);


-- ============================================================
-- IDEMPOTENCY INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_idempotency_operation
    ON lnbqsha_idempotency(operation_id);

CREATE INDEX IF NOT EXISTS idx_idempotency_status_created
    ON lnbqsha_idempotency(status, created_at);


-- ============================================================
-- TABLE: lnbqsha_migration_metadata
--
-- Tracks migration/import/reconciliation phases.
-- This table is operational metadata, not economy truth.
-- ============================================================

CREATE TABLE IF NOT EXISTS lnbqsha_migration_metadata (
    id BIGSERIAL PRIMARY KEY,

    phase VARCHAR(50) NOT NULL,

    status VARCHAR(20) NOT NULL
        CHECK (
            status IN (
                'pending',
                'running',
                'completed',
                'failed'
            )
        ),

    total_users BIGINT,

    processed_users BIGINT NOT NULL DEFAULT 0
        CHECK (processed_users >= 0),

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    completed_at TIMESTAMPTZ,

    error_details TEXT
);


-- ============================================================
-- TRIGGER FUNCTION: LEDGER IMMUTABILITY
--
-- Ledger rows may be INSERTED.
-- Ledger rows may NEVER be UPDATEd or DELETEd.
--
-- Corrections must be represented by a new compensating
-- transaction, e.g. refund/reconciliation.
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Ledger is immutable: UPDATE and DELETE are forbidden';
END;
$$;


-- ============================================================
-- LEDGER IMMUTABILITY TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS ledger_immutable_update
    ON lnbqsha_wallet_ledger;

CREATE TRIGGER ledger_immutable_update
BEFORE UPDATE ON lnbqsha_wallet_ledger
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_mutation();


DROP TRIGGER IF EXISTS ledger_immutable_delete
    ON lnbqsha_wallet_ledger;

CREATE TRIGGER ledger_immutable_delete
BEFORE DELETE ON lnbqsha_wallet_ledger
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_mutation();


-- ============================================================
-- TABLE COMMENTS
-- ============================================================

COMMENT ON TABLE lnbqsha_wallet IS
'Current economy projection. Not historical truth.';

COMMENT ON COLUMN lnbqsha_wallet.last_operation_id IS
'Auxiliary trace/index only. Must not be interpreted as historical proof.';

COMMENT ON TABLE lnbqsha_wallet_ledger IS
'Immutable append-only economy history and audit trail.';

COMMENT ON COLUMN lnbqsha_wallet_ledger.operation_id IS
'Server-generated immutable operation identity. One operation_id equals one currency mutation.';

COMMENT ON COLUMN lnbqsha_wallet_ledger.intent IS
'Immutable snapshot of the authoritative server-side operation intent.';

COMMENT ON TABLE lnbqsha_idempotency IS
'Application idempotency state machine scoped by user and idempotency key.';


-- +migrate Down

-- ============================================================
-- DOWN MIGRATION
--
-- WARNING:
--   This permanently deletes economy data.
--   Production rollback should normally be handled by a
--   forward migration rather than destructive rollback.
-- ============================================================

DROP TRIGGER IF EXISTS ledger_immutable_update
    ON lnbqsha_wallet_ledger;

DROP TRIGGER IF EXISTS ledger_immutable_delete
    ON lnbqsha_wallet_ledger;

DROP TABLE IF EXISTS lnbqsha_idempotency;

DROP TABLE IF EXISTS lnbqsha_wallet_ledger;

DROP TABLE IF EXISTS lnbqsha_migration_metadata;

DROP TABLE IF EXISTS lnbqsha_wallet;

DROP FUNCTION IF EXISTS prevent_ledger_mutation();
