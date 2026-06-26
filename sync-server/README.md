# VRCX Sync Server

Dockerized PostgreSQL sync service for self-hosted VRCX multi-device sync.

For the full Linux container deployment guide, see [docs/linux-container-deployment.md](../docs/linux-container-deployment.md).

## Deploy on your server

```bash
cd sync-server
cp .env.example .env
nano .env
docker compose up -d --build
```

Expose the API through your reverse proxy, for example:

```nginx
location /vrcx-sync/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Use `https://sync.example.com/vrcx-sync` as the VRCX sync endpoint.

`CORS_ORIGIN=*` is the most convenient value for desktop VRCX clients. The sync API is still protected by `SYNC_TOKEN`.

## API

- `GET /health`
- `GET /api/sync/pull?ownerId=<vrchat-user-id>&since=<sequence>`
- `POST /api/sync/push`

All `/api/sync/*` requests require:

```text
Authorization: Bearer <SYNC_TOKEN>
```
