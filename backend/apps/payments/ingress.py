"""Authenticated bridge ingress; no payment or account writes."""

from django.db import transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from apps.api.contract import validate
from apps.payments.provenance import verify_signature, validate_sender, event_identity
from apps.payments.notifications import parse_notification
from apps.payments.models import Transfer
from apps.core.rules import require


@transaction.atomic
def ingest(data):
    validate_sender(
        data["source"],
        data["senderId"],
        data["senderIsBot"],
        data["businessConnectionId"],
    )
    event_id = event_identity(
        data["businessConnectionId"], data["chatId"], data["messageId"]
    )
    notification = parse_notification(data["text"], data["source"])
    event, created = Transfer.objects.get_or_create(
        business_event_id=event_id,
        defaults=dict(
            source=data["source"],
            source_event_id=event_id,
            amount=notification.amount,
            received_at=notification.at,
            card_last4=notification.last4,
            status="verified_source",
            evidence_reference=event_id,
        ),
    )
    require(
        created
        or (
            event.source == data["source"]
            and event.amount == notification.amount
            and event.received_at == notification.at
            and event.card_last4 == notification.last4
        ),
        "Source event payload changed",
    )
    return event


class BankNotificationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        verify_signature(request.body, request.headers)
        validate("BankNotification", request.data)
        event = ingest(request.data)
        return Response({"eventId": str(event.pk), "evidenceStatus": event.status})
