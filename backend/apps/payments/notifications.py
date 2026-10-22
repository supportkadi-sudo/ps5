"""Strict bank text parsing. Raw text and card balances are never persisted."""

import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Notification:
    amount: Decimal
    last4: str
    at: datetime


def parse_amount(value):
    value = value.replace("\u00a0", " ").replace("\u202f", " ").strip()
    # Grouping is exactly three digits; decimal precision is exactly two.
    if not re.fullmatch(
        r"(?:\d+|\d{1,3}(?:[ .]\d{3})+)(?:,\d{2})?|(?:\d+|\d{1,3}(?: \d{3})+)\.\d{2}",
        value,
    ):
        raise ValueError("Unsupported or ambiguous amount")
    if "," in value:
        value = value.replace(".", "").replace(" ", "").replace(",", ".")
    elif "." in value and len(value.rsplit(".", 1)[1]) == 2:
        value = value.replace(" ", "")
    elif "." in value:
        # A single dot with three following digits is ambiguous (decimal/grouping).
        raise ValueError("Ambiguous amount")
    else:
        value = value.replace(" ", "")
    result = Decimal(value)
    if not 0 < result <= Decimal("9007199254740991"):
        raise ValueError("Invalid amount")
    return result


def parse_notification(text, source):
    if not isinstance(text, str) or len(text) > 4096:
        raise ValueError("Invalid bank message")
    lines = [x.strip() for x in text.splitlines() if x.strip()]
    header = {"uzcard": "🟢 Perevod na kartu", "humo": "🎉 Пополнение"}.get(source)
    if (
        not lines
        or lines[0] != header
        or any(x in text for x in ("➖", "Списание", "Отмена", "Возврат"))
    ):
        raise ValueError("Unsupported bank operation")
    if any(not x.startswith(("➕", "💳", "📍", "🕓", "💵", "💰")) for x in lines[1:]):
        raise ValueError("Unsupported bank message line")
    plus = [x for x in lines if x.startswith("➕")]
    cards = [x for x in lines if x.startswith("💳")]
    dates = [x for x in lines if x.startswith("🕓")]
    if len(plus) != 1 or len(cards) != 1 or len(dates) != 1:
        raise ValueError("Ambiguous bank message")
    amount = re.fullmatch(r"➕\s*([\d .,\u00a0\u202f]+)\s+UZS", plus[0])
    card = (
        re.fullmatch(r"💳\s*(?:UZCARD\s*)?\*{1,3}(\d{4})", cards[0], re.I)
        if source == "uzcard"
        else re.fullmatch(r"💳\s*HUMOCARD\s*\*{1,3}(\d{4})", cards[0], re.I)
    )
    if not amount or not card:
        raise ValueError("Missing amount or masked card")
    stamp = dates[0].removeprefix("🕓").strip()
    at = None
    for fmt in ("%d.%m.%y %H:%M", "%d.%m.%Y %H:%M", "%H:%M %d.%m.%Y", "%H:%M %d.%m.%y"):
        try:
            at = datetime.strptime(stamp, fmt).replace(tzinfo=ZoneInfo("Asia/Tashkent"))
            break
        except ValueError:
            continue
    if at is None:
        raise ValueError("Unsupported timestamp")
    return Notification(parse_amount(amount[1]), card[1], at)
