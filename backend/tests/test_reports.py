from datetime import timedelta
from django.utils import timezone
from apps.reports.services import report, period
from apps.accounts.models import Account
from apps.api.contract import validate
from rest_framework.exceptions import ValidationError
from .base import CashierCase


class ReportTests(CashierCase):
    def test_closed_revenue_cost_cash_expenses_and_later_refund(self):
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
                "amount": 10500,
                "transferId": "",
                "confirmedByCashier": True,
            },
            a,
        )
        self.assertEqual(report()["revenue"], 0)
        self.assertEqual(report()["paymentsByMethod"][str(self.cash.pk)], 10500)
        self.command("CloseAccount", {"expectedVersion": 4}, a)
        self.command(
            "AddExpense",
            {
                "scope": "club",
                "amount": 1000,
                "methodId": str(self.cash.pk),
                "category": "Delivery",
                "reason": "Cash paid outside drawer",
            },
            actor=self.owner,
        )
        r = report()
        validate("Report", r)
        self.assertEqual(
            (r["revenue"], r["costOfGoods"], r["grossProfit"], r["netResult"]),
            (10500, 4000, 6500, 5500),
        )
        self.assertEqual(r["productSales"][0]["quantity"], 1)
        # Move sale before local midnight; refund is recognized today.
        yesterday = timezone.now() - timedelta(days=1)
        Account.objects.filter(pk=a).update(closed_at=yesterday)
        self.command(
            "RefundAccount",
            {
                "expectedVersion": 5,
                "reason": "Refund handed back",
                "restockGoods": True,
            },
            a,
            actor=self.manager,
        )
        today = timezone.localdate()
        r = report(today, today)
        validate("Report", r)
        self.assertEqual(r["revenue"], -10500)
        self.assertEqual(r["costOfGoods"], -4000)
        self.assertEqual(r["revenueByMethod"][str(self.cash.pk)], -10500)
        self.assertEqual(report()["revenue"], 0)
        self.assertEqual(report()["paymentsByMethod"][str(self.cash.pk)], 0)

    def test_report_rights_date_validation(self):
        self.assertEqual(
            self.client.get(
                "/api/v1/reports?from=2026-10-01&to=2026-10-22"
            ).status_code,
            403,
        )
        self.client.force_authenticate(self.manager)
        response = self.client.get("/api/v1/reports?from=2026-10-01&to=2026-10-22")
        self.assertEqual(response.status_code, 200)
        validate("Report", response.json())
        for start, end in [
            ("2026-02-30", "2026-10-22"),
            ("2026-10-22", "2026-10-01"),
            ("", ""),
        ]:
            with self.assertRaises(ValidationError):
                period(start, end)
