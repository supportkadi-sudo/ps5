from django.db import migrations

TABLES = [
    "audit_auditevent",
    "payments_payment",
    "shifts_expense",
    "inventory_stockmovement",
    "inventory_allocation",
    "core_commandreceipt",
]


class Migration(migrations.Migration):
    dependencies = [
        ("audit", "0001_initial"),
        ("payments", "0001_initial"),
        ("shifts", "0001_initial"),
        ("inventory", "0001_initial"),
        ("core", "0001_initial"),
    ]
    operations = [
        migrations.RunSQL(
            """CREATE FUNCTION crm_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'CRM append-only record'; END; $$;"""
            + "\n".join(
                f"CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION crm_reject_mutation();"
                for table in TABLES
            ),
            "\n".join(f"DROP TRIGGER immutable_record ON {table};" for table in TABLES)
            + "\nDROP FUNCTION crm_reject_mutation();",
        )
    ]
