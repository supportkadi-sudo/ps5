"""Contract-first validation shared by DRF and generated TypeScript, no duplicate DTOs."""

import json
from pathlib import Path
from jsonschema import Draft202012Validator
from rest_framework.exceptions import ValidationError

CONTRACT = json.loads(
    (Path(__file__).resolve().parents[3] / "contracts/openapi.json").read_text()
)


def validate(name, value):
    def check_numbers(item):
        if isinstance(item, float):
            raise ValidationError("Floating point JSON values are not accepted")
        if isinstance(item, dict):
            for entry in item.values():
                check_numbers(entry)
        elif isinstance(item, list):
            for entry in item:
                check_numbers(entry)

    check_numbers(value)
    schema = {
        "$ref": "#/components/schemas/" + name,
        "components": CONTRACT["components"],
    }

    def credentials(item):
        return isinstance(item, dict) and any(
            "password" in key.lower() or credentials(entry)
            for key, entry in item.items()
        )

    credential_request = credentials(value)
    errors = list(Draft202012Validator(schema).iter_errors(value))
    if errors:
        raise ValidationError(
            {
                ".".join(map(str, e.path)) or "body": (
                    "Invalid credential value" if credential_request else e.message
                )
                for e in errors
            }
        )


def validate_command(operation, value):
    for methods in CONTRACT["paths"].values():
        for op in methods.values():
            if op.get("operationId") == operation:
                ref = op["requestBody"]["content"]["application/json"]["schema"]["$ref"]
                return validate(ref.rsplit("/", 1)[1], value)
    raise ValidationError("Unknown command")
