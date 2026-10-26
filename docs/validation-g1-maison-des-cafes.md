# Sprint G / Étape 1 — Validation métier « Maison des Cafés »

Aucun code produit modifié, aucun commit, aucune migration, aucun appel OpenAI (service IA lancé avec `OPENAI_API_KEY` vide ; seul le modèle d'embeddings local est utilisé).

## Pile isolée
- Postgres dédié (conteneur `poapo_g1_pg`, port 5544, base `g1`, schéma poussé avec `db push`) — la base de dev (5433) n'est pas touchée.
- poapoai :8011, API :5161, admin :5181, widget :5182, page de démo externe 127.0.0.1:5190.
- Données préparées en base (seul cas) : 2 comptes (commerçant de test avec mot de passe, tenant « étranger » avec 1 produit pour tester l'isolation). Tout le reste passe par l'interface.
- Scripts et captures : `/private/tmp/claude-501/-Users-benoitjoffre-Desktop-poapo-poapotech/0912ae20-41a0-46ad-8a97-b5a1a8551a7c/scratchpad/` (`shots/*.png`, `s01…s20.cjs`).

## Parcours : réussites / échecs
| # | Étape | Résultat |
|---|-------|----------|
| 1 | Connexion (mot de passe) | OK |
| 2 | Catalogue | OK (« Catalogue principal » auto, sélectionné automatiquement) |
| 3 | Import CSV de 10 cafés via l'UI | OK avec friction (G-02, G-03, G-04) |
| 4 | Assistant guidé | OK |
| 5 | 4 axes (acidité, intensité, corps, douceur) + 5 questions / 20 réponses | OK (questions importées en CSV, 1 question créée à la main pour juger l'éditeur) |
| 6 | 5 profils testés dans l'aperçu | OK, 5/5 conformes au calcul indépendant |
| 7 | Cohérence des recommandations | OK (voir ci-dessous) |
| 8 | Publier + activer | OK mais parcours lourd et trompeur (G-01, G-05) |
| 9 | Code d'intégration | OK (copié via le bouton) |
| 10 | Widget sur page HTML externe | OK (origine différente, aucune erreur console, mobile OK) |
| 11 | 5 sessions publiques (dont 2 clics produit) | OK |
| 12 | Résultats | OK, chiffres = événements |

## Cohérence des recommandations
Oracle = profil (0,5 de départ + impacts cumulés, borné 0–1) puis distance sur les axes (embeddings absents, donc score sémantique nul).
| Profil | Résultat (aperçu = widget public) |
|---|---|
| A fruité-léger | Kenya AA |
| B corsé-puissant | Sumatra Mandheling |
| C doux-gourmand | Brésil Santos |
| D équilibré | Brésil Santos |
| E multi-saveurs | Colombie Huila |
Les réponses influencent bien le résultat, les profils opposés donnent des cafés opposés. Limites : saturation rapide des axes à 0/1 avec 5 questions (le profil « fruité-léger » sort à intensité 1,0 sans l'avoir voulu) ; « équilibré » donne douceur 0,9 / corps 0,8.

## Vérifications métier
- Produits du bon catalogue : OK (0 produit hors tenant/catalogue dans les 5 sessions).
- Isolation tenant : OK. Produit « ÉTRANGER » jamais visible ; avec un quiz étranger actif créé pour le test, tous les accès croisés (public avec notre clientId, `/api/quizzes/:id`, `/api/catalog/:id`, éditeur de brouillon, métriques) renvoient 404.
- Brouillon vs publié : OK. Avant publication, le public renvoie « Ce quiz est désactivé ». Après publication, modifier une question et enregistrer le brouillon (révision 4→5) laisse le public strictement identique. Rappel affiché par l'UI : les modifications de **produits** s'appliquent immédiatement au public.
- Lien public direct : OK (`http://localhost:5182/?clientId=…&quizId=…`).
- Statistiques : démarrages 5, terminés 5, recommandations 5, clics produits 2 (« ce ne sont pas des ventes » bien affiché). Top produits : Brésil Santos 2, Kenya 1, Colombie 1, Sumatra 1 ; clics : Kenya 1, Brésil 1 — conforme. En base : quiz_start 5, quiz_complete 5, step_view 25, step_answer 20 (4 questions « single » × 5), buy_click 2.

## Problèmes constatés (priorisés)
Gravité : P1 = bloque ou fausse le résultat, P2 = gêne forte d'un non-technicien, P3 = finition.

| ID | Gravité | Problème | Reproduction |
|----|---------|----------|--------------|
| G-01 | P1 | **Aucun embedding créé à l'import CSV** : les 10 produits importés ont `embedding` nul, donc 60 % du score (sémantique) vaut 0 ; seule la proximité sur les axes joue. L'avertissement n'apparaît qu'à l'étape 5 (« Corriger »). | Importer le CSV, `select count(embedding) from "Product"` → 0 ; étape 5 > Vérifier le quiz. |
| G-02 | P2 | **Aucun mapping automatique sans IA** : toutes les colonnes sont sur « Ignorer », même « Nom », « Prix », « Description ». Le texte annonce que l'IA suggérera ; sans OpenAI, 10 sélections manuelles. | /catalog/import, charger un CSV avec en-têtes évidents. |
| G-03 | P2 | **Le lien import ↔ axes est invisible** : on importe avant d'avoir créé les axes ; il faut deviner `attribute.intensite` et que la clé doit ensuite correspondre exactement à la clé d'axe (les clés auto-générées ont heureusement coïncidé). Aucune vérification croisée. | Import avant l'étape « préférences ». |
| G-04 | P3 | Libellés d'aperçu d'import en clés brutes (`ATTRIBUTE.INTENSITE`, `PURCHASEURL`) ; une valeur d'axe hors 0–1 est ignorée ligne à ligne sans message clair. | Étape 3 de l'import. |
| G-05 | P2 | **Étape 5 trompeuse** : « Expérience publiée / Publié » s'affiche avant toute publication (le quiz live est vide : 0 question, aucun axe). L'activation exige « Appliquer et enregistrer » puis « Vérifier » puis case de confirmation puis « Publier » ; « Enregistrer le brouillon » est grisé avec « Terminez ou annulez les formulaires ouverts » sans dire lesquels. | Étape 5 sur un nouveau quiz ; cocher « Rendre accessible ». |
| G-06 | P2 | **Logo par défaut « POAPO — Révélateur de parfum »** affiché dans le widget d'un torréfacteur (intro, mobile). | Widget, écran d'accueil (capture 35). |
| G-07 | P2 | **Réponses des questions à choix multiple non comptées** par question dans Résultats (« Quelles saveurs aimez-vous ? » : aucun nombre de réponses, alors que les autres en ont 5). | Résultats > détail > questions les plus consultées. |
| G-08 | P3 | Le texte d'explication concatène les phrases sans séparateur (« …: Vive Correspond à ta préférence : Amer ») et dit « Intensité modéré ». Le mot-clé d'axe affiche « Léger » / « Amer » pour des valeurs au milieu (0,5 / 0,4). | Résultat de recommandation (capture 30). |
| G-09 | P3 | Aucune route `/experiences` (redirige silencieusement vers le catalogue) ; l'URL de l'assistant reste `step=2` après « Enregistrer et continuer » vers l'étape 3 (à confirmer, l'URL peut simplement être en retard). | Taper /experiences. |
| G-10 | P3 | Quiz « Quiz par défaut » (désactivé, sans question) créé automatiquement et affiché à côté de la vraie expérience dans l'accueil et Résultats. Visite guidée (modale) à chaque connexion tant qu'elle n'est pas passée. | Accueil d'un nouveau compte. |
| G-11 | P3 | Import de questions : message « Import termine … reponses … ignoree » sans accents ; le texte « Enregistrez d'abord les changements locaux » est contradictoire avec l'enregistrement immédiat constaté (le bouton « Enregistrer le brouillon » reste grisé après import). Bouton de partage du widget : libellé par défaut « Trouve un produit », couleur #2e6f6d par défaut, non liés à la marque du commerçant ; le code copié n'inclut ni `data-label` ni `data-color`. | Étape 3 ; page de démo. |
| G-12 | P3 | Impacts affichés « A 0.00 I 0.00 C 0.00 D 0.00 » (initiales sans légende) ; saturation des axes (voir cohérence). | Étape 3, carte réponse. |

## Notes de méthode et d'environnement
- Premier appel `/recommend` : timeout 10 s (chargement à froid du modèle local), puis normal après préchauffage. À prévoir en production : premier visiteur après un redémarrage → 500.
- `/map-catalog` répond 503 sans OpenAI : l'import continue bien (comportement attendu, non bloquant).
- Les clics produit sont enregistrés comme `buy_click` mais présentés comme « Clics vers les produits », jamais comme ventes.
- Non testé : activation de campagnes, embeddings réels (après correction de G-01 le classement peut différer de l'oracle), éditeur complet, enrichissement IA, A/B.

## Corrections recommandées (ordre)
1. G-01 : calculer les embeddings après import CSV (ou l'annoncer dès l'import).
2. G-05 : état « Non publié » réel, parcours activation + publication en une action, message explicite sur le formulaire bloquant.
3. G-06 / G-11 : logo et libellé/couleur du bouton issus de la marque du tenant, intégrés au code copié.
4. G-02 / G-03 : mapping heuristique local sans IA (noms de colonnes courants) ; proposer les axes existants et signaler les clés non reconnues.
5. G-07 : compter les réponses aux questions multiples.
6. G-08, G-09, G-10, G-12, G-04 : finitions.
