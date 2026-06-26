# Linux Container Deployment

This guide deploys the VRCX Cloud Sync server on a Linux host with Docker Compose. The desktop app still runs on your PC; the container only hosts the sync API and PostgreSQL database used by `Settings -> Integrations -> Cloud Sync`.

## Requirements

- A Linux server with Docker Engine and Docker Compose.
- A DNS name pointing at the server, such as `sync.example.com`.
- HTTPS through a reverse proxy such as Nginx, Caddy, or Traefik.
- A long random PostgreSQL password and a separate long random sync token.

## Prepare The Server

Clone this fork and enter the sync server directory:

```bash
git clone https://github.com/MoLiYue/VRCX.git
cd VRCX/sync-server
```

Create the environment file:

```bash
cp .env.example .env
nano .env
```

Use values like these:

```text
POSTGRES_DB=vrcx_sync
POSTGRES_USER=vrcx_sync
POSTGRES_PASSWORD=<long-random-postgres-password>
SYNC_TOKEN=<long-random-sync-token>
CORS_ORIGIN=*
SYNC_API_PORT=8080
```

`SYNC_TOKEN` is the bearer token that VRCX clients must use. Keep it private. `CORS_ORIGIN=*` is convenient for Electron clients and browser-based remote access; the API is still protected by `SYNC_TOKEN`.

## Start The Containers

```bash
docker compose up -d --build
docker compose ps
```

Check the local health endpoint:

```bash
curl http://127.0.0.1:8080/health
```

A healthy deployment returns:

```json
{"ok":true}
```

## Reverse Proxy

Expose the API through HTTPS. With Nginx, a path-based deployment can look like this:

```nginx
location /vrcx-sync/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Reload Nginx and verify the public endpoint:

```bash
curl https://sync.example.com/vrcx-sync/health
```

If you use a dedicated subdomain instead of a path, proxy `/` to `http://127.0.0.1:8080/` and use `https://sync.example.com` as the VRCX endpoint.

## Configure VRCX

Open VRCX and go to `Settings -> Integrations -> Cloud Sync`.

Use:

```text
Endpoint: https://sync.example.com/vrcx-sync
Access token: <SYNC_TOKEN>
```

Enable Cloud Sync and click `Sync now`. The app also starts periodic sync after login when Cloud Sync is enabled.

## Update

From the repository root on the server:

```bash
git pull
cd sync-server
docker compose up -d --build
```

## Backup And Restore

Back up PostgreSQL regularly:

```bash
docker compose exec -T postgres pg_dump -U vrcx_sync vrcx_sync > vrcx_sync.sql
```

Restore into a fresh deployment:

```bash
cat vrcx_sync.sql | docker compose exec -T postgres psql -U vrcx_sync vrcx_sync
```

The Docker volume is named `sync-server_postgres-data` by default. Keep both database dumps and the `.env` file in your server backup plan.

## Operations Notes

- Do not expose `VRCX.sqlite3` directly. The sync server stores selected records through authenticated API calls.
- Keep `SYNC_API_PORT` bound behind a firewall if the public entry point is your reverse proxy.
- Rotate `SYNC_TOKEN` if it leaks, then update every VRCX client.
- Logs are available with `docker compose logs -f api` and `docker compose logs -f postgres`.
