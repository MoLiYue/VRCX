import sqliteService from '../sqlite.js';

function nowIso() {
    return new Date().toISOString();
}

const syncMetadata = {
    async markSyncRecord(collection, recordKey, updatedAt = nowIso(), deletedAt = null) {
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO sync_metadata (collection, record_key, updated_at, deleted_at)
             VALUES (@collection, @record_key, @updated_at, @deleted_at)`,
            {
                '@collection': collection,
                '@record_key': recordKey,
                '@updated_at': updatedAt,
                '@deleted_at': deletedAt
            }
        );
    },

    async getSyncMetadata() {
        const map = new Map();
        await sqliteService.execute((dbRow) => {
            map.set(`${dbRow[0]}:${dbRow[1]}`, {
                collection: dbRow[0],
                recordKey: dbRow[1],
                updatedAt: dbRow[2],
                deletedAt: dbRow[3] || null
            });
        }, `SELECT collection, record_key, updated_at, deleted_at FROM sync_metadata`);
        return map;
    },

    async getSyncMetadataEntry(collection, recordKey) {
        let row = null;
        await sqliteService.execute(
            (dbRow) => {
                row = {
                    collection: dbRow[0],
                    recordKey: dbRow[1],
                    updatedAt: dbRow[2],
                    deletedAt: dbRow[3] || null
                };
            },
            `SELECT collection, record_key, updated_at, deleted_at
               FROM sync_metadata
              WHERE collection = @collection AND record_key = @record_key`,
            {
                '@collection': collection,
                '@record_key': recordKey
            }
        );
        return row;
    }
};

export { syncMetadata };
