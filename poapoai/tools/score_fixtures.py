"""
Outil de mesure du lot 10D-2B.2 (lecture seule, aucune base, aucun réseau).

Calcule, avec le CODE RÉEL de main.py (modèle d'embeddings réel, product_to_text, profile_to_text, cosine_similarity,
generic_attribute_score), le score que /recommend attribuerait à chaque (visiteur, produit) de catalogues de test fournis en JSON.
Ne modifie rien dans le moteur. Usage : python3 tools/score_fixtures.py entrée.json sortie.json
"""
import json
import sys

sys.path.insert(0, ".")
import main  # noqa: E402


def run(spec):
    model = main.load_model()
    out = {}
    for key, entry in spec.items():
        axes = [{"key": k, "label": k, "lowLabel": None, "highLabel": None} for k in entry["axes"]]
        # Axes du quiz (texte du profil) : par défaut ceux du catalogue (texte des produits), comme dans /embed/product puis /recommend.
        profile_axes = [{"key": k, "label": k, "lowLabel": None, "highLabel": None} for k in entry.get("profileAxes", entry["axes"])]
        products = entry["products"]
        embeddings = model.encode([main.product_to_text(p, axes) for p in products]).tolist()
        totals, cosines, axials = [], [], []
        for profile in entry["profiles"]:
            profile = {k: v for k, v in profile.items() if k in {a["key"] for a in profile_axes}}  # /recommend ne garde que les axes du quiz
            profile_embedding = model.encode(main.profile_to_text(profile, profile_axes, entry["industry"])).tolist()
            t, c, a = [], [], []
            for product, embedding in zip(products, embeddings):
                semantic = main.cosine_similarity(profile_embedding, embedding)
                axial = main.generic_attribute_score(profile, product["attributes"])
                c.append(semantic); a.append(axial); t.append(0.6 * semantic + 0.4 * axial)
            totals.append(t); cosines.append(c); axials.append(a)
        out[key] = {"total": totals, "cosine": cosines, "axial": axials}
    return out


if __name__ == "__main__":
    with open(sys.argv[1]) as handle:
        spec = json.load(handle)
    with open(sys.argv[2], "w") as handle:
        json.dump(run(spec), handle)
