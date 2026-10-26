import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
import main

BODY_AXIS = {"key": "body", "label": "Corps", "lowLabel": "Léger", "highLabel": "Corsé"}


class RecommendationTests(unittest.TestCase):
    def recommend(self, product_ids=None, rows=None, profile=None, axes=None, industry="Café", catalog_id=None, top_n=1):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.fetchall.return_value = rows if rows is not None else [
            ("coffee-product", None, {"body": 0.7, "origin": "Éthiopie"}),
        ]
        model = MagicMock()
        model.encode.return_value.tolist.return_value = [1.0, 0.0]
        with patch.object(main, "get_connection", return_value=connection), \
                patch.object(main, "get_model", return_value=model):
            result = main.recommend(main.RecommendRequest(
                tenantId="tenant-a", catalogId=catalog_id, industry=industry,
                profile=profile if profile is not None else {"body": 0.7},
                axes=axes if axes is not None else [BODY_AXIS],
                productIds=product_ids, topN=top_n,
            ))
        return result, cursor, model

    def test_selected_products_are_parameterized_in_query(self):
        result, cursor, _ = self.recommend(product_ids=["coffee-product"])
        self.assertEqual(result["productId"], "coffee-product")
        sql, params = cursor.execute.call_args.args
        self.assertIn("id = ANY(%s)", sql)
        self.assertEqual(params, ("tenant-a", ["coffee-product"]))

    def test_all_catalog_query(self):
        result, cursor, _ = self.recommend()
        sql, params = cursor.execute.call_args.args
        self.assertNotIn("ANY", sql)
        self.assertEqual(params, ("tenant-a",))
        self.assertEqual(result["productId"], "coffee-product")

    def test_catalog_filter_is_applied_in_sql(self):
        _, cursor, _ = self.recommend(catalog_id="catalog-voyages")
        sql, params = cursor.execute.call_args.args
        self.assertIn('"catalogId" = %s', sql)
        self.assertNotIn("ANY", sql)
        self.assertEqual(params, ("tenant-a", "catalog-voyages"))

    def test_catalog_filter_combines_with_selection(self):
        _, cursor, _ = self.recommend(product_ids=["coffee-product"], catalog_id="catalog-voyages")
        sql, params = cursor.execute.call_args.args
        self.assertIn('"catalogId" = %s', sql)
        self.assertIn("id = ANY(%s)", sql)
        self.assertEqual(params, ("tenant-a", "catalog-voyages", ["coffee-product"]))

    def test_without_catalog_keeps_tenant_scope(self):
        _, cursor, _ = self.recommend(product_ids=["coffee-product"])
        sql, _ = cursor.execute.call_args.args
        self.assertNotIn("catalogId", sql)

    def test_empty_selection_does_not_expand_to_catalog(self):
        with self.assertRaises(HTTPException) as caught:
            self.recommend(product_ids=[], rows=[])
        self.assertEqual(caught.exception.status_code, 404)

    def test_profile_summary_describes_quiz_axes(self):
        result, _, model = self.recommend()
        self.assertEqual(result["profileSummary"], {"axes": [{
            "key": "body", "label": "Corps", "value": 0.7, "level": "élevé", "description": "Corsé",
        }]})
        self.assertEqual(model.encode.call_args.args[0], "Préférences Café: Corsé")
        self.assertEqual(result["explanation"], ["Correspond à ta préférence : Corsé"])

    def test_closest_product_on_axes_wins(self):
        result, _, _ = self.recommend(rows=[
            ("light", None, {"body": 0.1}),
            ("strong", None, {"body": 0.8}),
        ])
        self.assertEqual(result["productId"], "strong")

    def test_profile_keys_outside_quiz_axes_are_ignored(self):
        result, _, _ = self.recommend(profile={"body": 0.2, "legacy": 0.9})
        self.assertEqual([axis["key"] for axis in result["profileSummary"]["axes"]], ["body"])
        self.assertEqual(result["profileSummary"]["axes"][0]["description"], "Léger")


class ReadinessTests(unittest.TestCase):
    def tearDown(self):
        main._model = None

    def test_ready_is_503_until_model_loaded(self):
        main._model = None
        with self.assertRaises(HTTPException) as caught:
            main.ready()
        self.assertEqual(caught.exception.status_code, 503)
        self.assertFalse(main.health()["ready"])

    def test_load_model_loads_once_and_warms_up(self):
        main._model = None
        fake = MagicMock()
        with patch.object(main, "SentenceTransformer", return_value=fake) as ctor:
            main.load_model()
            main.load_model()
            main.get_model()
        ctor.assert_called_once_with(main.MODEL_NAME)
        fake.encode.assert_called_once_with("warmup")
        self.assertEqual(main.ready()["status"], "ready")
        self.assertTrue(main.health()["ready"])

    def test_lifespan_loads_model_before_serving(self):
        import asyncio
        main._model = None
        fake = MagicMock()

        async def run():
            async with main.lifespan(main.app):
                self.assertIs(main._model, fake)

        with patch.object(main, "SentenceTransformer", return_value=fake):
            asyncio.run(run())


class MissingEmbeddingTests(unittest.TestCase):
    recommend = RecommendationTests.recommend
    """Axes seuls : sans embedding, le classement dépend uniquement de la proximité sur les axes."""

    def test_axes_only_catalog_ranks_by_axes(self):
        result, _, _ = self.recommend(profile={"body": 0.2}, top_n=3, rows=[
            ("strong", None, {"body": 0.9}), ("light", None, {"body": 0.2}), ("mid", None, {"body": 0.5}),
        ])
        self.assertEqual([p["id"] for p in result["topN"]], ["light", "mid", "strong"])

    def test_product_without_embedding_does_not_crash_next_to_embedded_one(self):
        result, _, _ = self.recommend(top_n=2, rows=[
            ("embedded", [1.0, 0.0], {"body": 0.7}), ("bare", None, {"body": 0.7}),
        ])
        scores = {p["id"]: p["score"] for p in result["topN"]}
        self.assertGreater(scores["embedded"], scores["bare"])  # biais documenté (60 % sémantique)


class ProductTextTests(unittest.TestCase):
    def test_axis_attributes_use_axis_labels(self):
        text = main.product_to_text(
            {"name": "Moka", "brand": "Torréfacteur", "tags": ["bio"], "attributes": {"body": 0.2, "origin": "Brésil"}},
            [BODY_AXIS],
        )
        self.assertEqual(text, "Moka. de Torréfacteur. tags: bio. caractéristiques: Léger, origin Brésil")


if __name__ == "__main__":
    unittest.main()
