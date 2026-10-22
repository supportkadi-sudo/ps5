from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4
from django.db import close_old_connections
from apps.core.commands import execute
from apps.core.rules import Conflict
from apps.accounts.models import Account, Line
from apps.inventory.models import Batch
from apps.shifts.models import Expense
from apps.core.models import CommandReceipt
from .base import CashierCase


class ConcurrencyTests(CashierCase):
    def race(self, operations):
        barrier = Barrier(len(operations))

        def run(args):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return execute(self.cashier, *args)
            except Conflict:
                return "conflict"
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=len(operations)) as pool:
            return list(pool.map(run, operations))

    def test_duplicate_expense_waits_and_returns_same_result(self):
        self.shift()
        key = str(uuid4())
        args = (
            key,
            "AddExpense",
            "",
            {
                "amount": 1000,
                "scope": "shift",
                "category": "Bar",
                "methodId": str(self.cash.pk),
                "reason": "Delivery",
            },
        )
        results = self.race([args, args])
        self.assertEqual(results[0], results[1])
        self.assertEqual(Expense.objects.count(), 1)
        self.assertEqual(CommandReceipt.objects.filter(key=key).count(), 1)

    def test_same_account_version_only_one_command_wins(self):
        self.shift()
        a = self.account()
        self.receive(1)
        data = {"productId": str(self.product.pk), "quantity": 1, "expectedVersion": 1}
        results = self.race(
            [(str(uuid4()), "AddLine", a, data), (str(uuid4()), "AddLine", a, data)]
        )
        self.assertEqual(results.count("conflict"), 1)
        self.assertEqual(Line.objects.count(), 1)
        self.assertEqual(Batch.objects.get().remaining, 0)
        self.assertEqual(Account.objects.get(pk=a).version, 2)

    def test_concurrent_booth_creation_cannot_double_book(self):
        self.shift()
        data = {"boothId": str(self.booth.pk), "customerName": "", "customerPhone": ""}
        results = self.race(
            [
                (str(uuid4()), "CreateAccount", "", data),
                (str(uuid4()), "CreateAccount", "", data),
            ]
        )
        self.assertEqual(results.count("conflict"), 1)
        self.assertEqual(Account.objects.count(), 1)

    def test_two_payments_cannot_overpay(self):
        from apps.payments.models import Payment

        self.shift()
        a = self.account()
        self.receive(1)
        self.command(
            "AddLine",
            {"productId": str(self.product.pk), "quantity": 1, "expectedVersion": 1},
            a,
        )
        self.command("Precheck", {"expectedVersion": 2}, a)
        data = {
            "methodId": str(self.cash.pk),
            "amount": 10000,
            "transferId": "",
            "confirmedByCashier": True,
            "expectedVersion": 3,
        }
        results = self.race(
            [
                (str(uuid4()), "AcceptPayment", a, data),
                (str(uuid4()), "AcceptPayment", a, data),
            ]
        )
        self.assertEqual(results.count("conflict"), 1)
        self.assertEqual(Payment.objects.count(), 1)

    def test_last_stock_across_two_accounts_only_sold_once(self):
        from apps.club.models import Booth

        self.shift()
        first = self.account()
        self.receive(1)
        self.booth = Booth.objects.create(name="02", console="PS5", tariff=self.tariff)
        second = self.account()
        data = {"productId": str(self.product.pk), "quantity": 1, "expectedVersion": 1}
        results = self.race(
            [
                (str(uuid4()), "AddLine", first, data),
                (str(uuid4()), "AddLine", second, data),
            ]
        )
        self.assertEqual(results.count("conflict"), 1)
        self.assertEqual(Line.objects.count(), 1)
        self.assertEqual(Batch.objects.get().remaining, 0)
