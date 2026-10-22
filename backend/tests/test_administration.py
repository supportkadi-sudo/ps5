from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.db import close_old_connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from apps.api.contract import validate
from apps.audit.models import AuditEvent
from apps.core.models import CommandReceipt
from apps.core.rules import Conflict
from apps.club.models import ReviewLink
from .base import CashierCase

PASSWORD = "Unshared-Strong-Credential-53!"


class AdministrationTests(CashierCase):
    def employee_data(self, user=None, role="cashier", active=True):
        data = {
            "user": {
                "id": str(user.pk) if user else "",
                "name": "Personal employee",
                "role": role,
                "isActive": active,
            },
            "expectedVersion": user.version if user else 0,
            "reason": "Employee administration",
        }
        if not user:
            data.update(username="new-employee", password=PASSWORD)
        return data

    def test_employee_roles_disable_last_owner_and_redacted_audit(self):
        data = self.employee_data()
        with self.assertRaises(PermissionDenied):
            self.command("SaveUser", data)
        result = self.command("SaveUser", data, actor=self.manager)
        employee = get_user_model().objects.get(pk=result["entityId"])
        self.assertTrue(employee.check_password(PASSWORD))
        with self.assertRaises(PermissionDenied):
            self.command(
                "SaveUser",
                self.employee_data(employee, role="manager"),
                actor=self.manager,
            )
        with self.assertRaises(PermissionDenied):
            self.command("SaveUser", self.employee_data(self.owner), actor=self.manager)
        with self.assertRaises(Conflict):
            self.command(
                "SaveUser",
                self.employee_data(self.owner, role="cashier"),
                actor=self.owner,
            )
        self.command(
            "SaveUser", self.employee_data(employee, active=False), actor=self.manager
        )
        employee.refresh_from_db()
        self.assertFalse(employee.is_active)
        text = str(
            list(AuditEvent.objects.filter(action="SaveUser").values("before", "after"))
        )
        receipts = str(list(CommandReceipt.objects.values("response")))
        for private in (PASSWORD, employee.password, "pbkdf2_"):
            self.assertNotIn(private, text + receipts)
        self.client.force_authenticate(self.manager)
        response = self.client.get("/api/v1/access/users")
        validate("EmployeeList", response.json())
        self.assertNotIn(
            str(self.owner.pk), [u["id"] for u in response.json()["items"]]
        )

    def test_employee_version_rollback_and_open_shift_guard(self):
        self.shift()
        with self.assertRaises(Conflict):
            self.command(
                "SaveUser",
                self.employee_data(self.cashier, active=False),
                actor=self.owner,
            )
        data = self.employee_data(self.cashier)
        with patch(
            "apps.access.services.audit", side_effect=RuntimeError("audit failure")
        ):
            with self.assertRaises(RuntimeError):
                self.command("SaveUser", data, actor=self.owner)
        self.cashier.refresh_from_db()
        self.assertEqual(self.cashier.version, 1)
        self.command("SaveUser", data, actor=self.owner)
        with self.assertRaises(Conflict):
            self.command("SaveUser", data, actor=self.owner)

    def test_reset_password_revokes_session_and_change_requires_old_password(self):
        c = APIClient(enforce_csrf_checks=True)
        token = c.get("/api/v1/auth/csrf").json()["csrfToken"]
        response = c.post(
            "/api/v1/auth/login",
            {"username": self.cashier.username, "password": "test-only-long-password"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(response.status_code, 200)
        self.command(
            "ResetPassword",
            {
                "expectedVersion": 1,
                "password": PASSWORD,
                "reason": "Employee requested reset",
            },
            str(self.cashier.pk),
            actor=self.manager,
        )
        self.assertEqual(c.get("/api/v1/workspace").status_code, 403)
        self.cashier.refresh_from_db()
        with self.assertRaises(PermissionDenied):
            self.command(
                "ChangePassword",
                {
                    "expectedVersion": 2,
                    "oldPassword": "wrong",
                    "newPassword": PASSWORD + "Next",
                    "reason": "Rotation",
                },
            )
        self.command(
            "ChangePassword",
            {
                "expectedVersion": 2,
                "oldPassword": PASSWORD,
                "newPassword": PASSWORD + "Next",
                "reason": "Rotation",
            },
        )
        self.cashier.refresh_from_db()
        self.assertTrue(self.cashier.check_password(PASSWORD + "Next"))
        self.assertNotIn(
            "password",
            str(AuditEvent.objects.get(action="ResetPassword").after).lower(),
        )
        with self.assertRaises(ValidationError):
            self.command(
                "ResetPassword",
                {"expectedVersion": 3, "password": "123", "reason": "Weak"},
                str(self.cashier.pk),
                actor=self.owner,
            )

    def test_review_link_crud_qr_permissions_and_rollback(self):
        body = {
            "review": {
                "id": "",
                "name": "2GIS",
                "url": "https://2gis.uz/tashkent",
                "enabled": True,
            },
            "expectedVersion": 0,
            "reason": "Set review destination",
        }
        with self.assertRaises(PermissionDenied):
            self.command("SaveReview", body)
        result = self.command("SaveReview", body, actor=self.manager)
        obj = ReviewLink.objects.get(pk=result["entityId"])
        self.client.force_authenticate(self.manager)
        response = self.client.get(f"/api/v1/settings/review-links/{obj.pk}/qr")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"<svg", response.content)
        self.assertEqual(response["Content-Type"], "image/svg+xml")
        self.assertEqual(
            self.client.get("/api/v1/settings/review-links").status_code, 200
        )
        body["review"].update(id=str(obj.pk), enabled=False)
        body["expectedVersion"] = 1
        with patch(
            "apps.club.reviews.audit", side_effect=RuntimeError("audit failure")
        ):
            with self.assertRaises(RuntimeError):
                self.command("SaveReview", body, actor=self.manager)
        obj.refresh_from_db()
        self.assertTrue(obj.enabled)
        self.command("SaveReview", body, actor=self.manager)
        self.assertEqual(
            self.client.get(f"/api/v1/settings/review-links/{obj.pk}/qr").status_code,
            404,
        )
        body["review"]["url"] = "javascript:alert(1)"
        body["expectedVersion"] = 2
        with self.assertRaises(ValidationError):
            self.command("SaveReview", body, actor=self.manager)
        self.client.force_authenticate(self.cashier)
        self.assertEqual(
            self.client.get("/api/v1/settings/review-links").status_code, 403
        )

    def test_concurrent_owner_demotions_leave_an_active_owner(self):
        other = get_user_model().objects.create_user(
            username="other-owner", role="owner"
        )
        barrier = Barrier(2)

        def run(target):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return self.command(
                    "SaveUser",
                    self.employee_data(target, role="cashier"),
                    actor=self.owner,
                )
            except APIException:
                return "rejected"
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, [self.owner, other]))
        self.assertEqual(results.count("rejected"), 1)
        self.assertEqual(
            get_user_model().objects.filter(role="owner", is_active=True).count(), 1
        )

    @override_settings(LOGIN_RATE_LIMIT=2, LOGIN_RATE_WINDOW_SECONDS=300)
    def test_login_rate_limit_shared_database_counter_and_expiry(self):
        def attempt(client):
            token = client.get("/api/v1/auth/csrf").json()["csrfToken"]
            return client.post(
                "/api/v1/auth/login",
                {"username": self.cashier.username, "password": "wrong"},
                format="json",
                HTTP_X_CSRFTOKEN=token,
            )

        self.assertEqual(attempt(APIClient(enforce_csrf_checks=True)).status_code, 403)
        self.assertEqual(attempt(APIClient(enforce_csrf_checks=True)).status_code, 403)
        response = attempt(APIClient(enforce_csrf_checks=True))
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)
        validate("Error", response.json())
        from datetime import timedelta
        from apps.access.models import LoginBucket

        LoginBucket.objects.update(
            window_started=timezone.now() - timedelta(seconds=301)
        )
        self.assertEqual(attempt(APIClient(enforce_csrf_checks=True)).status_code, 403)

    @override_settings(LOGIN_RATE_LIMIT=2, LOGIN_RATE_WINDOW_SECONDS=300)
    def test_parallel_login_reservations_cannot_bypass_limit(self):
        from apps.access.rate_limit import reserve
        from apps.access.models import LoginBucket

        barrier = Barrier(4)

        def run(index):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                reserve("same-employee", "127.0.0.1")
                return "allowed"
            except APIException:
                return "limited"
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(run, range(4)))
        self.assertEqual(results.count("allowed"), 2)
        self.assertEqual(results.count("limited"), 2)
        self.assertEqual(
            list(LoginBucket.objects.values_list("attempts", flat=True)), [2, 2]
        )

    def test_employee_creation_retry_and_reset_rollback(self):
        key = str(uuid4())
        body = self.employee_data()
        first = self.command("SaveUser", body, actor=self.owner, key=key)
        self.assertEqual(
            first, self.command("SaveUser", body, actor=self.owner, key=key)
        )
        self.assertEqual(
            get_user_model().objects.filter(username="new-employee").count(), 1
        )
        employee = get_user_model().objects.get(pk=first["entityId"])
        old_hash = employee.password
        with patch(
            "apps.access.services.audit", side_effect=RuntimeError("audit failure")
        ):
            with self.assertRaises(RuntimeError):
                self.command(
                    "ResetPassword",
                    {
                        "expectedVersion": 1,
                        "password": PASSWORD + "Reset",
                        "reason": "Reset",
                    },
                    str(employee.pk),
                    actor=self.owner,
                )
        employee.refresh_from_db()
        self.assertEqual(employee.password, old_hash)
        self.assertEqual(employee.version, 1)

    def test_oversize_unicode_review_rejected_and_legacy_qr_is_not_500(self):
        url = "https://example.com/" + "😀" * 970
        body = {
            "review": {"id": "", "name": "Oversize", "url": url, "enabled": True},
            "expectedVersion": 0,
            "reason": "QR regression",
        }
        with self.assertRaises(ValidationError):
            self.command("SaveReview", body, actor=self.owner)
        self.assertFalse(ReviewLink.objects.filter(url=url).exists())
        legacy = ReviewLink.objects.create(name="Legacy", url=url, enabled=True)
        self.client.force_authenticate(self.owner)
        response = self.client.get(f"/api/v1/settings/review-links/{legacy.pk}/qr")
        self.assertEqual(response.status_code, 400)
