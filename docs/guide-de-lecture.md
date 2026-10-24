# S'approprier Poapo : guide de lecture du code

Ce guide sert à comprendre le fonctionnement de l'application et à retrouver où
une règle métier est implémentée. Il décrit le code tel qu'il est organisé
aujourd'hui ; ce n'est pas un document de conception théorique.

## La carte mentale en une minute

Poapo est une application multi-tenant : chaque marque (tenant) a son catalogue,
ses quiz et ses données d'activité. Un quiz peut recommander tous les produits
actifs de la marque ou une sélection explicite.

```text
Visiteur ──> Widget React ──HTTP──> API TypeScript ──> PostgreSQL
                                     │                      │
                                     └──HTTP──> Service IA <┘

Équipe de la marque ──> Back-office React ──HTTP──> API TypeScript
```

- **Le widget** présente le quiz et recueille les réponses.
- **Le back-office** permet à une équipe de gérer son catalogue, ses quiz et ses
  questions, puis de lire les statistiques.
- **L'API** applique les règles métier, vérifie les droits et écrit les données.
- **PostgreSQL** conserve les tenants, produits, quiz, questions, sessions et
  événements. Prisma fournit l'accès TypeScript à la base.
- **Le service IA** transforme les produits et les préférences en vecteurs
  numériques (embeddings), puis aide à classer les produits.
- **Les types partagés** décrivent les contrats utilisés entre les applications
  TypeScript ; ils ne remplacent pas la validation côté serveur.

Depuis le Sprint 3, l'édition des quiz existants ne modifie plus les tables
publiques : le builder et la configuration utilisent un document
`QuizEditorDraft` séparé, sauvegardé avec une révision obligatoire.
`poapoback/src/services/quizEditorDrafts.ts` contrôle ce document, les identités
des questions/réponses et la sélection de produits. La révision est conservée
et incrémentée même après abandon, afin de refuser les écritures d'un ancien
onglet. Les anciennes routes de mutation du contenu ne permettent pas de
contourner ce mécanisme ; l'import CSV prépare lui aussi le brouillon.
Les identifiants publics existants restent dans le document, sans recréation.

Seule l'opération de publication contrôlée applique ce document : le widget, les
recommandations et les liens historiques continuent à lire `Quiz`, `Question`, `Answer` et
`QuizProduct`. Les campagnes partageant un quiz partagent son brouillon.
Le protocole API, la recette dans l'interface et le test PostgreSQL sont décrits
dans le [README de l'API](../poapoback/README.md#persistent-quiz-editor-drafts-sprint-3-step-1).

Depuis Campaign Studio, **Personnaliser le quiz** ouvre l'espace
`/campaigns/:campaignId/quiz-editor`. Il réutilise les cartes du Quiz Builder et
le même brouillon, sans dépendre du quiz sélectionné dans le menu global.
L'en-tête rappelle la campagne, le quiz et son catalogue public associé.
Les campagnes partageant le quiz sont signalées avec des liens.
Les quatre sections **Questions**, **Apparence**, **Aperçu** et **Publication**
sont opérationnelles. Changer de section
conserve les modifications locales ; quitter l'éditeur reste protégé.

L'apparence est stockée dans le champ facultatif `theme` du brouillon JSON.
La validation et la résolution centralisée (branding tenant + valeurs propres
au quiz + styles historiques) sont dans
[quizTheme.ts](../poapo-types/src/quizTheme.ts). Les valeurs sont limitées aux
couleurs hexadécimales, polices locales prédéfinies, formes et libellés autorisés.
[QuizAppearancePanel.tsx](../poapoadmin/src/components/QuizAppearancePanel.tsx)
présente les contrôles et un aperçu graphique statique. Le widget public ne lit
pas ce thème préparatoire : aucun changement public avant publication contrôlée.

L'onglet **Aperçu** prend explicitement un instantané du brouillon **local**, y
compris les changements non enregistrés. Les formulaires ouverts restent conservés
mais doivent être validés localement pour être inclus. Le composant client
[QuizContent](../poapofront/src/pages/QuizPage.tsx) est réutilisé dans un cadre
isolé avec les styles du widget et le thème préparé, sans second moteur de rendu.
Les conditions sont résolues par
[quizFlow.ts](../poapo-types/src/quizFlow.ts), partagé avec le parcours public.
Les endpoints authentifiés de [quizPreview.ts](../poapoback/src/services/quizPreview.ts)
valident tenant, catalogue, sélection, réponses et variantes avant d'appeler le
même calcul de profil et le même moteur Python via
[quizRecommendations.ts](../poapoback/src/services/quizRecommendations.ts).
Ce mode ne crée aucune session ni métrique : tracking et liens d'achat sont
neutralisés. Il fonctionne aussi pour un quiz inactif et ne publie rien.

L'onglet **Publication** vérifie uniquement la révision **enregistrée** :
[quizPublicationDiagnostic.ts](../poapoback/src/services/quizPublicationDiagnostic.ts)
est le diagnostic commun, réutilisé obligatoirement à la publication et lors
de l'activation de la version publique. Les erreurs de parcours, conditions,
axes, catalogue/tenant, produits ou thème sont bloquantes ; les limites du
générateur IA ne s'appliquent pas aux quiz historiques.
[quizPublication.ts](../poapoback/src/services/quizPublication.ts) verrouille le quiz,
compare la révision, exige la confirmation exacte des campagnes partagées et
applique tout en une transaction PostgreSQL. Les identifiants existants restent
stables, les nouvelles références conditionnelles sont remappées et tout échec
annule aussi la consommation du brouillon. Les lectures du brouillon utilisent
un instantané cohérent de sa révision et du contenu public.

Le thème publié est séparé dans `Quiz.publishedTheme` (migration additive).
[QuizThemeStyle.tsx](../poapofront/src/components/QuizThemeStyle.tsx) applique les
surcharges validées au vrai widget, sans styles supplémentaires en leur absence.
Le thème préparatoire n'est jamais exposé dans la configuration publique.
Une activation ou programmation vérifie le **public existant**, ne publie jamais
le brouillon et ne change pas la sémantique des statuts de campagne. Les nouveaux
quiz démarrent inactifs ; aucun quiz historique n'est désactivé rétroactivement.
La recette, les API et les tests réels sont dans le
[README de l'API](../poapoback/README.md#controlled-validation-and-publication-sprint-3-step-5).

### Une présentation courte du projet

> Poapo est une plateforme multi-tenant qui permet à une marque de créer des quiz
> de recommandation intégrables à son site. Le widget recueille les préférences,
> l'API valide les réponses et applique les règles métier, puis le service IA
> classe les produits du catalogue et renvoie une recommandation expliquée. Le
> back-office sert à gérer le catalogue, les quiz et leurs performances.

Tu peux ensuite détailler la partie que tu connais le mieux. Cette présentation
décrit le système ; elle n'implique pas que l'IA décide seule des règles ou du
produit à montrer.

## Les deux parcours à comprendre d'abord

### 1. Une marque configure un produit recommandable

1. Le back-office affiche le formulaire produit dans
   `poapoadmin/src/pages/ProductFormPage.tsx`.
2. Le formulaire transforme ses champs texte en données structurées avec
   `poapoadmin/src/lib/productForm.ts`.
3. Il envoie une requête authentifiée à `/api/catalog/products` ou
   `/api/catalog/products/:id`.
4. `poapoback/src/routes/catalog.ts` vérifie les données et l'appartenance du
   produit au tenant avant de les enregistrer.
5. Après une création ou une modification pertinente, l'API appelle
   `/embed/product` sans bloquer la réponse du formulaire.
6. `poapoai/main.py` convertit les informations du produit en texte, puis le
   modèle `sentence-transformers` en produit un embedding. L'API le stocke sur
   le produit.

L'embedding est une représentation numérique du contenu d'un produit. Il ne
remplace pas sa fiche : il est utilisé comme signal de similarité pour le
classement ultérieur.

### 2. Un visiteur fait le quiz et reçoit une recommandation

```text
Page hôte
  └─ poapo-widget.js crée un panneau et un iframe
       └─ Widget React lit clientId et quizId dans l'URL
            ├─ GET /api/embed/config
            ├─ GET /api/quiz/questions
            ├─ POST /api/quiz/track (événements de progression)
            └─ POST /api/quiz/submit
                 └─ API vérifie quiz, questions, réponses et produits autorisés
                      ├─ calcule un profil à partir des impacts des réponses
                      ├─ POST /recommend vers le service IA
                      │    └─ classe les produits autorisés
                      ├─ enregistre une QuizSession
                      └─ renvoie le produit et l'explication au widget
```

Dans le widget, `poapofront/public/poapo-widget.js` est le petit script à
installer sur le site d'une marque. Il ouvre une iframe ; l'application dans
l'iframe est celle de `poapofront/src/`.

Dans le widget React :

- `TenantContext.tsx` lit `clientId` et `quizId`, puis charge la configuration
  publique.
- `lib/quiz.ts` gère les variantes A/B et le filtrage des questions
  conditionnelles.
- `pages/QuizPage.tsx` gère l'état du parcours, les réponses, la progression,
  l'envoi et l'affichage du résultat.

Dans l'API, `publicQuizScope` résout le quiz à partir du tenant et de l'identifiant
facultatif. Un lien historique sans `quizId` cible le quiz par défaut. Un
identifiant explicitement incorrect ou désactivé est refusé : il ne bascule pas
silencieusement sur un autre quiz.

La route `/api/quiz/submit` vérifie que chaque réponse appartient bien à une
question active du quiz courant. Elle additionne les impacts configurés sur les
réponses : ces impacts forment le profil envoyé au service IA. Les axes ne sont
pas codés en dur : chaque quiz déclare les siens dans `Quiz.axes`, le profil part
de 0,5 sur chacun et les impacts sur des clés inconnues sont ignorés.
Le service IA filtre les produits par tenant, état actif et sélection du quiz,
puis classe les candidats avec un score sémantique et un score de préférences
numériques. L'API vérifie encore que le produit renvoyé est autorisé avant
d'enregistrer la session.

### Ce que « l'IA » fait ici — et ce qu'elle ne fait pas

Il faut distinguer l'IA qui a éventuellement aidé à écrire le code de l'IA
appelée lorsque l'application fonctionne. L'historique de création ne permet
pas de déduire précisément qui a écrit chaque ligne ; comprendre, vérifier et
faire évoluer le code reste une compétence que tu peux construire.

À l'exécution, les responsabilités visibles dans le dépôt sont :

| Opération | Mécanisme |
| --- | --- |
| Embedding d'un produit | Modèle local `sentence-transformers` appelé par `/embed/product` |
| Recommandation | Comparaison d'embeddings (similarité cosinus) et reranking par préférences numériques dans `/recommend` |
| Impacts proposés pour une réponse | Appel OpenAI dans `/infer/impacts` |
| Correspondance de colonnes d'import CSV | Appel OpenAI dans `/map-catalog` |
| Insights d'analytics | Tentative OpenAI côté API, puis règles locales lorsque la clé manque, que l'API refuse la requête ou que sa réponse n'est pas exploitable |

Le code de classement reste explicite : la route `/recommend` filtre et score
les candidats. L'appel à un modèle n'est donc pas une boîte noire pour toutes les
règles métier. Les secrets OpenAI et les URL internes sont configurés par
variables d'environnement ; ils ne doivent pas être ajoutés au code.

Pour la recommandation actuelle, le score combine **60 % de similarité
sémantique** et **40 % de proximité numérique**. Cette proximité compare le
profil aux valeurs `attributes.<clé>` du produit sur les axes du quiz.
`/recommend` prend
les produits actifs du tenant et reçoit éventuellement la sélection autorisée
par le quiz.

Un détail d'implémentation utile : le champ `embedding` du modèle Prisma est
actuellement déclaré `Json?`. Même si PostgreSQL et le schéma mentionnent
`pgvector`, le code `/recommend` lit les lignes filtrées et calcule la similarité
cosinus en Python ; ne suppose pas qu'une recherche par index vectoriel est déjà
utilisée par ce parcours.

## Le rôle des applications et leurs points d'entrée

| Zone | Point de départ | À lire ensuite |
| --- | --- | --- |
| API | `poapoback/src/server.ts` | `routes/`, `services/`, puis `prisma/schema.prisma` |
| Back-office | `poapoadmin/src/main.tsx` et `App.tsx` | `contexts/`, `lib/api.ts`, puis la page concernée |
| Widget | `poapofront/src/main.tsx` et `App.tsx` | `TenantContext.tsx`, `lib/quiz.ts`, `pages/QuizPage.tsx` |
| IA | `poapoai/main.py` | modèles Pydantic, helpers de scoring, puis routes FastAPI |
| Contrats communs | `poapo-types/src/index.ts` | types `Quiz`, `Question`, `Product`, `AuthToken` et métriques |
| Données | `poapoback/prisma/schema.prisma` | migrations dans `poapoback/prisma/migrations/` |

Dans l'API, une **route** traite HTTP : lecture des paramètres, contrôle et
réponse. Un **service** regroupe une règle réutilisable ou transversale. Par
exemple, `services/quizzes.ts` résout le quiz et ses erreurs, tandis que
`routes/quizzes.ts` expose les opérations de gestion.

Dans les deux interfaces React, un **contexte** partage un état à plusieurs
pages : `AuthContext` porte la session de l'admin, `QuizContext` le quiz choisi,
et `TenantContext` la configuration publique du widget.

### Authentification du back-office

La page `poapoadmin/src/pages/LoginPage.tsx` propose un lien magique ou un mot de
passe. Dans les deux cas, le backend renvoie un JWT ; `AuthContext` le conserve
via `lib/api.ts`, puis charge `/api/auth/me`. Les requêtes protégées envoient ce
JWT comme `Authorization: Bearer ...`. `middleware/auth.ts` vérifie le jeton et
attache l'identité au contexte de la requête. Les données métier doivent ensuite
rester limitées au tenant issu de cette identité.

Le lien magique suit deux appels distincts : `/api/auth/magic-link` crée un
jeton temporaire et envoie un email ; `/api/auth/verify` consomme le jeton et
renvoie le JWT. Le mot de passe est haché avec bcrypt, pas conservé en clair.

## Modèle de données : les relations métier essentielles

Lis les modèles de `poapoback/prisma/schema.prisma` dans cet ordre :

1. `Tenant` : propriétaire des données d'une marque.
2. `Quiz` : configuration de recommandation appartenant à un tenant, dont ses
   axes numériques (`axes`).
3. `QuizProduct` : sélection de produits associée à un quiz.
4. `Question`, puis `Answer` : contenu du quiz et impacts d'une réponse.
5. `QuizSession` : réponses et résultat d'une participation.
6. `Metric` : événements append-only (démarrage, progression, clics, etc.).
7. `MagicToken` : jetons temporaires d'authentification par email.

Règle utile : un produit appartient au tenant, et peut être sélectionné dans
plusieurs quiz de ce tenant. Les questions, sessions et métriques sont attachées
à un quiz. La couleur et le logo sont des réglages de tenant ; titre, texte du
bouton, activité et axes de recommandation sont associés au quiz, avec compatibilité historique décrite
dans `SETUP.md`.

## Comment lire une requête sans se perdre

Pour comprendre une fonctionnalité, pars toujours de l'action observable et suis
la chaîne dans cet ordre :

1. **Interface** : quel composant déclenche l'action ? Quel état local change ?
2. **Requête** : quelle URL, méthode et forme de payload sont envoyées ?
3. **Route API** : où l'URL est-elle montée dans `server.ts`, puis traitée ?
4. **Règles et droits** : quel middleware, service ou contrôle de tenant/quiz
   s'applique ?
5. **Persistance** : quels modèles Prisma sont lus ou modifiés ?
6. **Retour UI** : quelle réponse est attendue et comment sont gérés chargement,
   succès et erreur ?
7. **IA, si présente** : quelle route Python est appelée, quelles données lui
   sont envoyées, et quelle partie de sa réponse est ensuite validée ?

Exemple de recherche locale depuis la racine :

```bash
rg -n '"/api/quiz/submit"|/recommend|quizSession.create' poapofront/src poapoback/src poapoai/main.py
```

Ne commence pas par lire les 800 lignes d'une page ou d'une route d'un seul
tenant : commence par trouver le bouton, le `fetch` ou le chemin d'API. Ensuite,
ouvre seulement la fonction concernée et son appelant.

## Parcours de lecture conseillé

Fais un parcours à la fois et résume chaque fichier avec tes mots avant de passer
au suivant :

1. **Entrée de l'API** : `poapoback/src/server.ts` — middleware, sécurité,
   montage des routes, santé et démarrage.
2. **Données** : `poapoback/prisma/schema.prisma` — tenant, quiz, produit,
   question, réponse et session.
3. **Chargement du widget** : `poapofront/public/poapo-widget.js`, puis
   `poapofront/src/contexts/TenantContext.tsx`.
4. **Parcours visiteur** : `poapofront/src/pages/QuizPage.tsx`, en suivant les
   appels vers `/questions`, `/track` et `/submit`.
5. **Soumission API** : `poapoback/src/routes/quiz.ts`, puis
   `poapoback/src/services/quizzes.ts`.
6. **Recommandation IA** : `poapoai/main.py`, en partant de `/recommend` et en
   remontant vers `profile_to_text`, `cosine_similarity` et les fonctions de
   score.
7. **Connexion admin** : `poapoadmin/src/pages/LoginPage.tsx`, puis
   `poapoback/src/routes/auth.ts`,
   `poapoback/src/services/auth.ts` et `poapoback/src/middleware/auth.ts`.
8. **Configuration admin** : `poapoadmin/src/App.tsx`, puis les pages quiz,
   builder, catalogue et analytics.
9. **Tests** : `poapoback/tests/quizzes.test.ts` et
   `poapoai/test_recommend.py` — les tests montrent les comportements attendus
   et les limites qu'il faut préserver.

Tu peux lancer les services et les tests comme indiqué dans le
[guide de démarrage](../SETUP.md). Les tests API simulant la persistance ne
remplacent pas un essai de migration contre une copie de la base.

## Mini-exercices pour vérifier ta compréhension

1. **Changer le libellé d'un bouton** : identifier si le bouton appartient au
   widget ou à l'admin, trouver sa source de configuration et suivre son
   chargement jusqu'à l'API.
2. **Expliquer pourquoi un produit est recommandé** : suivre une réponse,
   retrouver ses `impacts`, expliquer le profil résultant, puis retrouver les
   scores calculés par `/recommend`.
3. **Ajouter un champ de produit** : retrouver le type partagé, le modèle Prisma,
   l'API de création/modification, le formulaire et l'effet éventuel sur
   l'embedding.
4. **Comprendre l'isolation multi-tenant** : repérer où le tenant vient du JWT
   dans l'admin et où le `clientId` public est associé au quiz dans le widget.
5. **Comprendre une statistique** : retrouver l'événement `Metric` qui
   l'alimente, son filtre tenant/quiz, son calcul API et sa présentation dans
   Analytics.

Si tu peux expliquer pour un parcours le déclencheur, la requête, la règle, la
donnée persistée et le résultat visible, tu as déjà une carte fiable de cette
fonctionnalité. Tu n'as pas besoin de mémoriser tout le dépôt : le but est de
savoir où regarder et comment vérifier ce que tu as compris.
