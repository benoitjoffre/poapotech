# Poapo Quiz Widget

The customer-facing quiz is a React and TypeScript application built with Vite.
It can run as a standalone page during development or be embedded in a tenant's
site. The embed configuration and quiz data are served by the Poapo API.

## Run locally

From the repository root:

```bash
npm run front
```

Or, from this directory:

```bash
npm run dev
```

Vite serves the widget at `http://localhost:5173`. Configure its API URL in the
local environment file as described in the repository's
[setup guide](../SETUP.md).

## Code layout

- `src/pages/QuizPage.tsx` implements the quiz experience.
- `src/contexts/TenantContext.tsx` loads and provides tenant and quiz settings.
- `src/App.tsx` defines the application routes.
- `public/poapo-widget.js` is the small script customers add to embed the quiz.

Run `npm run build --workspace=poapofront` to type-check and build the
production-ready static assets.
