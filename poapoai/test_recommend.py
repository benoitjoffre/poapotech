import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
import main


class RecommendationTests(unittest.TestCase):
    def recommend(self, industry="coffee", product_ids=None, rows=None):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.fetchall.return_value = rows if rows is not None else [
            ("coffee-product", "Café", None, None, None, None, None, None, None,
             {"body": 0.7}, [], [], [], [])
        ]
        model = MagicMock()
        model.encode.return_value.tolist.return_value = [1.0, 0.0]
        with patch.object(main, "get_connection", return_value=connection), \
                patch.object(main, "get_model", return_value=model):
            result = main.recommend(main.RecommendRequest(
                tenantId="tenant-a", industry=industry, profile={"body": 0.7},
                productIds=product_ids,
            ))
        return result, cursor

    def test_selected_products_are_parameterized_in_query(self):
        result, cursor = self.recommend(product_ids=["coffee-product"])
        self.assertEqual(result["productId"], "coffee-product")
        sql, params = cursor.execute.call_args.args
        self.assertIn("id = ANY(%s)", sql)
        self.assertEqual(params, ("tenant-a", ["coffee-product"]))

    def test_legacy_all_catalog_query(self):
        result, cursor = self.recommend(industry="perfume")
        self.assertEqual(result["productId"], "coffee-product")
        sql, params = cursor.execute.call_args.args
        self.assertNotIn("ANY", sql)
        self.assertEqual(params, ("tenant-a",))
        self.assertIn("freshnessLevel", result["profileSummary"])

    def test_empty_selection_does_not_expand_to_catalog(self):
        with self.assertRaises(HTTPException) as caught:
            self.recommend(product_ids=[], rows=[])
        self.assertEqual(caught.exception.status_code, 404)

    def test_generic_profile_uses_dictionary(self):
        result, _ = self.recommend()
        self.assertEqual(result["profileSummary"]["preferences"], {"body": 0.7})


if __name__ == "__main__":
    unittest.main()
