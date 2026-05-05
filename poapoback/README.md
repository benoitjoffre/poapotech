# POAPO Back - API Quiz Parfum

API Express minimaliste pour soumettre un quiz et obtenir un parfum recommande.

## Prerequis

- Node.js installe (version 18+ conseillee)
- Le port 5000 doit etre libre, ou utiliser `PORT`

## Lancer l'API

```bash
node server.js
```

Par defaut l'API ecoute sur `http://localhost:5000`.

Pour changer le port :

```bash
PORT=5050 node server.js
```

## Endpoint

### POST /api/quiz/submit

Body JSON :

```json
{
  "answers": {
    "q1": 0,
    "q2": 1,
    "q3": 2,
    "q4": 0,
    "q5": 3,
    "q6": 1,
    "q7": 2,
    "q8": 0,
    "q9": 1,
    "q10": 2
  }
}
```

Reponse JSON :

```json
{
  "perfume": { "name": "...", "freshness": 0.8, "intensity": 0.5, "sweetness": 0.3 },
  "profile": { "freshness": 0.7, "intensity": 0.4, "sweetness": 0.6 },
  "explanation": "Profil plutot frais et sucre; ... est le plus proche."
}
```

## Donnees

- Questions : `data/questions.json`
- Parfums : `data/perfumes.json`

## Notes

- Le moteur de recommandation est dans `sevices/recommender/`.
- La route est dans `routes/quiz.js`.
