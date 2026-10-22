import asyncio
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from apps.payments.provenance import connected


class Command(BaseCommand):
    help = (
        "Poll club Telegram Business updates; run exactly one instance per bot token."
    )

    def handle(self, **options):
        if not settings.P2P_BOT_TOKEN or not any(
            connected(s) for s in ("uzcard", "humo")
        ):
            raise CommandError(
                "Configure club bot token, HMAC, sender allowlists and Business connection first"
            )
        from aiogram import Bot
        from apps.payments.bridge import poll

        async def run():
            async with Bot(settings.P2P_BOT_TOKEN) as bot:
                await poll(bot)

        asyncio.run(run())
