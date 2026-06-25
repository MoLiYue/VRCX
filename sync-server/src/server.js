import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pg from 'pg';

const { Pool } = pg;

const port = Number(process.env.PORT || 8080);
const syncToken = process.env.SYNC_TOKEN || '';
const corsOrigin = process.env.CORS_ORIGIN || '*';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

if (!syncToken) {
  throw new Error('SYNC_TOKEN is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10)
});

const app = express();

app.use(helmet());
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin }));
app.use(express.json({ limit: process.env.JSON_LIMIT || '50mb' }));

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== syncToken) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

function parseRecord(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('record must be an object');
  }
  const collection = String(input.collection || '');
  const recordKey = String(input.recordKey || '');
  const deviceId = String(input.deviceId || '');
  const clientUpdatedAt = new Date(input.updatedAt || input.clientUpdatedAt || '');
  const deletedAt = input.deletedAt ? new Date(input.deletedAt) : null;

  if (!collection || collection.length > 80) {
    throw new Error('invalid collection');
  }
  if (!recordKey || recordKey.length > 300) {
    throw new Error('invalid recordKey');
  }
  if (!deviceId || deviceId.length > 120) {
    throw new Error('invalid deviceId');
  }
  if (Number.isNaN(clientUpdatedAt.getTime())) {
    throw new Error('invalid updatedAt');
  }
  if (deletedAt && Number.isNaN(deletedAt.getTime())) {
    throw new Error('invalid deletedAt');
  }

  return {
    collection,
    recordKey,
    deviceId,
    clientUpdatedAt: clientUpdatedAt.toISOString(),
    deletedAt: deletedAt ? deletedAt.toISOString() : null,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {}
  };
}

app.get('/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/sync/pull', requireAuth, async (req, res, next) => {
  try {
    const ownerId = String(req.query.ownerId || '');
    const since = Number(req.query.since || 0);
    const limit = Math.min(Number(req.query.limit || 1000), 5000);

    if (!ownerId || ownerId.length > 120) {
      res.status(400).json({ error: 'invalid ownerId' });
      return;
    }

    const result = await pool.query(
      `SELECT collection, record_key, payload, client_updated_at, deleted_at, device_id, sequence
         FROM sync_records
        WHERE owner_id = $1 AND sequence > $2
        ORDER BY sequence ASC
        LIMIT $3`,
      [ownerId, since, limit]
    );

    const records = result.rows.map((row) => ({
      collection: row.collection,
      recordKey: row.record_key,
      payload: row.payload,
      updatedAt: row.client_updated_at,
      deletedAt: row.deleted_at,
      deviceId: row.device_id,
      sequence: Number(row.sequence)
    }));

    res.json({
      records,
      cursor: records.length ? records[records.length - 1].sequence : since
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/sync/push', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const ownerId = String(req.body?.ownerId || '');
    const records = Array.isArray(req.body?.records) ? req.body.records : [];

    if (!ownerId || ownerId.length > 120) {
      res.status(400).json({ error: 'invalid ownerId' });
      return;
    }
    if (records.length > 5000) {
      res.status(400).json({ error: 'too many records' });
      return;
    }

    await client.query('BEGIN');

    let accepted = 0;
    for (const input of records) {
      const record = parseRecord(input);
      const result = await client.query(
        `INSERT INTO sync_records (
             owner_id, collection, record_key, payload, client_updated_at, deleted_at, device_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (owner_id, collection, record_key)
         DO UPDATE SET
             payload = EXCLUDED.payload,
             client_updated_at = EXCLUDED.client_updated_at,
             deleted_at = EXCLUDED.deleted_at,
             device_id = EXCLUDED.device_id,
             sequence = nextval('sync_records_sequence_seq'),
             server_updated_at = now()
         WHERE sync_records.client_updated_at < EXCLUDED.client_updated_at
         RETURNING sequence`,
        [
          ownerId,
          record.collection,
          record.recordKey,
          JSON.stringify(record.payload),
          record.clientUpdatedAt,
          record.deletedAt,
          record.deviceId
        ]
      );
      accepted += result.rowCount;
    }

    await client.query('COMMIT');
    res.json({ ok: true, accepted });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});

app.listen(port, () => {
  console.log(`VRCX sync server listening on ${port}`);
});
