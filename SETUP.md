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

# Appliquer les migrations (crée toutes les tables)
npm run db:migrate
# → Donner un nom à la migration : "init"

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

### Terminal 4 — Back-office admin (port 5174) _(Phase 3 — à venir)_

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

## Scripts disponibles

### Monorepo (racine)

```bash
npm run back    # Lance le backend en dev
npm run front   # Lance le widget en dev
npm run admin   # Lance l'admin en dev
npm run ai      # Lance le service IA
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
│   ├── prisma/schema.prisma    Schéma DB (Tenant, Product, Question, QuizSession, Metric...)
│   ├── src/
│   │   ├── server.ts
│   │   ├── lib/prisma.ts
│   │   ├── middleware/auth.ts
│   │   └── routes/
│   │       ├── auth.ts         POST /api/auth/magic-link, GET /api/auth/verify
│   │       ├── embed.ts        GET /api/embed/config (public, widget)
│   │       ├── quiz.ts         GET /questions, POST /submit, /track, /feedback, GET /metrics
│   │       └── catalog.ts      CRUD /api/catalog/products
│   └── .env.example
│
├── poapofront/                 Widget quiz React + TypeScript (iframe embeddable)
│
├── poapoadmin/                 Back-office React + TypeScript (à venir Phase 3)
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
GET  /api/embed/config?clientId=     Config branding du tenant
GET  /api/quiz/questions?clientId=   Questions du quiz
POST /api/quiz/submit                Soumettre les réponses → recommandation
POST /api/quiz/track                 Tracking événements
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

GET  /api/quiz/metrics               Analytics dashboard
```

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
