# POAPO — Plan de refonte UX

## Décisions validées le 26 octobre 2026

Cette décision remplace la proposition de navigation à cinq rubriques.
L'implémentation actuelle reste limitée au nouvel Accueil et à la préparation
de la navigation définitive. Elle ne comprend pas la refonte des autres pages.

## Navigation principale

| Ordre | Rubrique | Route existante conservée |
| --- | --- | --- |
| 1 | Accueil | `/` |
| 2 | Mes produits | `/catalog` |
| 3 | Mes expériences | `/quizzes` |
| 4 | Campagnes | `/campaigns` |
| 5 | Résultats | `/analytics` avec le contexte du quiz sélectionné |
| 6 | Paramètres | `/settings` |

Le super-administrateur conserve une navigation séparée. Les anciennes routes,
les liens profonds et les contextes tenant, quiz et catalogue restent conservés.
Le Campaign Studio reste une destination de premier niveau, pas une fonction
à supprimer ou à absorber dans les expériences.

## Identité et composants

- Couleur principale : **#6C47FF**.
- Réutiliser les tokens, boutons, icônes et composants existants.
- Conserver la composition de la maquette d'accueil, adaptée au violet POAPO.
- Les composants de présentation doivent recevoir des propriétés typées ;
  le chargement des données reste séparé de leur affichage.
- Ne pas reproduire les données fictives, vidéos absentes ou pourcentages
  d'avancement non calculables de la maquette.

Les [composants du tableau de bord](../poapoadmin/src/components/dashboard/)
sont réutilisables pour les cartes, indicateurs et liens de ressources.

## Responsabilités métier

1. Une **expérience** correspond à un **quiz existant** : aucun nouveau système
   de quiz ni nouvelle entité métier ne doit être créé pour ce renommage UX.
2. Une **campagne** est une opération marketing facultative associée à un quiz.
3. Plusieurs campagnes peuvent partager un quiz : le contenu, le brouillon et
   les statistiques du quiz ne doivent pas être dupliqués par campagne.
4. La création et la publication d'un quiz doivent fonctionner sans campagne
   dans le parcours cible.
5. Conserver le Campaign Studio et toutes ses fonctionnalités métier.
6. Les statuts de campagne ne contrôlent pas actuellement l'accès public du
   quiz : ne pas présenter une campagne active, en pause, programmée ou terminée
   comme une activation ou désactivation du lien public.
7. Préserver les modèles, données, anciennes routes et intégrations.

### Écart explicite entre la cible et l'existant

La création d'un quiz dispose déjà du parcours `/quizzes/new`, indépendant
des campagnes. En revanche, l'interface d'apparence et de publication reste
actuellement dans l'éditeur de campagne. Rendre ce parcours accessible depuis
le quiz sans campagne est une exigence à traiter ultérieurement, en réutilisant
les mécanismes existants de brouillon, aperçu et publication atomique.
Cette étape ne livre pas encore cette indépendance de publication et ne doit
pas créer automatiquement une campagne pour la simuler.

## Découpage et périmètre

### Sprint A — Étape 1 : nouvel Accueil (seul périmètre actif)

- Afficher l'identité réelle, les compteurs et expériences du tenant.
- Proposer une prochaine action déterministe et reprendre le bon brouillon.
- Rendre visibles les six rubriques, dont Campagnes vers le Studio existant.
- Préserver l'agrégation par quiz sans double comptage entre campagnes.
- Réutiliser les composants et valider clavier, mobile et états de données.
- Ne pas modifier les autres pages, le scoring, le moteur, les campagnes,
  les brouillons, la publication atomique, les liens publics ou le widget.

### Étapes ultérieures — à cadrer puis valider écran par écran

- **Mes produits** : simplifier la gestion, l'import et les catalogues sans
  masquer leur appartenance ni mélanger leurs données.
- **Mes expériences** : exposer les quiz existants dans un parcours cohérent,
  y compris ceux qui n'ont aucune campagne.
- **Création guidée et publication autonome du quiz** : réutiliser les éditeurs
  et API existants ; rendre les campagnes strictement facultatives.
- **Campagnes** : conserver le Studio et ses capacités ; clarifier les liens
  avec les quiz partagés et la différence entre statut marketing et accès public.
- **Résultats et Paramètres** : simplifier séparément après validation de leur
  périmètre, sans inventer de ventes ni de chiffre d'affaires.

Ces étapes ne sont pas autorisées au développement dans le périmètre actuel.
Leur ordre détaillé et leurs maquettes restent à valider.

## Points de non-régression

- Isolation multi-tenant et multi-catalogue.
- Quiz sans campagne, quiz partagé entre campagnes, compte sans activité.
- Reprise avec identifiant du quiz et contexte catalogue explicites.
- Brouillons persistants et publication atomique inchangés.
- Disponibilité publique distincte des statuts et dates de campagne.
- Anciennes routes, liens publics et intégrations inchangés.
- Navigation commerçant à six entrées, super-administrateur séparé.
- Accès clavier et absence de débordement à 320, 375, 768 et 1440 px.
- Aucune dépendance obligatoire à OpenAI.

Aucun commit automatique.
