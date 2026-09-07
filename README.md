# ESN Backend

> **Setting this up on a new machine? Read [INSTALL.md](./INSTALL.md)** — a complete,
> step-by-step Windows guide (prerequisites, exact versions, data loading, logins,
> troubleshooting). This README is the developer reference; INSTALL.md is the install path.

Internal resource-management API for an ESN (IT consulting). Node 20+, TypeScript (ESM),
Express, Prisma + PostgreSQL, Zod, Keycloak (OIDC/JWT), MinIO (S3).

This is the **foundation skeleton**: full Prisma schema + cross-cutting infrastructure
(auth, RBAC, validation, error handling, storage, logging) + a sample `health` module.
Business modules (recruitment, consultants, staffing, missions, contracts, reporting)
plug into this layering.

## Layering (strict — dependencies flow downward only)

```
routes -> controller -> service -> repository -> prisma
```

- **routes**: path + middleware (`auth`, `rbac(...)`, `validate(schema)`) + bind controller.
- **controller**: HTTP in/out only. No business logic, no Prisma.
- **service**: business logic, transactions, audit writes. Throws `AppError`.
- **repository**: the ONLY layer that imports the Prisma client.

## Prerequisites

- Node.js 20+ and Docker.

## Infrastructure (lives in this repo)

`docker-compose.yml`, `keycloak/`, and the `Makefile` are part of the backend repo. Bring up Postgres,
MinIO, and Keycloak from here:

```bash
docker compose up -d       # or: make up
```

Starts **postgres** (:5432), **minio** (:9000 / console :9001, bucket `esn-documents`), and **keycloak**
(:8080, imports the `esn` realm with roles + 4 dev users). Dev Keycloak users: `rh@esn.local`,
`manager@esn.local`, `direction@esn.local`, `consultant@esn.local` — password `password`.

## Setup

```bash
cp .env.example .env       # then fill in real values
npm install
npm run prisma:generate    # generate the Prisma client
npm run prisma:migrate     # create/apply the dev migration (needs the DB above running)
npm run seed               # idempotent dev seed (skills, template, 4 users)
```

### Full demo dataset (optional)

```bash
npm run seed:full          # complete, realistic dataset — needs postgres + minio + keycloak up
```

`prisma/seed-full/` builds a whole ESN out of Tunisian identities: 8 internal users, 25 consultants,
10 clients, 20 missions, 30 candidates, 20 contracts with their validation workflow, 10 job offers,
40 portal applications and ~140 **real PDFs uploaded to MinIO** (so every download actually works).
Every table is populated and every enum value appears at least once.

It is **destructive** (wipes the domain tables and the `esn-documents` bucket) and **idempotent**
(fixed PRNG seed, Keycloak accounts matched by username and reused). Every seeded account — staff and
consultants — logs in with the password `password`; consultants use `prenom.nom@esn.local`.

## Run

```bash
npm run dev      # tsx watch, hot reload on src/server.ts
npm run build    # tsc -> dist/
npm run start    # node dist/server.js
```

The API listens on `http://localhost:4000`. Health check:

```bash
curl http://localhost:4000/api/health
# { "status": "ok", "db": true }
```

## Quality

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest
```

## Environment

All env is read through a single zod-validated `config` module (`src/config/env.ts`).
The process crashes at boot on missing/invalid values. See `.env.example` for the full list:
`PORT`, `LOG_LEVEL`, `CORS_ORIGIN`, `DATABASE_URL`, `KEYCLOAK_ISSUER`, `KEYCLOAK_JWKS_URI`,
`KEYCLOAK_AUDIENCE`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`.

## Security notes

- Every token is verified against Keycloak JWKS (signature + `iss` + `aud` + `exp`).
- RBAC is enforced server-side per route via `rbac(...roles)`; owner-scoped access via
  `requireOwnership(resolver)`. See `docs/rbac-matrix.md`.
- Storage keys are generated server-side; client filenames are sanitized (no path traversal).
- Secrets only via env; `.env*` is gitignored.

## Data model

`prisma/schema.prisma` is kept in sync with `docs/data-model.md` (the source of truth).
Change both in the same commit.
