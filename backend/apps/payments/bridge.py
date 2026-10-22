"""Business updates only. No screenshots, forwarded text or admin paste fallback."""

import asyncio
import json
import logging
import time
import urllib.request
from urllib.error import HTTPError, URLError
from django.conf import settings
from rest_framework.exceptions import PermissionDenied
from apps.payments.provenance import validate_sender, signature

logger = logging.getLogger(__name__)


def envelope(message):
    sender = message.from_user
    if (
        not sender
        or not message.text
        or message.forward_origin
        or message.via_bot
        or message.edit_date
    ):
        return None
    sources = [
        s for s, c in settings.P2P_SOURCES.items() if sender.id in c["sender_ids"]
    ]
    if len(sources) != 1:
        return None
    source = sources[0]
    try:
        validate_sender(
            source, sender.id, sender.is_bot, message.business_connection_id
        )
    except PermissionDenied:
        return None
    return dict(
        source=source,
        senderId=sender.id,
        senderIsBot=sender.is_bot,
        businessConnectionId=message.business_connection_id,
        chatId=message.chat.id,
        messageId=message.message_id,
        text=message.text,
    )


def deliver(payload):
    body = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    timestamp = int(time.time())
    request = urllib.request.Request(
        settings.P2P_BACKEND_URL.rstrip("/") + "/api/v1/integrations/telegram-business",
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-P2P-Timestamp": str(timestamp),
            "X-P2P-Signature": signature(settings.P2P_WEBHOOK_SECRET, timestamp, body),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.load(response)
            if (
                response.status != 200
                or not isinstance(data.get("eventId"), str)
                or data.get("evidenceStatus") != "verified_source"
            ):
                raise RuntimeError("Invalid bank acknowledgement")
    except HTTPError as exc:
        # Invalid/unsupported text is a permanent rejection; no body or text in logs.
        if exc.code == 400:
            logger.warning("Bank message rejected: unsupported format")
            return
        raise RuntimeError("Bank delivery rejected") from None
    except (URLError, ValueError):
        raise RuntimeError("Bank delivery unavailable") from None


async def poll(bot):
    offset = None
    while True:
        try:
            updates = await bot.get_updates(
                offset=offset, timeout=30, allowed_updates=["business_message"]
            )
        except Exception:
            logger.warning("Telegram polling unavailable")
            await asyncio.sleep(5)
            continue
        for update in updates:
            if update.business_message:
                payload = envelope(update.business_message)
                if payload:
                    # Do not advance Telegram acknowledgement until backend committed.
                    # Restart redelivery remains safe via stable event identity.
                    delay = 1
                    while True:
                        try:
                            await asyncio.to_thread(deliver, payload)
                            break
                        except Exception:
                            logger.warning("Bank delivery pending; retrying")
                            await asyncio.sleep(delay)
                            delay = min(delay * 2, 30)
            offset = update.update_id + 1
