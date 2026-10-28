# Déploiement Render — environnement de recette (offre gratuite)

> **État : préparé, rien n'est déployé.** `render.yaml` décrit 5 ressources en région Frankfurt, validées contre le schéma officiel
> Render (`https://render.com/schema/render.yaml.json`). Aucun service payant, aucun déploiement automatique (`autoDeployTrigger: "off"`).
> Cet environnement sert à **recetter avec des données de test** : voir « Limites de l'offre gratuite » avant toute donnée réelle.

## 1. Architecture

```
Visiteur ──► poapo-widget (site statique) ──┐   iframe + poapo-widget.js sur les sites des clients
Commerçant ► poapo-admin  (site statique) ──┼──► poapo-api (Node/Express) ──► poapo-db (PostgreSQL + pgvector)
                                            │         │ HTTPS public + jeton AI_SERVICE_TOKEN
                                            │         └──────────────► poapo-ai (Python, embeddings locaux) ──► poapo-db
                                            └── Auth0 (externe, votre tenant existant)
```

| Liaison | URL utilisée | Pourquoi |
|---|---|---|
| API → base, Python → base | **interne** (`fromDatabase: connectionString`) | même région ; ne passe pas par Internet |
| API → Python | **publique** `https://poapo-ai.onrender.com` | un service web gratuit ne reçoit pas de trafic du réseau privé (doc Render) ; protégé par `AI_SERVICE_TOKEN` |
| Navigateurs → API | publique | `VITE_API_BASE_URL` (admin et widget) |

## 2. Limites de l'offre gratuite (source : <https://render.com/docs/free>)
- **Web services** : mise en veille après 15 min sans trafic, réveil ≈ 1 min ; 750 h gratuites par mois **pour tout l'espace de travail** ;
  disque local éphémère ; une instance ; pas de shell ; ports sortants 25/465/587 bloqués ; instance **512 Mo / 0,1 CPU**
  ([compute plans](https://render.com/docs/compute-plans)).
- **PostgreSQL gratuit** : 1 Go, **expire 30 jours après sa création** (14 jours de grâce, puis suppression), **aucune sauvegarde**,
  pas de pool de connexions. pgvector : `CREATE EXTENSION vector` documenté pour PostgreSQL ≥ 13 ; la page ne précise pas l'offre gratuite →
  **à confirmer au premier déploiement** (la migration `baseline` échouera explicitement sinon).
- **Sites statiques** : gratuits, avec des quotas de bande passante et de minutes de build.
- Conséquences : premier appel après inactivité = API puis Python à réveiller en cascade (≈ 1 à 2 min) ; la purge de rétention
  (`docs/subscriptions.md`) s'exécute 60 s après chaque réveil.

## 3. ⚠ Mémoire du moteur Python (mesurée)
Mesure locale (Python 3.11, torch 2.2.0 CPU, `paraphrase-multilingual-MiniLM-L12-v2`, modèle fp32 ≈ 458 Mo sur disque) :

| Étape | RSS |
|---|---|
| Import (torch + FastAPI + dépendances) | ≈ 335 Mo |
| Après chargement du modèle + warm-up | ≈ 745 Mo |
| Après un lot de 64 encodages (pic) | ≈ 765 Mo |

macOS et Linux diffèrent de quelques dizaines de Mo, mais l'ordre de grandeur dépasse nettement les **512 Mo** de l'offre gratuite :
**`poapo-ai` sera très probablement tué (mémoire insuffisante) au chargement du modèle.** Je n'ai pas modifié le moteur (ni
quantification, ni float16 : cela changerait les embeddings, donc le scoring). `OMP_NUM_THREADS=1` et `TOKENIZERS_PARALLELISM=false`
limitent seulement les pics.

Ce que cela implique pour la recette gratuite :
- **Fonctionne sans Python** : Auth0, onboarding, abonnements, catalogues, import CSV (embeddings `PENDING`/`FAILED`), édition d'expériences,
  publication, campagnes, résultats, widget (questions). `/ready` renvoie `degraded` (HTTP 200).
- **Ne fonctionne pas sans Python** : calcul de recommandation (aperçu express, `POST /api/quiz/submit` → 503 explicite, **aucun quota consommé**),
  embeddings des produits.
- Options pour tester les recommandations (décision à prendre, rien n'est fait) : (a) passer `poapo-ai` sur une instance d'au moins 2 Go
  (plan `standard`, payant — voir la page Pricing de Render), la plus petite instance payante à 512 Mo ne suffit pas ; (b) héberger le moteur
  ailleurs et renseigner `AI_SERVICE_URL` ; (c) accepter une recette sans recommandations.

## 4. Variables d'environnement (aucune valeur dans le dépôt)
Les variables « sync: false » sont saisies dans le Dashboard au premier import ; les valeurs générées (`generateValue`) restent dans Render.

| Variable | Service | Rôle | Oblig. | Configuration |
|---|---|---|---|---|
| `NODE_VERSION` (22.12.0), `NODE_ENV=production`, `TRUST_PROXY=1` | API | runtime, IP réelle derrière le proxy | oui | dans `render.yaml` |
| `DATABASE_URL` | API, Python | connexion PostgreSQL **interne** | oui | automatique (`fromDatabase`) |
| `JWT_SECRET` | API | signature des jetons de feedback (≥ 32 car.) | oui | généré par Render |
| `AI_SERVICE_TOKEN` | API, Python | jeton partagé API ↔ Python | oui | généré côté API, lu par Python (`fromService`) |
| `AI_SERVICE_URL` | API | URL **publique** de poapo-ai, sans `/` final | oui | Dashboard (saisie) |
| `FRONTEND_URL` | API | origine du widget | oui | Dashboard (saisie) |
| `ADMIN_URL` | API | origine de l'administration (CORS) | oui | Dashboard (saisie) |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` | API | vérification des jetons Auth0 | oui | Dashboard (saisie) |
| `SUPER_ADMIN_EMAIL` | API | email Auth0 **vérifié** du super-admin | oui | Dashboard (saisie) |
| `EMBEDDING_WORKER`, `EMBEDDING_WORKER_INTERVAL_MS`, `POAPO_RETENTION_JOB` | API | réglages facultatifs (`off` pour désactiver) | non | Dashboard |
| `PYTHON_VERSION` (3.11.9), `HF_HOME`, `MODEL_NAME`, `OMP_NUM_THREADS`, `TOKENIZERS_PARALLELISM`, `ALLOWED_ORIGINS` | Python | runtime et modèle | oui | dans `render.yaml` |
| `OPENAI_API_KEY` | Python | **facultatif**, génération de quiz / enrichissement IA uniquement | non | **laisser vide** en recette |
| `VITE_API_BASE_URL` | admin, widget | URL publique de l'API (**intégrée au build**) | oui | Dashboard (saisie) |
| `VITE_WIDGET_BASE_URL` | admin | URL du widget (liens, intégration) | oui | Dashboard (saisie) |
| `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE` | admin | SDK Auth0 (identifiants publics) | oui | Dashboard (saisie) |

Retirées de `render.yaml` car inutiles avec Auth0 : `SMTP_*`, `EMAIL_FROM`, `SUPER_ADMIN_PASSWORD` (chemin historique désactivé en production).
Les variables `VITE_*` étant **figées à la compilation**, toute modification impose un redéploiement manuel du site statique concerné.

## 5. En-têtes de sécurité (vérifiés localement, voir §8)
- **poapo-widget** : `Content-Security-Policy: frame-ancestors *`, aucun `X-Frame-Options` → intégrable en iframe sur n'importe quel domaine client.
- **poapo-admin** : `X-Frame-Options: DENY` + `frame-ancestors 'none'` → jamais affichable dans une iframe tierce.
- Les deux : `X-Content-Type-Options: nosniff`, `Referrer-Policy`, cache immuable sur `/assets/*` ; `poapo-widget.js` : cache 5 min.
- À contrôler après déploiement (Render peut ajouter ses propres en-têtes) : voir la checklist §7.

## 6. Procédure de première mise en ligne
**Prérequis (à faire par vous)** : le code est poussé sur GitHub (branche choisie) ; le dépôt est accessible à Render (GitHub App « Render »).

1. **Auth0 (application de recette)** — Dashboard Auth0 → Applications → créer une application *Single Page Web Application* « POAPO recette »
   (ou dupliquer l'existante) et renseigner, avec l'URL **réelle** de `poapo-admin` : *Allowed Callback URLs*, *Allowed Logout URLs*,
   *Allowed Web Origins* = `https://<poapo-admin>.onrender.com`. L'API `poapo-api` (audience) et l'Action qui ajoute les claims
   `https://poapo.app/email` / `email_verified` existent déjà (voir `docs/auth0.md`). Ne modifiez pas l'application de développement.
2. **Render** → *New* → *Blueprint* → choisir le dépôt et la branche → les 5 ressources s'affichent (toutes *Free*) → renseigner les
   variables demandées. Si vous ne connaissez pas encore les URLs, saisissez des valeurs provisoires (corrigées à l'étape 4).
   Vérifiez que **« Auto-Deploy » est bien sur « Off »** pour chaque service.
3. Attendre la fin des builds : `poapo-db` d'abord, puis `poapo-api` (applique `prisma migrate deploy` au démarrage ; base neuve = 12 migrations,
   extension `vector` incluse — vérifié sur une base vide locale), `poapo-ai` (téléchargement du modèle ≈ 450 Mo, voir §3), puis les deux sites.
4. **Relever les URLs réelles** (Dashboard, en haut de chaque service) puis corriger : `AI_SERVICE_URL`, `FRONTEND_URL`, `ADMIN_URL` (API),
   `VITE_API_BASE_URL` / `VITE_WIDGET_BASE_URL` (sites). Lancer *Manual Deploy → Deploy latest commit* sur **API, admin et widget**
   (les sites doivent être recompilés).
5. Compléter Auth0 avec l'URL définitive (étape 1) si elle a changé. **Noter la date de création de `poapo-db`** : la base expire 30 jours après.
6. Dérouler la checklist §7.

## 7. Checklist post-déploiement
Remplacer `<api>`, `<widget>`, `<admin>` par les URLs réelles.
- [ ] `curl -s https://<api>/health` → `{"status":"ok"}` ; `curl -s https://<api>/ready` → `ok` (ou `degraded` si Python est arrêté).
- [ ] `curl -sI https://<widget>/` : **pas** de `x-frame-options`, `content-security-policy: frame-ancestors *`. `curl -sI https://<admin>/` : `x-frame-options: DENY`.
- [ ] `https://<admin>/catalogs` (rechargement profond) s'ouvre sans 404 (réécriture SPA).
- [ ] Auth0 : inscription → email de vérification → connexion → création de boutique → abonnement **STARTER** (« Mon abonnement »).
- [ ] Déconnexion / reconnexion : même boutique, pas de doublon. Deuxième compte : ne voit rien du premier (catalogues, expériences, résultats).
- [ ] Super-admin (`SUPER_ADMIN_EMAIL`) : accès à l'administration des comptes ; attribution PRO d'un compte de test.
- [ ] Import CSV de produits (≤ 5 Mo) ; création express ; publication.
- [ ] Widget sur une page tierce : coller le snippet ci-dessous dans un fichier HTML local ou un site de test ; l'iframe s'affiche, les questions se chargent.
- [ ] Recommandations (si Python disponible, §3) : un parcours complet ; le résultat apparaît dans « Résultats » et le compteur « Mon abonnement » s'incrémente.
- [ ] Campagnes (compte PRO) et analytics avancés (compte PRO) ; ces deux fonctions sont refusées en STARTER avec un message clair.
- [ ] Aucune erreur dans les logs Render, aucun secret affiché ; le widget fonctionne après un réveil (≈ 1 min).

```html
<script src="https://<widget>.onrender.com/poapo-widget.js" data-client-id="ID_BOUTIQUE" data-quiz-id="ID_EXPERIENCE" async></script>
```

## 8. Vérifications locales effectuées (sans toucher à une base existante)
- `render.yaml` validé contre le schéma JSON officiel (0 erreur, références `fromService` / `fromDatabase` cohérentes, aucun secret littéral).
- Builds API, admin et widget sous Node 22.13 ; `npm ci --dry-run` cohérent avec le lockfile.
- Migrations : 12 appliquées avec succès sur une **base temporaire vide** (créée puis supprimée), extension `vector` présente.
- API compilée en `NODE_ENV=production` : refus de démarrer sans `JWT_SECRET` / avec une URL `localhost` ; `/health`, `/ready` ; écoute sur toutes
  les interfaces ; routes protégées → 401 ; jeton HS256 historique refusé ; CORS (public `*`, administration limitée à `ADMIN_URL`, origine inconnue → 403) ;
  corps > 10 Mo → 413 ; aucun secret dans les logs.
- Widget embarqué par `poapo-widget.js` dans une page d'un autre domaine, servi avec les en-têtes de `render.yaml` : iframe affichée, questions chargées via CORS ;
  l'administration, elle, est refusée dans une iframe tierce.
- Non vérifiable hors Render : les en-têtes effectivement émis par Render (checklist §7), pgvector sur l'offre gratuite, la mémoire réelle de `poapo-ai`.

## 9. Exploitation
- **Migrations** : uniquement `prisma migrate deploy` (additif). Jamais `migrate reset` ni `db push` en recette comme en production. Une migration
  défaillante empêche le démarrage de l'API (visible dans les logs) sans modifier les données déjà migrées.
- **Sauvegarde** : aucune sur l'offre gratuite. Avant l'expiration de la base, exporter avec `pg_dump` depuis la chaîne de connexion **externe**
  du Dashboard (jamais dans un fichier versionné). Les données de recette sont jetables.
- **Retour arrière** : *Manual Deploy → Rollback* du service concerné (code uniquement ; le schéma ne revient pas en arrière).
- `poapofront/public/test-embed.html` (page de démonstration) est publiée avec le widget ; elle pointe vers `localhost` et n'est pas utilisable en recette.
- Passage en pilote réel : base PostgreSQL et API payantes (sauvegardes, pas de veille), `migrate deploy` en `preDeployCommand`, instance Python ≥ 2 Go, tenant Auth0 de production séparé.

## 10. Embeddings
Les produits naissent `PENDING`. Le worker de l'API (toutes les 5 s, uniquement tant que le service est éveillé) les passe `READY` (ou `FAILED` après 5 tentatives) ;
reprise : `POST /api/catalog/embeddings/retry`, état : `GET /api/catalog/embeddings`. Sans Python, ils restent `PENDING`/`FAILED`.
