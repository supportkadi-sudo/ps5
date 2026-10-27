from datetime import timedelta
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from apps.accounts.calculations import amounts
from apps.accounts.models import Account, Segment
from apps.club.models import Booth, Tariff
from apps.core.rules import Conflict
from .base import CashierCase


class ConsoleTariffTests(CashierCase):
    def test_choices_snapshot_minutes_and_occupied_booth(self):
        self.shift()
        for code, rate, expected in (("PS3", 40000, [500, 20000, 40000, 60000]), ("PS4", 50000, [1000, 25000, 50000, 75000]), ("PS5", 60000, [1000, 30000, 60000, 90000])):
            tariff = Tariff.objects.get(console_code=code) if code == "PS5" else Tariff.objects.create(name=code, console_code=code, hourly_rate=rate)
            tariff.hourly_rate = rate
            tariff.save()
            booth = Booth.objects.create(name=code, console="", tariff=tariff)
            payload = {"boothId": str(booth.pk), "tariffId": str(tariff.pk), "customerName": "", "customerPhone": ""}
            account_id = self.command("CreateAccount", payload)["entityId"]
            account = Account.objects.get(pk=account_id)
            self.assertEqual((account.console, account.tariff_id, account.hourly_rate, account.status), (code, tariff.pk, rate, "playing"))
            with self.assertRaises(Conflict):
                self.command("CreateAccount", payload)
            now = timezone.now()
            for minutes, expected_total in zip((1, 30, 60, 90), expected):
                Segment.objects.filter(account=account).update(started_at=now-timedelta(minutes=minutes), stopped_at=now)
                result = amounts(account, now)
                self.assertEqual(result["total"], expected_total)
            tariff.hourly_rate = rate + 10000
            tariff.save()
            account.refresh_from_db()
            self.assertEqual(account.hourly_rate, rate)
            self.assertEqual(account.console, code)
            self.assertEqual(amounts(account, now)["total"], expected[-1])

    def test_seed_idempotent_and_never_resets_price(self):
        self.booth.enabled = False
        self.booth.save()
        call_command("init_club")
        self.tariff.refresh_from_db()
        self.tariff.hourly_rate = 71000
        self.tariff.save()
        call_command("init_club")
        self.assertEqual(Booth.objects.filter(enabled=True).count(), 7)
        self.assertEqual(Tariff.objects.filter(console_code__in=["PS3", "PS4", "PS5"]).count(), 3)
        self.tariff.refresh_from_db()
        self.assertEqual(self.tariff.hourly_rate, 71000)

    def test_seed_rejects_unclassified_active_booths_without_changes(self):
        with self.assertRaises(CommandError):
            call_command("init_club")
        self.assertEqual(Booth.objects.count(), 1)
        self.assertEqual(Tariff.objects.count(), 1)
