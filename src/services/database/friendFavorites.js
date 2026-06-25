import sqliteService from '../sqlite.js';
import { syncMetadata } from './syncMetadata.js';

function favoriteRecordKey(entityId, groupName) {
    return `${entityId}:${groupName}`;
}

const friendFavorites = {
    async addFriendToLocalFavorites(userId, groupName) {
        const createdAt = new Date().toJSON();
        await sqliteService.executeNonQuery(
            'INSERT OR REPLACE INTO favorite_friend (user_id, group_name, created_at) VALUES (@user_id, @group_name, @created_at)',
            {
                '@user_id': userId,
                '@group_name': groupName,
                '@created_at': createdAt
            }
        );
        await syncMetadata.markSyncRecord('favorite_friend', favoriteRecordKey(userId, groupName), createdAt);
    },

    async removeFriendFromLocalFavorites(userId, groupName) {
        const updatedAt = new Date().toJSON();
        await sqliteService.executeNonQuery(
            `DELETE FROM favorite_friend WHERE user_id = @user_id AND group_name = @group_name`,
            {
                '@user_id': userId,
                '@group_name': groupName
            }
        );
        await syncMetadata.markSyncRecord('favorite_friend', favoriteRecordKey(userId, groupName), updatedAt, updatedAt);
    },

    async renameFriendFavoriteGroup(newGroupName, groupName) {
        const rows = await this.getFriendFavorites();
        const renamed = rows.filter((row) => row.groupName === groupName);
        await sqliteService.executeNonQuery(
            `UPDATE favorite_friend SET group_name = @new_group_name WHERE group_name = @group_name`,
            {
                '@new_group_name': newGroupName,
                '@group_name': groupName
            }
        );
        const updatedAt = new Date().toJSON();
        for (const row of renamed) {
            await syncMetadata.markSyncRecord('favorite_friend', favoriteRecordKey(row.userId, row.groupName), updatedAt, updatedAt);
            await syncMetadata.markSyncRecord('favorite_friend', favoriteRecordKey(row.userId, newGroupName), updatedAt);
        }
    },

    async deleteFriendFavoriteGroup(groupName) {
        const rows = await this.getFriendFavorites();
        const deleted = rows.filter((row) => row.groupName === groupName);
        await sqliteService.executeNonQuery(
            `DELETE FROM favorite_friend WHERE group_name = @group_name`,
            {
                '@group_name': groupName
            }
        );
        const updatedAt = new Date().toJSON();
        for (const row of deleted) {
            await syncMetadata.markSyncRecord('favorite_friend', favoriteRecordKey(row.userId, row.groupName), updatedAt, updatedAt);
        }
    },

    async getFriendFavorites() {
        const data = [];
        await sqliteService.execute((dbRow) => {
            const row = {
                created_at: dbRow[1],
                userId: dbRow[2],
                groupName: dbRow[3]
            };
            data.push(row);
        }, 'SELECT * FROM favorite_friend');
        return data;
    }
};

export { friendFavorites };
