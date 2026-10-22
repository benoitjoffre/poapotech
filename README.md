# Poapo

Poapo is a multi-tenant quiz and product-recommendation platform. The repository
is an npm-workspaces monorepo for the TypeScript applications and shared types,
with a separate Python service for semantic recommendations.

## Applications

| Directory | Responsibility | Local port |
| --- | --- | ---: |
| `poapoback/` | Express API, Prisma schema and database migrations | 5050 |
| `poapofront/` | Embeddable customer-facing quiz | 5173 |
| `poapoadmin/` | Tenant administration console | 5174 |
| `poapoai/` | FastAPI recommendation and catalog-mapping service | 8000 |
| `poapo-types/` | Shared TypeScript contracts | — |

The API is the source of truth for tenant data, quizzes, catalog products,
questions and analytics. The browser applications call the API; the API calls
the Python service for AI-assisted recommendations and catalog operations.
PostgreSQL is started locally with Docker Compose.

## Getting started

See [SETUP.md](./SETUP.md) for prerequisites, environment variables, database
setup, migrations, service startup, integration details and troubleshooting.
To understand the application flow and learn where to read the code, start with
the [code walkthrough](./docs/guide-de-lecture.md).

Install the JavaScript dependencies from the repository root:

```bash
npm install
npm run build
```

Copy each service's `.env.example` to `.env` and fill in local values before
starting services. Keep credentials in local environment files; never commit
them.

Start the API, widget, and admin console in separate terminals:

```bash
npm run back
npm run front
npm run admin
```

Start the AI service in another terminal after creating its Python virtual
environment and installing `poapoai/requirements.txt`:

```bash
npm run ai
```

## Validation

```bash
npm run build
npm run lint --workspace=poapofront
npm run test:back
```

Run the AI unit tests with the project's Python environment activated:

```bash
cd poapoai
python -m unittest test_recommend -v
```

## Where to make changes

- API endpoints and HTTP concerns belong in `poapoback/src/routes/`.
- Reusable backend operations belong in `poapoback/src/services/`.
- Database changes start in `poapoback/prisma/schema.prisma`; use versioned
  migrations for existing databases. Read the migration guidance in
  [SETUP.md](./SETUP.md) before applying a schema change.
- Shared request and response contracts belong in `poapo-types/src/`.
- Widget and admin UI code belongs in each application's `src/` directory.
- AI endpoints and recommendation logic currently live in `poapoai/main.py`.

Keep changes focused and typed. Add comments to explain non-obvious decisions or
constraints, not to narrate what the code already says. Update the relevant
documentation and run the narrowest applicable validation command before
handing off a change.
