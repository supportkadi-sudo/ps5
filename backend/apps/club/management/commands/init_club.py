from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.models import Q
from apps.club.models import Booth, Tariff


class Command(BaseCommand):
    help = "Initialize seven booths and PS tariffs without changing existing prices or history."

    @transaction.atomic
    def handle(self, **options):
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(71003)")
        tariffs = []
        for number, rate in ((3, 40000), (4, 50000), (5, 60000)):
            code = f"PS{number}"
            matches = list(
                Tariff.objects.select_for_update().filter(
                    Q(console_code=code)
                    | Q(console_code__isnull=True, name__in=[code, f"PlayStation {number}"])
                )
            )
            if len(matches) > 1:
                raise CommandError(f"Multiple {code} tariffs; inspect before initializing")
            tariff = matches[0] if matches else Tariff.objects.create(
                name=code, hourly_rate=rate, console_code=code
            )
            if tariff.console_code != code:
                tariff.console_code = code
                tariff.save(update_fields=["console_code"])
            tariffs.append(tariff)
        wanted = [f"Кабинка {number}" for number in range(1, 8)]
        extras = list(
            Booth.objects.select_for_update().filter(enabled=True)
            .exclude(name__in=wanted).values_list("name", flat=True)
        )
        if extras:
            raise CommandError(f"Other active booths require inspection first: {extras}")
        for name in wanted:
            matches = list(Booth.objects.select_for_update().filter(name=name))
            if len(matches) > 1:
                raise CommandError(f"Duplicate booth {name}; inspect before initializing")
            if matches:
                if not matches[0].enabled:
                    matches[0].enabled = True
                    matches[0].save(update_fields=["enabled"])
            else:
                Booth.objects.create(name=name, console="", tariff=tariffs[0])
        self.stdout.write(self.style.SUCCESS("Seven booths initialized; existing rates preserved."))
