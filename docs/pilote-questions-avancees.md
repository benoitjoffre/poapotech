# Pilote des questions avancées — protocole d'évaluation

Statut : **préparation**. Rien n'est activé en production. Ce document décrit comment évaluer le générateur universel de questions sur de vrais catalogues, avec l'accord des commerçants, avant toute décision d'ouverture.

## 1. Périmètre et garde-fous

- Le générateur avancé ne sert qu'à **créer** un nouveau quiz (parcours Express). Un quiz avancé déjà créé reste lisible, modifiable, publiable et servi quel que soit l'état de l'interrupteur.
- Interrupteur côté serveur : `EXPRESS_UNIVERSAL_QUESTIONS`.
  - absent ou autre valeur : désactivé pour tous (état actuel) ;
  - `pilot` : réservé aux comptes listés dans `EXPRESS_UNIVERSAL_TENANTS` (identifiants séparés par des virgules) ;
  - `1` : ouvert à tous les comptes (à ne pas utiliser avant la décision finale).
- Valeurs par défaut inchangées pendant tout le pilote : stratégie de récupération `exact`, bonus `window_spread` λ = 1. Le bonus constant β = 0,15 n'est qu'une variante d'essai de l'évaluation.
- Aucun quiz n'est publié automatiquement. Le commerçant relit, modifie et publie lui-même.
- Le plafond de budget strict n'est proposé que sur décision explicite du commerçant (case dédiée) et seulement si les prix sont renseignés et valides à 90 % au moins.

## 2. Conditions préalables par commerçant

1. Accord écrit du commerçant : usage de son catalogue pour l'évaluation, anonymisation des fiches de jugement.
2. Catalogue importé avec les colonnes utiles conservées (import CSV, étape « informations supplémentaires ») ; embeddings prêts à 100 % (page Catalogue).
3. Au moins 30 produits actifs ; au moins deux caractéristiques catégorielles ou un prix exploitable. En dessous, le repli sur le générateur historique est normal.
4. Aucune modification des produits ni des quiz du commerçant pendant l'évaluation : le script est en **lecture seule**.

## 3. Variantes comparées

| Code interne | Variante |
|---|---|
| `legacy` | Générateur historique (modèles sectoriels), classement du moteur seul |
| `universal_lambda1` | Générateur universel, bonus par fenêtre λ = 1 (défaut) |
| `universal_beta015` | Générateur universel, bonus constant β = 0,15 (essai) |

Les trois s'appuient sur le **vrai** moteur Python et les vrais embeddings du commerçant.

## 4. Préparation (lecture seule)

```
cd poapoback
npx tsx src/scripts/pilotEvaluation.ts --tenant <id> --catalog <id> --visitors 30 --seed 1 --out ./pilot-<commerçant>
```

Produit quatre fichiers :

- `feuille-evaluation-aveugle.csv` : une ligne par produit proposé, variantes anonymisées en X / Y / Z, ordre mélangé **par scénario** ;
- `cle-des-variantes.json` : correspondance X / Y / Z ↔ variante. **Ne l'ouvrir qu'après tous les jugements.** Elle doit être conservée par une personne qui ne juge pas ;
- `questions-generees.json` : les questions du quiz universel, pour juger leur clarté ;
- `metriques-automatiques.json` : métriques calculées sans jugement humain.

Un essai à blanc sur un catalogue synthétique : `node --import tsx tests/tools/pilotDryRun.ts <dossier>`.

## 5. Ce qui est calculé automatiquement

Par variante, sur les mêmes scénarios (fiches visiteurs tirées au hasard avec une graine fixe dans les questions réellement générées) :

- satisfaction des préférences exprimées (catégorie, budget) par le Top 1 ;
- respect des plafonds stricts (si le plafond strict est activé : doit valoir 100 %) ;
- perte de score moteur du Top 1 par rapport au meilleur du moteur seul, mesurée par le moteur lui-même (scores comparables entre appels) ;
- diversité des Top 1 ;
- latence (médiane, p90) et nombre d'exécutions dégradées (appel supplémentaire en échec, scores incomparables).

Ces métriques **ne remplacent pas** le jugement : une préférence respectée n'est pas forcément une meilleure recommandation.

## 6. Ce que jugent les humains (à l'aveugle)

Au moins deux juges indépendants par catalogue, qui ne connaissent pas la clé. Pour chaque scénario et chaque code X / Y / Z, à partir de la seule fiche visiteur :

| Colonne | Échelle |
|---|---|
| Cohérence du Top 1 | 1 à 5 |
| Pertinence du Top 3 | 1 à 5 |
| Préférences respectées | oui / non |
| Qualité du compromis (quand tout ne peut pas être satisfait) | 1 à 5 |
| Question ambiguë ou inutile | texte libre (sur `questions-generees.json`) |

Les désaccords entre juges (écart ≥ 2 points) sont notés et arbitrés par discussion, sans ouvrir la clé.

## 7. Critères de décision

Ne jamais changer un paramètre par défaut à partir d'un seul catalogue. Une décision d'ouverture élargie exige au minimum :

- 3 catalogues réels dans au moins 2 secteurs, 30 scénarios chacun ;
- jugement humain moyen du variant universel supérieur à l'historique sur le Top 1 **et** le Top 3, sur la majorité des catalogues ;
- zéro dépassement de plafond strict ;
- aucune question jugée ambiguë par les deux juges sans correction proposée ;
- latence p90 d'une recommandation inférieure à 1 s sur le plus grand catalogue ;
- aucune exécution dégradée non expliquée.

β = 0,15 ne remplace λ = 1 que si les jugements humains le préfèrent sur la majorité des catalogues.

## 8. Retour arrière

Couper l'interrupteur (`EXPRESS_UNIVERSAL_QUESTIONS` absent) : plus aucune création avancée ; les quiz créés restent servis tels quels. Aucune donnée à nettoyer côté base (colonne `Answer.effects` nullable, quiz avancés = quiz ordinaires).
