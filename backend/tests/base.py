from uuid import uuid4
from django.test import TransactionTestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from apps.club.models import Tariff, Booth
from apps.catalog.models import Product, PaymentMethod
from apps.core.commands import execute


class CashierCase(TransactionTestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username="owner-test", password="test-only-long-password", role="owner"
        )
        self.cashier = User.objects.create_user(
            username="cashier-test", password="test-only-long-password", role="cashier"
        )
        self.manager = User.objects.create_user(
            username="manager-test", password="test-only-long-password", role="manager"
        )
        self.tariff = Tariff.objects.create(name="PS5", hourly_rate=40000, console_code="PS5")
        self.booth = Booth.objects.create(name="01", console="PS5", tariff=self.tariff)
        self.product = Product.objects.create(
            name="Cola", category="Bar", sale_price=10000, default_cost=4000
        )
        self.cash = PaymentMethod.objects.create(name="Cash", kind="cash")
        self.card = PaymentMethod.objects.create(name="Terminal", kind="other")
        self.p2p = PaymentMethod.objects.create(name="P2P", kind="p2p")
        self.client = APIClient()
        self.client.force_authenticate(self.cashier)

    def command(self, op, data, entity="", actor=None, key=None):
        return execute(
            actor or self.cashier, key or str(uuid4()), op, str(entity), data
        )

    def shift(self):
        return self.command("OpenShift", {"openingCash": 100000})["entityId"]

    def account(self):
        return self.command(
            "CreateAccount",
            {"boothId": str(self.booth.pk), "tariffId": str(self.tariff.pk), "customerName": "", "customerPhone": ""},
        )["entityId"]

    def receive(self, quantity=2, cost=4000):
        return self.command(
            "ReceiveBatch",
            {"productId": str(self.product.pk), "quantity": quantity, "unitCost": cost},
            actor=self.manager,
        )["entityId"]
