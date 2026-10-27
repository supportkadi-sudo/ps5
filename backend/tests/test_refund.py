from rest_framework.exceptions import PermissionDenied
from apps.core.rules import Conflict
from apps.accounts.models import Line
from apps.payments.models import Payment, Refund, PaymentReversal
from apps.inventory.models import Batch
from apps.shifts.services import expected
from apps.shifts.models import Shift
from .base import CashierCase


class RefundTests(CashierCase):
    def test_compensation_preserves_paid_history_and_restores_stock(self):
        shift = self.shift()
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
                "amount": 10500,
                "methodId": str(self.cash.pk),
                "transferId": "",
                "confirmedByCashier": True,
            },
            a,
        )
        self.command("CloseAccount", {"expectedVersion": 4}, a)
        data = {
            "expectedVersion": 5,
            "reason": "Returned unopened product; cash handed back",
            "restockGoods": True,
        }
        with self.assertRaises(PermissionDenied):
            self.command("RefundAccount", data, a)
        self.command("RefundAccount", data, a, actor=self.manager)
        self.assertEqual(Payment.objects.count(), 1)
        self.assertEqual(PaymentReversal.objects.get().amount, 10500)
        self.assertFalse(Line.objects.get().removed)
        self.assertEqual(Batch.objects.get().remaining, 2)
        self.assertEqual(expected(Shift.objects.get(pk=shift)), 100000)
        with self.assertRaises(Conflict):
            self.command(
                "RefundAccount", {**data, "expectedVersion": 6}, a, actor=self.owner
            )
        self.assertEqual(Refund.objects.count(), 1)
