from django.db import migrations, models
import django.db.models.deletion


def backfill(apps, schema_editor):
    Account = apps.get_model("accounts", "Account")
    for account in Account.objects.select_related("booth").iterator():
        account.tariff_id = account.booth.tariff_id
        account.console = account.booth.console
        account.save(update_fields=["tariff", "console"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_account_acct_hist_idx_account_acct_shift_hist_idx_and_more"), ("club", "0003_tariff_console_code")]
    operations = [
        migrations.AddField(model_name="account", name="tariff", field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="club.tariff")),
        migrations.AddField(model_name="account", name="console", field=models.CharField(blank=True, max_length=100)),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
