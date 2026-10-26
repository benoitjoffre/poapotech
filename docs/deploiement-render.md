# Déploiement Render (préparation — rien n'est déployé)

`render.yaml` décrit 5 ressources dans la région Frankfurt : PostgreSQL (pgvector), API Node, moteur Python, admin (statique), widget (statique).

## Ordre de mise en place
1. Importer le Blueprint ; renseigner les variables `sync: false` (voir tableau).
2. L'API applique `prisma migrate deploy` à chaque démarrage (base vide : 10 migrations, extension `vector` incluse).
3. Renseigner les URLs croisées une fois les services créés, puis redéployer API/admin/widget.

## Variables
| Service | Variable | Rôle |
|---|---|---|
| API | `DATABASE_URL` (auto), `JWT_SECRET` (généré), `AI_SERVICE_TOKEN` (généré) | base, sessions, jeton Python |
| API | `AI_SERVICE_URL` | URL du moteur Python |
| API | `FRONTEND_URL`, `ADMIN_URL` | origines autorisées pour l'administration (CORS) ; `ADMIN_URL` sert aux liens de connexion |
| API | `TRUST_PROXY=1`, `NODE_ENV=production` | IP réelle derrière le proxy, rate limit |
| API | `SMTP_*`, `EMAIL_FROM`, `SUPER_ADMIN_EMAIL/PASSWORD` | e-mails de connexion, super-admin |
| API | `EMBEDDING_WORKER`, `EMBEDDING_WORKER_INTERVAL_MS` | optionnels |
| Python | `DATABASE_URL`, `AI_SERVICE_TOKEN`, `MODEL_NAME`, `HF_HOME`, `PYTHON_VERSION` | lecture des produits, jeton, modèle local |
| Python | `OPENAI_API_KEY` | facultatif (génération de quiz/enrichissement uniquement) |
| Admin (build) | `VITE_API_BASE_URL`, `VITE_WIDGET_BASE_URL` | obligatoires en production |
| Widget (build) | `VITE_API_BASE_URL` | obligatoire en production |

## Sondes
- `/health` (API, Python) : liveness, sans dépendance.
- `/ready` (API) : 503 uniquement si PostgreSQL est inaccessible ; Python arrêté = `status: "degraded"` avec HTTP 200.
- `/ready` (Python) : 200 une fois le modèle chargé.

## Intégration client
```html
<script src="https://<widget>.onrender.com/poapo-widget.js" data-client-id="TENANT" data-quiz-id="QUIZ" async></script>
```
`data-url` est facultatif : par défaut, l'origine du script.

## Embeddings
Les produits naissent `PENDING`. Le worker de l'API les passe `READY` (ou `FAILED` après 5 tentatives) ; reprise : `POST /api/catalog/embeddings/retry`, état : `GET /api/catalog/embeddings`.
