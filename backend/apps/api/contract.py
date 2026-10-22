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
    errors = list(Draft202012Validator(schema).iter_errors(value))
    if errors:
        raise ValidationError(
            {".".join(map(str, e.path)) or "body": e.message for e in errors}
        )
