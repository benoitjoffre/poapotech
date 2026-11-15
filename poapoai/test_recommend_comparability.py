"""
Lot 10D-2B : vérifications du moteur /recommend nécessaires au double appel (général + préférences).
Ces tests exécutent le VRAI code de scoring de main.py (modèle et base simulés) ; ils ne modifient rien dans le moteur.
"""
import math
import unittest
from unittest.mock import MagicMock, patch

from pydantic import ValidationError
from fastapi import HTTPException
import main

AXES = [{"key": "body", "label": "Corps", "lowLabel": "Léger", "highLabel": "Corsé"},
        {"key": "acid", "label": "Acidité", "lowLabel": None, "highLabel": None}]
PROFILE = {"body": 0.75, "acid": 0.25}
ROWS = [
    ("p1", [1.0, 0.0, 0.0], {"body": 0.9, "acid": 0.1}),
    ("p2", [0.6, 0.8, 0.0], {"body": 0.7, "acid": 0.3}),
    ("p3", [0.0, 1.0, 0.0], {"body": 0.2, "acid": 0.9}),
    ("p4", [0.5, 0.5, 0.7], {"body": 0.75, "acid": 0.25}),
    ("p5", None, {"body": 0.75, "acid": 0.25}),          # sans embedding
    ("p6", [1.0, 0.0, 0.0], {"body": 0.9, "acid": 0.1}),  # ex æquo exact avec p1
]


def recommend(rows, product_ids=None, top_n=10, profile=PROFILE):
    selected = rows if product_ids is None else [r for r in rows if r[0] in product_ids]
    connection = MagicMock()
    connection.cursor.return_value.fetchall.return_value = selected
    model = MagicMock()
    model.encode.return_value.tolist.return_value = [1.0, 0.0, 0.0]
    with patch.object(main, "get_connection", return_value=connection), patch.object(main, "get_model", return_value=model):
        return main.recommend(main.RecommendRequest(
            tenantId="t", catalogId="c", industry="Café", profile=profile, axes=AXES, productIds=product_ids, topN=top_n))


class ComparabilityTests(unittest.TestCase):
    def test_formula_is_60_percent_semantic_40_percent_axes(self):
        result = recommend(ROWS)
        scores = {p["id"]: p["score"] for p in result["topN"]}
        axial = 1 - math.sqrt((0.75 - 0.9) ** 2 + (0.25 - 0.1) ** 2) / math.sqrt(2)
        self.assertAlmostEqual(scores["p1"], 0.6 * 1.0 + 0.4 * axial, places=12)

    def test_same_product_gets_exactly_the_same_score_in_any_call(self):
        full = {p["id"]: p["score"] for p in recommend(ROWS)["topN"]}
        for ids in (["p2", "p4"], ["p1"], ["p3", "p4", "p5"], ["p6", "p2"]):
            part = {p["id"]: p["score"] for p in recommend(ROWS, product_ids=ids)["topN"]}
            for pid, score in part.items():
                self.assertEqual(score, full[pid], f"{pid} dans {ids}")

    def test_scores_are_not_normalised_by_the_candidate_set(self):
        a = {p["id"]: p["score"] for p in recommend(ROWS, product_ids=["p1", "p3"])["topN"]}
        b = {p["id"]: p["score"] for p in recommend(ROWS, product_ids=["p1", "p2", "p3", "p4"])["topN"]}
        self.assertEqual(a["p1"], b["p1"])
        self.assertEqual(a["p3"], b["p3"])

    def test_union_of_two_calls_ranks_like_one_full_call(self):
        full = [p["id"] for p in recommend(ROWS)["topN"] if p["id"] not in ("p1", "p6")]
        merged = {}
        for ids in (["p2", "p3"], ["p4", "p5"]):
            merged.update({p["id"]: p["score"] for p in recommend(ROWS, product_ids=ids)["topN"]})
        self.assertEqual(sorted(merged, key=lambda i: -merged[i]), full)

    def test_product_without_embedding_scores_axes_only(self):
        scores = {p["id"]: p["score"] for p in recommend(ROWS)["topN"]}
        self.assertEqual(scores["p5"], 0.4 * 1.0)   # sémantique = 0 (biais documenté : jusqu'à 0,6 de moins)
        self.assertLess(scores["p5"], scores["p4"])

    def test_limit_top_n_is_10(self):
        with self.assertRaises(ValidationError):
            main.RecommendRequest(tenantId="t", profile={}, axes=[], topN=11)
        self.assertEqual(main.RecommendRequest(tenantId="t", profile={}, axes=[], topN=10).topN, 10)
        many = [(f"x{i}", [1.0, 0.0, 0.0], {"body": i / 20, "acid": 0.5}) for i in range(15)]
        self.assertEqual(len(recommend(many, top_n=10)["topN"]), 10)

    def test_empty_candidate_set_is_404_never_a_fallback_to_the_catalogue(self):
        with self.assertRaises(HTTPException) as caught:
            recommend(ROWS, product_ids=["inconnu"])
        self.assertEqual(caught.exception.status_code, 404)

    def test_ties_follow_database_row_order(self):
        """Pas d'ORDER BY dans la requête : à égalité parfaite, l'ordre dépend de la base. Le re-classement Node départage par identifiant."""
        first = [p["id"] for p in recommend(ROWS)["topN"]][:2]
        swapped = [p["id"] for p in recommend([ROWS[5]] + ROWS[:5])["topN"]][:2]
        self.assertEqual(set(first), {"p1", "p6"})
        self.assertNotEqual(first, swapped)

    def test_deterministic(self):
        self.assertEqual(recommend(ROWS), recommend(ROWS))


if __name__ == "__main__":
    unittest.main()
