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

## Persistent quiz editor drafts (Sprint 3, step 1)

`Quiz`, `Question`, `Answer` and `QuizProduct` remain the public source of truth.
`QuizEditorDraft` stores one independent, versioned JSON document per quiz.
Reading a quiz without a draft returns a snapshot of the public configuration
and questions, revision `0`, without writing anything.

After updating the code, apply the additive migration and regenerate the client
from this directory:

```bash
npx prisma migrate deploy
npm run db:generate
```

Migration: `20261023090000_add_quiz_editor_drafts`. No existing quiz is rewritten.
Restart the API after generating the Prisma client.

### Authenticated API

All operations resolve the quiz within the tenant from the JWT, including
inactive quizzes. Unknown/foreign quizzes return `404`.

| Method | URL | Body | Result |
| --- | --- | --- | --- |
| GET | `/api/quizzes/:id/draft` | none | `{ quizId, revision, hasChanges, updatedAt, draft }` |
| PUT | `/api/quizzes/:id/draft` | `{ revision, draft }` | Same envelope, incremented revision |
| DELETE | `/api/quizzes/:id/draft` | `{ revision }` | Public snapshot, incremented revision, `hasChanges: false` |

`draft.schemaVersion` is `1`. `draft.config` contains name, catalogue, industry,
axes, public title, CTA, intended activation, product selection mode and
`productIds`. `draft.questions` contains stable IDs, text, help/image, type,
order, activation, A/B variant, condition and answers with stable IDs, order,
text, emoji/image, activation and impacts.

Use the IDs returned by GET for existing questions/answers. New items use
`draft_` followed by a UUID v4. Persisted IDs cannot be imported from another
quiz, nor can an existing answer be moved to another question. Condition targets
must exist in the submitted document. Product IDs must belong to its catalogue
and tenant. Existing published axis keys are retained; labels and new axes can
be prepared without rewriting published impacts.

PUT replaces the complete draft, not just one section. Always retain the
questions when editing configuration, and retain configuration when editing
questions. The admin does this automatically.

Missing/invalid revisions return `400`. Concurrent or stale writes return `409`.
The first save uses a unique insert; subsequent saves and discards use an atomic
revision comparison. Discard clears the content but keeps the row and advances
the revision, so pre-discard tabs cannot resurrect an abandoned draft.

CSV import remains at `/api/quiz/builder/questions/import-csv?quizId=...`,
with multipart fields `file` and `revision`. It appends only to the draft and
returns its new envelope plus import counts. It never inserts public questions.
The legacy question/answer mutation routes and content updates through
`PUT /api/quizzes/:id` return `409` with instructions to use the draft.
The branding and super-admin tenant endpoints no longer update public quiz text.
Tenant branding still works; the account industry no longer rewrites the default
quiz's industry.

The existing `PUT /api/quizzes/:id` activation-only operation remains available
for the **existing public content**. It does not apply any draft fields.
Public APIs, historical links without `quizId`, campaign associations and the
recommendation engine do not read drafts. Editing and discarding require neither
OpenAI nor the Python service.

### Admin workflow

1. Open a campaign, then **Personnaliser le quiz → Questions**, or open **Quiz Builder** and select a quiz.
2. Edit cards and apply their changes locally. New questions/answers, deletions
   and reordering are local until **Enregistrer le brouillon** is clicked.
3. Finish or cancel open card forms before saving the whole draft.
4. The status distinguishes unsaved changes, saved draft, errors and conflicts.
   Navigation (including browser back), quiz selection and page unload protect
   unsaved changes.
5. Reload the page: the saved draft is recovered; the public quiz is unchanged.
6. Configure the same draft from **Configurer / intégrer le quiz**. Changes to
   configuration preserve its questions and vice versa.
7. To test a conflict, open the same quiz in two tabs, save in the first, then
   try saving in the second. Its local changes remain visible after `409`.
   Reloading the server draft requires confirmation before losing local edits.
8. **Abandonner les modifications préparatoires** resets the entire draft
   (questions and configuration), not the public quiz.

Saved drafts may be incomplete. The separate diagnostic and atomic publication
operation below are mandatory before making their changes public.
There is no automatic merge after conflicts. Several campaigns referencing the
same quiz share its draft; editing does not duplicate or reattach campaigns.
Global tenant logo/color settings remain global and are outside this step.

### Unified campaign editor (Sprint 3, step 2)

From Campaign Studio, **Personnaliser le quiz** opens
`/campaigns/:campaignId/quiz-editor`. The authenticated campaign determines the
quiz; a global quiz selection or a `quizId` query parameter cannot override it.
The header identifies the campaign, associated quiz and its public catalogue.
The existing Quiz Builder is reused with the same persistent draft, revision
checks, CSV import and navigation protection. The standalone builder remains
available for historical admin links.
The embedded builder also exposes up/down reorder buttons for questions and
answers, so ordering does not require drag-and-drop on touch devices or a mouse.

**Questions**, **Apparence**, **Aperçu** and **Publication** are functional.
Switching sections retains local
question forms and unsaved edits; leaving the editor still requires confirmation.

When several tenant campaigns use the quiz, the editor lists the other campaigns
with links and explains that they share the same draft. This uses the existing
tenant-scoped campaign API with `quizId`, regardless of campaign status, and
does not duplicate or reattach any quiz. No migration is required for step 2.

### Draft appearance (Sprint 3, step 3)

`draft.theme` is optional (`QuizTheme | null`), within the existing version-1 JSON
document. Old drafts without this property remain valid. Draft appearance itself
needs no migration; step 5 adds the separate nullable published theme column.
The shared `parseQuizTheme` allowlist validates:

- `logoUrl`: absolute HTTP(S) URL, no credentials, maximum 2048 characters.
  No image upload/storage service exists, so no upload feature is introduced.
- `primaryColor`, `secondaryColor`, `accentColor`, `backgroundColor`, `textColor`:
  six-digit `#RRGGBB` only.
- `headingFont`, `bodyFont`: predefined IDs from `QUIZ_FONTS` (local font stacks,
  no remote stylesheet or font fetch).
- `buttonShape`: `rounded`, `soft` or `square`.
- `startLabel`, `previousLabel`, `nextLabel`, `submitLabel`, `restartLabel`:
  plain text, 1–80 characters, no control characters. The product CTA is unchanged.

Unknown properties, CSS and font URLs are rejected with `400`. Empty or null
themes and missing/null fields inherit the brand and historical widget defaults.
`resolveQuizTheme` centralizes this resolution. Without a custom background, the
historical gradient is retained. The public widget and embed configuration do
not consume `draft.theme`: their existing branding and behaviour are unchanged.

In **Apparence**, controls are on the left and a scoped, non-interactive graphic
sample is on the right (stacked on mobile). Colors support picker and hex entry;
clearing a field restores inheritance. Invalid fields are explicit and disable
saving; the sample then explicitly falls back to brand styling. A failed logo
load is shown, not silently replaced.

Questions and appearance share one in-memory document, save toolbar, revision,
conflict state and leave guard. Finish/cancel open question forms before saving
from either section. Configuration saves and CSV imports preserve `theme`.
**Réinitialiser au thème de la marque** changes only local `theme` to `null`;
save the draft to persist it. It neither clears questions/configuration nor
updates the tenant. **Abandonner les modifications préparatoires** still resets
the whole draft. Multiple campaigns using one quiz also share its appearance.

The sample is illustrative, not an exact full-widget rendering; it makes no
tracking, recommendation or AI calls. The separate **Aperçu** section runs the
interactive journey described below. Appearance is activated publicly only by
the controlled publication operation.

### Interactive draft preview (Sprint 3, step 4)

The preview uses an **explicit snapshot of the local editor document**, including
unsaved question and theme changes. It never saves that document. Open question/
answer forms must first be applied locally to be included; their state survives
tab changes, and a visible notice explains this distinction. Subsequent edits do
not silently change an ongoing simulation: use **Actualiser depuis l'état local**.
Saving/discarding still uses the existing revision/CAS protocol independently.

Authenticated tenant-scoped endpoints:

- `POST /api/quizzes/:id/preview` with `{draft}` validates the document, catalogue,
  selected products and theme, then returns `{quizId,draft,branding}`. It neither
  reads a public-only scope nor requires an active quiz.
- `POST /api/quizzes/:id/preview/recommendations` with
  `{draft,answers:[{questionId,answerId}],abVariant?:string|null}` revalidates the
  whole local document and requires valid answers to every reachable active
  question of the selected variant. Single/scale accept exactly one answer;
  multi accepts one or more. Foreign, inactive, hidden, missing or duplicate
  answers are rejected. No public access or tenant ID supplied in the body is
  used to authorize either endpoint.

`quizRecommendations.ts` is the read-only shared core used by both public submit
and preview: unchanged `computeProfile`, same Python `/recommend`, same catalogue/
product constraints, same explanations and profile. Existing answers use the
public lookup order because per-answer clamping is order-sensitive; draft-only
answers use the local document order after existing answers. The Python scoring
algorithm is unchanged and this path does not invoke OpenAI. The Python service,
PostgreSQL and its local sentence-transformer model must be available.

The admin imports the **existing `QuizContent` customer component**, not a second
renderer, and displays it through a React portal in an isolated iframe using the
widget's original styles. Its explicit preview runtime supplies local questions,
resolved draft theme and an authenticated submit adapter. All trackers return
before `fetch`/`sendBeacon`, public submit is never called, purchase links become
disabled buttons, and preview responses have no `sessionId`. There are no writes
to `QuizSession`, `Metric`, feedback, conversions, draft or public content.
Images remain normal image requests; no application analytics is emitted.

The shared conditional helper ignores selections from unreachable questions,
including stale selections after returning to an earlier branch. The same helper
serves the public widget. The scale control now also allows explicitly choosing
its first value without first moving the slider. Existing public URLs, branding
and random per-session A/B assignment remain unchanged.

**Ordinateur/Mobile**, the visible no-data banner, a variant selector,
**Recommencer**, progress, results and explicit error/retry states are provided.
Changing device width does not reset answers; restart or variant change does.
This remains a simulation: it does not publish, validate readiness for publication,
or record a conversion.

Real PostgreSQL + Python regression (isolated tenant, cleaned in `finally`):

```bash
POAPO_TEST_PREVIEW_ENGINE=1 NODE_ENV=test npm exec --workspace=poapo-back -- \
  node --import tsx --test tests/quizPreview.postgres.test.ts
```

Opt-in browser regression against the running local admin/API/Python (Playwright
must already be available; `POAPO_PLAYWRIGHT_MODULE` can point to an isolated
installation). It creates and deletes only a uniquely named fixture tenant:

```bash
node poapoadmin/tests/quizPreview.browser.cjs
```

For Odyssey: open its campaign, **Personnaliser le quiz**, change/apply questions
or appearance locally, then **Aperçu → Lancer l'aperçu local**. Test each available
variant and device mode, submit answers and inspect the recommendation/profile.
After edits, refresh the snapshot explicitly. The catalogue/product selection
comes from the draft configuration, not the current global catalogue selector.
Do not expect any analytics increase or any change to the public Odyssey link.

### Controlled validation and publication (Sprint 3, step 5)

Apply the additive migration before deploying the updated API:

```bash
npm exec --workspace=poapo-back -- prisma migrate deploy
npm exec --workspace=poapo-back -- prisma generate
```

`20261024110000_add_published_quiz_theme` adds nullable JSONB
`Quiz.publishedTheme`; it does not rewrite existing quizzes, IDs or draft JSON.
Public configuration reads this column **only**, never the draft theme.
`QuizThemeStyle`, shared with preview, emits overrides only for customized fields;
an uncustomized historical quiz receives no extra theme stylesheet.

Authenticated, tenant-scoped operations:

- `POST /api/quizzes/:id/publication/check` with `{revision}` checks the saved
  draft, or the current public document when there is no pending draft. Returns
  `{quizId,revision,hasChanges,valid,summary,errors,warnings,campaigns}`.
- `POST /api/quizzes/:id/publication/publish` with `{revision,confirm:true}`
  reruns the same diagnostic and requires a saved draft. If multiple campaigns
  share the quiz, also supply `confirmedCampaignIds` with the exact list returned
  by a fresh diagnostic. Returns the standard draft envelope with its incremented
  revision, public snapshot and `hasChanges:false`.

The common server diagnostic checks playable active routes, types/texts, active
answers, previous/reachable conditions, cycles, A/B variants, impacts/axes,
tenant/catalogue/product membership, active recommendable products and theme.
It does **not** impose the AI generator's question/answer limits. Missing
embeddings/axis attributes, weak axes, impact-free answers, low color contrast
and shared campaigns are warnings, not blockers. Contrast uses solid color
swatches (4.5:1), not a full image/gradient/accessibility audit.

Publication uses one PostgreSQL transaction. A tenant-scoped quiz row lock
serializes publications, activation and campaign association mutations.
READ COMMITTED deliberately reads campaign associations after acquiring that
lock, including a concurrent association whose commit the lock waited for.
The draft CAS coordinates save/discard/publication. Public IDs are retained;
new `draft_UUID` identities receive real UUIDs and all conditions are remapped
after answers exist. Own conditions are temporarily cleared inside the
transaction before deletions. Cross-quiz conditions are refused, never silently
cleared. Product links are replaced safely around a catalogue switch.
Any failure rolls back public content, theme **and** draft revision.
Draft reads use a repeatable-read snapshot, preventing a mixture of old public
content and a new post-publication revision.

Stale revisions, simultaneous publication or a changed shared-campaign list
return `409`: reload, review and verify again; there is no automatic merge or
retry. Invalid publication returns `422` with its diagnostic. An unexpected SQL
failure remains an error, never a success-shaped fallback.

**Activation policy:** only the **existing public version** is validated when
activating a quiz or creating/updating an ACTIVE/SCHEDULED campaign. An unrelated
pending draft does not block valid public content and is never automatically
published. Campaign dates/status semantics, quiz activation and historical URL
resolution remain independent. New quizzes, including newly provisioned default
quizzes, start inactive; previously created quizzes are not disabled.
Explicit `active:true` on quiz creation is refused until content can be checked.

**Browser acceptance, including Odyssey:**

1. Open a campaign → **Personnaliser le quiz**. Verify quiz/catalogue and any
   shared-campaign warning. Prefer a test campaign: publication changes the real
   quiz used by every listed campaign.
2. Edit Questions/Apparence and apply open card forms. **Aperçu** can simulate
   local unsaved changes, but **Publication** requires saving first.
3. Save, then **Publication → Vérifier le quiz**. Follow question/appearance or
   configuration links to correct errors. Warnings do not block publication.
4. Check the summary, target catalogue, active/inactive state and campaigns.
   Confirm replacement and, if shared, explicitly confirm all affected campaigns.
5. Publish. Editing/save/discard controls are frozen during the operation. Only
   a successful response shows success; failure preserves the saved draft.
6. Reload the editor: no pending draft remains, its revision has advanced and
   question/answer IDs are preserved. Reload the existing public Odyssey URL:
   content and prepared theme now appear, provided the published quiz is active.
   Complete the journey and inspect normal recommendations.
7. In two editor tabs, save/publish from one, then verify/publish from the other:
   expect `409`, preserved local changes and an explicit reload/review.
8. Check mobile/desktop layouts. Publication itself creates no sessions/metrics;
   a subsequent **public** customer journey still tracks normally.

Real PostgreSQL publication tests include rollback through an intentional SQL
failure, concurrent publication/save/association, IDs/remapping, tenant/catalogue
isolation, themes, invalid conditions/variants and activation policy:

```bash
POAPO_TEST_PUBLICATION=1 NODE_ENV=test npm exec --workspace=poapo-back -- \
  node --import tsx --test tests/quizPublication.postgres.test.ts
node poapoadmin/tests/quizPublication.browser.cjs
```

The opt-in browser test requires local admin/widget/API/Python and Playwright
(or `POAPO_PLAYWRIGHT_MODULE`). It cleans its unique fixture tenant and owned
browser; it never edits a real Odyssey tenant. Publication/diagnostics themselves
need neither Python nor OpenAI. No version history/rollback UI or quiz duplication
is introduced; discard still resets to the currently published version.

### Verification

From the repository root:

```bash
npm run test:back
npm run build
```

To enable all real PostgreSQL/Python scenarios in the canonical suite:

```bash
POAPO_TEST_POSTGRES=1 POAPO_TEST_PREVIEW_ENGINE=1 POAPO_TEST_PUBLICATION=1 \
  NODE_ENV=test npm run test:back
```

The normal API tests use simulated persistence. An opt-in PostgreSQL test
exercises real HTTP routes, concurrent inserts/updates, the composite tenant FK,
discard, inactive quiz editing and unchanged public content:

```bash
NODE_ENV=test POAPO_TEST_POSTGRES=1 npm exec --workspace=poapo-back -- \
  node --import tsx --test tests/quizEditorDrafts.postgres.test.ts
```

It requires the configured PostgreSQL database and applied migrations. It creates
a uniquely named test tenant and removes only that tenant and its fixtures in
`finally`. Expected unique/FK constraint errors may appear in Prisma's logs while
their assertions pass.
