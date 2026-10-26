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

### Merchant homepage

Merchants now land on `/`, with six navigation destinations: Accueil, Mes
produits, Mes expériences, Campagnes, Résultats and Paramètres. All previous
routes remain available, and super-administrators retain separate navigation.
The homepage uses the [read-only dashboard API](./poapoback/README.md#merchant-home-summary-sprint-a-step-1)
without changing quiz creation, drafts, publication or public integration.
Appearance and publication still use the existing campaign editor.
The [validated UX plan](./docs/plan-refonte-ux.md) defines the target separation:
an experience is an existing quiz, and campaigns are optional marketing
operations that can share a quiz. Campaign-independent publication remains a
future implementation requirement, not a capability delivered by this step.
Campaign status must not be presented as a public-access control.

The homepage follows the supplied dashboard composition with the POAPO purple
identity: compact hero, four activity cards, experience cards plus a creation
tile, product summary and a right-hand next-action/resources column.
Generic typed [dashboard components](./poapoadmin/src/components/dashboard/DashboardCard.tsx)
provide panels, statistics and resource links. The
[experience card](./poapoadmin/src/components/dashboard/ExperienceCard.tsx)
accepts its data and tenant context through props, without fetching or reading
authentication state. [Homepage sections](./poapoadmin/src/components/dashboard/HomeSections.tsx)
compose these building blocks; the page owns data loading and error states.
No stock product imagery, fabricated trends, progress or video resources are
introduced. The hero illustration is decorative, not an interactive preview.

The existing authentication flow may create a default empty quiz/catalog for
a new merchant; the homepage displays these real records rather than hiding
them or creating its own defaults.

With the local API, admin and PostgreSQL running, run the browser scenarios:

```bash
POAPO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
POAPO_SCREENSHOT_DIR=/absolute/path/to/screenshots \
node poapoadmin/tests/home.browser.cjs
```

Both variables are optional: Playwright is resolved normally when the first
is omitted, and screenshots are saved only when the second is provided.
The scenarios use temporary isolated fixtures, remove them afterward, and
check 320, 375, 768 and 1440 px layouts, keyboard navigation, legacy links,
empty/error states and separate super-admin access.

### AI service

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
