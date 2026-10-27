# Auth0 — configuration et architecture

## Architecture
- **Admin React** : Auth0 SPA, Authorization Code + PKCE (`@auth0/auth0-react`), aucun secret. Jeton d'accès gardé en mémoire par le SDK (refresh token avec rotation + repli iframe).
- **API Node** : valide chaque access token RS256 via JWKS (`services/auth0.ts`) : signature, algorithme, `iss`, `aud`, `exp`. Le `tenantId` n'est jamais lu depuis le client : `sub` → `User` → `Membership` → `Tenant` (`services/accounts.ts`).
- **Super-admin** : email vérifié == `SUPER_ADMIN_EMAIL`. L'inscription ne crée jamais de super-admin ni ne lui donne de boutique.
- **Transition** : un tenant historique sans propriétaire est rattaché au premier compte Auth0 dont l'email **vérifié** est identique. Les jetons HS256, magic link et mot de passe restent actifs hors production (comptes de développement) et sont coupés (401/410) en production dès qu'Auth0 est configuré (`LEGACY_AUTH=on|off` pour forcer).
- **Onboarding** : `POST /api/auth/onboarding` (nom, secteur, site facultatif) crée Tenant + User + Membership OWNER en transaction, idempotent (double clic/rechargement), couleur `#6C47FF`. Email non vérifié → 403 `email_not_verified`.
- **Entitlements** : `services/entitlements.ts` (`Tenant.plan`, aucune limite appliquée, points d'application documentés). Pas de Stripe.

## À créer dans Auth0 (rien n'est requis pour les tests locaux)
1. **API** : identifier = audience (ex. `https://api.poapo.app`), signature RS256, durée du jeton ≤ 1 h.
2. **Application SPA** : Allowed Callback URLs / Logout URLs / Web Origins = URL de l'admin (+ `http://localhost:5174`). Activer Refresh Token Rotation. Connexion par mot de passe + « Verify email » activé.
3. **Action (Login / Post Login)** ajoutant au access token :
   `api.accessToken.setCustomClaim("https://poapo.app/email", event.user.email); api.accessToken.setCustomClaim("https://poapo.app/email_verified", event.user.email_verified);`
4. Recommandé : domaine personnalisé (cookies de session first-party, silent auth fiable sur Safari) et protection anti-bots / MFA pour le super-admin.

## Variables
| Service | Variable |
|---|---|
| API | `AUTH0_DOMAIN` (ou `AUTH0_ISSUER`), `AUTH0_AUDIENCE`, `SUPER_ADMIN_EMAIL`, (`LEGACY_AUTH`) — obligatoires en production |
| Admin (build) | `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE` |

## Testé localement
`poapoback/tests/auth0.postgres.test.ts` (faux émetteur JWKS) et `poapoadmin/tests/auth0.browser.cjs` (faux Auth0 `tests/support/mockAuth0.cjs`). Reste à valider sur un vrai tenant Auth0 de test : écran d'inscription hébergé, email de vérification, Action de claims, rotation des refresh tokens.
