CREATE TABLE IF NOT EXISTS sync_records (
    owner_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    record_key TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    client_updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    device_id TEXT NOT NULL,
    sequence BIGSERIAL NOT NULL,
    server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, collection, record_key)
);

CREATE INDEX IF NOT EXISTS sync_records_owner_sequence_idx
    ON sync_records (owner_id, sequence);

CREATE INDEX IF NOT EXISTS sync_records_owner_collection_idx
    ON sync_records (owner_id, collection);
