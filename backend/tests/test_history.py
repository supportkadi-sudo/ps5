from datetime import timedelta
from uuid import uuid4
from django.utils import timezone
from apps.accounts.models import Account
from apps.shifts.models import Shift, Expense
from apps.payments.models import Payment
from apps.core.models import MAX_MONEY
from apps.core.rules import Conflict
from apps.api.contract import validate
from .base import CashierCase


class HistoryTests(CashierCase):
    def test_account_pages_tied_timestamps_inserts_and_detail_scope(self):
        self.shift()
        a = self.account()
        account = Account.objects.get(pk=a)
        now = timezone.now() - timedelta(minutes=2)
        Account.objects.filter(pk=a).update(
            status="closed", closed_at=now, final_total=0, created_at=now
        )
        for i in range(5):
            Account.objects.create(
                booth=self.booth,
                shift=account.shift,
                status="closed",
                created_at=now,
                closed_at=now,
                hourly_rate=40000,
                final_total=0,
            )
        response = self.client.get("/api/v1/accounts?limit=2")
        self.assertEqual(response.status_code, 200)
        first = response.json()
        validate("AccountPage", first)
        newest = self.account()
        ids = [a["id"] for a in first["items"]]
        cursor = first["nextCursor"]
        while cursor:
            page = self.client.get(
                "/api/v1/accounts", {"limit": 2, "cursor": cursor}
            ).json()
            ids += [a["id"] for a in page["items"]]
            cursor = page["nextCursor"]
        self.assertEqual(len(ids), 6)
        self.assertEqual(len(set(ids)), 6)
        self.assertNotIn(newest, ids)
        self.assertEqual(self.client.get(f"/api/v1/accounts/{newest}").status_code, 200)
        self.client.force_authenticate(self.manager)
        self.assertEqual(
            self.client.get(
                "/api/v1/accounts", {"cursor": first["nextCursor"]}
            ).status_code,
            400,
        )
        other = Shift.objects.create(
            cashier=self.manager,
            opened_at=now - timedelta(days=2),
            closed_at=now,
            opening_cash=0,
            actual_cash=0,
            expected_cash=0,
        )
        foreign = Account.objects.create(
            booth=self.booth,
            shift=other,
            status="closed",
            created_at=now,
            closed_at=now,
            hourly_rate=40000,
            final_total=0,
        )
        self.client.force_authenticate(self.cashier)
        self.assertEqual(
            self.client.get(f"/api/v1/accounts/{foreign.pk}").status_code, 404
        )
        self.assertEqual(
            self.client.get("/api/v1/accounts", {"shiftId": str(other.pk)}).json()[
                "items"
            ],
            [],
        )

    def test_payment_expense_audit_pagination_and_bad_cursors(self):
        shift = self.shift()
        a = self.account()
        now = timezone.now()
        for i in range(5):
            Payment.objects.create(
                account_id=a,
                shift_id=shift,
                actor=self.cashier,
                method=self.cash,
                method_kind="cash",
                amount=1000,
                created_at=now,
            )
            Expense.objects.create(
                shift_id=shift,
                actor=self.cashier,
                method=self.cash,
                method_kind="cash",
                amount=100,
                category="Test",
                reason="Test expense",
                created_at=now,
            )
        for resource, schema in [
            ("payments", "PaymentPage"),
            ("expenses", "ExpensePage"),
        ]:
            first = self.client.get(
                f"/api/v1/{resource}", {"limit": 2, "shiftId": shift}
            ).json()
            validate(schema, first)
            second = self.client.get(
                f"/api/v1/{resource}",
                {"limit": 2, "shiftId": shift, "cursor": first["nextCursor"]},
            ).json()
            self.assertFalse(
                set(i["id"] for i in first["items"])
                & set(i["id"] for i in second["items"])
            )
            self.assertEqual(
                self.client.get(
                    f"/api/v1/{resource}", {"cursor": first["nextCursor"]}
                ).status_code,
                400,
            )
        self.assertEqual(self.client.get("/api/v1/audit").status_code, 403)
        self.client.force_authenticate(self.owner)
        response = self.client.get("/api/v1/audit?limit=1")
        validate("AuditPage", response.json())
        for params in [
            {"limit": 0},
            {"limit": 101},
            {"cursor": "tampered"},
            {"accountId": "bad-id"},
            {"unknown": "value"},
        ]:
            self.assertEqual(
                self.client.get("/api/v1/payments", params).status_code, 400
            )
        self.assertEqual(
            self.client.post("/api/v1/payments", {}, format="json").status_code, 405
        )

    def test_workspace_boundaries_and_shift_totals_use_all_operations(self):
        shift = self.shift()
        a = self.account()
        now = timezone.now()
        for i in range(55):
            Payment.objects.create(
                account_id=a,
                shift_id=shift,
                actor=self.cashier,
                method=self.cash,
                method_kind="cash",
                amount=1000,
                created_at=now,
            )
            Expense.objects.create(
                shift_id=shift,
                actor=self.cashier,
                method=self.cash,
                method_kind="cash",
                amount=100,
                category="Test",
                reason="Test expense",
                created_at=now,
            )
        w = self.client.get("/api/v1/workspace").json()
        validate("Workspace", w)
        self.assertEqual(len(w["expenses"]), 50)
        self.assertEqual(w["shifts"][0]["paymentsByMethod"][str(self.cash.pk)], 55000)
        self.assertEqual(w["shifts"][0]["expensesByMethod"][str(self.cash.pk)], 5500)
        self.assertEqual(w["shifts"][0]["expectedCash"], 149500)
        self.receive(7)
        w = self.client.get("/api/v1/workspace").json()
        self.assertEqual(w["products"][0]["availableStock"], 7)

    def test_invalid_catalog_update_and_adapter_inputs_and_cash_overflow(self):
        with self.assertRaises(self.product.DoesNotExist):
            self.command(
                "SaveProduct",
                {
                    "product": {
                        "id": str(uuid4()),
                        "name": "Missing",
                        "category": "Bar",
                        "salePrice": 1,
                        "defaultCost": 1,
                        "enabled": True,
                    }
                },
                actor=self.owner,
            )
        from apps.payments.adapter import record_notification

        for amount in (1.5, True, -1, MAX_MONEY + 1):
            with self.assertRaises(Conflict):
                record_notification(
                    source="test",
                    event_id="e",
                    amount=amount,
                    received_at=timezone.now(),
                )
        shift = self.shift()
        self.command(
            "AddExpense",
            {
                "amount": MAX_MONEY,
                "category": "Test",
                "scope": "shift",
                "methodId": str(self.cash.pk),
                "reason": "Test only",
            },
        )
        with self.assertRaises(Conflict):
            self.command(
                "CloseShift",
                {"actualCash": MAX_MONEY, "reason": "Overflowing discrepancy"},
                shift,
            )
        self.assertIsNone(Shift.objects.get(pk=shift).closed_at)

    def test_refund_detail_retains_original_payment_and_compensation(self):
        self.shift()
        a = self.account()
        self.receive()
        self.command(
            "AddLine",
            {"expectedVersion": 1, "productId": str(self.product.pk), "quantity": 1},
            a,
        )
        self.command("Precheck", {"expectedVersion": 2}, a)
        self.command(
            "AcceptPayment",
            {
                "expectedVersion": 3,
                "methodId": str(self.cash.pk),
                "amount": 10000,
                "transferId": "",
                "confirmedByCashier": True,
            },
            a,
        )
        self.command("CloseAccount", {"expectedVersion": 4}, a)
        self.command(
            "RefundAccount",
            {
                "expectedVersion": 5,
                "reason": "Money actually returned",
                "restockGoods": False,
            },
            a,
            actor=self.manager,
        )
        response = self.client.get("/api/v1/accounts/" + a)
        validate("Account", response.json())
        self.assertEqual(len(response.json()["payments"]), 1)
        self.assertEqual(response.json()["refund"]["amount"], 10000)
        self.assertFalse(response.json()["refund"]["restockGoods"])
        from apps.inventory.models import Batch
        from apps.reports.services import report

        self.assertEqual(Batch.objects.get().remaining, 1)
        self.assertEqual(report()["costOfGoods"], 4000)
        shift_page = self.client.get("/api/v1/shifts").json()
        validate("ShiftPage", shift_page)
        self.assertEqual(
            shift_page["items"][0]["refundsByMethod"][str(self.cash.pk)], 10000
        )
        page = self.client.get("/api/v1/refunds", {"accountId": a}).json()
        validate("RefundPage", page)
        self.assertEqual(
            page["items"][0]["reversals"][0]["paymentId"],
            response.json()["payments"][0]["id"],
        )
        self.assertEqual(
            self.client.get("/api/v1/workspace").json()["shifts"][0]["refundsByMethod"][
                str(self.cash.pk)
            ],
            10000,
        )

    def test_source_event_duplicates_concurrency_and_conflicting_payload(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import close_old_connections
        from apps.payments.adapter import record_notification
        from apps.payments.models import Transfer

        now = timezone.now()
        barrier = Barrier(2)

        def incoming(index):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return str(
                    record_notification(
                        source="test-adapter",
                        event_id="same-event",
                        amount=5000,
                        received_at=now,
                    ).pk
                )
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(incoming, range(2)))
        self.assertEqual(ids[0], ids[1])
        self.assertEqual(Transfer.objects.count(), 1)
        self.assertEqual(Transfer.objects.get().status, "unverified")
        with self.assertRaises(Conflict):
            record_notification(
                source="test-adapter",
                event_id="same-event",
                amount=6000,
                received_at=now,
            )
        self.assertEqual(Transfer.objects.get().amount, 5000)

    def test_database_rejects_unsafe_money_even_without_service(self):
        from django.db import IntegrityError, transaction
        from apps.payments.models import Transfer

        for value in (0, MAX_MONEY + 1):
            with self.assertRaises(IntegrityError), transaction.atomic():
                Transfer.objects.create(
                    source="test",
                    source_event_id=str(value),
                    amount=value,
                    received_at=timezone.now(),
                )
