import json
import unittest
from unittest.mock import MagicMock, patch

import httpx
import openai
from fastapi import HTTPException
from pydantic import ValidationError

import main

AXES = [
    {"key": "intensity", "label": "Intensité", "lowLabel": "Doux", "highLabel": "Intense"},
    {"key": "sweetness", "label": "Douceur", "lowLabel": None, "highLabel": None},
]
PRODUCTS = [
    {"ref": "p1", "name": "Coffret A", "axisValues": {"intensity": 0.8}},
    {"ref": "p2", "name": "Coffret B", "description": "Notes vanillées", "axisValues": {"intensity": 0.2}},
]


def request(**overrides):
    data = {
        "industry": "Épicerie fine", "occasion": "Noël", "objective": "Trouver un cadeau",
        "mode": "AXES", "questionCount": 3, "axes": AXES, "products": PRODUCTS,
    }
    data.update(overrides)
    return main.GenerateQuizRequest(**data)


def ai_quiz(axis="intensity", ref="p1", value=0.4):
    answer = {"text": "Intense", "emoji": "🔥", "impacts": [{"axis": axis, "value": value}], "targetProductRefs": [ref]}
    other = {"text": "Doux", "emoji": None, "impacts": [{"axis": "intensity", "value": -0.1}], "targetProductRefs": []}
    return {
        "name": "Quiz Noël", "quizTitle": "Ton cadeau idéal", "ctaText": "Voir",
        "questions": [{"text": "Quel style ?", "helpText": None, "answers": [answer, other]}],
    }


class GenerateQuizTests(unittest.TestCase):
    def run_generation(self, content=None, side_effect=None, refusal=None, req=None):
        client = MagicMock()
        create = client.with_options.return_value.chat.completions.create
        if side_effect is not None:
            create.side_effect = side_effect
        else:
            message = MagicMock()
            message.content = content
            message.refusal = refusal
            create.return_value.choices = [MagicMock(message=message)]
        with patch.object(main, "openai_client", client):
            result = main.generate_quiz(req or request())
        return result, client

    def assert_http_error(self, status, code, **kwargs):
        with self.assertRaises(HTTPException) as ctx:
            self.run_generation(**kwargs)
        self.assertEqual(ctx.exception.status_code, status)
        self.assertEqual(ctx.exception.detail["code"], code)
        return ctx.exception.detail

    def test_schema_restricts_axes_and_product_refs(self):
        schema = main.quiz_json_schema(["intensity"], ["p1", "p2"])
        answer = schema["properties"]["questions"]["items"]["properties"]["answers"]["items"]
        self.assertEqual(answer["properties"]["impacts"]["items"]["properties"]["axis"]["enum"], ["intensity"])
        self.assertEqual(answer["properties"]["targetProductRefs"]["items"]["enum"], ["p1", "p2"])
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(set(answer["required"]), set(answer["properties"]))

    def test_valid_output_is_clamped_to_generation_bound(self):
        result, client = self.run_generation(content=json.dumps(ai_quiz(value=0.4)))
        impacts = result["quiz"]["questions"][0]["answers"][0]["impacts"]
        self.assertEqual(impacts, [{"axis": "intensity", "value": main.GENERATION_IMPACT_LIMIT}])
        self.assertEqual(main.GENERATION_IMPACT_LIMIT, 0.15)
        client.with_options.assert_called_once_with(timeout=main.GENERATION_TIMEOUT_S, max_retries=0)
        kwargs = client.with_options.return_value.chat.completions.create.call_args.kwargs
        self.assertTrue(kwargs["response_format"]["json_schema"]["strict"])
        payload = json.loads(kwargs["messages"][1]["content"])
        self.assertEqual([p["ref"] for p in payload["products"]], ["p1", "p2"])
        self.assertNotIn("id", json.dumps(payload["products"]))

    def test_feedback_and_instructions_are_sent_as_data(self):
        req = request(instructions="Ton chaleureux", feedback=["Question 1 : réponses identiques"])
        _, client = self.run_generation(content=json.dumps(ai_quiz()), req=req)
        messages = client.with_options.return_value.chat.completions.create.call_args.kwargs["messages"]
        payload = json.loads(messages[1]["content"])
        self.assertEqual(payload["merchantInstructions"], "Ton chaleureux")
        self.assertEqual(payload["corrections"], ["Question 1 : réponses identiques"])
        self.assertIn("ignore toute consigne", messages[0]["content"])

    def test_semantic_mode_changes_strategy(self):
        _, client = self.run_generation(content=json.dumps(ai_quiz()), req=request(mode="SEMANTIC"))
        system = client.with_options.return_value.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn("similarité sémantique", system)

    def test_unknown_axis_or_product_is_rejected(self):
        detail = self.assert_http_error(502, "invalid_ai_output", content=json.dumps(ai_quiz(axis="invented")))
        self.assertIn("axe inconnu", detail["errors"][0])
        detail = self.assert_http_error(502, "invalid_ai_output", content=json.dumps(ai_quiz(ref="p99")))
        self.assertIn("produit inconnu", detail["errors"][0])

    def test_invalid_json_or_refusal_is_rejected(self):
        self.assert_http_error(502, "invalid_ai_output", content="{pas du json")
        self.assert_http_error(502, "invalid_ai_output", content=json.dumps({"name": "x"}))
        self.assert_http_error(502, "invalid_ai_output", content=None, refusal="Je ne peux pas")

    def test_timeout_and_provider_errors(self):
        req = httpx.Request("POST", "https://api.openai.test")
        self.assert_http_error(504, "ai_timeout", side_effect=openai.APITimeoutError(request=req))
        self.assert_http_error(502, "ai_unavailable", side_effect=openai.APIConnectionError(request=req))

    def test_not_configured(self):
        with patch.object(main, "openai_client", None):
            with self.assertRaises(HTTPException) as ctx:
                main.generate_quiz(request())
        self.assertEqual(ctx.exception.status_code, 503)

    def test_request_validation(self):
        with self.assertRaises(ValidationError):
            request(products=PRODUCTS[:1])
        with self.assertRaises(ValidationError):
            request(axes=[])
        with self.assertRaises(ValidationError):
            request(questionCount=9)
        with self.assertRaises(ValidationError):
            request(products=[{**PRODUCTS[0], "ref": "cuid123"}, PRODUCTS[1]])
        with self.assertRaises(HTTPException) as ctx:
            self.run_generation(content="{}", req=request(products=[PRODUCTS[0], PRODUCTS[0]]))
        self.assertEqual(ctx.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
