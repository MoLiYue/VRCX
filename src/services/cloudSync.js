import configRepository from './config.js';
import { database, dbVars } from './database';
import sqliteService from './sqlite.js';

const SYNC_ENABLED_KEY = 'VRCX_cloudSyncEnabled';
const SYNC_ENDPOINT_KEY = 'VRCX_cloudSyncEndpoint';
const SYNC_TOKEN_KEY = 'VRCX_cloudSyncToken';
const SYNC_DEVICE_ID_KEY = 'VRCX_cloudSyncDeviceId';
const SYNC_CURSOR_KEY = 'VRCX_cloudSyncCursor';
const SYNC_LAST_RUN_KEY = 'VRCX_cloudSyncLastRun';

const FALLBACK_UPDATED_AT = '1970-01-01T00:00:00.000Z';
const GAME_LOG_TABLES = [
    'gamelog_location',
    'gamelog_join_leave',
    'gamelog_portal_spawn',
    'gamelog_video_play',
    'gamelog_resource_load',
    'gamelog_event',
    'gamelog_external'
];
const SYNC_COLLECTIONS = new Set([
    'user_memos',
    'world_memos',
    'avatar_memos',
    'avatar_tags',
    'favorite_world',
    'favorite_avatar',
    'favorite_friend',
    'friend_log_history',
    'notifications',
    'notifications_v2',
    ...GAME_LOG_TABLES
]);

function normalizeEndpoint(endpoint) {
    return String(endpoint || '').replace(/\/+$/, '');
}

function metadataKey(collection, recordKey) {
    return `${collection}:${recordKey}`;
}

function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function compactKey(parts) {
    const value = parts.map((part) => String(part ?? '')).join('|');
    const prefix = String(parts[0] ?? '').slice(0, 80);
    return `${prefix}:${hashString(value)}`;
}

function isRemoteNewer(remoteUpdatedAt, localEntry) {
    if (!localEntry?.updatedAt) {
        return true;
    }
    return new Date(remoteUpdatedAt).getTime() >= new Date(localEntry.updatedAt).getTime();
}

function makeRecord(collection, recordKey, payload, metadata, deviceId, fallbackUpdatedAt = FALLBACK_UPDATED_AT) {
    return {
        collection,
        recordKey,
        payload,
        updatedAt: metadata?.updatedAt || fallbackUpdatedAt,
        deletedAt: metadata?.deletedAt || null,
        deviceId
    };
}

function rowToObject(columns, row) {
    return Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null]));
}

async function queryRows(sql, args = null) {
    const rows = [];
    await sqliteService.execute((row) => rows.push(row), sql, args);
    return rows;
}

async function queryObjects(sql, columns, args = null) {
    const rows = await queryRows(sql, args);
    return rows.map((row) => rowToObject(columns, row));
}

function recordUpdatedAt(payload) {
    return payload.updated_at || payload.updatedAt || payload.edited_at || payload.editedAt || payload.created_at || payload.createdAt || FALLBACK_UPDATED_AT;
}

function favoriteKey(entityId, groupName) {
    return `${entityId}:${groupName}`;
}

function splitFavoriteKey(recordKey) {
    const [id, ...groupParts] = String(recordKey || '').split(':');
    return {
        id,
        groupName: groupParts.join(':')
    };
}

function gameLogKey(collection, row) {
    if (collection === 'gamelog_location') {
        return compactKey([row.created_at, row.location]);
    }
    if (collection === 'gamelog_join_leave') {
        return compactKey([row.created_at, row.type, row.display_name]);
    }
    if (collection === 'gamelog_portal_spawn') {
        return compactKey([row.created_at, row.display_name]);
    }
    if (collection === 'gamelog_video_play') {
        return compactKey([row.created_at, row.video_url]);
    }
    if (collection === 'gamelog_resource_load') {
        return compactKey([row.created_at, row.resource_url]);
    }
    if (collection === 'gamelog_event') {
        return compactKey([row.created_at, row.data]);
    }
    if (collection === 'gamelog_external') {
        return compactKey([row.created_at, row.message]);
    }
    return compactKey([collection, JSON.stringify(row)]);
}

function makeSyncRecord(collection, recordKey, payload, metadata, deviceId) {
    const entry = metadata.get(metadataKey(collection, recordKey));
    return makeRecord(collection, recordKey, payload, entry, deviceId, recordUpdatedAt(payload));
}

async function requestSync(path, options = {}) {
    const endpoint = normalizeEndpoint(await configRepository.getString(SYNC_ENDPOINT_KEY, ''));
    const token = await configRepository.getString(SYNC_TOKEN_KEY, '');
    if (!endpoint) {
        throw new Error('Sync endpoint is not configured');
    }
    if (!token) {
        throw new Error('Sync token is not configured');
    }

    const response = await fetch(`${endpoint}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        throw new Error(`Sync request failed: ${response.status}`);
    }
    return response.json();
}

async function getDeviceId() {
    let deviceId = await configRepository.getString(SYNC_DEVICE_ID_KEY, '');
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        await configRepository.setString(SYNC_DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
}

async function collectLocalRecords(deviceId) {
    const metadata = await database.getSyncMetadata();
    const records = [];

    for (const memo of await database.getAllUserMemos()) {
        const recordKey = memo.userId;
        const entry = metadata.get(metadataKey('user_memos', recordKey));
        records.push(
            makeRecord(
                'user_memos',
                recordKey,
                memo,
                entry,
                deviceId,
                memo.editedAt || FALLBACK_UPDATED_AT
            )
        );
    }

    for (const memo of await database.getAllWorldMemos()) {
        const recordKey = memo.worldId;
        const entry = metadata.get(metadataKey('world_memos', recordKey));
        records.push(
            makeRecord(
                'world_memos',
                recordKey,
                memo,
                entry,
                deviceId,
                memo.editedAt || FALLBACK_UPDATED_AT
            )
        );
    }

    for (const memo of await database.getAllAvatarMemos()) {
        const recordKey = memo.avatarId;
        const entry = metadata.get(metadataKey('avatar_memos', recordKey));
        records.push(
            makeRecord(
                'avatar_memos',
                recordKey,
                memo,
                entry,
                deviceId,
                memo.editedAt || FALLBACK_UPDATED_AT
            )
        );
    }

    const avatarTags = await database.getAllAvatarTags();
    for (const [avatarId, tags] of avatarTags.entries()) {
        for (const tag of tags) {
            const recordKey = `${avatarId}:${tag.tag}`;
            const entry = metadata.get(metadataKey('avatar_tags', recordKey));
            records.push(
                makeRecord(
                    'avatar_tags',
                    recordKey,
                    {
                        avatarId,
                        tag: tag.tag,
                        color: tag.color
                    },
                    entry,
                    deviceId
                )
            );
        }
    }

    for (const row of await database.getWorldFavorites()) {
        records.push(
            makeSyncRecord(
                'favorite_world',
                favoriteKey(row.worldId, row.groupName),
                row,
                metadata,
                deviceId
            )
        );
    }

    for (const row of await database.getAvatarFavorites()) {
        records.push(
            makeSyncRecord(
                'favorite_avatar',
                favoriteKey(row.avatarId, row.groupName),
                row,
                metadata,
                deviceId
            )
        );
    }

    for (const row of await database.getFriendFavorites()) {
        records.push(
            makeSyncRecord(
                'favorite_friend',
                favoriteKey(row.userId, row.groupName),
                row,
                metadata,
                deviceId
            )
        );
    }

    for (const row of await collectFriendLogHistory()) {
        records.push(
            makeSyncRecord(
                'friend_log_history',
                compactKey([row.created_at, row.type, row.user_id]),
                row,
                metadata,
                deviceId
            )
        );
    }

    for (const row of await collectNotifications()) {
        records.push(makeSyncRecord('notifications', row.id, row, metadata, deviceId));
    }

    for (const row of await collectNotificationsV2()) {
        records.push(makeSyncRecord('notifications_v2', row.id, row, metadata, deviceId));
    }

    for (const collection of GAME_LOG_TABLES) {
        for (const row of await collectGameLogTable(collection)) {
            records.push(makeSyncRecord(collection, gameLogKey(collection, row), row, metadata, deviceId));
        }
    }

    for (const entry of metadata.values()) {
        if (!SYNC_COLLECTIONS.has(entry.collection)) {
            continue;
        }
        if (!entry.deletedAt) {
            continue;
        }
        const exists = records.some(
            (record) => record.collection === entry.collection && record.recordKey === entry.recordKey
        );
        if (!exists) {
            records.push(makeRecord(entry.collection, entry.recordKey, {}, entry, deviceId));
        }
    }

    return dedupeRecords(records);
}

function dedupeRecords(records) {
    const map = new Map();
    for (const record of records) {
        const key = metadataKey(record.collection, record.recordKey);
        const existing = map.get(key);
        if (!existing || new Date(record.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
            map.set(key, record);
        }
    }
    return Array.from(map.values());
}

async function collectFriendLogHistory() {
    return queryObjects(
        `SELECT id, created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number FROM ${dbVars.userPrefix}_friend_log_history`,
        [
            'id',
            'created_at',
            'type',
            'user_id',
            'display_name',
            'previous_display_name',
            'trust_level',
            'previous_trust_level',
            'friend_number'
        ]
    );
}

async function collectNotifications() {
    return queryObjects(
        `SELECT id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired FROM ${dbVars.userPrefix}_notifications`,
        [
            'id',
            'created_at',
            'type',
            'sender_user_id',
            'sender_username',
            'receiver_user_id',
            'message',
            'world_id',
            'world_name',
            'image_url',
            'invite_message',
            'request_message',
            'response_message',
            'expired'
        ]
    );
}

async function collectNotificationsV2() {
    return queryObjects(
        `SELECT id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details FROM ${dbVars.userPrefix}_notifications_v2`,
        [
            'id',
            'created_at',
            'updated_at',
            'expires_at',
            'type',
            'link',
            'link_text',
            'message',
            'title',
            'image_url',
            'seen',
            'sender_user_id',
            'sender_username',
            'data',
            'responses',
            'details'
        ]
    );
}

async function collectGameLogTable(collection) {
    const columns = {
        gamelog_location: ['id', 'created_at', 'location', 'world_id', 'world_name', 'time', 'group_name'],
        gamelog_join_leave: ['id', 'created_at', 'type', 'display_name', 'location', 'user_id', 'time'],
        gamelog_portal_spawn: ['id', 'created_at', 'display_name', 'location', 'user_id', 'instance_id', 'world_name'],
        gamelog_video_play: ['id', 'created_at', 'video_url', 'video_name', 'video_id', 'location', 'display_name', 'user_id'],
        gamelog_resource_load: ['id', 'created_at', 'resource_url', 'resource_type', 'location'],
        gamelog_event: ['id', 'created_at', 'data'],
        gamelog_external: ['id', 'created_at', 'message', 'display_name', 'user_id', 'location']
    }[collection];
    return queryObjects(`SELECT ${columns.join(', ')} FROM ${collection}`, columns);
}

async function applyRemoteRecord(record) {
    const localEntry = await database.getSyncMetadataEntry(record.collection, record.recordKey);
    if (!isRemoteNewer(record.updatedAt, localEntry)) {
        return false;
    }

    if (record.deletedAt) {
        await deleteLocalRecord(record);
    } else {
        await upsertLocalRecord(record);
    }

    await database.markSyncRecord(record.collection, record.recordKey, record.updatedAt, record.deletedAt || null);
    return true;
}

async function upsertLocalRecord(record) {
    const payload = record.payload || {};
    if (record.collection === 'user_memos') {
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO memos (user_id, edited_at, memo)
             VALUES (@user_id, @edited_at, @memo)`,
            {
                '@user_id': payload.userId || record.recordKey,
                '@edited_at': payload.editedAt || record.updatedAt,
                '@memo': payload.memo || ''
            }
        );
        return;
    }
    if (record.collection === 'world_memos') {
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO world_memos (world_id, edited_at, memo)
             VALUES (@world_id, @edited_at, @memo)`,
            {
                '@world_id': payload.worldId || record.recordKey,
                '@edited_at': payload.editedAt || record.updatedAt,
                '@memo': payload.memo || ''
            }
        );
        return;
    }
    if (record.collection === 'avatar_memos') {
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO avatar_memos (avatar_id, edited_at, memo)
             VALUES (@avatar_id, @edited_at, @memo)`,
            {
                '@avatar_id': payload.avatarId || record.recordKey,
                '@edited_at': payload.editedAt || record.updatedAt,
                '@memo': payload.memo || ''
            }
        );
        return;
    }
    if (record.collection === 'avatar_tags') {
        const [avatarId, ...tagParts] = record.recordKey.split(':');
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO avatar_tags (avatar_id, tag, color)
             VALUES (@avatar_id, @tag, @color)`,
            {
                '@avatar_id': payload.avatarId || avatarId,
                '@tag': payload.tag || tagParts.join(':'),
                '@color': payload.color || null
            }
        );
        return;
    }
    if (record.collection === 'favorite_world') {
        await upsertFavorite('favorite_world', 'world_id', payload.worldId || payload.world_id, payload.groupName || payload.group_name, payload.created_at || record.updatedAt);
        return;
    }
    if (record.collection === 'favorite_avatar') {
        await upsertFavorite('favorite_avatar', 'avatar_id', payload.avatarId || payload.avatar_id, payload.groupName || payload.group_name, payload.created_at || record.updatedAt);
        return;
    }
    if (record.collection === 'favorite_friend') {
        await upsertFavorite('favorite_friend', 'user_id', payload.userId || payload.user_id, payload.groupName || payload.group_name, payload.created_at || record.updatedAt);
        return;
    }
    if (record.collection === 'friend_log_history') {
        await sqliteService.executeNonQuery(
            `DELETE FROM ${dbVars.userPrefix}_friend_log_history WHERE created_at = @created_at AND type = @type AND user_id = @user_id`,
            {
                '@created_at': payload.created_at,
                '@type': payload.type,
                '@user_id': payload.user_id
            }
        );
        await sqliteService.executeNonQuery(
            `INSERT INTO ${dbVars.userPrefix}_friend_log_history (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number)
             VALUES (@created_at, @type, @user_id, @display_name, @previous_display_name, @trust_level, @previous_trust_level, @friend_number)`,
            {
                '@created_at': payload.created_at,
                '@type': payload.type,
                '@user_id': payload.user_id,
                '@display_name': payload.display_name,
                '@previous_display_name': payload.previous_display_name,
                '@trust_level': payload.trust_level,
                '@previous_trust_level': payload.previous_trust_level,
                '@friend_number': payload.friend_number
            }
        );
        return;
    }
    if (record.collection === 'notifications') {
        await upsertNotification(payload);
        return;
    }
    if (record.collection === 'notifications_v2') {
        await upsertNotificationV2(payload);
        return;
    }
    if (GAME_LOG_TABLES.includes(record.collection)) {
        await upsertGameLog(record.collection, payload);
    }
}

async function upsertFavorite(table, idColumn, id, groupName, createdAt) {
    await sqliteService.executeNonQuery(
        `DELETE FROM ${table} WHERE ${idColumn} = @id AND group_name = @group_name`,
        {
            '@id': id,
            '@group_name': groupName
        }
    );
    await sqliteService.executeNonQuery(
        `INSERT INTO ${table} (${idColumn}, group_name, created_at) VALUES (@id, @group_name, @created_at)`,
        {
            '@id': id,
            '@group_name': groupName,
            '@created_at': createdAt
        }
    );
}

async function upsertNotification(payload) {
    await sqliteService.executeNonQuery(
        `INSERT OR REPLACE INTO ${dbVars.userPrefix}_notifications (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired)
         VALUES (@id, @created_at, @type, @sender_user_id, @sender_username, @receiver_user_id, @message, @world_id, @world_name, @image_url, @invite_message, @request_message, @response_message, @expired)`,
        {
            '@id': payload.id,
            '@created_at': payload.created_at,
            '@type': payload.type,
            '@sender_user_id': payload.sender_user_id,
            '@sender_username': payload.sender_username,
            '@receiver_user_id': payload.receiver_user_id,
            '@message': payload.message,
            '@world_id': payload.world_id,
            '@world_name': payload.world_name,
            '@image_url': payload.image_url,
            '@invite_message': payload.invite_message,
            '@request_message': payload.request_message,
            '@response_message': payload.response_message,
            '@expired': payload.expired ? 1 : 0
        }
    );
}

async function upsertNotificationV2(payload) {
    await sqliteService.executeNonQuery(
        `INSERT OR REPLACE INTO ${dbVars.userPrefix}_notifications_v2 (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details)
         VALUES (@id, @created_at, @updated_at, @expires_at, @type, @link, @link_text, @message, @title, @image_url, @seen, @sender_user_id, @sender_username, @data, @responses, @details)`,
        {
            '@id': payload.id,
            '@created_at': payload.created_at,
            '@updated_at': payload.updated_at,
            '@expires_at': payload.expires_at,
            '@type': payload.type,
            '@link': payload.link,
            '@link_text': payload.link_text,
            '@message': payload.message,
            '@title': payload.title,
            '@image_url': payload.image_url,
            '@seen': payload.seen ? 1 : 0,
            '@sender_user_id': payload.sender_user_id,
            '@sender_username': payload.sender_username,
            '@data': payload.data || '{}',
            '@responses': payload.responses || '[]',
            '@details': payload.details || '{}'
        }
    );
}

async function upsertGameLog(collection, payload) {
    const handlers = {
        gamelog_location: [
            `INSERT OR IGNORE INTO gamelog_location (created_at, location, world_id, world_name, time, group_name) VALUES (@created_at, @location, @world_id, @world_name, @time, @group_name)`,
            {
                '@created_at': payload.created_at,
                '@location': payload.location,
                '@world_id': payload.world_id,
                '@world_name': payload.world_name,
                '@time': payload.time,
                '@group_name': payload.group_name
            }
        ],
        gamelog_join_leave: [
            `INSERT OR IGNORE INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time) VALUES (@created_at, @type, @display_name, @location, @user_id, @time)`,
            {
                '@created_at': payload.created_at,
                '@type': payload.type,
                '@display_name': payload.display_name,
                '@location': payload.location,
                '@user_id': payload.user_id,
                '@time': payload.time
            }
        ],
        gamelog_portal_spawn: [
            `INSERT OR IGNORE INTO gamelog_portal_spawn (created_at, display_name, location, user_id, instance_id, world_name) VALUES (@created_at, @display_name, @location, @user_id, @instance_id, @world_name)`,
            {
                '@created_at': payload.created_at,
                '@display_name': payload.display_name,
                '@location': payload.location,
                '@user_id': payload.user_id,
                '@instance_id': payload.instance_id,
                '@world_name': payload.world_name
            }
        ],
        gamelog_video_play: [
            `INSERT OR IGNORE INTO gamelog_video_play (created_at, video_url, video_name, video_id, location, display_name, user_id) VALUES (@created_at, @video_url, @video_name, @video_id, @location, @display_name, @user_id)`,
            {
                '@created_at': payload.created_at,
                '@video_url': payload.video_url,
                '@video_name': payload.video_name,
                '@video_id': payload.video_id,
                '@location': payload.location,
                '@display_name': payload.display_name,
                '@user_id': payload.user_id
            }
        ],
        gamelog_resource_load: [
            `INSERT OR IGNORE INTO gamelog_resource_load (created_at, resource_url, resource_type, location) VALUES (@created_at, @resource_url, @resource_type, @location)`,
            {
                '@created_at': payload.created_at,
                '@resource_url': payload.resource_url,
                '@resource_type': payload.resource_type,
                '@location': payload.location
            }
        ],
        gamelog_event: [
            `INSERT OR IGNORE INTO gamelog_event (created_at, data) VALUES (@created_at, @data)`,
            {
                '@created_at': payload.created_at,
                '@data': payload.data
            }
        ],
        gamelog_external: [
            `INSERT OR IGNORE INTO gamelog_external (created_at, message, display_name, user_id, location) VALUES (@created_at, @message, @display_name, @user_id, @location)`,
            {
                '@created_at': payload.created_at,
                '@message': payload.message,
                '@display_name': payload.display_name,
                '@user_id': payload.user_id,
                '@location': payload.location
            }
        ]
    };
    const handler = handlers[collection];
    if (handler) {
        await sqliteService.executeNonQuery(handler[0], handler[1]);
    }
}

async function deleteLocalRecord(record) {
    if (record.collection === 'user_memos') {
        await sqliteService.executeNonQuery(`DELETE FROM memos WHERE user_id = @id`, {
            '@id': record.recordKey
        });
        return;
    }
    if (record.collection === 'world_memos') {
        await sqliteService.executeNonQuery(`DELETE FROM world_memos WHERE world_id = @id`, {
            '@id': record.recordKey
        });
        return;
    }
    if (record.collection === 'avatar_memos') {
        await sqliteService.executeNonQuery(`DELETE FROM avatar_memos WHERE avatar_id = @id`, {
            '@id': record.recordKey
        });
        return;
    }
    if (record.collection === 'avatar_tags') {
        const [avatarId, ...tagParts] = record.recordKey.split(':');
        await sqliteService.executeNonQuery(
            `DELETE FROM avatar_tags WHERE avatar_id = @avatar_id AND tag = @tag`,
            {
                '@avatar_id': avatarId,
                '@tag': tagParts.join(':')
            }
        );
        return;
    }
    if (record.collection === 'favorite_world') {
        const fallback = splitFavoriteKey(record.recordKey);
        await deleteFavorite('favorite_world', 'world_id', record.payload?.worldId || record.payload?.world_id || fallback.id, record.payload?.groupName || record.payload?.group_name || fallback.groupName);
        return;
    }
    if (record.collection === 'favorite_avatar') {
        const fallback = splitFavoriteKey(record.recordKey);
        await deleteFavorite('favorite_avatar', 'avatar_id', record.payload?.avatarId || record.payload?.avatar_id || fallback.id, record.payload?.groupName || record.payload?.group_name || fallback.groupName);
        return;
    }
    if (record.collection === 'favorite_friend') {
        const fallback = splitFavoriteKey(record.recordKey);
        await deleteFavorite('favorite_friend', 'user_id', record.payload?.userId || record.payload?.user_id || fallback.id, record.payload?.groupName || record.payload?.group_name || fallback.groupName);
        return;
    }
    if (record.collection === 'notifications') {
        await sqliteService.executeNonQuery(`DELETE FROM ${dbVars.userPrefix}_notifications WHERE id = @id`, {
            '@id': record.recordKey
        });
        return;
    }
    if (record.collection === 'notifications_v2') {
        await sqliteService.executeNonQuery(`DELETE FROM ${dbVars.userPrefix}_notifications_v2 WHERE id = @id`, {
            '@id': record.recordKey
        });
    }
}

async function deleteFavorite(table, idColumn, id, groupName) {
    await sqliteService.executeNonQuery(
        `DELETE FROM ${table} WHERE ${idColumn} = @id AND group_name = @group_name`,
        {
            '@id': id,
            '@group_name': groupName
        }
    );
}

async function pullRemote(ownerId) {
    let cursor = await configRepository.getInt(SYNC_CURSOR_KEY, 0);
    let applied = 0;
    let pulled = 0;

    while (true) {
        const result = await requestSync(
            `/api/sync/pull?ownerId=${encodeURIComponent(ownerId)}&since=${cursor}&limit=1000`
        );
        const records = Array.isArray(result.records) ? result.records : [];
        pulled += records.length;
        for (const record of records) {
            if (await applyRemoteRecord(record)) {
                applied++;
            }
        }
        cursor = Number(result.cursor || cursor);
        await configRepository.setInt(SYNC_CURSOR_KEY, cursor);
        if (records.length < 1000) {
            break;
        }
    }

    return { pulled, applied, cursor };
}

async function pushLocal(ownerId, deviceId) {
    const records = await collectLocalRecords(deviceId);
    let accepted = 0;
    for (let i = 0; i < records.length; i += 500) {
        const result = await requestSync('/api/sync/push', {
            method: 'POST',
            body: JSON.stringify({
                ownerId,
                records: records.slice(i, i + 500)
            })
        });
        accepted += Number(result.accepted || 0);
    }
    return { pushed: records.length, accepted };
}

const cloudSync = {
    async isEnabled() {
        return configRepository.getBool(SYNC_ENABLED_KEY, false);
    },

    async getConfig() {
        return {
            enabled: await configRepository.getBool(SYNC_ENABLED_KEY, false),
            endpoint: await configRepository.getString(SYNC_ENDPOINT_KEY, ''),
            token: await configRepository.getString(SYNC_TOKEN_KEY, ''),
            deviceId: await getDeviceId(),
            lastRun: await configRepository.getString(SYNC_LAST_RUN_KEY, ''),
            cursor: await configRepository.getInt(SYNC_CURSOR_KEY, 0)
        };
    },

    async setConfig(config) {
        await configRepository.setBool(SYNC_ENABLED_KEY, Boolean(config.enabled));
        await configRepository.setString(SYNC_ENDPOINT_KEY, normalizeEndpoint(config.endpoint));
        await configRepository.setString(SYNC_TOKEN_KEY, config.token || '');
    },

    async sync(ownerId) {
        if (!ownerId) {
            throw new Error('Current user is required before syncing');
        }
        const deviceId = await getDeviceId();
        const pull = await pullRemote(ownerId);
        const push = await pushLocal(ownerId, deviceId);
        const lastRun = new Date().toISOString();
        await configRepository.setString(SYNC_LAST_RUN_KEY, lastRun);
        return {
            ...pull,
            ...push,
            lastRun
        };
    }
};

window.cloudSync = cloudSync;

export { cloudSync };
