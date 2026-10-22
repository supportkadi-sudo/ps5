from django.test import SimpleTestCase
from django.urls import resolve
from apps.api.contract import CONTRACT
from config.urls import COMMAND_ROUTES


class ContractTests(SimpleTestCase):
    def test_all_implemented_operations_have_real_routes_and_dto(self):
        operations = {}
        for path, methods in CONTRACT["paths"].items():
            for method, operation in methods.items():
                if operation.get("x-backend-implemented"):
                    match = resolve(path.replace("{id}", "entity"))
                    self.assertIsNotNone(match.func)
                    operations[operation["operationId"]] = (path, method)
        for route, command in COMMAND_ROUTES.items():
            self.assertEqual(
                operations[command],
                ("/api/v1/" + route.replace("<str:id>", "{id}"), "post"),
            )
            request = CONTRACT["paths"][operations[command][0]]["post"]["requestBody"]
            self.assertEqual(
                request["content"]["application/json"]["schema"]["$ref"],
                "#/components/schemas/" + command,
            )
            self.assertIn(
                "CommandResult",
                str(
                    CONTRACT["paths"][operations[command][0]]["post"]["responses"][
                        "200"
                    ]
                ),
            )

    def test_every_session_post_declares_csrf(self):
        for path, methods in CONTRACT["paths"].items():
            op = methods.get("post")
            if op and op.get("x-backend-implemented"):
                headers = {p["name"]: p for p in op.get("parameters", [])}
                self.assertTrue(headers.get("X-CSRFToken", {}).get("required"), path)
