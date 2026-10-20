# Poapo API

The active API is an Express application written in TypeScript. Its entry point
is `src/server.ts`; the `dev`, `build` and `start` scripts in this workspace
operate on that application.

## Run locally

From the repository root:

```bash
npm run back
```

Or, from this directory:

```bash
npm run dev
```

The API listens on port `5050` by default. Configure local settings in `.env`
using `.env.example` as a reference. Start PostgreSQL before using database-backed
routes.

## Database

```bash
npm run db:generate
npm run db:migrate
```

Use `db:push` only for a new or disposable development database. For an existing
database, follow the migration and backup instructions in the repository's
[setup guide](../SETUP.md).

## Code layout

- `src/server.ts` configures middleware, mounts routers and starts the server.
- `src/routes/` contains HTTP handlers grouped by feature.
- `src/services/` contains backend logic shared by routes.
- `src/middleware/` contains request middleware such as authentication.
- `src/lib/` contains shared infrastructure such as the Prisma client.
- `prisma/` contains the database schema and versioned migrations.
- `tests/` contains API-level tests that use a simulated persistence layer.

Run the API tests from the repository root with `npm run test:back`, or from this
directory with `npm test`.
