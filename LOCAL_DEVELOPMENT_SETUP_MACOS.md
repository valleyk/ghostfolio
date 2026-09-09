# macOS + OrbStack Local Development Setup

This document records the local setup performed on 2026-08-28 for this
repository. It follows `DEVELOPMENT.md` and uses OrbStack's Docker daemon.

## Prerequisites

- macOS with OrbStack running
- Docker CLI connected to OrbStack (`docker version` succeeds)
- Node.js `>= 22.18.0` (`node --version`)
- npm (bundled with Node.js)

## Initial Setup

From the repository root:

```bash
npm install
cp .env.dev .env
```

The `.env` file is ignored by Git and must remain local. Do not commit its
secrets. For an existing `.env`, retain its credentials and update only the
hostnames below when moving from a previous OrbStack/Docker setup:

```dotenv
REDIS_HOST=localhost
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}?connect_timeout=300
```

OrbStack publishes the development containers to the macOS host, so both
services are reached through `localhost`, not a transient VM IP address.

Start the infrastructure and initialize the schema and development seed data:

```bash
docker compose -f docker/docker-compose.dev.yml up -d
docker compose -f docker/docker-compose.dev.yml ps
npm run database:setup
```

Expected Compose services:

- `gf-postgres-dev` on `localhost:5432`
- `gf-redis-dev` on `localhost:6379`

Both should report `healthy` in `docker compose ... ps` before running the
database command.

## Start the Application

Use two terminals from the repository root:

```bash
npm run start:server
```

```bash
npm run start:client
```

Open <https://localhost:4200/en>. The repository already includes the local
HTTPS certificate and key at `apps/client/localhost.cert` and
`apps/client/localhost.pem`.

The first registered user receives the `ADMIN` role.

## Daily Commands

```bash
# Start PostgreSQL and Redis
docker compose -f docker/docker-compose.dev.yml up -d

# Stop PostgreSQL and Redis while preserving local data
docker compose -f docker/docker-compose.dev.yml stop

# Apply schema changes after pulling updates
npm run database:push

# Run the project test suite
npm test
```

To remove the local development database completely, use the destructive
command below. It removes the Docker volume and all local development data:

```bash
docker compose -f docker/docker-compose.dev.yml down -v
```

Afterward, run `docker compose -f docker/docker-compose.dev.yml up -d` and
`npm run database:setup` again.

## Yahoo Finance on This Mac

Yahoo Finance does not require a separate API key in the local development
environment. Ghostfolio uses the unofficial `yahoo-finance2` client.

The HTTPS development client at `https://localhost:4200` is unrelated to
Yahoo Finance. Market-data requests are made by the Nest API process, not by
the browser.

On this Mac, enabling the global `EnvHttpProxyAgent` in
`apps/api/src/main.ts` caused Yahoo Finance requests to fail. Symptoms
included a missing `Set-Cookie` header and a successful HTTP response whose
compressed body could not be parsed as JSON. This is consistent with the
local network/proxy path changing Yahoo response headers or content encoding.

For local development, the proxy-agent import and its
`setGlobalDispatcher(new EnvHttpProxyAgent())` call are currently commented
out. Restart the API after changing this setting:

```bash
npm run start:server
```

Do not apply this workaround to a deployed environment without first checking
whether that environment intentionally uses `HTTP_PROXY`, `HTTPS_PROXY`, or
`NO_PROXY`. If Yahoo requests fail there, configure the proxy to transparently
preserve `Set-Cookie` and `Content-Encoding` headers, or bypass the proxy for
Yahoo domains.

## Verification Performed

The setup was verified with Docker Compose v2.39.2 and Node.js v26.0.0.
PostgreSQL 15 and Redis started successfully and reported healthy. Prisma
successfully synchronized the schema with PostgreSQL at `localhost:5432` and
executed the development seed command.

If Prisma prints a blank `Schema engine error` inside a sandboxed coding tool,
run `npm run database:setup` from a normal local terminal. Prisma may need
write access to its macOS cache directory. This does not indicate a database
connection failure when Compose services are healthy.

# local dev login token

```
cca245877aeb3ac8fef5bb2c8114f7f6fcdce4d780d60f8f395f69f2a7e219d39c40027f1fb7a7207bde4e92d7664b9e64a66a235b7fafaf3063176fbc6b7322
```
