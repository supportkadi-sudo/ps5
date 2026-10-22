from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0002_refund_paymentreversal"),
        ("audit", "0002_append_only"),
    ]
    operations = [
        migrations.RunSQL(
            "\n".join(
                f"CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION crm_reject_mutation();"
                for table in ["payments_refund", "payments_paymentreversal"]
            ),
            "\n".join(
                f"DROP TRIGGER immutable_record ON {table};"
                for table in ["payments_refund", "payments_paymentreversal"]
            ),
        )
    ]
