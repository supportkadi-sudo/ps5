from django.db import connection, IntegrityError, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.utils import timezone


class ExistingDataUpgradeTests(TransactionTestCase):
    def test_zero_notification_is_preserved_quarantined_and_indexed(self):
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        previous = ("payments", "0003_append_only_refunds")
        executor.migrate([previous])
        try:
            apps = executor.loader.project_state([previous]).apps
            Transfer = apps.get_model("payments", "Transfer")
            row = Transfer.objects.create(
                source="legacy",
                source_event_id="zero",
                amount=0,
                status="unverified",
                received_at=timezone.now(),
            )
            executor = MigrationExecutor(connection)
            executor.migrate(latest)
            from apps.payments.models import Transfer as Current

            saved = Current.objects.get(pk=row.pk)
            self.assertEqual(
                (saved.amount, saved.status, saved.source_event_id),
                (0, "ambiguous", "zero"),
            )
            with self.assertRaises(IntegrityError), transaction.atomic():
                Current.objects.filter(pk=row.pk).update(status="verified_source")
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT indexdef FROM pg_indexes WHERE indexname = 'audit_entity_hist_idx'"
                )
                definition = cursor.fetchone()[0]
            self.assertIn("(entity_id, at DESC, id DESC)", definition)
        finally:
            MigrationExecutor(connection).migrate(latest)


class TariffSnapshotUpgradeTests(TransactionTestCase):
    def test_existing_account_keeps_price_and_gets_legacy_booth_snapshot(self):
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        previous = ("accounts", "0002_account_acct_hist_idx_account_acct_shift_hist_idx_and_more")
        targets = [node for node in latest if node[0] not in ("accounts", "club")] + [previous, ("club", "0002_reviewlink")]
        executor.migrate(targets)
        try:
            apps = executor.loader.project_state(targets).apps
            User = apps.get_model("access", "User")
            Shift = apps.get_model("shifts", "Shift")
            Tariff = apps.get_model("club", "Tariff")
            Booth = apps.get_model("club", "Booth")
            Account = apps.get_model("accounts", "Account")
            user = User.objects.create(username="migration-owner", role="owner")
            shift = Shift.objects.create(cashier_id=user.pk, opened_at=timezone.now(), opening_cash=0)
            tariff = Tariff.objects.create(name="PS5", hourly_rate=90000)
            booth = Booth.objects.create(name="Legacy", console="PS5", tariff_id=tariff.pk)
            account = Account.objects.create(booth_id=booth.pk, shift_id=shift.pk, hourly_rate=60000, created_at=timezone.now())
            MigrationExecutor(connection).migrate(latest)
            from apps.accounts.models import Account as CurrentAccount
            saved = CurrentAccount.objects.get(pk=account.pk)
            self.assertEqual((saved.hourly_rate, saved.console, saved.tariff_id), (60000, "PS5", tariff.pk))
        finally:
            MigrationExecutor(connection).migrate(latest)
