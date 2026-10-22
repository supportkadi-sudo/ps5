from django.test import override_settings
from rest_framework.test import APIClient
from rest_framework.exceptions import PermissionDenied
from django.contrib.auth import get_user_model
from django.utils import timezone
from apps.core.rules import Conflict
from apps.payments.models import Transfer, Payment
from apps.api.read_models import workspace
from apps.api.contract import validate
from .base import CashierCase


class AccessTests(CashierCase):
    def test_real_session_csrf_login_logout(self):
        c = APIClient(enforce_csrf_checks=True)
        self.assertEqual(c.get("/api/v1/workspace").status_code, 403)
        self.assertEqual(
            c.post(
                "/api/v1/auth/login",
                {
                    "username": self.cashier.username,
                    "password": "test-only-long-password",
                },
                format="json",
            ).status_code,
            403,
        )
        token = c.get("/api/v1/auth/csrf").json()["csrfToken"]
        login = c.post(
            "/api/v1/auth/login",
            {"username": self.cashier.username, "password": "test-only-long-password"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(login.status_code, 200, login.content)
        validate("Session", login.json())
        self.assertNotEqual(login.json()["csrfToken"], token)
        self.assertEqual(c.get("/api/v1/workspace").status_code, 200)
        self.assertEqual(
            c.post(
                "/api/v1/shifts/open", {"openingCash": 0}, format="json"
            ).status_code,
            403,
        )
        from uuid import uuid4

        response = c.post(
            "/api/v1/shifts/open",
            {"openingCash": 0},
            format="json",
            HTTP_X_CSRFTOKEN=login.json()["csrfToken"],
            HTTP_IDEMPOTENCY_KEY=str(uuid4()),
        )
        self.assertEqual(response.status_code, 200, response.content)
        validate("CommandResult", response.json())
        self.assertEqual(
            c.post(
                "/api/v1/auth/logout", HTTP_X_CSRFTOKEN=login.json()["csrfToken"]
            ).status_code,
            204,
        )
        self.assertEqual(c.get("/api/v1/workspace").status_code, 403)

    def test_cashier_cannot_manage_or_read_costs_or_other_shift(self):
        with self.assertRaises(PermissionDenied):
            self.command(
                "ReceiveBatch",
                {"productId": str(self.product.pk), "quantity": 2, "unitCost": 1},
            )
        self.shift()
        a = self.account()
        self.receive()
        self.command(
            "AddLine",
            {"expectedVersion": 1, "productId": str(self.product.pk), "quantity": 1},
            a,
        )
        w = workspace(self.cashier)
        validate("Workspace", w)
        self.assertEqual(w["batches"], [])
        self.assertEqual(w["products"][0]["defaultCost"], 0)
        self.assertEqual(w["accounts"][0]["lines"][0]["cost"], 0)
        self.assertEqual(w["audit"], [])
        other = get_user_model().objects.create_user(username="other", role="cashier")
        with self.assertRaises(PermissionDenied):
            self.command("Precheck", {"expectedVersion": 2}, a, actor=other)
        self.assertEqual(workspace(other)["accounts"], [])
        self.cashier.role = "manager"
        self.cashier.save()
        self.receive()
        self.cashier.role = "cashier"
        self.cashier.save()
        with self.assertRaises(PermissionDenied):
            self.command(
                "ReceiveBatch",
                {"productId": str(self.product.pk), "quantity": 2, "unitCost": 1},
            )

    @override_settings(
        P2P_WEBHOOK_SECRET="synthetic-tests-only",
        P2P_SOURCES={
            "uzcard": {"sender_ids": [900001], "connection_id": "synthetic-business"}
        },
    )
    def test_p2p_unverified_fixture_ambiguous_rejected_and_single_link(self):
        self.shift()
        a = self.account()
        self.receive()
        self.command(
            "AddLine",
            {"expectedVersion": 1, "productId": str(self.product.pk), "quantity": 1},
            a,
        )
        self.command("Precheck", {"expectedVersion": 2}, a)
        t = Transfer.objects.create(
            source="test-trusted-adapter",
            source_event_id="event-1",
            amount=10000,
            received_at=timezone.now(),
        )
        body = {
            "expectedVersion": 3,
            "methodId": str(self.p2p.pk),
            "amount": 10000,
            "transferId": str(t.pk),
            "confirmedByCashier": True,
        }
        for status in ["unverified", "ambiguous"]:
            t.status = status
            t.save()
            with self.assertRaises(Conflict):
                self.command("AcceptPayment", body, a)
        # Verified source is seeded ONLY by test; public ingress cannot assert it.
        t.status = "verified_source"
        t.evidence_reference = "trusted-test-reference"
        t.save()
        # Trust alone is insufficient: no card/expected part => manual review.
        with self.assertRaises(Conflict):
            self.command("AcceptPayment", body, a)
        self.p2p.p2p_source, self.p2p.card_last4 = "uzcard", "9522"
        self.p2p.save()
        self.command(
            "ExpectTransfer",
            {"expectedVersion": 3, "methodId": str(self.p2p.pk), "amount": 10000},
            a,
        )
        body["expectedVersion"] = 4
        t.source, t.card_last4, t.business_event_id = (
            "uzcard",
            "9522",
            "synthetic-business-event",
        )
        t.save()
        self.command("AcceptPayment", body, a)
        self.assertEqual(Payment.objects.count(), 1)
        from apps.club.models import Booth

        booth = Booth.objects.create(name="02", console="PS5", tariff=self.tariff)
        self.booth = booth
        second = self.account()
        self.command(
            "AddLine",
            {"expectedVersion": 1, "productId": str(self.product.pk), "quantity": 1},
            second,
        )
        self.command("Precheck", {"expectedVersion": 2}, second)
        with self.assertRaises(Conflict):
            self.command("AcceptPayment", body, second)
        self.assertEqual(Payment.objects.count(), 1)
        from apps.accounts.models import Account

        self.assertEqual(Account.objects.get(pk=a).status, "awaiting_payment")

    def test_invalid_payload_is_definite_error_and_health_ready(self):
        from uuid import uuid4

        for body in [
            {"openingCash": -1},
            {"openingCash": 1.5},
            {"openingCash": True},
            {"openingCash": 10**17},
            {"openingCash": 0, "role": "owner"},
        ]:
            r = self.client.post(
                "/api/v1/shifts/open",
                body,
                format="json",
                HTTP_IDEMPOTENCY_KEY=str(uuid4()),
            )
            self.assertEqual(r.status_code, 400, r.content)
            validate("Error", r.json())
        self.assertEqual(self.client.get("/health").status_code, 200)
        self.assertEqual(self.client.get("/ready").status_code, 200)
