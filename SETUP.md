# Poapo — Guide de démarrage

## Prérequis

- Node.js ≥ 20
- npm ≥ 10
- Docker + Docker Compose
- Python ≥ 3.11
- Git

---

## 1. Cloner et installer les dépendances

```bash
# Cloner
git clone <repo-url> poapotech
cd poapotech

# Installer toutes les dépendances (monorepo npm workspaces)
npm install

# Compiler le package de types partagés
cd poapo-types && npx tsc && cd ..
```

---

## 2. Lancer PostgreSQL (Docker)

```bash
# Depuis la racine /poapotech
docker-compose up -d

# Vérifier que le conteneur est healthy
docker ps
# → poapo_postgres doit afficher "healthy"
```

Base de données disponible sur `localhost:5433` (port interne du conteneur : `5432`).
Le port hôte `5433` évite les conflits avec les autres instances PostgreSQL locales.
Les `DATABASE_URL` du backend et du service IA doivent utiliser ce port.

- user : `poapo`
- password : `poapo_secret`
- db : `poapo`

---

## 3. Configurer le backend

```bash
cd poapoback

# Copier et éditer les variables d'environnement
cp .env.example .env
```

Editer `.env` — valeurs obligatoires :

| Variable         | Description                       |
| ---------------- | --------------------------------- |
| `DATABASE_URL`   | Déjà remplie pour Docker local    |
| `JWT_SECRET`     | Chaîne longue et aléatoire        |
| `SMTP_HOST`      | Serveur SMTP (ex: smtp.gmail.com) |
| `SMTP_PORT`      | 587                               |
| `SMTP_USER`      | Email expéditeur                  |
| `SMTP_PASS`      | Mot de passe applicatif           |
| `OPENAI_API_KEY` | Clé OpenAI (pour le mapping IA)   |
| `AI_SERVICE_URL` | `http://localhost:8000`           |

```bash
# Générer le client Prisma
npm run db:generate

# Pour une NOUVELLE base vide de développement uniquement :
# créer le schéma courant (aucune donnée historique à migrer)
npm run db:push

# Pour une base existante, voir « Migration multi-quiz » ci-dessous.
# Ne pas utiliser db:push pour migrer les données historiques.

# (Optionnel) Explorer la DB dans le navigateur
npm run db:studio
```

---

## 4. Configurer le service IA (Python)

```bash
cd ../poapoai

# Créer et activer l'environnement virtuel
python3 -m venv .venv
source .venv/bin/activate      # macOS/Linux
# .venv\Scripts\activate       # Windows

# Installer les dépendances
pip install -r requirements.txt
# ⚠️ Le téléchargement du modèle (~120 MB) se fait au premier démarrage

# Copier les variables d'environnement
cp .env.example .env
# Remplir OPENAI_API_KEY et vérifier DATABASE_URL
```

---

## 5. Lancer tous les services

Ouvrir **4 terminaux** :

### Terminal 1 — Backend Node.js (port 5050)

```bash
cd poapotech/poapoback
npm run dev
```

### Terminal 2 — Service IA Python (port 8000)

```bash
cd poapotech/poapoai
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

### Terminal 3 — Widget quiz frontend (port 5173)

```bash
cd poapotech/poapofront
npm run dev
```

### Terminal 4 — Back-office admin (port 5174)

```bash
cd poapotech/poapoadmin
npm run dev
```

---

## 6. Vérifier que tout fonctionne

```bash
# Backend
curl http://localhost:5050/health
# → {"status":"ok","ts":"..."}

# Service IA
curl http://localhost:8000/health
# → {"status":"ok","model":"paraphrase-multilingual-MiniLM-L12-v2"}

# Widget
open http://localhost:5173
```

---

## Plusieurs quiz par tenant

Dans **Mes quiz**, créez un quiz puis configurez :

- son nom interne, son activité (libellé libre : « Café », « Vins », « Cosmétique »…),
  son titre public et son CTA ;
- ses **axes de recommandation** (voir ci-dessous) ;
- son **catalogue** (voir « Plusieurs catalogues par tenant ») ;
- les produits recommandables : tous les produits actifs de son catalogue, ou une
  sélection explicite dans ce catalogue ;
- son état actif/désactivé. La désactivation conserve les questions et les statistiques.

Le logo, la couleur et le domaine autorisé restent partagés au niveau du tenant.
Un quiz ne recommande jamais un produit d'un autre catalogue. Une sélection vide ne
retombe jamais sur tout le catalogue.

### Plusieurs catalogues par tenant

Un tenant possède un ou plusieurs catalogues indépendants (par exemple
« Expériences » et « Hébergements »). Chaque produit et chaque quiz appartient à un
seul catalogue ; chaque tenant possède un **catalogue principal** (`isDefault`),
créé automatiquement et non supprimable.

- Page **Catalogues** : créer, renommer, supprimer un catalogue secondaire vide, et
  accéder à ses produits, quiz, campagnes, à l'import CSV et à la création de quiz.
- Les listes Produits, Quiz et Campagnes ont un sélecteur de catalogue (mémorisé
  dans le navigateur).
- `useAllProducts` signifie « tous les produits actifs du catalogue du quiz ».
- Changer le catalogue d'un quiz exige une nouvelle sélection de produits ; déplacer
  un produit sélectionné par un quiz est refusé (409).
- Les axes restent définis **par quiz** et la recommandation utilise uniquement les
  axes du quiz. La réunion des axes des quiz d'un catalogue sert seulement d'aide à
  l'édition des produits et à l'import.
- Le service IA filtre en SQL les produits sur le catalogue du quiz ; le générateur
  de quiz (Campaign Studio) ne propose que les produits du catalogue du quiz.
- Rétrocompatibilité : les API sans `catalogId` (création de produit, import,
  création de quiz) utilisent le catalogue principal ; le widget est inchangé.

### Axes de recommandation (vecteurs numériques)

Poapo n'est lié à aucun secteur : chaque quiz définit ses propres axes numériques,
par exemple `body` (« Corps », léger → corsé) et `acidity` pour un quiz café, ou
`budget` et `sportiness` pour un quiz vélo. Un axe possède :

- une clé technique (`^[A-Za-z][A-Za-z0-9_]{0,39}$`, figée après création) ;
- un libellé et, facultativement, les libellés des extrémités basse et haute.

Un quiz accepte au maximum 12 axes. Ils sont utilisés à trois endroits :

1. **Produit** : la valeur de chaque axe (0 à 1) est stockée dans
   `attributes.<clé>`. Le formulaire produit affiche un curseur par axe, tous quiz
   du tenant confondus ; les autres caractéristiques restent libres en JSON.
2. **Réponse** : dans le Quiz Builder, chaque réponse déplace le profil sur les
   axes du quiz (impacts de -1 à 1). Le profil part de 0,5 sur chaque axe.
3. **Recommandation** : le service IA combine 60 % de similarité sémantique et
   40 % de proximité entre le profil et `attributes` sur les axes du quiz.

Import CSV : le catalogue accepte les colonnes `attribute.<clé>` (le mapping propose
les axes existants et des « caractéristiques libres ») ; l'import de questions
accepte les impacts dans des colonnes `<clé>` ou `impact_<clé>`.

Le Quiz Builder et Analytics disposent d'un sélecteur de quiz. Les questions,
conditions, variantes A/B, sessions et métriques sont isolées par quiz. Une variante
A/B reste une variante d'un quiz, pas un autre quiz.

Chaque fiche quiz fournit son lien et son code d'intégration :

```text
https://app.poapo-tech.com/?clientId=TENANT_ID&quizId=QUIZ_ID
```

```html
<script
  src="https://app.poapo-tech.com/poapo-widget.js"
  data-url="https://app.poapo-tech.com"
  data-client-id="TENANT_ID"
  data-quiz-id="QUIZ_ID"
  async
></script>
```

Les anciennes intégrations sans `quizId` ou `data-quiz-id` continuent d'utiliser le
**quiz par défaut**. Son identité est conservée ; les réglages de quiz de la page
Paramètres et des anciennes API de branding ciblent ce quiz uniquement. Un
identifiant explicite inconnu, étranger au tenant ou désactivé est refusé, sans
repli vers un autre quiz.

### Migration multi-quiz d'une base existante

1. Sauvegarder la base et vérifier la base cible ainsi que l'historique Prisma.
2. Si la base a été créée par `db:push`, établir d'abord une baseline de son schéma
   historique selon la procédure Prisma. Les migrations versionnées ici sont
   **incrémentales**, elles ne constituent pas un schéma initial pour une base vide.
3. Appliquer dans l'ordre les migrations non encore appliquées :
   - `20261015110000_add_sector_product_attributes` ;
   - `20261015150000_add_multiple_quizzes` ;
   - `20261022100000_generic_recommendation_axes` ;
   - `20261022120000_add_campaigns` (Campaign Studio, purement additive) ;
   - `20261022140000_add_catalogs` (multi-catalogue, additive avec reprise).
4. Régénérer le client Prisma, reconstruire et redéployer ensemble le backend,
   le service IA, l'administration et le front.
5. Vérifier l'ancien lien `clientId` seul, puis un nouveau lien avec `quizId`.

La migration multi-quiz crée `default_<tenantId>` pour chaque tenant existant,
copie sa configuration et rattache toutes ses questions, sessions et métriques à
ce quiz. Aucun produit ou historique n'est supprimé. Les nouveaux tenants
obtiennent leur quiz par défaut à leur premier accès aux quiz.

Ne pas remplacer cette migration par `db:push` sur une base contenant des données :
le rattachement des lignes historiques fait partie du SQL de migration. Si les
colonnes secteur/attributs existent déjà via `db:push`, réconcilier cet état avec
l'historique avant d'appliquer la première migration, qui ajoute ces colonnes.

La migration `generic_recommendation_axes` retire le modèle spécifique au parfum
sans perte de données : les anciennes colonnes produit (notes, famille,
concentration, axes…) sont fusionnées dans `attributes`, les axes de chaque quiz
sont déduits des clés d'impact de ses réponses, et les codes d'activité deviennent
des libellés. Les axes ainsi créés reprennent leur clé comme libellé ; renommez-les
depuis la fiche quiz.

La migration `add_campaigns` crée uniquement les types `CampaignStatus` et
`CampaignOccasion`, la table `Campaign`, ses index et ses clés étrangères. Elle ne
modifie aucune table ni donnée existante. La clé étrangère composite
`(tenantId, quizId)` garantit en base qu'une campagne ne référence qu'un quiz de
son propre tenant.

La migration `add_catalogs` crée la table `Catalog`, un catalogue principal
`catalog_<tenantId>` par tenant, et y rattache tous les produits et quiz existants.
`QuizProduct` reçoit une colonne `catalogId` reprise du quiz. Des clés étrangères
composites garantissent en base que :

- le catalogue d'un produit ou d'un quiz appartient au même tenant
  (`(tenantId, catalogId)` → `Catalog(tenantId, id)`) ;
- un quiz et un produit sélectionné partagent le même catalogue
  (`QuizProduct(catalogId, quizId)` → `Quiz(catalogId, id)` et
  `QuizProduct(catalogId, productId)` → `Product(catalogId, id)`).

Un index unique partiel limite chaque tenant à un seul catalogue principal. Aucune
ligne n'est supprimée. La migration commence par un contrôle : si une sélection
`QuizProduct` associe un quiz et un produit de tenants différents, elle s'arrête
(`RAISE EXCEPTION`) sans rien modifier. Corrigez ces lignes, marquez la migration
comme annulée (`npx prisma migrate resolve --rolled-back 20261022140000_add_catalogs`)
puis relancez `npx prisma migrate deploy`. Le backend et le service IA doivent être
déployés **après** cette migration : leur code utilise la colonne `catalogId`.

### Tests ciblés multi-quiz

Depuis la racine, sans connexion à une base et sans appel à un modèle externe :

```bash
npm run test:back
cd poapoai && .venv/bin/python -m unittest test_recommend test_generate test_enrich -v
```

Les tests API exécutent les routes HTTP avec une persistance simulée. Les tests IA
simulent la connexion PostgreSQL et le modèle d'embedding. Une validation de
migration et de persistance doit également être réalisée sur une copie de base
avant le déploiement.

---

## Scripts disponibles

### Monorepo (racine)

```bash
npm run back    # Lance le backend en dev
npm run front   # Lance le widget en dev
npm run admin   # Lance l'admin en dev
npm run ai      # Lance le service IA
npm run build   # Vérifie les types et construit les workspaces JavaScript
npm run test:back # Lance les tests API sans base de données
```

### Backend (`poapoback/`)

```bash
npm run dev           # Développement avec rechargement automatique (tsx watch)
npm run build         # Compile en dist/
npm run start         # Lance la version compilée
npm run db:generate   # Régénère le client Prisma après modif du schéma
npm run db:migrate    # Applique les migrations en dev
npm run db:push       # Sync schéma sans migration (proto rapide)
npm run db:studio     # Interface visuelle Prisma Studio
```

### Service IA (`poapoai/`)

```bash
uvicorn main:app --reload --port 8000   # Développement
uvicorn main:app --port 8000            # Production
```

---

## Architecture des ports

| Service           | Port | URL                   |
| ----------------- | ---- | --------------------- |
| Backend API       | 5050 | http://localhost:5050 |
| Service IA        | 8000 | http://localhost:8000 |
| Widget quiz       | 5173 | http://localhost:5173 |
| Back-office admin | 5174 | http://localhost:5174 |
| PostgreSQL        | 5433 | localhost:5433        |
| Prisma Studio     | 5555 | http://localhost:5555 |

---

## Structure du monorepo

```
poapotech/
├── docker-compose.yml          PostgreSQL + pgvector
├── package.json                Monorepo npm workspaces
│
├── poapo-types/                Types TypeScript partagés (front + back + admin)
│   └── src/index.ts
│
├── poapoback/                  API Express + TypeScript
│   ├── prisma/schema.prisma    Schéma DB (Tenant, Quiz, QuizProduct, Product, Question, QuizSession, Metric...)
│   ├── src/
│   │   ├── server.ts
│   │   ├── lib/prisma.ts
│   │   ├── middleware/auth.ts
│   │   └── routes/
│   │       ├── auth.ts         POST /api/auth/magic-link, GET /api/auth/verify
│   │       ├── embed.ts        GET /api/embed/config (public, widget)
│   │       ├── quiz.ts         GET /questions, POST /submit, /track, /feedback, GET /metrics
│   │       ├── quizzes.ts      Gestion des quiz et sélections de produits
│   │       └── catalog.ts      CRUD /api/catalog/products
│   └── .env.example
│
├── poapofront/                 Widget quiz React + TypeScript (iframe embeddable)
│
├── poapoadmin/                 Back-office React + TypeScript
│
└── poapoai/                    Service Python FastAPI + sentence-transformers
    ├── main.py
    │   ├── POST /embed/product     Embedding d'un produit
    │   ├── POST /embed/batch       Embedding batch
    │   ├── POST /recommend         Recommandation par profil utilisateur
    │   ├── POST /infer/impacts     Impacts d'une réponse sur les axes (GPT-4o-mini)
    │   ├── POST /generate/quiz     Génération d'un brouillon de quiz de campagne (GPT-4o-mini)
    │   └── POST /map-catalog       Mapping colonnes CSV → champs Poapo (GPT-4o-mini)
    └── requirements.txt
```

---

## Endpoints API — Résumé

### Publics (widget)

```
GET  /api/embed/config?clientId=&quizId=   Branding tenant et configuration du quiz
GET  /api/quiz/questions?clientId=&quizId= Questions du quiz
POST /api/quiz/submit                     Réponses + clientId + quizId → recommandation
POST /api/quiz/track                      Événement + clientId + quizId
POST /api/quiz/feedback              Feedback après résultat
```

### Protégés JWT

```
POST /api/auth/magic-link            Envoyer un magic link
GET  /api/auth/verify?token=         Vérifier token → JWT
GET  /api/auth/me                    Profil tenant
PUT  /api/auth/me/branding           Modifier branding

GET    /api/catalogs                 Catalogues du tenant + compteurs (produits, quiz, campagnes)
POST   /api/catalogs                 Créer un catalogue (nom unique par tenant)
GET    /api/catalogs/:id             Détail d'un catalogue
PUT    /api/catalogs/:id             Renommer / décrire
DELETE /api/catalogs/:id             Supprimer un catalogue secondaire vide (409 sinon)

GET  /api/catalog/products?catalogId=  Liste produits (paginée ; sans catalogId : tout le tenant)
POST /api/catalog/products           Créer un produit (catalogId facultatif → catalogue principal)
GET  /api/catalog/products/:id       Détail produit
PUT  /api/catalog/products/:id       Modifier produit
DELETE /api/catalog/products/:id     Supprimer produit

GET  /api/quizzes?catalogId=          Liste des quiz du tenant
POST /api/quizzes                    Créer un quiz (catalogId facultatif → catalogue principal)
GET  /api/quizzes/:id                Configuration et produits sélectionnés
PUT  /api/quizzes/:id                Modifier ou désactiver un quiz
GET  /api/quiz/builder/questions?quizId=   Questions du quiz choisi
GET  /api/quiz/metrics?quizId=             Analytics du quiz choisi
GET  /api/quiz/metrics/ai-insights?quizId=  Insights du quiz choisi

GET    /api/campaigns?search=&status=&occasion=&quizId=&catalogId=&sort=   Campagnes du tenant + compteurs par statut
POST   /api/campaigns                Créer une campagne (quiz existant du tenant)
GET    /api/campaigns/:id            Détail d'une campagne
PUT    /api/campaigns/:id            Modifier (dont en ligne / en pause)
POST   /api/campaigns/:id/duplicate  Dupliquer en brouillon, sans dates
DELETE /api/campaigns/:id            Supprimer un brouillon uniquement
```

Une campagne a un statut **enregistré** (`status`) et un statut **calculé**
(`effectiveStatus`) : `SCHEDULED`/`ACTIVE` deviennent `SCHEDULED` avant
`startsAt`, `COMPLETED` après `endsAt`, `ACTIVE` sinon. Aucun job ne réécrit le
statut. Le filtre `status` porte sur le statut calculé ; `sort` accepte `recent`,
`oldest`, `startsAt` et `name`. Dans ce sprint, le statut d'une campagne n'a aucun
effet sur le widget, le quiz ou les recommandations.

```
GET  /api/campaigns/:id/quiz-generation/context   Quiz, axes, produits (500 max) et canAttach
POST /api/campaigns/:id/quiz-generation           Générer un brouillon de quiz (aucune écriture en base)
POST /api/campaigns/:id/quiz-generation/preview   Aperçu : profil + un seul appel /recommend (top 3)
POST /api/campaigns/:id/quiz-generation/save      Enregistrer comme nouveau quiz inactif
```

Génération de quiz par IA (Campaign Studio, sprint 2) :

- Seuls les axes du quiz de la campagne sont utilisables. Le mode est `AXES` si au
  moins un axe s'écarte de 0,2 entre les produits sélectionnés, sinon `SEMANTIC`
  si au moins un produit possède un embedding, sinon la génération est refusée (422).
- L'IA ne reçoit que des références locales (`p1`, `p2`…), jamais d'identifiant
  produit, tenant ou campagne. Toute référence, tout axe inconnu ou tout impact
  hors de ±0,15 est rejeté ; une seconde tentative est faite avec le détail des
  erreurs, puis 502. Délai dépassé → 504, service indisponible → 503.
- Les impacts modifiés manuellement par le commerçant sont validés sur ±1, comme
  dans le Quiz Builder.
- Le quiz enregistré est toujours un **nouveau quiz inactif**. Il n'est rattaché
  automatiquement à la campagne que si celle-ci est en `DRAFT` ; sinon il reste
  indépendant. Il n'est jamais publié automatiquement.
- Limitation : une génération à la fois par tenant et
  `QUIZ_GENERATION_HOURLY_LIMIT` générations par heure (10 par défaut, compteur en
  mémoire par instance).
- Variables du service IA : `OPENAI_API_KEY`, `GENERATION_MODEL` (défaut
  `gpt-4o-mini`), `GENERATION_TIMEOUT_S` (défaut 30). Le backend utilise
  `AI_SERVICE_URL`.

Enrichissement des axes produits par IA (page admin « Enrichissement IA ») :

```
GET  /api/catalogs/:catalogId/enrichment/context?quizId=   Axes du quiz + produits du catalogue
POST /api/catalogs/:catalogId/enrichment/estimate          Estimer un lot (≤ 10 produits)
POST /api/catalogs/:catalogId/enrichment/apply             Enregistrer les valeurs validées
POST /enrich/axes                                          (service IA, interne)
```

- Le quiz doit appartenir au catalogue et au tenant authentifié ; les axes estimés
  sont uniquement ceux du quiz choisi. Le moteur de scoring n'est pas modifié.
- L'IA reçoit des références locales (`p1`…), la description, les tags et les
  attributs non-axes du produit, jamais les valeurs d'axes existantes ni les
  identifiants. Chaque estimation contient une valeur 0–1, une justification, un
  niveau de confiance (`low`/`medium`/`high`) et des extraits ; un axe peut être
  marqué `insufficient_data`. Les extraits absents du texte source sont écartés et
  la confiance est alors plafonnée à `low`. Les produits sans aucune donnée sont
  marqués « données insuffisantes » sans appel IA.
- Les valeurs sont écrites dans `Product.attributes.<axe>` seulement après
  validation. Une valeur existante n'est remplacée qu'avec `overwrite: true`
  (case « Remplacer la valeur existante ») ; si le produit a changé entre-temps,
  l'API répond 409. Les embeddings sont recalculés après enregistrement.
- Limitation : une estimation à la fois par tenant et
  `ENRICHMENT_HOURLY_PRODUCT_LIMIT` produits envoyés à l'IA par heure (200 par
  défaut, compteur en mémoire par instance, non remboursé en cas d'erreur IA).
- Variables du service IA : `ENRICH_MODEL` (défaut `GENERATION_MODEL`),
  `ENRICH_TIMEOUT_S` (défaut 30).

Le paramètre `quizId` est facultatif pour la rétrocompatibilité : son absence
cible le quiz par défaut. Toutes les mutations du builder acceptent `?quizId=`,
y compris l'import CSV. Le choix des produits utilise `useAllProducts` et
`productIds` dans `POST/PUT /api/quizzes`. Les produits doivent appartenir au
tenant authentifié et au catalogue du quiz. L'import CSV de produits
(`/api/catalog/import/parse` et `/api/catalog/import/execute`) accepte un `catalogId` facultatif.

---

## Déploiement Scaleway

```bash
# Sur le serveur
docker-compose -f docker-compose.prod.yml up -d   # À créer

# Backend
NODE_ENV=production npm run build
npm run start

# Service IA (systemd ou supervisor)
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2

# Reverse proxy (nginx)
# → quiz.poapo.fr → poapofront (port 5173 ou dist statique)
# → admin.poapo.fr → poapoadmin (port 5174 ou dist statique)
# → api.poapo.fr → poapoback (port 5050)
# → ai.poapo.fr → poapoai (port 8000, interne uniquement)
```

---

## Troubleshooting

**Prisma : `Error: P1001 Can't reach database server`**

```bash
docker-compose up -d   # Relancer PostgreSQL
docker ps              # Vérifier que le conteneur est "healthy"
```

**Service IA : `OSError: [Errno 28] No space left`**

```bash
# Le modèle sentence-transformers fait ~120 MB
# Libérer de l'espace disque ou changer MODEL_NAME dans .env
```

**CORS error depuis le widget**

```bash
# Vérifier FRONTEND_URL dans poapoback/.env
# Doit correspondre exactement à l'URL du front (ex: http://localhost:5173)
```

**Magic link : email non reçu**

```bash
# En développement, afficher le lien dans les logs backend
# Ajouter dans poapoback/.env : LOG_MAGIC_LINK=true
```
