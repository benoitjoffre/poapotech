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

Base de données disponible sur `localhost:5432`

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

- son nom interne, son secteur, son titre public et son CTA ;
- les produits recommandables : tout le catalogue, ou une sélection explicite ;
- son état actif/désactivé. La désactivation conserve les questions et les statistiques.

Le catalogue, le logo, la couleur et le domaine autorisé restent partagés au niveau
du tenant. Le « profil de saisie » du formulaire produit permet de renseigner des
produits de plusieurs secteurs dans le même catalogue. Pour éviter de recommander
un produit d'un autre secteur, utilisez une sélection explicite dans chaque quiz.
Une sélection vide ne retombe jamais sur tout le catalogue.

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
   - `20261015150000_add_multiple_quizzes`.
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

### Tests ciblés multi-quiz

Depuis la racine, sans connexion à une base et sans appel à un modèle externe :

```bash
npm run test:back
cd poapoai && .venv/bin/python -m unittest test_recommend -v
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
| PostgreSQL        | 5432 | localhost:5432        |
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
    │   ├── POST /infer/impacts     Impacts olfactifs d'une réponse (GPT-4o-mini)
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

GET  /api/catalog/products           Liste produits (paginée)
POST /api/catalog/products           Créer un produit
GET  /api/catalog/products/:id       Détail produit
PUT  /api/catalog/products/:id       Modifier produit
DELETE /api/catalog/products/:id     Supprimer produit

GET  /api/quizzes                    Liste des quiz du tenant
POST /api/quizzes                    Créer un quiz
GET  /api/quizzes/:id                Configuration et produits sélectionnés
PUT  /api/quizzes/:id                Modifier ou désactiver un quiz
GET  /api/quiz/builder/questions?quizId=   Questions du quiz choisi
GET  /api/quiz/metrics?quizId=             Analytics du quiz choisi
GET  /api/quiz/metrics/ai-insights?quizId=  Insights du quiz choisi
```

Le paramètre `quizId` est facultatif pour la rétrocompatibilité : son absence
cible le quiz par défaut. Toutes les mutations du builder acceptent `?quizId=`,
y compris l'import CSV. Le choix des produits utilise `useAllProducts` et
`productIds` dans `POST/PUT /api/quizzes`. Les produits doivent appartenir au
tenant authentifié.

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
