# VRCX Cloud Sync

This repo includes a first-pass self-hosted sync path for VRCX data that is safe to share between devices:

- `memos`
- `world_memos`
- `avatar_memos`
- `avatar_tags`
- `favorite_world`
- `favorite_avatar`
- `favorite_friend`
- `${userPrefix}_friend_log_history`
- `${userPrefix}_notifications`
- `${userPrefix}_notifications_v2`
- `gamelog_location`
- `gamelog_join_leave`
- `gamelog_portal_spawn`
- `gamelog_video_play`
- `gamelog_resource_load`
- `gamelog_event`
- `gamelog_external`

The sync server runs on Docker with PostgreSQL. It stores per-record JSON payloads and uses `client_updated_at` for last-write-wins conflict resolution.

## Server Deployment

On your Linux server:

```bash
cd sync-server
cp .env.example .env
nano .env
docker compose up -d --build
```

Recommended `.env` values:

```text
POSTGRES_DB=vrcx_sync
POSTGRES_USER=vrcx_sync
POSTGRES_PASSWORD=<long random password>
SYNC_TOKEN=<long random token>
CORS_ORIGIN=*
SYNC_API_PORT=8080
```

Reverse proxy example:

```nginx
location /vrcx-sync/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Health check:

```bash
curl https://sync.example.com/vrcx-sync/health
```

`CORS_ORIGIN=*` keeps desktop VRCX clients working across Electron origins. The API still requires the `SYNC_TOKEN` bearer token.

## VRCX Setup

Open VRCX settings, then go to Integrations > Cloud Sync.

Use:

```text
Endpoint: https://sync.example.com/vrcx-sync
Access token: value of SYNC_TOKEN
```

Enable Cloud Sync and click `Sync now`.

VRCX also runs one background sync after login when Cloud Sync is enabled.

## Notes

Do not expose `VRCX.sqlite3` directly through a static web server. The sync server is designed to receive selected records through an authenticated API instead of serving the whole local database.
