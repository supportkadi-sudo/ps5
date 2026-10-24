from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from apps.accounts.models import Account, Segment, Line
from apps.club.models import Booth
from apps.shifts.models import Shift
from apps.payments.models import Payment
from apps.api.contract import validate, CONTRACT
from .base import CashierCase


class AccountHistoryTests(CashierCase):
    def test_filters_before_pagination_inclusive_tashkent_days(self):
        self.shift()
        shift = Shift.objects.get()
        start = datetime(2026, 1, 2, tzinfo=ZoneInfo("Asia/Tashkent"))
        other = Booth.objects.create(name="02", console="PS4", tariff=self.tariff)
        accounts = []
        for at, booth in [
            (start - timedelta(seconds=1), self.booth),
            (start, self.booth),
            (start + timedelta(hours=23, minutes=59), self.booth),
            (start + timedelta(days=1), self.booth),
            (start, other),
        ]:
            accounts.append(
                Account.objects.create(
                    booth=booth,
                    shift=shift,
                    status="closed",
                    created_at=at,
                    closed_at=at,
                    hourly_rate=40000,
                    final_total=0,
                )
            )
        params = {
            "from": "2026-01-02",
            "to": "2026-01-02",
            "boothId": str(self.booth.pk),
            "status": "closed",
            "limit": 1,
        }
        response = self.client.get("/api/v1/accounts", params)
        self.assertEqual(response.status_code, 200)
        first = response.json()
        validate("AccountPage", first)
        self.assertEqual(first["items"][0]["id"], str(accounts[2].pk))
        second = self.client.get(
            "/api/v1/accounts", {**params, "cursor": first["nextCursor"]}
        ).json()
        self.assertEqual(second["items"][0]["id"], str(accounts[1].pk))
        self.assertIsNone(second["nextCursor"])
        self.assertEqual(
            self.client.get(
                "/api/v1/accounts",
                {**params, "to": "2026-01-03", "cursor": first["nextCursor"]},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.get(
                "/api/v1/accounts", {**params, "boothId": str(other.pk)}
            ).json()["items"][0]["id"],
            str(accounts[4].pk),
        )
        for bad in [
            {"from": "2026-02-30"},
            {"to": "20260102"},
            {"from": "2026-01-03", "to": "2026-01-02"},
            {"boothId": "bad"},
            {"status": "paid"},
        ]:
            self.assertEqual(
                self.client.get("/api/v1/accounts", bad).status_code, 400, bad
            )
        fields = {
            p["name"]
            for p in CONTRACT["paths"]["/api/v1/accounts"]["get"]["parameters"]
        }
        self.assertTrue({"from", "to", "boothId"} <= fields)

    def test_metadata_excludes_pauses_and_removed_goods_and_keeps_scope(self):
        self.shift()
        account_id = self.account()
        a = Account.objects.get(pk=account_id)
        start = datetime(2026, 1, 2, 20, tzinfo=ZoneInfo("Asia/Tashkent"))
        Segment.objects.create(
            account=a, started_at=start, stopped_at=start + timedelta(minutes=60)
        )
        Segment.objects.create(
            account=a,
            started_at=start + timedelta(minutes=90),
            stopped_at=start + timedelta(minutes=165),
        )
        for removed in [False, True]:
            Line.objects.create(
                account=a,
                product=self.product,
                name="Cola",
                quantity=2,
                unit_price=10000,
                cost=4000,
                removed=removed,
                removal_reason="Test" if removed else "",
            )
        for index, method in enumerate([self.cash, self.card, self.cash]):
            Payment.objects.create(
                account=a,
                shift=a.shift,
                actor=self.cashier,
                method=method,
                method_kind=method.kind,
                amount=1000,
                created_at=start + timedelta(minutes=index),
            )
        response = self.client.get("/api/v1/accounts").json()
        validate("AccountPage", response)
        row = response["items"][0]
        self.assertEqual(
            row["history"],
            dict(
                boothName="01",
                console="PS5",
                cashierName="cashier-test",
                elapsedMinutes=135,
                goodsAmount=20000,
                paymentMethods=["Cash", "Terminal"],
            ),
        )
        detail = self.client.get(f"/api/v1/accounts/{account_id}").json()
        self.assertEqual(row["total"], detail["total"])
        self.assertEqual(row["paid"], 3000)
        self.assertEqual(row["lines"][0]["cost"], 0)
        foreign = Shift.objects.create(
            cashier=self.manager,
            opened_at=start,
            closed_at=start + timedelta(hours=1),
            opening_cash=0,
            actual_cash=0,
            expected_cash=0,
        )
        Account.objects.create(
            booth=self.booth,
            shift=foreign,
            status="closed",
            hourly_rate=40000,
            final_total=0,
            created_at=start,
        )
        self.assertEqual(len(self.client.get("/api/v1/accounts").json()["items"]), 1)
