from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("club", "0002_reviewlink")]
    operations = [
        migrations.AddField(
            model_name="tariff",
            name="console_code",
            field=models.CharField(blank=True, max_length=3, null=True, unique=True),
        ),
    ]
