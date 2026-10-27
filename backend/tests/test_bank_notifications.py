from decimal import Decimal
from datetime import timedelta
from types import SimpleNamespace
import json
import time
from uuid import uuid4
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.exceptions import PermissionDenied
from apps.payments.notifications import parse_notification, parse_amount
from apps.payments.provenance import signature
from apps.payments.bridge import envelope
from apps.payments.models import Transfer, Payment, TransferExpectation
from apps.payments.matching import match_transfer
from apps.accounts.models import Account
from apps.audit.models import AuditEvent
from apps.core.rules import Conflict
from .base import CashierCase

UZCARD = """🟢 Perevod na kartu
➕ 992.56 UZS
💳 ***9522
📍 IYB HUMO 2 UZCARD, UZ
🕓 08.09.26 08:29
💵 1 000.56 UZS"""
HUMO = """🎉 Пополнение
➕ 249.402,00 UZS
📍 HAMKOR HUMO P2P>Andi
💳 HUMOCARD *5763
🕓 06:52 22.10.2026
💰 401.502,70 UZS"""
SOURCES = {
    "uzcard": {
        "sender_ids": frozenset([900001]),
        "connection_id": "synthetic-business",
    },
    "humo": {"sender_ids": frozenset([900002]), "connection_id": "synthetic-business"},
}
SECRET = "synthetic-tests-only-not-for-live"


def notification(source="uzcard", amount="10000.00", message_id=1, at=None):
    at = (at or timezone.now()).astimezone(timezone.get_current_timezone())
    text = (
        UZCARD.replace("992.56", amount).replace(
            "08.09.26 08:29", at.strftime("%d.%m.%y %H:%M")
        )
        if source == "uzcard"
        else HUMO.replace("249.402,00", amount).replace(
            "06:52 22.10.2026", at.strftime("%H:%M %d.%m.%Y")
        )
    )
    return dict(
        source=source,
        senderId=next(iter(SOURCES[source]["sender_ids"])),
        senderIsBot=True,
        businessConnectionId="synthetic-business",
        chatId=700001,
        messageId=message_id,
        text=text,
    )


class ParserTests(SimpleTestCase):
    def test_exact_two_samples_ignore_balance(self):
        u = parse_notification(UZCARD, "uzcard")
        h = parse_notification(HUMO, "humo")
        self.assertEqual(
            (u.amount, u.last4, u.at.isoformat()),
            (Decimal("992.56"), "9522", "2026-09-08T08:29:00+05:00"),
        )
        self.assertEqual(
            (h.amount, h.last4, h.at.isoformat()),
            (Decimal("249402.00"), "5763", "2026-10-22T06:52:00+05:00"),
        )
        self.assertNotEqual(u.amount, Decimal("1000.56"))
        self.assertNotEqual(h.amount, Decimal("401502.70"))

    def test_number_formats(self):
        for text, expected in [
            ("992.56", "992.56"),
            ("992,56", "992.56"),
            ("249.402,00", "249402"),
            ("249 402,00", "249402"),
            ("249\u00a0402.70", "249402.70"),
            ("249\u202f402", "249402"),
            ("1 234 567,89", "1234567.89"),
        ]:
            self.assertEqual(parse_amount(text), Decimal(expected))
        for value in [
            "1.234",
            "1,234",
            "1 23",
            "-10",
            "0",
            "1.00.00",
            "1,00.00",
            "NaN",
            "1e3",
            "9007199254740991.01",
        ]:
            with self.assertRaises(ValueError, msg=value):
                parse_amount(value)

    def test_outgoing_unsupported_ambiguous_and_full_card_rejected(self):
        for text in [
            UZCARD.replace("➕", "➖"),
            UZCARD.replace("Perevod na kartu", "Oplata"),
            UZCARD.replace("***9522", "8600123456789522"),
            UZCARD + "\n➕ 10 UZS",
            UZCARD.replace("➕ 992.56 UZS", ""),
            UZCARD + "\nСписание 100 UZS",
            UZCARD.replace("08.09.26", "31.02.26"),
            UZCARD.replace("➕ 992.56", "➕ -992.56"),
        ]:
            with self.assertRaises(ValueError):
                parse_notification(text, "uzcard")
        with self.assertRaises(ValueError):
            parse_notification(HUMO, "uzcard")

    @override_settings(P2P_SOURCES=SOURCES, P2P_WEBHOOK_SECRET=SECRET)
    def test_bridge_uses_actual_sender_not_chat_and_rejects_paste_and_forward(self):
        def message(**changes):
            values = dict(
                from_user=SimpleNamespace(id=900001, is_bot=True),
                text=UZCARD,
                business_connection_id="synthetic-business",
                chat=SimpleNamespace(id=700001),
                message_id=1,
                forward_origin=None,
                via_bot=None,
                edit_date=None,
            )
            return SimpleNamespace(**(values | changes))

        self.assertEqual(envelope(message())["senderId"], 900001)
        for value in [
            message(from_user=SimpleNamespace(id=700001, is_bot=True)),
            message(from_user=SimpleNamespace(id=900001, is_bot=False)),
            message(business_connection_id=None),
            message(business_connection_id="other"),
            message(text=None),
            message(forward_origin="customer"),
            message(edit_date=timezone.now()),
        ]:
            self.assertIsNone(envelope(value))


@override_settings(P2P_SOURCES=SOURCES, P2P_WEBHOOK_SECRET=SECRET)
class BankFlowTests(CashierCase):
    def post_bank(self, data=None, signature_value=None, timestamp=None):
        data = data or notification()
        body = json.dumps(
            data, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode()
        stamp = timestamp if timestamp is not None else int(time.time())
        return APIClient().generic(
            "POST",
            "/api/v1/integrations/telegram-business",
            body,
            content_type="application/json",
            HTTP_X_P2P_TIMESTAMP=str(stamp),
            HTTP_X_P2P_SIGNATURE=signature_value
            if signature_value is not None
            else signature(SECRET, stamp, body),
        )

    def waiting(self, source="uzcard", amount=10000):
        self.shift()
        a = self.account()
        self.receive()
        self.command(
            "AddLine",
            dict(expectedVersion=1, productId=str(self.product.pk), quantity=1),
            a,
        )
        self.command("Precheck", {"expectedVersion": 2}, a)
        self.p2p.p2p_source = source
        self.p2p.card_last4 = "9522" if source == "uzcard" else "5763"
        self.p2p.save()
        self.command(
            "ExpectTransfer",
            dict(expectedVersion=3, methodId=str(self.p2p.pk), amount=amount),
            a,
        )
        return a

    def accept(self, a, t, version=4, amount=10000, key=None, actor=None):
        return self.command(
            "AcceptPayment",
            dict(
                expectedVersion=version,
                methodId=str(self.p2p.pk),
                amount=amount,
                transferId=str(t.pk),
                confirmedByCashier=True,
            ),
            a,
            key=key,
            actor=actor,
        )

    def test_ingress_signature_trust_connection_and_no_client_evidence(self):
        for changes, code in [
            ({"senderId": 999999}, 403),
            ({"senderId": 900002}, 403),
            ({"senderIsBot": False}, 400),
            ({"businessConnectionId": ""}, 400),
            ({"businessConnectionId": "unknown"}, 403),
        ]:
            self.assertEqual(self.post_bank(notification() | changes).status_code, code)
        self.assertEqual(self.post_bank(signature_value="v1=bad").status_code, 403)
        self.assertEqual(self.post_bank(signature_value="v1=неверно").status_code, 403)
        self.assertEqual(self.post_bank(timestamp=10**1000).status_code, 403)
        self.assertEqual(
            self.post_bank(timestamp=int(time.time()) - 301).status_code, 403
        )
        self.assertEqual(
            self.post_bank(
                notification() | {"text": UZCARD.replace("➕", "➖")}
            ).status_code,
            400,
        )
        client_post = self.client.post(
            "/api/v1/integrations/telegram-business", notification(), format="json"
        )
        self.assertEqual(client_post.status_code, 403)
        self.assertEqual(Transfer.objects.count(), 0)
        with override_settings(P2P_SOURCES={}):
            self.assertEqual(self.post_bank().status_code, 403)
            self.assertTrue(
                all(
                    not s["configured"]
                    for s in self.client.get("/api/v1/workspace").json()["p2pSources"]
                )
            )

    def test_two_formats_ingest_are_evidence_only_and_precise(self):
        for source, text, amount, last4 in [
            ("uzcard", UZCARD, "992.56", "9522"),
            ("humo", HUMO, "249402.00", "5763"),
        ]:
            r = self.post_bank(
                notification(source, message_id=1 if source == "uzcard" else 2)
                | {"text": text}
            )
            self.assertEqual(r.status_code, 200, r.data)
            t = Transfer.objects.get(pk=r.data["eventId"])
            self.assertEqual(
                (t.amount, t.card_last4, t.status),
                (Decimal(amount), last4, "verified_source"),
            )
            self.assertFalse(hasattr(t, "raw_text"))
        self.assertEqual(Payment.objects.count(), 0)

    def test_idempotent_delivery_changed_payload_and_unmatched(self):
        data = notification()
        first = self.post_bank(data)
        self.assertEqual(first.status_code, 200)
        for _ in range(2):
            self.assertEqual(self.post_bank(data).data, first.data)
        self.assertEqual(Transfer.objects.count(), 1)
        self.assertEqual(
            self.post_bank(notification(amount="9999.00")).status_code, 409
        )
        self.assertEqual(match_transfer(Transfer.objects.get())[0], "unmatched")
        self.assertEqual(Payment.objects.count(), 0)

    def test_found_explicit_split_confirmation_then_separate_close_both_sources(self):
        for source in ("uzcard", "humo"):
            with self.subTest(source=source):
                # One scenario per transaction case; reset via ordinary close/shift flow.
                a = self.waiting(source, 5000)
                r = self.post_bank(
                    notification(
                        source,
                        amount="5000.00",
                        message_id=1 if source == "uzcard" else 2,
                    )
                )
                self.assertEqual(r.status_code, 200, r.data)
                t = Transfer.objects.get(pk=r.data["eventId"])
                self.assertEqual(match_transfer(t)[0], "found")
                saved = Account.objects.get(pk=a)
                self.assertEqual(
                    (
                        saved.status,
                        saved.version,
                        Payment.objects.filter(account_id=a).count(),
                    ),
                    ("awaiting_payment", 4, 0),
                )
                with self.assertRaises(Conflict):
                    self.command("CloseAccount", {"expectedVersion": 4}, a)
                key = str(uuid4())
                self.accept(a, t, amount=5000, key=key)
                self.accept(a, t, amount=5000, key=key)
                self.assertEqual(Payment.objects.filter(account_id=a).count(), 1)
                self.assertEqual(Account.objects.get(pk=a).status, "awaiting_payment")
                with self.assertRaises(Conflict):
                    self.accept(a, t, version=5, amount=5000)
                self.command(
                    "AcceptPayment",
                    dict(
                        expectedVersion=5,
                        methodId=str(self.cash.pk),
                        amount=5500,
                        transferId="",
                        confirmedByCashier=True,
                    ),
                    a,
                )
                self.assertEqual(Account.objects.get(pk=a).status, "awaiting_payment")
                self.command("CloseAccount", {"expectedVersion": 6}, a)
                self.assertEqual(Account.objects.get(pk=a).status, "closed")
                events = AuditEvent.objects.filter(entity_id=a)
                self.assertTrue(
                    events.filter(action="AcceptPayment", actor=self.cashier).exists()
                )
                self.assertTrue(
                    events.filter(action="CloseAccount", actor=self.cashier).exists()
                )
                shift = Account.objects.get(pk=a).shift
                self.command(
                    "CloseShift", dict(actualCash=105500, reason=""), str(shift.pk)
                )

    def test_ambiguous_mismatched_card_time_amount_and_fraction_require_review(self):
        a = self.waiting()
        r = self.post_bank()
        t = Transfer.objects.get(pk=r.data["eventId"])
        e = TransferExpectation.objects.get(account_id=a)
        from apps.club.models import Booth

        self.booth = Booth.objects.create(name="02", console="PS5", tariff=self.tariff)
        second = self.account()
        self.command(
            "AddLine",
            dict(expectedVersion=1, productId=str(self.product.pk), quantity=1),
            second,
        )
        self.command("Precheck", {"expectedVersion": 2}, second)
        self.command(
            "ExpectTransfer",
            dict(expectedVersion=3, methodId=str(self.p2p.pk), amount=10000),
            second,
        )
        self.assertEqual(match_transfer(t)[0], "manual_review")
        with self.assertRaises(Conflict):
            self.accept(a, t)
        other = TransferExpectation.objects.get(account_id=second)
        other.consumed_at = timezone.now()
        other.save()
        t.amount = Decimal("10000.56")
        self.assertEqual(match_transfer(t)[0], "manual_review")
        t.amount = Decimal("9000")
        self.assertEqual(match_transfer(t)[0], "manual_review")
        t.amount = Decimal("10000")
        t.card_last4 = "1111"
        self.assertEqual(match_transfer(t)[0], "unmatched")
        t.card_last4 = ""
        self.assertEqual(match_transfer(t)[0], "manual_review")
        t.card_last4 = "9522"
        t.received_at = e.expires_at + timedelta(minutes=1)
        self.assertNotEqual(match_transfer(t)[0], "found")
        self.assertEqual(Payment.objects.count(), 0)

    def test_roles_and_cashier_scope_no_automatic_acceptance(self):
        a = self.waiting()
        r = self.post_bank()
        t = Transfer.objects.get(pk=r.data["eventId"])
        w = self.client.get("/api/v1/workspace").json()
        row = next(x for x in w["transfers"] if x["id"] == str(t.pk))
        self.assertEqual(
            (row["processingStatus"], row["candidateAccountId"], row["cardLast4"]),
            ("found", a, "9522"),
        )
        with self.assertRaises(PermissionDenied):
            self.command(
                "SaveMethod",
                {
                    "method": {
                        "id": str(self.p2p.pk),
                        "name": "Changed",
                        "kind": "p2p",
                        "enabled": True,
                    }
                },
                actor=self.cashier,
            )
        from django.contrib.auth import get_user_model

        outsider = get_user_model().objects.create_user(
            username="outsider", role="cashier"
        )
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get("/api/v1/workspace").json()["transfers"], [])
        with self.assertRaises(PermissionDenied):
            self.accept(a, t, actor=outsider)
        self.assertEqual(Payment.objects.count(), 0)

    def test_parallel_ingress_has_one_stable_event_and_no_payment(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import close_old_connections
        from apps.payments.ingress import ingest

        barrier = Barrier(2)
        data = notification()

        def incoming(_):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return str(ingest(data).pk)
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(incoming, range(2)))
        self.assertEqual(ids[0], ids[1])
        self.assertEqual(Transfer.objects.count(), 1)
        self.assertEqual(Payment.objects.count(), 0)
        # A different source cannot reuse the connection/chat/message identity.
        self.assertEqual(self.post_bank(notification("humo")).status_code, 409)
        self.assertEqual(Transfer.objects.count(), 1)

    def test_expectation_csrf_source_configuration_and_changed_method_fail_closed(self):
        a = self.waiting()
        payload = dict(expectedVersion=4, methodId=str(self.p2p.pk), amount=5000)
        csrf_client = APIClient(enforce_csrf_checks=True)
        csrf_client.force_login(self.cashier)
        self.assertEqual(
            csrf_client.post(
                f"/api/v1/accounts/{a}/expect-transfer",
                payload,
                format="json",
                HTTP_IDEMPOTENCY_KEY=str(uuid4()),
            ).status_code,
            403,
        )
        with override_settings(P2P_SOURCES={}):
            with self.assertRaises(Conflict):
                self.command("ExpectTransfer", payload, a)
        response = self.post_bank()
        t = Transfer.objects.get(pk=response.data["eventId"])
        self.p2p.card_last4 = "1111"
        self.p2p.save()
        with self.assertRaises(Conflict):
            self.accept(a, t)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(Account.objects.get(pk=a).status, "awaiting_payment")
