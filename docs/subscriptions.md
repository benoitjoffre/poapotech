# Abonnements (V1, sans paiement)

## Séparation des responsabilités

| Couche | Fichier | Rôle |
|---|---|---|
| Authentification | `services/auth0.ts`, `accounts.ts` | Qui est connecté, quelle boutique. Crée l'abonnement STARTER à l'inscription. |
| Abonnements | `services/subscriptions.ts` | Cycle de vie de `Subscription` (création, attribution promo, plan effectif, journal). |
| Entitlements | `services/entitlements.ts`, `planCatalog.ts` | Droits, quotas, erreurs métier, compteur de recommandations. **Seul point de décision.** |
| Facturation | _(absente)_ | Hors périmètre V1. |

Source de vérité : `Subscription` (1 par tenant). `Tenant.plan` est obsolète (colonne conservée, plus lue).
Grille des formules : **uniquement** `planCatalog.ts` (valeurs provisoires, `null` = illimité, aucun prix).

## Plan effectif (calculé à la lecture, sans cron)
`ACTIVE` et pas d'échéance dépassée et `startsAt` atteint → plan stocké. Sinon (échéance passée, `CANCELED`, début futur) → **STARTER**,
`status` rapporté `EXPIRED`/`CANCELED`, `previousPlan` renseigné. Aucune donnée n'est supprimée.
Tenants antérieurs à la migration : `BUSINESS` / `LEGACY`, sans échéance.

## Erreurs métier (HTTP 403, jamais 402)
```json
{ "error": "…", "code": "quota_exceeded", "details": { "quota": "catalogs", "limit": 1, "used": 1, "plan": "STARTER" } }
{ "error": "…", "code": "feature_not_included", "details": { "feature": "campaigns", "plan": "STARTER" } }
```
Endpoint public `POST /api/quiz/submit` : **429** `{ error, code: "quota_exceeded" }` sans plan ni limite (aucune fuite côté visiteur).

## Points d'application
- Catalogues : `POST /api/catalogs` (verrou boutique + comptage dans la même transaction).
- Expériences publiées = `Quiz.active = true` : `PUT /api/quizzes/:id {active:true}` uniquement (les créations sont toujours inactives). Réactiver une expérience déjà active ne consomme rien.
- **Décision produit confirmée** : STARTER = création express ; PRO/BUSINESS = enrichissement IA du catalogue. PRO peut être offert pendant le pilote ; aucun tarif n'est fixé ni affiché.
- Fonctionnalités : `campaigns` (écritures `/api/campaigns`), `aiEnrichment` (`/api/catalogs/:id/enrichment`), `advancedAnalytics` (`GET /api/quiz/metrics` et `/api/quiz/metrics/ai-insights`). Lecture des ressources existantes conservée.
- **Analytics essentiels (tous plans, jamais gardés)** : `/api/dashboard`, `/api/results/summary`, `/api/results/experiences/:id`, page Résultats. **Avancés (PRO/BUSINESS)** : panneau « Analyses détaillées » (entonnoir, variantes A/B, abandons, suggestions). En STARTER le panneau affiche un message et un lien vers « Mon abonnement ».
- Création express (`/api/express-quiz/*`) : accessible à tous les plans.
- Super-admin : exempté des gardes de fonctionnalités.

## Quota de recommandations
- **Consomme 1 unité** : un `POST /api/quiz/submit` réussi (session créée). Pas `/track`, `/feedback`, `/questions`, ni analytics.
- Atomicité : une transaction = clé d'idempotence → incrément conditionnel `INSERT … ON CONFLICT DO UPDATE … WHERE compteur < limite` → création de la session. Échec = rollback, rien consommé. Les appels concurrents sont sérialisés par le verrou de ligne.
- Idempotence : `idempotencyKey` (body, 16–100 car. `[A-Za-z0-9_-]`), une par soumission logique (le widget la génère et la réutilise aux retries). Même clé + mêmes réponses → même réponse stockée, 0 unité (même quota épuisé). Même clé + contenu différent (quiz/réponses) → 422. Sans clé : chaque appel compte (rétrocompatibilité des anciens widgets).
- Remise à zéro : période UTC `YYYY-MM`, nouvelle ligne `UsageCounter` le 1er du mois à 00:00 UTC ; aucune tâche planifiée.

## Rétrogradation / expiration
Rien n'est supprimé ni désactivé. Les expériences actives restent actives et servies. Sont bloqués : création de catalogue, activation/réactivation au-delà du quota, écritures sur fonctionnalités non incluses, recommandations au-delà du quota mensuel. Désactiver reste possible.

## Attribution promotionnelle
`PUT /api/admin/tenants/:id/subscription` `{ plan: STARTER|PRO|BUSINESS, endsAt?: ISO futur }` (super-admin uniquement) ; `GET` renvoie aussi le journal (`SubscriptionEvent`: acteur, avant/après, échéance). Aucune route marchande n'écrit un plan ; `GET /api/subscription` est en lecture seule.

## Futurs points d'intégration Stripe (non implémentés)
- Colonnes déjà prévues : `Subscription.stripeCustomerId`, `stripeSubscriptionId`, source `STRIPE`.
- Checkout : nouvelle route authentifiée créant une session Stripe (module `services/billing/` séparé).
- Webhook (`checkout.session.completed`, `customer.subscription.updated|deleted`, `invoice.payment_failed`) : vérifier la signature, puis appeler **uniquement** une fonction de `subscriptions.ts` (upsert `Subscription`, source `STRIPE`, `endsAt` = fin de période) + `SubscriptionEvent` (acteur `stripe`). Aucun changement dans `entitlements.ts` ni dans les routes.
- Conflit à trancher le moment venu : un accès `PROMO` en cours et un abonnement payant (le plus favorable gagne ?).

## Rétention de `RecommendationRequest` (30 jours)
- Fenêtre d'idempotence garantie : 30 jours après la première soumission ; au-delà, la clé est oubliée.
- `services/recommendationRetention.ts` supprime par lots de 1000 les lignes de plus de 30 jours (`FOR UPDATE SKIP LOCKED`). Ne touche **ni `QuizSession` ni `UsageCounter`** (compteurs mensuels et historique intacts) et ne peut pas concerner une transaction en cours.

### Audit Render (offre gratuite) et solution pilote
- Le service web gratuit s'endort après ~15 min sans trafic et redémarre à la requête suivante ; le timer 24 h (`setInterval`) ne s'exécute donc jamais en pratique.
- Mécanisme retenu : `startRetentionJob()` planifie une purge **60 s après chaque démarrage** (donc à chaque réveil qui dure plus d'une minute) + toutes les 24 h si le service reste éveillé. Elle est idempotente et sans risque en cas de redémarrages ou d'instances multiples.
- Conséquences : tant que le service est utilisé, il redémarre régulièrement et la table reste bornée (≈ 1 ligne par recommandation, quelques centaines d'octets). Sans aucun trafic, rien n'est créé donc rien à purger. Cas limite : un réveil < 60 s (simple ping) ne purge pas — sans effet fonctionnel, le prochain réveil rattrape.
- Aucun service payant ni cron externe n'est créé. Si le pilote passe sur une offre toujours active : le timer 24 h suffit ; sinon un Render Cron Job (`npm run retention:purge -w poapoback`) reste possible **après validation**.
- Désactivation : `POAPO_RETENTION_JOB=off`. Exécution manuelle : `npm run retention:purge -w poapoback`.
- Rappel (render.yaml) : la base gratuite Render expire ; prévoir sauvegarde/migration avant le pilote réel.
