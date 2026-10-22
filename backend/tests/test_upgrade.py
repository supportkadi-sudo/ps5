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
