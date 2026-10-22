import os
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.db import transaction
from apps.club.models import Booth, Tariff
from apps.catalog.models import Product, PaymentMethod
from apps.core.commands import execute
from uuid import uuid4


class Command(BaseCommand):
    help = "Add artificial catalog to an empty *_demo database; never reset history."

    def add_arguments(self, parser):
        parser.add_argument("--owner", required=True)

    @transaction.atomic
    def handle(self, owner, **options):
        if os.getenv("ENABLE_DEMO_SEED") != "1" or not settings.DATABASES["default"][
            "NAME"
        ].endswith("_demo"):
            raise CommandError(
                "Requires ENABLE_DEMO_SEED=1 and a dedicated *_demo database"
            )
        actor = get_user_model().objects.get(
            username=owner, role="owner", is_active=True
        )
        if any(
            model.objects.exists() for model in (Booth, Tariff, Product, PaymentMethod)
        ):
            raise CommandError(
                "Catalog is not empty. Refusing to change existing demonstration data."
            )

        def run(name, data):
            return execute(actor, str(uuid4()), name, "", data)["entityId"]

        for console, rate, count in [
            ("PS3", 40000, 3),
            ("PS4", 50000, 1),
            ("PS5", 60000, 2),
        ]:
            tariff = run(
                "SaveTariff",
                {"tariff": {"id": "", "name": console, "hourlyRate": rate}},
            )
            for number in range(1, count + 1):
                run(
                    "SaveBooth",
                    {
                        "booth": {
                            "id": "",
                            "name": f"{console}-{number}",
                            "console": console,
                            "tariffId": tariff,
                            "enabled": True,
                        }
                    },
                )
        for name, kind in [
            ("Наличные", "cash"),
            ("Терминал — ручное подтверждение", "other"),
        ]:
            run(
                "SaveMethod",
                {"method": {"id": "", "name": name, "kind": kind, "enabled": True}},
            )
        for name, price, cost in [("Кола 1л", 20000, 15000), ("Чай", 15000, 4000)]:
            product = run(
                "SaveProduct",
                {
                    "product": {
                        "id": "",
                        "name": name,
                        "category": "Напитки",
                        "salePrice": price,
                        "defaultCost": cost,
                        "enabled": True,
                    }
                },
            )
            run(
                "ReceiveBatch", {"productId": product, "quantity": 10, "unitCost": cost}
            )
        self.stdout.write(
            self.style.SUCCESS(
                "Artificial catalog created; no P2P source or payments seeded."
            )
        )
