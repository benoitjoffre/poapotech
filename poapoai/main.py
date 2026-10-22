"""
poapoai — Service IA de Poapo
Recommandation générique par embeddings sémantiques et axes numériques par quiz
+ mapping catalogue via GPT-4o-mini
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
def level_of(value: float) -> str:
    return "élevé" if value >= 0.65 else "modéré" if value >= 0.4 else "faible"


def axis_value_text(axis: dict, value: float) -> str:
    """Traduit une valeur d'axe [0-1] en texte, via les libellés bas/haut s'ils existent."""
    label = axis.get("label") or axis["key"]
    low, high = axis.get("lowLabel"), axis.get("highLabel")
    if value >= 0.65 and high:
        return high
    if value < 0.4 and low:
        return low
    return f"{label} {level_of(value)}"


def product_to_text(product: dict, axes: list[dict] | None = None) -> str:
    """Convertit un produit en texte sémantique pour l'embedding."""
    parts = []
    if product.get("name"):
        parts.append(product["name"])
    if product.get("brand"):
        parts.append(f"de {product['brand']}")
    if product.get("tags"):
        parts.append(f"tags: {', '.join(product['tags'])}")
    if product.get("description"):
        parts.append(product["description"][:200])
    attributes = product.get("attributes")
    if isinstance(attributes, dict) and attributes:
        axes_by_key = {axis["key"]: axis for axis in axes or []}
        described = []
        for key, value in attributes.items():
            axis = axes_by_key.get(key)
            if axis and isinstance(value, (int, float)) and not isinstance(value, bool):
                described.append(axis_value_text(axis, float(value)))
            else:
                described.append(f"{key} {value}")
        parts.append("caractéristiques: " + ", ".join(described))
    return ". ".join(parts)


def profile_to_text(profile: dict, axes: list[dict], industry: str = "") -> str:
    """Convertit un profil utilisateur (valeurs par axe) en texte sémantique."""
    axes_by_key = {axis["key"]: axis for axis in axes}
    parts = [
        axis_value_text(axes_by_key.get(key, {"key": key}), float(value))
        for key, value in profile.items()
    ]
    prefix = f"Préférences {industry}".strip() if industry else "Préférences"
    return f"{prefix}: {', '.join(parts)}" if parts else prefix


def cosine_similarity(a: list[float], b: list[float]) -> float:
    arr_a = np.array(a)
    arr_b = np.array(b)
    denom = np.linalg.norm(arr_a) * np.linalg.norm(arr_b)
    if denom == 0:
        return 0.0
    return float(np.dot(arr_a, arr_b) / denom)


def generic_attribute_score(profile: dict, attributes: dict) -> float:
    """Similarité [0-1] entre le profil et les valeurs d'axes du produit (distance euclidienne normalisée)."""
    shared_axes = [
        (float(profile[key]), float(value))
        for key, value in attributes.items()
        if key in profile and isinstance(value, (int, float)) and not isinstance(value, bool)
    ]
    if not shared_axes:
        return 0.0
    distance = math.sqrt(sum((wanted - actual) ** 2 for wanted, actual in shared_axes))
    return 1 - distance / math.sqrt(len(shared_axes))


def build_explanation(profile: dict, attributes: dict, axes: list[dict]) -> list[str]:
    """Explique la recommandation par les axes où le produit colle le mieux au profil."""
    matches = []
    for axis in axes:
        key = axis["key"]
        value = attributes.get(key)
        if key not in profile or not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        matches.append((abs(float(profile[key]) - float(value)), axis, float(profile[key])))
    matches.sort(key=lambda item: item[0])
    bullets = [
        f"Correspond à ta préférence : {axis_value_text(axis, wanted)}"
        for gap, axis, wanted in matches[:3]
        if gap <= 0.25
    ]
    return bullets or ["Le produit le plus proche de tes réponses dans notre sélection"]


def build_profile_summary(profile: dict, axes: list[dict]) -> dict:
    return {
        "axes": [
            {
                "key": axis["key"],
                "label": axis.get("label") or axis["key"],
                "value": round(float(profile.get(axis["key"], 0.5)), 3),
                "level": level_of(float(profile.get(axis["key"], 0.5))),
                "description": axis_value_text(axis, float(profile.get(axis["key"], 0.5))),
            }
            for axis in axes
        ]
    }


# ─── Schémas Pydantic ──────────────────────────────────────────────────────────
class AxisInput(BaseModel):
    key: str
    label: str = ""
    lowLabel: str | None = None
    highLabel: str | None = None


class ProductInput(BaseModel):
    id: str | None = None
    name: str
    brand: str | None = None
    description: str | None = None
    tags: list[str] = []
    attributes: dict[str, Any] = Field(default_factory=dict)
    axes: list[AxisInput] = Field(default_factory=list)


class RecommendRequest(BaseModel):
    tenantId: str
    profile: dict[str, float] = Field(default_factory=dict)
    industry: str = ""
    axes: list[AxisInput] = Field(default_factory=list)
    productIds: list[str] | None = None
    topN: int = Field(1, ge=1, le=10)


class InferImpactsRequest(BaseModel):
    questionText: str
    answerText: str
    axes: list[AxisInput]
    industry: str = ""


class MapCatalogRequest(BaseModel):
    headers: list[str]
    sampleRows: list[dict[str, str]]
    axes: list[AxisInput] = Field(default_factory=list)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/embed/product")
def embed_product(product: ProductInput):
    """Génère l'embedding d'un produit à partir de son texte sémantique."""
    data = product.model_dump()
    text = product_to_text(data, data["axes"])
    model = get_model()
    embedding: list[float] = model.encode(text).tolist()
    return {"embedding": embedding, "text": text, "dims": len(embedding)}


@app.post("/embed/batch")
def embed_batch(products: list[ProductInput]):
    """Génère les embeddings pour une liste de produits."""
    model = get_model()
    texts = [product_to_text(data, data["axes"]) for data in (p.model_dump() for p in products)]
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
    Algorithme : embedding sémantique (cosine) + proximité sur les axes du quiz (euclidien).
    """
    axes = [axis.model_dump() for axis in req.axes]
    # Le profil se limite aux axes définis par le quiz (s'il en a).
    axis_keys = {axis["key"] for axis in axes}
    profile_dict = {k: v for k, v in req.profile.items() if not axis_keys or k in axis_keys}
    if not axes:
        axes = [{"key": key, "label": key, "lowLabel": None, "highLabel": None} for key in profile_dict]

    # 1. Construire le texte profil et l'embedder
    profile_text = profile_to_text(profile_dict, axes, req.industry)
    model = get_model()
    profile_emb: list[float] = model.encode(profile_text).tolist()

    # 2. Charger les produits du tenant depuis PostgreSQL
    try:
        conn = get_connection()
        cur = conn.cursor()
        product_filter = ' AND id = ANY(%s)' if req.productIds is not None else ''
        params = (req.tenantId, req.productIds) if req.productIds is not None else (req.tenantId,)
        cur.execute(
            """
            SELECT id, embedding, attributes
            FROM "Product"
            WHERE "tenantId" = %s AND active = true
            """ + product_filter,
            params
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DB error: {e}")

    if not rows:
        raise HTTPException(status_code=404, detail="Aucun produit trouvé")

    # 3. Scorer chaque produit : 60% sémantique + 40% axes
    scored = []
    for pid, emb_json, attributes_json in rows:
        attributes = json.loads(attributes_json) if isinstance(attributes_json, str) else attributes_json or {}
        emb = json.loads(emb_json) if isinstance(emb_json, str) else emb_json
        semantic_score = cosine_similarity(profile_emb, emb) if emb else 0.0
        axial_score = generic_attribute_score(profile_dict, attributes)
        scored.append({
            "id": pid,
            "score": 0.6 * semantic_score + 0.4 * axial_score,
            "attributes": attributes,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    best = scored[0]

    return {
        "productId": best["id"],
        "score": best["score"],
        "explanation": build_explanation(profile_dict, best["attributes"], axes),
        "profileSummary": build_profile_summary(profile_dict, axes),
        "topN": [{"id": p["id"], "score": p["score"]} for p in scored[: req.topN]],
    }


@app.post("/infer/impacts")
def infer_impacts(req: InferImpactsRequest):
    """
    Utilise GPT-4o-mini pour inférer l'impact d'une réponse de quiz sur chacun des axes du quiz.
    Retourne {<clé d'axe>: <float dans [-0.15, +0.15]>}.
    """
    if not openai_client:
        raise HTTPException(status_code=503, detail="OpenAI non configuré")
    if not req.axes:
        return {}

    axes_desc = "\n".join(
        f"- {axis.key} : {axis.label or axis.key}"
        + (f" (de « {axis.lowLabel or 'faible'} » à « {axis.highLabel or 'élevé'} »)" if axis.lowLabel or axis.highLabel else "")
        for axis in req.axes
    )
    activity = f" pour l'activité « {req.industry} »" if req.industry else ""
    system = f"""Tu es un expert en recommandation produit{activity}.
On te donne une question et une réponse d'un quiz de recommandation.
Tu dois déduire l'impact de cette réponse sur les axes suivants :
{axes_desc}

Réponds UNIQUEMENT avec un JSON valide associant chaque clé d'axe à un float entre -0.15 et 0.15.
0.0 = neutre."""

    user = f'Question : "{req.questionText}"\nRéponse : "{req.answerText}"'

    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=40 + 20 * len(req.axes),
        temperature=0.2,
    )

    content = response.choices[0].message.content or "{}"
    impacts = json.loads(content)

    def clamp(v: Any) -> float:
        try:
            return max(-0.15, min(0.15, float(v or 0)))
        except (TypeError, ValueError):
            return 0.0

    return {axis.key: clamp(impacts.get(axis.key)) for axis in req.axes}


@app.post("/map-catalog")
def map_catalog(req: MapCatalogRequest):
    """
    Utilise GPT-4o-mini pour suggérer le mapping colonnes CSV → champs Poapo.
    """
    if not openai_client:
        raise HTTPException(status_code=503, detail="OpenAI non configuré")

    target_fields = [
        "name", "brand", "description", "price", "imageUrl", "purchaseUrl",
        "tags", "active", "featured", "attributes",
        *(f"attribute.{axis.key}" for axis in req.axes),
    ]
    axes_desc = ", ".join(f"attribute.{axis.key} = {axis.label or axis.key}" for axis in req.axes) or "aucun"

    sample_str = json.dumps(req.sampleRows[:5], ensure_ascii=False, indent=2)

    system = f"""Tu es un expert en import de catalogues produits multi-secteurs.
Tu reçois les colonnes d'un fichier CSV et quelques lignes d'exemple.
Tu dois mapper chaque colonne source vers un champ cible Poapo (ou null si pas de correspondance).
Le champ attributes reçoit un objet JSON de caractéristiques libres.
Les champs attribute.<clé> sont les axes de recommandation (valeurs numériques entre 0 et 1) : {axes_desc}.
Une autre caractéristique utile peut être mappée vers attribute.<nomEnCamelCase>.

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
