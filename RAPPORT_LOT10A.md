# RAPPORT LOT 10A — Audit du générateur universel de quiz

Légende : **[V]** constat vérifié dans le code · **[H]** hypothèse · **[R]** recommandation.
Aucun fichier applicatif modifié, aucune migration, aucun appel OpenAI, aucun commit.
Limite : les données brutes du lot 9 (CSV 40 parfums, 12 profils) ne sont pas dans le dépôt ; les causes du lot 9 sont donc déduites du code **[H fondée sur V]**.

---

## 1. Architecture actuelle

### 1.1 Flux complet

```
CSV ──► parse ──► mapping colonnes ──► applyMapping ──► Product{price,brand,tags,attributes(JSON)}
                                                              │
        ┌─────────────────────────────────────────────────────┤
        ▼                                                     ▼
 file d'embeddings (embeddings.ts)                  enrichissement des axes (local / IA)
 /embed/product → Product.embedding                  deterministicEnrichment.ts / productEnrichment.ts
        │                                                     │
        └──────────────┬──────────────────────────────────────┘
                       ▼
        scanAttributes → candidats numériques 0–1 → critères (AxisPlan) → Quiz.axes
                       ▼
        selectQuestions (modèles sectoriels remappés) → Question/Answer.impacts
                       ▼
 Visiteur : /api/quiz/submit → computeProfile (0,5 + Σ impacts, borné 0–1)
                       ▼
 recommendQuiz → poapoai /recommend : 0,6·cosinus + 0,4·proximité axes → Top 1
```

### 1.2 Étape par étape

| Étape | Fichier · fonction | Constat **[V]** |
|---|---|---|
| Séparateur CSV | `services/csv.ts` · `detectCsvSeparator` | `;`, `,` ou tab, selon l'en-tête |
| Reconnaissance des colonnes | `services/importMapping.ts` · `normalizeHeader`, `suggestMapping`, `SYNONYMS` | Synonymes fixes pour 10 champs (name, brand, price, tags…) + clés/libellés des axes existants. Toute autre colonne reste **non mappée = ignorée** (avertissement). Mapping manuel possible vers `attribute.<clé>` |
| Normalisation | `routes/import.ts` · `applyMapping`, `parseNumber` | `price` → Float ; `tags` → liste (split `,;|`) ; `attribute.x` → nombre si parsable, sinon **chaîne brute**. Les clés qui sont des axes doivent valoir 0–1 (sinon ligne en erreur) |
| Stockage | `prisma/schema.prisma` · `Product` | `price`, `brand`, `tags[]` en colonnes ; tout le reste dans `attributes Json` (non typé) ; `Quiz.axes Json` ; `Answer.impacts Json` |
| Axes numériques | `services/axes.ts` · `validateAxes`, `isAxisValue` | Un axe = `{key,label,lowLabel,highLabel}` ; valeurs produit **nombres dans [0,1]** uniquement ; max 12 axes/quiz |
| Axes du catalogue | `services/catalogs.ts` · `catalogAxes` | Union des axes des quiz du catalogue |
| Enrichissement local | `services/deterministicEnrichment.ts` · `estimateAxes`, `canonicalPerfumeAxis` | Règles lexicales **uniquement pour le secteur Parfum** (`RULES`). Autres secteurs : `NO_RULE` → `insufficient_data` |
| Enrichissement IA | `services/productEnrichment.ts` + `poapoai/main.py` · `/enrich/axes` | Batches de 10, quota horaire, valeurs 0–1 + confiance (appel OpenAI, non exécuté dans ce lot) |
| Détection du secteur | `services/expressQuiz.ts` · `detectSector` | Regex de mots-clés sur activité/catalogue/produits → 4 modèles (`expressSectors.ts`) ou `null` |
| Analyse du catalogue | `expressQuiz.ts` · `scanAttributes`, `isDiscriminant`, `analyse` | **Ne retient que les attributs de type `number`** ; coverage ≥ 0,5, écart max–min ≥ 0,2 (`DISCRIMINANT_SPREAD`) |
| Sélection des critères | `analyse` | Tri : rang dans le modèle sectoriel → axe existant → écart décroissant ; plafond `MAX_EXPRESS_AXES = 6` ; doublons : même alias ou corrélation ≥ 0,97 |
| Génération des questions | `expressQuiz.ts` · `selectQuestions`, `remapTemplate`, `axisQuestion` | Pool = questions **écrites à la main par secteur** remappées sur les axes retenus ; repli : question binaire « Côté X… ». Glouton : couvre d'abord les axes sous `MIN_AXIS_AMPLITUDE = 0,3`. 3/5/7 questions (`QUESTION_COUNTS`) |
| Réponse → préférence | `routes/quiz.ts` (`/submit`), `services/scoring.ts` · `computeProfile` | Profil = 0,5 par axe, + impacts des réponses dans l'ordre, borné 0–1. `multi` : impacts cumulés |
| Transmission | `services/quizRecommendations.ts` · `recommendQuiz` | Envoie `profile`, `axes`, `industry`, `productIds` (filtre) à `/recommend` |
| Classement | `poapoai/main.py` · `recommend`, `profile_to_text`, `generic_attribute_score` | `0,6 × cosinus(embedding profil, embedding produit) + 0,4 × (1 − distance euclidienne normalisée sur les axes communs)` |
| Retour | `quizRecommendations.ts` | Seul `productId` du meilleur est utilisé ; `topN` (1–10) existe côté IA mais est ignoré par Node |

### 1.3 Constats annexes **[V]**
- `/generate/quiz`, `/infer/impacts`, `/map-catalog` existent dans `main.py` mais **aucun appel dans `poapoback/src`** : endpoints inutilisés par le parcours actuel (la création express est 100 % déterministe, test `aucune dépendance OpenAI dans la génération express`).
- Le dossier `poapoback/sevices/recommender` est vide.
- Le texte embarqué du produit (`product_to_text`) inclut les attributs non-axes en `"clé valeur"` ; **le texte du profil (`profile_to_text`) ne décrit que les axes**.
- `price` n'est jamais lu par le générateur ni par le scoring.

---

## 2. Causes des limites du lot 9

### 2.1 Pourquoi pas de questions budget / genre / famille olfactive **[V + H]**

| Critère | Où il est perdu | Nature |
|---|---|---|
| **Budget** | `price` est une colonne `Product`, jamais examinée par `scanAttributes` ; aucun type « intervalle » n'existe ; aucune question sectorielle sur le prix | **Génération** (et modèle) |
| **Genre** | Colonne CSV non reconnue par `SYNONYMS` → ignorée, ou stockée en chaîne dans `attributes` ; `scanAttributes` saute tout non-`number` ; aucune question n'en parle | **Import** (colonne ignorée si non mappée) + **génération** (catégoriel non géré) |
| **Famille olfactive** | Idem : texte → ignoré par le générateur ; `RULES` Parfum n'estime que des axes numériques (fraîcheur, intensité…) | **Génération** + modèle |
| Effet sur le classement | Même stocké, un attribut texte n'influence que l'embedding produit ; le profil visiteur ne le mentionne jamais → effet quasi nul | **Moteur** |

Conclusion : même avec un import parfait, **le générateur ne sait représenter ni catégorie, ni budget, ni contrainte**. L'import ajoute une perte supplémentaire (colonne non mappée), mais n'est pas la cause principale.

### 2.2 Pourquoi seulement 6 Top 3 distincts sur 12 profils **[H fondée sur V]**
1. Espace de profils minuscule : 4 axes × questions binaires ±0,25 depuis 0,5 → peu de profils atteignables (≈ 2 niveaux/axe).
2. `profile_to_text` discrétise en 3 niveaux (faible/modéré/élevé) ou en libellés bas/haut : la partie sémantique (60 %) varie très peu d'un profil à l'autre.
3. Les axes Parfum estimés par règles lexicales ont `insufficient_data` fréquent → valeurs manquantes ; `generic_attribute_score` **ignore** les axes manquants (non pénalisés) et retourne 0 si aucun axe commun : couverture inégale = scores non comparables.
4. Les dimensions qui séparent réellement les parfums (genre, famille, prix) sont absentes du profil.
5. 6 axes max, 3–7 questions : budget d'information faible.

### 2.3 Répartition
- **Import** : colonnes non reconnues/ignorées ; texte stocké mais sans type ; prix hors attributs.
- **Génération** : numérique 0–1 seul ; modèles sectoriels écrits à la main ; aucun score de couverture/diversité multi-types.
- **Moteur** : profil sans composante catégorielle ni contrainte.

---

## 3. Capacités existantes et manquantes

| Type | Pris en charge ? | Stockage | Influence sur la reco | Manque pour un quiz |
|---|---|---|---|---|
| Préférence numérique | **Oui** (0–1) | `attributes[clé]` + `Quiz.axes` + `Answer.impacts` | 40 % proximité + texte d'embedding | Normalisation des échelles hors 0–1 (écartées aujourd'hui), robustesse aux outliers |
| Catégorie | **Non** | Chaîne dans `attributes` (non typée) ; `tags[]` | Indirect via embedding produit seulement ; profil sans catégorie | Détection de type, valeurs normalisées, réponse → valeur choisie, prise en compte au classement |
| Budget | **Non** | `Product.price` (Float) | Aucune | Type intervalle, questions, filtre/pénalité |
| Contrainte stricte | **Partiel (infra)** | — ; mais `productIds` filtre déjà `/recommend` | Aucune dans le quiz | Représentation côté réponse + calcul de `productIds` |
| Préférence souple | **Oui** (implicite = tout impact) | `Answer.impacts` | Via profil | — |
| Contexte d'utilisation | **Non** | Aucun (occasion/saison volontairement exclues, cf. `RULES`) | Modèles : impacts manuels sur axes | Distinguer propriété produit vs contexte visiteur |
| Choix multiples | **Partiel** | `Question.type = multi` | Impacts cumulés (somme bornée) | Sémantique OU/ET pour catégories ; limite de somme |

Rappel : `Question.conditionAnswerId` et `abVariant` existent en base mais ne sont pas exploités pour la sélection de questions.

---

## 4. Analyse de la sélection des questions **[V]**

| Point demandé | État actuel |
|---|---|
| Couverture | Seuil binaire `MIN_COVERAGE = 0,5` ; un critère à 49 % est écarté, un critère à 51 % est traité comme complet |
| Diversité des valeurs | Mesure = `max − min` : sensible aux outliers, aveugle à la distribution (deux pôles seuls = « discriminant ») |
| Capacité discriminante | Seuil `spread ≥ 0,2` ; pas de mesure de partition des produits |
| Fiabilité | Pas de distinction valeur CSV / estimée (règle) / estimée (IA) dans `scanAttributes` |
| Nombre de questions | 3/5/7 ; un axe non mesurable en N questions est **retiré** (boucle `while plans.length`) |
| Redondance | Corrélation ≥ 0,97 sur ≥ 5 produits communs ; redondance de questions par texte/signature d'impacts |
| Critère important mais couverture partielle | **Impossible** : filtré avant tout arbitrage ; seul repli = critères « sémantiques » du secteur (si < 2 axes retenus) |
| Compréhension visiteur | Textes écrits à la main (modèles) ; repli générique `Côté X…` |
| Impact réel | Mesuré par amplitude des impacts (≥ 0,3), pas par effet sur le Top-K |

Autres limites : binaires non connus rejetés (« indicateur oui/non »), clés non conformes à `AXIS_KEY_PATTERN` ignorées (colonnes en français avec espaces), 3 questions sur 4 axes incompatibles.

---

## 5. Modèle universel de critères (hypothèses de conception)

Principe **[R]** : un critère devient `Criterion { kind, source, stats }` *dérivé* des données (jamais inventé), le secteur ne servant qu'à nommer/formuler.

| Famille | Nécessaire ? | Données existantes suffisantes ? | Évolution du modèle | Évaluation sans perturber le scoring |
|---|---|---|---|---|
| **NUMERIC** | Oui (déjà là) | Oui | Aucune ; ajouter dérivation par percentile pour échelles hors 0–1 | Inchangée (axes) |
| **CATEGORICAL** | Oui : genre, famille, type | Partiellement : chaînes dans `attributes`, `tags`, `brand` ; aucun type ni normalisation | Métadonnées de critère (type, valeurs normalisées) | (a) one-hot en axes 0/1 (A) ; (b) bonus de re-classement sur `topN` (B) |
| **RANGE** | Oui : budget | `price` suffit pour le budget ; durée/capacité si présentes dans `attributes` numériques | Métadonnées (champ source, bornes, tranches par quantiles) | Filtre `productIds` (B) ou axe de percentile (A, approximatif) |
| **CONSTRAINT** | Oui mais limité (taille, dispo) | Seulement si colonne fiable (≥ 90 % couverture) ; `active` existe | Idem + drapeau « strict » | Filtre `productIds` (déjà supporté par `/recommend`) |

### Souple vs obligatoire **[R]**
Une contrainte est *stricte* si et seulement si : (1) le critère est de nature compatibilité/budget, (2) couverture ≥ 90 % (sinon on exclurait des produits sur donnée absente), (3) la formulation de la question est explicitement une limite (« Mon budget maximum »), (4) le commerçant ne l'a pas passée en souple. Sinon : préférence souple. Garde-fou : si le filtre laisse < K produits (K = 3), **relâcher** et le signaler. Les produits sans valeur ne sont jamais exclus silencieusement ; ils restent éligibles avec bonus neutre.

---

## 6. Algorithme de sélection (explicable, déterministe)

### 6.1 Entrées
Pour chaque colonne/attribut candidat *c* (y compris `price`, `brand`, `tags`, attributs texte) : valeurs observées sur *N* produits actifs.

### 6.2 Inférence de type (déterministe)
- tout nombre dans [0,1] → NUMERIC ; autres nombres (dont `price`) → RANGE ;
- texte avec ≤ 12 valeurs distinctes effectives (valeurs < 3 % regroupées) et ≥ 2 → CATEGORICAL ; liste/tags → CATEGORICAL multi ;
- texte à cardinalité élevée (≈ nom, descriptions) → rejeté ;
- 0/1, oui/non → binaire (CATEGORICAL à 2 valeurs).

### 6.3 Score de base
```
Gate(c) = 1 si  couverture C ≥ θ_min (0,3)  ET  ≥ 2 valeurs effectives  ET  taux de parsing ≥ 0,9, sinon 0
R(c)    = fiabilité = moyenne pondérée de la provenance des valeurs
          (CSV direct 1,0 · estimé règle/confiance haute 0,8 · estimé IA/basse 0,5)
U(c)    = intelligibilité ∈ [0,1] : libellé lisible (+), 2–5 options (+), options ≤ 25 caractères (+), clé technique (−)
```

### 6.4 Gain marginal (cœur de l'algorithme)
Capacité discriminante = nombre de **paires de produits séparées** par au moins une question retenue :
```
Gain(c | S) = [ paires non encore séparées par S et séparées par c ] / [ N(N−1)/2 ]
Score(c | S) = Gate(c) · Gain(c|S) · R(c) · U(c) · C(c)^α        (α = 0,5)
```
- NUMERIC/RANGE : séparation = produits dans des tranches différentes (quantiles, 3 tranches) ; robuste aux outliers.
- CATEGORICAL : séparation = valeurs effectives différentes.
- Produit sans valeur : séparé de personne (pas de crédit factice) → la couverture partielle est pénalisée proportionnellement, **sans exclusion**.

### 6.5 Procédure
1. Calculer tous les `Score(c | ∅)` ; écarter `Gate = 0` (avec raison explicite renvoyée au commerçant).
2. Choisir `c* = argmax Score(c | S)` (départage : gain, puis clé alphabétique) ; l'ajouter à S.
3. Redondance : le gain marginal intègre déjà la redondance (paires déjà séparées ne comptent plus) ; ajouter garde-fou |corr| ≥ 0,97 / V de Cramér ≥ 0,9.
4. Arrêt : nombre de questions atteint (3/5/7, une question par critère retenu ou par groupe de critères) ou `Gain marginal < ε` (ε = 2 % des paires) → **ne pas poser de question inutile**.
5. Un critère à couverture partielle mais fort gain reste sélectionnable (via C^α plutôt qu'un seuil dur) ; annoté « donnée incomplète ».
6. Refus : si aucun critère ne passe le gate → pas de question (message existant à conserver).

### 6.6 Impact réel
Au moment de la génération, le sémantique n'est pas rejouable de façon stable ; la proxy « paires séparées » est l'estimation. L'impact réel se **mesure hors ligne** dans le protocole §9 (Top-K changés par réponse), et sert à calibrer α, θ_min, ε — pas à décider à l'exécution.

### 6.7 Rôle du secteur
Uniquement : libellés de question, libellés de réponses, regroupement de synonymes. Ni seuils ni sélection propres au secteur. Les modèles existants restent un *dictionnaire de formulation*, pas un moteur.

---

## 7. Compatibilité avec le scoring : approches A, B, C

| | **A. Questions seules** | **B. Contraintes/préférences typées autour du scoring** | **C. Moteur de classement typé** |
|---|---|---|---|
| Principe | Meilleure sélection + critères dérivés exprimés en axes 0–1 (percentile de prix, one-hot de catégorie) | A + filtre `productIds` pour contraintes strictes (Node) + bonus de re-classement sur `topN` | Réécriture du scoring (Python) avec termes typés |
| Complexité | Faible | Moyenne | Élevée |
| Risque de régression | Très faible (scoring identique) | Faible si désactivé par défaut/quiz sans critères typés | Élevé (tous secteurs) |
| Secteurs existants | Inchangés | Inchangés tant que non activé | Tous touchés |
| Quiz publiés | Intacts (axes/impacts inchangés) | Intacts (nouveaux champs optionnels, absents = ancien comportement) | Résultats changent, A/B impossible sur l'existant |
| Gain de pertinence | Moyen : préférences souples seulement ; budget en axe de percentile = proximité, pas un plafond ; one-hot consomme les axes (max 6/12) | Fort : budget et genre vraiment respectés ; catégorie prise en compte | Potentiellement le plus fort, mais pas nécessaire avant d'avoir mesuré B |
| Tests nécessaires | Fixtures catalogue, tests de sélection, régression scoring (existante) | + tests de filtre/relâchement, re-classement, compat. quiz sans métadonnées, parcours `/submit` | + non-régression sur tous quiz, recalibrage des poids |

Verdict **[R]** : **A est insuffisant** pour budget et contraintes (un axe de percentile ne peut pas exprimer « pas plus de 60 € »). **B suffit** pour ce que le lot 9 révèle, car l'infrastructure existe : `productIds` filtre déjà `/recommend` et `topN` est déjà renvoyé. **C n'est pas justifié** tant que A+B n'ont pas été mesurés ; aucune modification du scoring (60/40) n'est recommandée à ce stade.

Point d'attention **[V]** : la partie 40 % ignore les axes manquants, ce qui avantage les produits peu renseignés ; à mesurer avant tout changement, pas à corriger dans ce lot.

---

## 8. Généralisation multisecteur (données réellement exploitables)

Principe : n'utiliser que ce qui est présent. Aucune donnée inventée ; fixtures isolées à créer (hypothèses : colonnes standard d'un export e-commerce).

| Secteur | Critères exploitables si la colonne existe | Non exploitable sans donnée | Refus attendu |
|---|---|---|---|
| **Parfum** | genre (catégoriel), famille olfactive (catégoriel / tags), prix (RANGE), contenance (RANGE), axes numériques déjà estimés (fraîcheur, intensité…) | Occasion/saison (contexte visiteur, pas propriété) ; axes sans mention dans la fiche | Pas de question « famille » si colonne < 30 % renseignée ou valeurs toutes distinctes |
| **Café** | type/mouture (catégoriel), origine (catégoriel), prix/poids (RANGE), intensité/acidité (numériques si fournis) | Notes de dégustation libres sans normalisation | Pas de question « intensité » sans valeur : aucune règle lexicale hors Parfum, donc `insufficient_data` |
| **Mode** | catégorie, couleur, matière (catégoriels), prix (RANGE), taille (CONSTRAINT) | Taille/stock par variante : le modèle `Product` n'a pas de variantes **[V]** ; style (élégance…) non déductible | Pas de contrainte de taille sans colonne taille fiable ≥ 90 % |

Cas de refus communs : une seule valeur effective ; cardinalité quasi unique ; taux de parsing < 0,9 ; prix absent sur > 70 % ; colonne texte libre.

---

## 9. Stratégie de validation avant/après

1. **Catalogues figés** : 3 fixtures (Parfum 40, Café, Mode) + 1 catalogue dégradé (colonnes partielles) ; versionnés dans un dossier de tests isolé, jamais en base de production.
2. **Profils visiteurs figés** : 12–20 par secteur, décrits en langage métier (« budget < 60 €, féminin, frais ») et non comme des vecteurs, pour garder une évaluation indépendante du moteur.
3. **Condition 0** : génération actuelle + scoring actuel (baseline) ; **condition 1** : nouvelle génération + scoring inchangé ; ensuite seulement B.
4. **Mesures** :
   - diversité : nombre de Top 1 et de Top 3 distincts / profils ;
   - pertinence Top 1 / Top 3 notée 0–5 par une grille écrite *avant* les résultats, par un juge indépendant du score interne (humain, ou jugement sur attributs bruts du catalogue, pas sur les scores) ;
   - respect des contraintes : % de recommandations violant budget/genre déclarés (objectif 0) ;
   - couverture : % de produits apparaissant dans au moins un Top 3 ;
   - questions utiles : questions dont la suppression ne change aucun Top 3 (ablation) ;
   - sensibilité : variation du Top 1 par réponse changée.
5. **Garde-fous** : un résultat différent n'est pas meilleur ; une amélioration n'est retenue que si la pertinence jugée augmente **et** aucune contrainte n'est violée. Rejouer 2 fois pour confirmer le déterminisme.
6. **Non-régression** : les tests existants (`expressQuiz.test.ts` — régression scoring, café complet) restent verts ; un quiz publié rejoué avant/après doit donner un résultat identique.

---

## 10. Feuille de route

| Lot | Objectif | Fichiers concernés | Modifications | Risques | Tests | Acceptation | Dépend de |
|---|---|---|---|---|---|---|---|
| **10B** | Diagnostic de catalogue typé (lecture seule) : types, couverture, entropie, raisons de refus, y compris `price`, `brand`, `tags`, texte | `expressQuiz.ts` (nouvelle analyse pure), `poapo-types` | Fonction pure `profileColumns`, rapport exposé dans `analysis.candidates` ; pas de génération nouvelle | Faible | Unitaires sur fixtures 3 secteurs + catalogue dégradé | Parfum 40 : genre/famille/prix détectés avec type et raison ; rien ne change dans les brouillons actuels | — |
| 10C | Import : propositions de mapping pour colonnes texte/prix → `attribute.*`, sans écriture silencieuse | `importMapping.ts`, `import.ts`, admin import | Suggestion (jamais auto) basée sur le type détecté | Moyen (UX import) | `importMapping.test.ts` étendu | Colonnes non mappées signalées avec suggestion ; idempotence inchangée | 10B |
| 10D | Sélection par gain de paires (§6) + questions génériques catégorielles/range sous forme de **préférences souples** (axes dérivés) | `expressQuiz.ts`, `expressSectors.ts` (formulations) | Remplace le tri actuel ; secteurs = libellés | Moyen (brouillons changent) | Comparaison avant/après §9 sans toucher au scoring | Diversité ≥ baseline, 0 régression sur café | 10B |
| 10E | Contraintes strictes (budget, taille, genre optionnel) via `productIds` + relâchement | `routes/quiz.ts`, `quizRecommendations.ts`, `Answer`/`Quiz` (champ JSON optionnel), builder admin | Calcul de `productIds` côté Node ; champ optionnel absent = ancien comportement | Moyen/élevé (schéma, éditeur) | Tests de filtre, relâchement, quiz publiés anciens | Quiz publiés inchangés ; 0 violation de contrainte | 10D, migration à valider |
| 10F | Bonus catégoriel sur `topN` (si 10D+10E insuffisants) | `quizRecommendations.ts` | Re-classement Node sur Top 10 | Moyen | Mesure §9 | Gain de pertinence démontré | 10E |
| 10G (conditionnel) | Évolution du scoring (C) | `poapoai/main.py` | — | Élevé | Complète | Seulement si B plafonne | mesures 10F |

Priorité : 10B → 10D → 10E → 10C → 10F. Gain maximal / modifications minimales : 10B + 10D.

---

## 11. Recommandation pour le lot 10B

**[R]** Lot 10B = **diagnostic de catalogue typé**, pur et en lecture seule, **sans changer les brouillons, l'import, la base ni le scoring**.

Pourquoi en premier :
- La cause racine est que le générateur « ne voit » que les nombres 0–1. Prouver ce que le catalogue contient réellement (types, couverture, entropie, raisons de refus) est le prérequis de tout le reste et ne présente aucun risque pour les quiz publiés.
- Il permet de fixer les seuils (θ_min, ε, α) sur des fixtures avant de les coder dans l'algorithme.
- Il crée les fixtures et le harnais de comparaison §9, utilisables pour juger 10D/10E.

Périmètre 10B : fonction pure `profileColumns(products)` (type inféré, couverture, valeurs effectives, entropie normalisée, taux de parsing, raison de refus) ; fixtures Parfum/Café/Mode/dégradé ; harnais avant/après avec scoring Python inchangé ; aucun appel OpenAI ; aucune migration.

Critère d'acceptation 10B : sur le catalogue Parfum 40, genre, famille et prix sont détectés avec leur type et leur couverture ; les colonnes inutilisables sont refusées avec une raison lisible ; la suite de tests existante reste verte.

Risques résiduels à traiter avant 10E : le modèle n'a pas de variantes produit (taille/stock), l'éditeur admin devra exposer le caractère souple/strict, et la sémantique de `multi` (somme bornée) est inadaptée aux catégories.
