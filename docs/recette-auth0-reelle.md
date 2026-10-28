# Recette Auth0 réelle (tenant de développement)

**État** : non exécutée automatiquement — aucun compte de test ni boîte mail dédiée n'est disponible dans l'environnement de travail.
Constaté en lecture seule : `poapo.eu.auth0.com` répond (`/.well-known/openid-configuration` et `jwks.json` : HTTP 200) ; l'API et l'admin sont configurées (`AUTH0_DOMAIN`, `AUTH0_AUDIENCE=poapo-api`, `VITE_AUTH0_CLIENT_ID`). Aucun paramètre Auth0 n'a été modifié.

## Ce qui manque pour l'exécuter
1. Deux comptes de test dans le tenant Auth0 **de développement** (A et B), emails vérifiés (ou accès à la boîte pour cliquer le lien de vérification).
2. `http://localhost:5174` dans *Allowed Callback URLs / Logout URLs / Web Origins* de l'application SPA (à vérifier dans le dashboard Auth0).
3. L'Action Auth0 qui ajoute les claims `https://poapo.app/email` et `https://poapo.app/email_verified` à l'access token (sinon `/api/auth/me` renverra 401/email absent).
4. Les identifiants de test fournis par variables d'environnement (jamais committées).

## Exécution
```
cd poapoback && npm run dev          # API :5050 (utilise .env)
cd poapoadmin && npm run dev         # admin :5174 (utilise .env.local)
POAPO_REAL_AUTH0=1 AUTH0_E2E_A_EMAIL=… AUTH0_E2E_A_PASSWORD=… AUTH0_E2E_B_EMAIL=… AUTH0_E2E_B_PASSWORD=… \
  POAPO_PLAYWRIGHT_MODULE=<chemin playwright> node poapoadmin/tests/auth0Real.browser.cjs
```
Sans ces variables le script s'arrête avec `SKIP`. Il crée des boutiques « Recette Auth0 A/B » dans la base locale : les supprimer ensuite.

## Parcours à valider (script + vérifications manuelles)
| Étape | Auto | Manuel |
|---|---|---|
| Inscription Universal Login | — | oui (captcha / anti-bot possibles) |
| Vérification de l'email | — | oui (lien reçu) ; avant : « Vérifiez votre adresse email », aucune boutique |
| Connexion + création de boutique | ✔ | |
| STARTER automatique | ✔ (Subscription en base) | |
| Déconnexion / reconnexion, sans doublon | ✔ | |
| Isolation A/B | ✔ (UI) | tester aussi un appel API avec le jeton de A sur une ressource de B |
| Droits (campagnes/enrichissement refusés en STARTER) | — | via l'UI |
La recette simulée (`auth0.browser.cjs`, `subscription.browser.cjs`) couvre déjà ces parcours avec un fournisseur local.
