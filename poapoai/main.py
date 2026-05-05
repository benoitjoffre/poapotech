"""
poapoai — Service IA de Poapo
Recommandation par embeddings sémantiques + mapping catalogue via GPT-4o-mini
"""
from __future__ import annotations

import os
import json
import math
from typing import Any

import numpy as np
import psycopg2
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from openai import OpenAI

load_dotenv()

# ─── Config ───────────────────────────────────────────────────────────────────
MODEL_NAME = os.getenv("MODEL_NAME", "paraphrase-multilingual-MiniLM-L12-v2")
DATABASE_URL = os.getenv("DATABASE_URL", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# ─── Initialisation ───────────────────────────────────────────────────────────
app = FastAPI(title="Poapo AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5050"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# Chargement du modèle au démarrage (mis en cache en mémoire)
print(f"[poapoai] Chargement du modèle {MODEL_NAME}...")
_model: SentenceTransformer | None = None

def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    return _model

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# ─── DB helper ────────────────────────────────────────────────────────────────
def get_connection():
    # Strip Prisma-specific query params not supported by psycopg2
    dsn = DATABASE_URL.split("?")[0]
    return psycopg2.connect(dsn)

# ─── Helpers ─────────────────────────────────────────────────────────────────
def product_to_text(product: dict) -> str:
    """Convertit un produit en texte sémantique pour l'embedding."""
    parts = []
    if product.get("name"):
        parts.append(product["name"])
    if product.get("brand"):
        parts.append(f"de {product['brand']}")
    if product.get("olfactoryFamily"):
        parts.append(f"famille {product['olfactoryFamily']}")
    if product.get("subFamily"):
        parts.append(product["subFamily"])
    notes = []
    for key in ("topNotes", "heartNotes", "baseNotes"):
        if product.get(key):
            notes.extend(product[key])
    if notes:
        parts.append(f"notes: {', '.join(notes)}")
    if product.get("tags"):
        parts.append(f"tags: {', '.join(product['tags'])}")
    if product.get("description"):
        parts.append(product["description"][:200])
    # Axes numériques → mots
    axes = []
    if product.get("freshness") is not None:
        f = float(product["freshness"])
        axes.append("très frais" if f > 0.7 else "frais" if f > 0.45 else "peu frais")
    if product.get("intensity") is not None:
        i = float(product["intensity"])
        axes.append("très intense" if i > 0.7 else "modéré" if i > 0.45 else "discret")
    if product.get("sweetness") is not None:
        s = float(product["sweetness"])
        axes.append("très doux" if s > 0.7 else "doux" if s > 0.45 else "peu doux")
    if axes:
        parts.append(", ".join(axes))
    return ". ".join(parts)


def profile_to_text(profile: dict, gender: str | None, mood: str | None) -> str:
    """Convertit un profil utilisateur en texte sémantique."""
    parts = []
    f, i, s = profile.get("freshness", 0.5), profile.get("intensity", 0.5), profile.get("sweetness", 0.5)
    parts.append("très frais" if f > 0.7 else "frais" if f > 0.45 else "peu frais")
    parts.append("très intense" if i > 0.7 else "d'intensité modérée" if i > 0.45 else "discret")
    parts.append("très doux et gourmand" if s > 0.7 else "doux" if s > 0.45 else "peu sucré")
    if gender == "male":
        parts.append("masculin")
    elif gender == "female":
        parts.append("féminin")
    if mood:
        parts.append(f"ambiance {mood}")
    return "Parfum " + ", ".join(parts)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    arr_a = np.array(a)
    arr_b = np.array(b)
    denom = np.linalg.norm(arr_a) * np.linalg.norm(arr_b)
    if denom == 0:
        return 0.0
    return float(np.dot(arr_a, arr_b) / denom)


def euclidean_score(profile: dict, product: dict) -> float:
    """Score de similarité axiale [0-1] basé sur distance euclidienne."""
    axes = ["freshness", "intensity", "sweetness"]
    dist = math.sqrt(sum(
        (float(profile.get(ax, 0.5)) - float(product.get(ax) or 0.5)) ** 2
        for ax in axes
    ))
    max_dist = math.sqrt(3)
    return 1 - (dist / max_dist)


def build_explanation(profile: dict, product: dict) -> list[str]:
    bullets = []
    f = profile.get("freshness", 0.5)
    i = profile.get("intensity", 0.5)
    s = profile.get("sweetness", 0.5)
    if f >= 0.6 and i >= 0.55:
        bullets.append("Frais mais avec du caractère")
    elif f >= 0.6:
        bullets.append("Frais et facile à porter")
    elif i >= 0.65:
        bullets.append("Une présence qui se remarque")
    elif s >= 0.65:
        bullets.append("Doux et enveloppant")
    else:
        bullets.append("Équilibré et agréable au quotidien")
    if i < 0.45 and s < 0.55:
        bullets.append("Idéal pour ton rythme quotidien")
    elif i >= 0.65 or s >= 0.65:
        bullets.append("Parfait pour les soirées")
    else:
        bullets.append("Un bon choix pour les occasions")
    if i >= 0.6 or s >= 0.6:
        bullets.append("Un parfum qui évolue bien sur la peau")
    return bullets[:3]


# ─── Schémas Pydantic ──────────────────────────────────────────────────────────
class ProductInput(BaseModel):
    id: str | None = None
    name: str
    brand: str | None = None
    description: str | None = None
    olfactoryFamily: str | None = None
    subFamily: str | None = None
    topNotes: list[str] = []
    heartNotes: list[str] = []
    baseNotes: list[str] = []
    tags: list[str] = []
    freshness: float | None = None
    intensity: float | None = None
    sweetness: float | None = None


class OlfactoryProfile(BaseModel):
    freshness: float = Field(0.5, ge=0, le=1)
    intensity: float = Field(0.5, ge=0, le=1)
    sweetness: float = Field(0.5, ge=0, le=1)


class RecommendRequest(BaseModel):
    tenantId: str
    profile: OlfactoryProfile
    gender: str | None = None
    mood: str | None = None
    topN: int = Field(1, ge=1, le=10)


class InferImpactsRequest(BaseModel):
    questionText: str
    answerText: str


class MapCatalogRequest(BaseModel):
    headers: list[str]
    sampleRows: list[dict[str, str]]


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/embed/product")
def embed_product(product: ProductInput):
    """Génère l'embedding d'un produit à partir de son texte sémantique."""
    text = product_to_text(product.model_dump())
    model = get_model()
    embedding: list[float] = model.encode(text).tolist()
    return {"embedding": embedding, "text": text, "dims": len(embedding)}


@app.post("/embed/batch")
def embed_batch(products: list[ProductInput]):
    """Génère les embeddings pour une liste de produits."""
    model = get_model()
    texts = [product_to_text(p.model_dump()) for p in products]
    embeddings = model.encode(texts).tolist()
    return {
        "results": [
            {"id": p.id, "embedding": emb, "dims": len(emb)}
            for p, emb in zip(products, embeddings)
        ]
    }


@app.post("/recommend")
def recommend(req: RecommendRequest):
    """
    Recommande le meilleur produit pour un profil utilisateur.
    Algorithme : embedding sémantique (cosine) + reranking axial (euclidien) + filtre genre.
    """
    # 1. Construire le texte profil et l'embedder
    profile_dict = req.profile.model_dump()
    profile_text = profile_to_text(profile_dict, req.gender, req.mood)
    model = get_model()
    profile_emb: list[float] = model.encode(profile_text).tolist()

    # 2. Charger les produits du tenant depuis PostgreSQL
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, brand, "genderTarget", "olfactoryFamily",
                   freshness, intensity, sweetness, embedding,
                   "topNotes", "heartNotes", "baseNotes", tags
            FROM "Product"
            WHERE "tenantId" = %s AND active = true
            """,
            (req.tenantId,)
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DB error: {e}")

    if not rows:
        raise HTTPException(status_code=404, detail="Aucun produit avec embedding trouvé")

    # 3. Scorer chaque produit
    scored = []
    for row in rows:
        pid, name, brand, gender_target, olfactory_family, freshness, intensity, sweetness, emb_json, top_n, heart_n, base_n, tags = row

        # Filtre genre
        if req.gender and gender_target and gender_target != req.gender and gender_target != "unisex":
            continue

        product_dict = {
            "freshness": freshness,
            "intensity": intensity,
            "sweetness": sweetness,
        }

        # Score sémantique (cosine similarity)
        emb = json.loads(emb_json) if isinstance(emb_json, str) else emb_json
        semantic_score = cosine_similarity(profile_emb, emb) if emb else 0.0

        # Score axial (euclidien)
        axial_score = euclidean_score(profile_dict, product_dict)

        # Score final : 60% sémantique + 40% axial
        final_score = 0.6 * semantic_score + 0.4 * axial_score

        scored.append({
            "id": pid,
            "score": final_score,
            "product": product_dict,
        })

    if not scored:
        raise HTTPException(status_code=404, detail="Aucun produit compatible trouvé")

    scored.sort(key=lambda x: x["score"], reverse=True)
    best = scored[0]

    # 4. Générer l'explication
    explanation = build_explanation(profile_dict, best["product"])

    # 5. Résumé du profil
    f, i, s = profile_dict["freshness"], profile_dict["intensity"], profile_dict["sweetness"]
    profile_summary = {
        "freshnessLevel": "élevé" if f >= 0.65 else "modéré" if f >= 0.4 else "faible",
        "intensityLevel": "élevé" if i >= 0.65 else "modéré" if i >= 0.4 else "faible",
        "sensualityLevel": "très doux" if s >= 0.65 else "doux" if s >= 0.4 else "peu doux",
        "usageMoment": "soirée" if i >= 0.65 or s >= 0.65 else "quotidien" if i < 0.45 and s < 0.55 else "occasion",
    }

    return {
        "productId": best["id"],
        "score": best["score"],
        "explanation": explanation,
        "profileSummary": profile_summary,
        "topN": [{"id": p["id"], "score": p["score"]} for p in scored[: req.topN]],
    }


@app.post("/infer/impacts")
def infer_impacts(req: InferImpactsRequest):
    """
    Utilise GPT-4o-mini pour inférer les impacts olfactifs d'une réponse de quiz.
    Retourne { freshness, intensity, sweetness } dans [-0.15, +0.15].
    """
    if not openai_client:
        raise HTTPException(status_code=503, detail="OpenAI non configuré")

    system = """Tu es un expert en parfumerie. 
On te donne une question et une réponse d'un quiz de recommandation de parfum.
Tu dois déduire l'impact de cette réponse sur 3 axes olfactifs :
- freshness : tendance vers le frais/léger vs chaud/lourd
- intensity : tendance vers le discret vs le sillage marqué
- sweetness : tendance vers le sec/boisé vs le doux/gourmand

Réponds UNIQUEMENT avec un JSON valide de la forme :
{"freshness": <float entre -0.15 et 0.15>, "intensity": <float>, "sweetness": <float>}
Sois précis et cohérent. 0.0 = neutre."""

    user = f'Question : "{req.questionText}"\nRéponse : "{req.answerText}"'

    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=60,
        temperature=0.2,
    )

    content = response.choices[0].message.content or "{}"
    impacts = json.loads(content)

    # Clamp dans [-0.15, 0.15]
    def clamp(v: Any) -> float:
        return max(-0.15, min(0.15, float(v or 0)))

    return {
        "freshness": clamp(impacts.get("freshness")),
        "intensity": clamp(impacts.get("intensity")),
        "sweetness": clamp(impacts.get("sweetness")),
    }


@app.post("/map-catalog")
def map_catalog(req: MapCatalogRequest):
    """
    Utilise GPT-4o-mini pour suggérer le mapping colonnes CSV → champs Poapo.
    """
    if not openai_client:
        raise HTTPException(status_code=503, detail="OpenAI non configuré")

    target_fields = [
        "name", "brand", "description", "price", "imageUrl", "purchaseUrl",
        "concentration", "olfactoryFamily", "subFamily", "genderTarget",
        "topNotes", "heartNotes", "baseNotes", "tags",
        "freshness", "intensity", "sweetness",
        "seasons", "occasions", "timeOfDay",
        "priceTier", "featured",
    ]

    sample_str = json.dumps(req.sampleRows[:5], ensure_ascii=False, indent=2)

    system = f"""Tu es un expert en import de catalogues produits pour parfumerie.
Tu reçois les colonnes d'un fichier CSV et quelques lignes d'exemple.
Tu dois mapper chaque colonne source vers un champ cible Poapo (ou null si pas de correspondance).

Champs cibles disponibles : {json.dumps(target_fields)}

Réponds UNIQUEMENT avec un JSON valide :
{{
  "mappings": [
    {{"sourceColumn": "Nom produit", "targetField": "name"}},
    {{"sourceColumn": "Ref", "targetField": null}},
    ...
  ],
  "confidence": 0.85
}}"""

    user = f"Colonnes : {json.dumps(req.headers)}\n\nExemples :\n{sample_str}"

    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=800,
        temperature=0.1,
    )

    content = response.choices[0].message.content or "{}"
    result = json.loads(content)

    return {
        "mappings": result.get("mappings", []),
        "sampleRows": req.sampleRows[:5],
        "confidence": float(result.get("confidence", 0.0)),
    }
