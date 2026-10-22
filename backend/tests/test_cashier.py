from datetime import timedelta
from unittest.mock import patch
from django.utils import timezone
from django.db import transaction, DatabaseError
from apps.accounts.models import Account, Segment, Line
from apps.inventory.models import Batch, StockMovement
from apps.payments.models import Payment
from apps.shifts.models import Shift, Expense
from apps.audit.models import AuditEvent
from apps.core.models import CommandReceipt
from apps.core.rules import Conflict
from apps.accounts.calculations import amounts
from apps.api.contract import validate
from apps.api.read_models import workspace
from .base import CashierCase


class CashierTests(CashierCase):
    def test_complete_cashier_flow(self):
        shift = self.shift()
        account = self.account()
        a = Account.objects.get(pk=account)
        self.assertEqual(a.status, "draft")
        self.assertFalse(a.segments.exists())
        batch = self.receive()
        self.command("StartTimer", {"expectedVersion": 1}, account)
        self.command(
            "AddLine",
            {"expectedVersion": 2, "productId": str(self.product.pk), "quantity": 1},
            account,
        )
        start = timezone.now() - timedelta(minutes=80)
        Segment.objects.filter(account_id=account).update(started_at=start)
        with patch(
            "apps.accounts.services.timezone.now",
            return_value=start + timedelta(minutes=80),
        ):
            self.command("Precheck", {"expectedVersion": 3}, account)
        a.refresh_from_db()
        self.assertEqual(a.status, "awaiting_payment")
        self.assertEqual(amounts(a, timezone.now())["total"], 63500)
        self.command(
            "AcceptPayment",
            {
                "expectedVersion": 4,
                "methodId": str(self.cash.pk),
                "amount": 20000,
                "transferId": "",
                "confirmedByCashier": True,
            },
            account,
        )
        with self.assertRaises(Conflict):
            self.command("CloseAccount", {"expectedVersion": 5}, account)
        self.command(
            "AcceptPayment",
            {
                "expectedVersion": 5,
                "methodId": str(self.card.pk),
                "amount": 43500,
                "transferId": "",
                "confirmedByCashier": True,
            },
            account,
        )
        a.refresh_from_db()
        self.assertEqual(a.status, "awaiting_payment")
        self.command("CloseAccount", {"expectedVersion": 6}, account)
        self.command(
            "AddExpense",
            {
                "scope": "shift",
                "amount": 5000,
                "category": "bar",
                "methodId": str(self.cash.pk),
                "reason": "Supplies",
            },
        )
        self.command(
            "CloseShift", {"actualCash": 114000, "reason": "Count short by 1000"}, shift
        )
        s = Shift.objects.get(pk=shift)
        self.assertEqual(s.expected_cash, 115000)
        w = workspace(self.cashier)
        validate("Workspace", w)
        self.assertEqual(w["shifts"][0]["difference"], -1000)
        self.assertEqual(w["accounts"][0]["status"], "closed")
        self.assertEqual(Batch.objects.get(pk=batch).remaining, 1)
        self.assertEqual(Payment.objects.count(), 2)

    def test_fifo_restore_exact_batches_with_reason_and_audit(self):
        self.shift()
        account = self.account()
        first = self.receive(2, 4000)
        second = self.receive(4, 6000)
        self.command(
            "AddLine",
            {"expectedVersion": 1, "productId": str(self.product.pk), "quantity": 3},
            account,
        )
        line = Line.objects.get(account_id=account)
        self.assertEqual(line.cost, 14000)
        self.assertEqual(Batch.objects.get(pk=first).remaining, 0)
        self.assertEqual(Batch.objects.get(pk=second).remaining, 3)
        with self.assertRaises(Conflict):
            self.command(
                "RemoveLine",
                {"expectedVersion": 2, "lineId": str(line.pk), "reason": "  "},
                account,
            )
        self.command(
            "RemoveLine",
            {
                "expectedVersion": 2,
                "lineId": str(line.pk),
                "reason": "Customer changed mind",
            },
            account,
        )
        self.assertEqual(
            list(
                Batch.objects.order_by("received_at").values_list(
                    "remaining", flat=True
                )
            ),
            [2, 4],
        )
        self.assertEqual(StockMovement.objects.count(), 6)
        event = AuditEvent.objects.get(action="AddLine")
        self.assertEqual([b["remaining"] for b in event.before["batches"]], [2, 4])
        self.assertEqual([b["remaining"] for b in event.after["batches"]], [0, 3])
        self.assertEqual(line.allocations.count(), 2)

    def test_rollback_after_stock_or_payment_write(self):
        self.shift()
        account = self.account()
        self.receive()
        count = CommandReceipt.objects.count()
        with patch(
            "apps.accounts.services.audit",
            side_effect=RuntimeError("simulated audit failure"),
        ):
            with self.assertRaises(RuntimeError):
                self.command(
                    "AddLine",
                    {
                        "expectedVersion": 1,
                        "productId": str(self.product.pk),
                        "quantity": 1,
                    },
                    account,
                )
        self.assertEqual(Batch.objects.get().remaining, 2)
        self.assertFalse(Line.objects.exists())
        self.assertEqual(CommandReceipt.objects.count(), count)
        self.assertEqual(Account.objects.get(pk=account).version, 1)

    def test_durable_retry_and_changed_payload_conflict(self):
        from uuid import uuid4
        from django.db import connections

        self.shift()
        data = {
            "scope": "shift",
            "amount": 3000,
            "category": "Bar",
            "methodId": str(self.cash.pk),
            "reason": "Delivery",
        }
        key = str(uuid4())
        first = self.command("AddExpense", data, key=key)
        connections.close_all()
        self.assertEqual(first, self.command("AddExpense", data, key=key))
        self.assertEqual(Expense.objects.count(), 1)
        with self.assertRaises(Conflict):
            self.command("AddExpense", {**data, "amount": 4000}, key=key)
        with self.assertRaises(Conflict):
            self.command("OpenShift", {"openingCash": 0}, key=key)

    def test_minute_accumulation_and_single_final_rounding(self):
        self.shift()
        account = self.account()
        a = Account.objects.get(pk=account)
        now = timezone.now()
        for offset in (0, 50):
            Segment.objects.create(
                account=a,
                started_at=now + timedelta(seconds=offset),
                stopped_at=now + timedelta(seconds=offset + 30),
            )
        self.assertEqual(
            amounts(a, now)["total"], 500
        )  # 60 seconds total, not 2 started minutes.
        self.assertEqual(amounts(a, now)["gameAmount"], 666)
        self.tariff.hourly_rate = 99999
        self.tariff.save()
        a.refresh_from_db()
        self.assertEqual(a.hourly_rate, 40000)
        for micros, expected in [(0, 500), (1, 1500)]:
            Segment.objects.filter(account=a).delete()
            Segment.objects.create(
                account=a,
                started_at=now,
                stopped_at=now + timedelta(seconds=60, microseconds=micros),
            )
            self.assertEqual(amounts(a, now)["total"], expected)
        a.hourly_rate = 15000
        a.save()
        self.assertEqual(amounts(a, now)["total"], 500)  # 2 minutes = 500.
        Segment.objects.filter(account=a).update(stopped_at=now + timedelta(minutes=1))
        self.assertEqual(amounts(a, now)["total"], 500)  # 250 midpoint rounds up.

    def test_partial_payment_blocks_edits_overpayment_and_wrong_transitions(self):
        self.shift()
        a = self.account()
        self.receive()
        with self.assertRaises(Conflict):
            self.command("CloseAccount", {"expectedVersion": 1}, a)
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
                "amount": 5000,
                "transferId": "",
                "confirmedByCashier": True,
            },
            a,
        )
        with self.assertRaises(Conflict):
            self.command(
                "AddLine",
                {
                    "expectedVersion": 4,
                    "productId": str(self.product.pk),
                    "quantity": 1,
                },
                a,
            )
        with self.assertRaises(Conflict):
            self.command(
                "AcceptPayment",
                {
                    "expectedVersion": 4,
                    "methodId": str(self.cash.pk),
                    "amount": 5001,
                    "transferId": "",
                    "confirmedByCashier": True,
                },
                a,
            )
        self.assertEqual(Payment.objects.count(), 1)

    def test_db_append_only_audit_payment_and_stock(self):
        self.shift()
        self.account()
        self.receive()
        event = AuditEvent.objects.first()
        for mutation in (
            lambda: AuditEvent.objects.filter(pk=event.pk).update(reason="changed"),
            lambda: event.delete(),
            lambda: StockMovement.objects.all().delete(),
        ):
            with self.assertRaises(DatabaseError), transaction.atomic():
                mutation()

    def test_handover_preserves_timer_and_requires_new_shift(self):
        shift = self.shift()
        a = self.account()
        self.command("StartTimer", {"expectedVersion": 1}, a)
        self.command("CloseShift", {"actualCash": 100000, "reason": ""}, shift)
        with self.assertRaises(Conflict):
            self.command("Precheck", {"expectedVersion": 2}, a)
        new_shift = self.command(
            "OpenShift", {"openingCash": 100000}, actor=self.manager
        )["entityId"]
        account = Account.objects.get(pk=a)
        self.assertEqual(str(account.shift_id), new_shift)
        self.assertEqual(account.status, "playing")
        self.assertEqual(account.version, 3)
        self.assertTrue(AuditEvent.objects.filter(action="Handover").exists())

    def test_precheck_audit_uses_same_recalculated_timestamp(self):
        self.shift()
        a = self.account()
        self.command("StartTimer", {"expectedVersion": 1}, a)
        now = timezone.now()
        Segment.objects.filter(account_id=a).update(started_at=now - timedelta(hours=1))
        with patch("apps.accounts.services.timezone.now", return_value=now):
            self.command("Precheck", {"expectedVersion": 2}, a)
        event = AuditEvent.objects.get(action="Precheck")
        self.assertEqual(event.before["total"], 40000)
        self.assertEqual(event.after["total"], 40000)
        self.assertEqual(event.before["status"], "playing")
        self.assertEqual(event.after["status"], "awaiting_payment")

    def test_payment_rolls_back_when_audit_fails(self):
        self.shift()
        a = self.account()
        self.receive()
        self.command(
            "AddLine",
            {"expectedVersion": 1, "productId": str(self.product.pk), "quantity": 1},
            a,
        )
        self.command("Precheck", {"expectedVersion": 2}, a)
        with patch(
            "apps.accounts.services.audit",
            side_effect=RuntimeError("simulated audit failure"),
        ):
            with self.assertRaises(RuntimeError):
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
        self.assertFalse(Payment.objects.exists())
        self.assertEqual(Account.objects.get(pk=a).version, 3)
        self.assertFalse(AuditEvent.objects.filter(action="AcceptPayment").exists())

    def test_receipt_replays_across_separate_python_workers(self):
        import json
        import os
        import subprocess
        import sys
        from uuid import uuid4
        from django.db import connection

        self.shift()
        payload = {
            "actor": self.cashier.pk,
            "key": str(uuid4()),
            "data": {
                "scope": "shift",
                "amount": 2000,
                "category": "Bar",
                "methodId": str(self.cash.pk),
                "reason": "Delivery",
            },
        }
        worker = """import json,sys,os
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django
django.setup()
from django.contrib.auth import get_user_model
from apps.core.commands import execute
p=json.load(sys.stdin)
r=execute(get_user_model().objects.get(pk=p['actor']),p['key'],'AddExpense','',p['data'])
print(json.dumps(r))
"""
        env = {**os.environ, "POSTGRES_DB": connection.settings_dict["NAME"]}
        # Two independently started interpreters, with no shared application memory.
        responses = []
        for _ in range(2):
            result = subprocess.run(
                [sys.executable, "-c", worker],
                input=json.dumps(payload),
                text=True,
                capture_output=True,
                env=env,
                timeout=20,
                check=True,
            )
            responses.append(json.loads(result.stdout))
        self.assertEqual(responses[0], responses[1])
        self.assertEqual(Expense.objects.count(), 1)
        self.assertEqual(CommandReceipt.objects.filter(key=payload["key"]).count(), 1)
