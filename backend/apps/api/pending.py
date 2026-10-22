"""Durable online retry slot. Financial request bodies never need browser storage."""

from uuid import UUID
from django.db import transaction
from django.contrib.auth import get_user_model
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from apps.api.contract import validate_command
from apps.core.models import PendingCommand
from apps.core.rules import require


class PendingView(APIView):
    def get(self, request):
        row = PendingCommand.objects.filter(actor=request.user).first()
        return Response(
            {
                "pending": {"actorId": str(request.user.pk), "command": row.command}
                if row
                else None
            }
        )

    @transaction.atomic
    def post(self, request):
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        body = request.data
        if not isinstance(body, dict):
            raise ValidationError("Object body required")
        if set(body) == {"completeKey"}:
            row = PendingCommand.objects.filter(actor=request.user).first()
            require(
                not row or row.command["key"] == body["completeKey"],
                "Pending command changed",
            )
            if row:
                row.delete()
            return Response({"completed": True})
        command = body.get("command", {})
        if not isinstance(command, dict):
            raise ValidationError("Object command required")
        if set(body) != {"command"} or set(command) - {
            "name",
            "data",
            "key",
            "entityId",
        }:
            raise ValidationError("Invalid pending command")
        name = command.get("name")
        # Credentials must never be persisted in retry slots, including arbitrary nested fields.
        if name in ("SaveUser", "ResetPassword", "ChangePassword"):
            raise ValidationError("Credential commands cannot be staged")
        try:
            UUID(command["key"])
        except (KeyError, ValueError, TypeError):
            raise ValidationError("UUID required")
        from apps.core.commands import ACCOUNT_COMMANDS
        from apps.catalog.services import CONFIG

        allowed = (
            ACCOUNT_COMMANDS
            | set(CONFIG)
            | {
                "CreateAccount",
                "OpenShift",
                "CloseShift",
                "AddExpense",
                "ReceiveBatch",
                "AdjustStock",
                "SaveReview",
                "RefundAccount",
            }
        )
        if name not in allowed:
            raise ValidationError("Unknown staged operation")
        validate_command(name, command.get("data"))
        if not isinstance(command.get("entityId", ""), str):
            raise ValidationError("Invalid entity identifier")
        row = PendingCommand.objects.filter(actor=request.user).first()
        require(
            not row or row.command == command, "Resolve existing pending command first"
        )
        if not row:
            PendingCommand.objects.create(actor=request.user, command=command)
        return Response({"actorId": str(request.user.pk), "command": command})
