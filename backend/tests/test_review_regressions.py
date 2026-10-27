from datetime import timedelta
from uuid import uuid4
from django.utils import timezone
from rest_framework.test import APIClient
from apps.api.contract import CONTRACT, validate
from apps.api.read_models import workspace
from apps.accounts.models import Account
from apps.shifts.models import Shift
from apps.payments.models import Transfer, Payment
from .base import CashierCase


class ReviewRegressions(CashierCase):
    def paid_account(self):
        self.shift()
        account = self.account()
        self.receive()
        self.command(
            "AddLine",
            {"expectedVersion": 1, "productId": str(self.product.pk), "quantity": 1},
            account,
        )
        self.command("Precheck", {"expectedVersion": 2}, account)
        self.command(
            "AcceptPayment",
            {
                "expectedVersion": 3,
                "methodId": str(self.cash.pk),
                "amount": 10500,
                "transferId": "",
                "confirmedByCashier": True,
            },
            account,
        )
        self.command("CloseAccount", {"expectedVersion": 4}, account)
        return account

    def test_refund_contract_and_real_csrf_session(self):
        op = CONTRACT["paths"]["/api/v1/accounts/{id}/refund"]["post"]
        headers = {p["name"]: p for p in op["parameters"] if p["in"] == "header"}
        self.assertTrue(headers.get("X-CSRFToken", {}).get("required"))
        account = self.paid_account()
        client = APIClient(enforce_csrf_checks=True)
        token = client.get("/api/v1/auth/csrf").json()["csrfToken"]
        response = client.post(
            "/api/v1/auth/login",
            {"username": self.manager.username, "password": "test-only-long-password"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(response.status_code, 200)
        token = response.json()["csrfToken"]
        path = f"/api/v1/accounts/{account}/refund"
        data = {
            "expectedVersion": 5,
            "reason": "Cash actually returned",
            "restockGoods": True,
        }
        for headers in ({}, {"HTTP_X_CSRFTOKEN": "bad-token"}):
            response = client.post(
                path, data, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()), **headers
            )
            self.assertEqual(response.status_code, 403)
            validate("Error", response.json())
        self.assertEqual(Account.objects.get(pk=account).status, "closed")
        response = client.post(
            path,
            data,
            format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid4()),
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(response.status_code, 200, response.content)
        validate("CommandResult", response.json())
        self.assertEqual(Account.objects.get(pk=account).status, "cancelled")

    def test_transfer_scope_linked_and_suitable_unlinked(self):
        self.shift()
        account = self.account()
        self.receive()
        self.command(
            "AddLine",
            {"expectedVersion": 1, "productId": str(self.product.pk), "quantity": 1},
            account,
        )
        self.command("Precheck", {"expectedVersion": 2}, account)
        now = timezone.now()

        def transfer(event, amount=5000, at=None):
            return Transfer.objects.create(
                source="unverified-test",
                source_event_id=event,
                amount=amount,
                received_at=at or now,
            )

        suitable = transfer("suitable")
        transfer("old", at=now - timedelta(days=1))
        transfer("large", amount=10001)
        transfer("future", at=now + timedelta(hours=1))
        own = transfer("own")
        own_shift = Shift.objects.get(closed_at__isnull=True)
        Payment.objects.create(
            account_id=account,
            shift=own_shift,
            method=self.p2p,
            method_kind="p2p",
            actor=self.cashier,
            amount=5000,
            transfer=own,
            created_at=now,
        )
        other_shift = Shift.objects.create(
            cashier=self.manager,
            opened_at=now - timedelta(days=2),
            closed_at=now - timedelta(days=1),
            opening_cash=0,
            actual_cash=0,
            expected_cash=0,
        )
        from apps.club.models import Booth

        booth = Booth.objects.create(name="foreign", console="PS5", tariff=self.tariff)
        foreign_account = Account.objects.create(
            booth=booth,
            shift=other_shift,
            hourly_rate=40000,
            status="closed",
            created_at=now,
            closed_at=now,
            final_total=5000,
        )
        foreign = transfer("foreign")
        Payment.objects.create(
            account=foreign_account,
            shift=other_shift,
            method=self.p2p,
            method_kind="p2p",
            actor=self.manager,
            amount=5000,
            transfer=foreign,
            created_at=now,
        )
        ids = {t["id"] for t in workspace(self.cashier)["transfers"]}
        self.assertEqual(ids, {str(own.pk), str(suitable.pk)})
        for actor in (self.owner, self.manager):
            self.assertEqual(len(workspace(actor)["transfers"]), 6)
        self.command(
            "CloseShift", {"actualCash": 100000, "reason": ""}, str(own_shift.pk)
        )
        self.assertEqual(
            {t["id"] for t in workspace(self.cashier)["transfers"]}, {str(own.pk)}
        )
