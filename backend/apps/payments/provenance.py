"""Telegram identity and KADI-compatible v1 timestamp/body HMAC."""

import hashlib
import hmac
import json
import time
import re
from django.conf import settings
from rest_framework.exceptions import PermissionDenied


def signature(secret, timestamp, body):
    return (
        "v1="
        + hmac.new(
            secret.encode(),
            b"v1\n" + str(timestamp).encode("ascii") + b"\n" + body,
            hashlib.sha256,
        ).hexdigest()
    )


def verify_signature(body, headers):
    secret = settings.P2P_WEBHOOK_SECRET
    stamp = headers.get("X-P2P-Timestamp", "")
    actual = headers.get("X-P2P-Signature", "")
    if not re.fullmatch(r"[0-9]{1,12}", stamp) or not re.fullmatch(
        r"v1=[0-9a-f]{64}", actual
    ):
        raise PermissionDenied("Invalid bank signature")
    try:
        timestamp = int(stamp)
    except (ValueError, TypeError):
        raise PermissionDenied("Invalid bank signature")
    if (
        not secret
        or abs(time.time() - timestamp) > 300
        or not hmac.compare_digest(signature(secret, timestamp, body), actual)
    ):
        raise PermissionDenied("Invalid bank signature")


def source_config(source):
    return settings.P2P_SOURCES.get(source, {})


def connected(source):
    config = source_config(source)
    return bool(
        settings.P2P_WEBHOOK_SECRET
        and config.get("sender_ids")
        and config.get("connection_id")
    )


def validate_sender(source, sender_id, is_bot, connection_id):
    config = source_config(source)
    if (
        not connected(source)
        or type(sender_id) is not int
        or sender_id not in config["sender_ids"]
        or is_bot is not True
        or not connection_id
        or connection_id != config["connection_id"]
    ):
        raise PermissionDenied("Bank source not connected or untrusted Telegram sender")


def event_identity(connection_id, chat_id, message_id):
    return (
        "tg-business:"
        + hashlib.sha256(
            json.dumps(
                [connection_id, chat_id, message_id], separators=(",", ":")
            ).encode()
        ).hexdigest()
    )
