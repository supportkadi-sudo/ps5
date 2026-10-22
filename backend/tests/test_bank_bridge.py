"""The bridge signs exact bytes and acknowledges only delivered Business updates."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from django.test import SimpleTestCase, override_settings
from apps.payments.bridge import deliver, poll
from apps.payments.provenance import signature
from .test_bank_notifications import SOURCES, SECRET, UZCARD, notification


@override_settings(
    P2P_SOURCES=SOURCES,
    P2P_WEBHOOK_SECRET=SECRET,
    P2P_BACKEND_URL="http://backend.invalid",
)
class BridgeDeliveryTests(SimpleTestCase):
    def test_signs_exact_bytes_with_kadi_v1(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = json.dumps(
            {"eventId": "synthetic-uuid", "evidenceStatus": "verified_source"}
        )
        response.status = 200
        with (
            patch(
                "apps.payments.bridge.urllib.request.urlopen", return_value=response
            ) as send,
            patch("apps.payments.bridge.time.time", return_value=1790000000),
        ):
            deliver(notification())
        request = send.call_args.args[0]
        self.assertEqual(request.get_header("X-p2p-timestamp"), "1790000000")
        self.assertEqual(
            request.get_header("X-p2p-signature"),
            signature(SECRET, 1790000000, request.data),
        )
        self.assertEqual(send.call_args.kwargs["timeout"], 15)
        self.assertEqual(
            request.full_url,
            "http://backend.invalid/api/v1/integrations/telegram-business",
        )

    async def test_retry_holds_telegram_offset_until_backend_ack(self):
        message = SimpleNamespace(
            from_user=SimpleNamespace(id=900001, is_bot=True),
            text=UZCARD,
            business_connection_id="synthetic-business",
            chat=SimpleNamespace(id=700001),
            message_id=1,
            forward_origin=None,
            via_bot=None,
            edit_date=None,
        )
        update = SimpleNamespace(update_id=42, business_message=message)
        bot = SimpleNamespace(
            get_updates=AsyncMock(side_effect=[[update], asyncio.CancelledError])
        )
        with (
            patch(
                "apps.payments.bridge.asyncio.to_thread",
                new=AsyncMock(side_effect=[RuntimeError("temporary"), None]),
            ) as send,
            patch("apps.payments.bridge.asyncio.sleep", new=AsyncMock()) as delay,
        ):
            with self.assertRaises(asyncio.CancelledError):
                await poll(bot)
        self.assertEqual(send.await_count, 2)
        delay.assert_awaited_once_with(1)
        self.assertIsNone(bot.get_updates.await_args_list[0].kwargs["offset"])
        self.assertEqual(bot.get_updates.await_args_list[1].kwargs["offset"], 43)
