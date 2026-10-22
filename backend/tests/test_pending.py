from uuid import uuid4
from apps.core.models import PendingCommand
from .base import CashierCase


class PendingTests(CashierCase):
    def test_staging_replay_scope_and_credentials(self):
        command = {
            "name": "OpenShift",
            "key": str(uuid4()),
            "data": {"openingCash": 1000},
        }
        self.assertEqual(
            self.client.get("/api/v1/commands/pending").json(), {"pending": None}
        )
        for _ in range(2):
            self.assertEqual(
                self.client.post(
                    "/api/v1/commands/pending", {"command": command}, format="json"
                ).status_code,
                200,
            )
        self.assertEqual(PendingCommand.objects.count(), 1)
        self.assertEqual(
            self.client.get("/api/v1/commands/pending").json()["pending"]["command"],
            command,
        )
        other = {**command, "key": str(uuid4())}
        self.assertEqual(
            self.client.post(
                "/api/v1/commands/pending", {"command": other}, format="json"
            ).status_code,
            409,
        )
        self.client.force_authenticate(self.owner)
        self.assertIsNone(self.client.get("/api/v1/commands/pending").json()["pending"])
        self.assertEqual(
            self.client.post(
                "/api/v1/commands/pending",
                {"command": {**command, "name": "SaveUser"}},
                format="json",
            ).status_code,
            400,
        )
        self.client.force_authenticate(self.cashier)
        self.assertEqual(
            self.client.post(
                "/api/v1/commands/pending", {"completeKey": other["key"]}, format="json"
            ).status_code,
            409,
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/commands/pending",
                {"completeKey": command["key"]},
                format="json",
            ).status_code,
            200,
        )
        self.assertFalse(PendingCommand.objects.exists())
