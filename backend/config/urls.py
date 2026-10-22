from django.urls import path
from apps.api.auth import CsrfView, LoginView, LogoutView
from apps.api.views import (
    CommandView,
    WorkspaceView,
    SchemaView,
    ReportView,
    health,
    ready,
)

from apps.api.administration import EmployeeView, ReviewView, ReviewQrView

from apps.api.history import HistoryView, AccountDetailView

COMMAND_ROUTES = {
    "access/users": "SaveUser",
    "access/users/<str:id>/password": "ResetPassword",
    "auth/password": "ChangePassword",
    "settings/review-links": "SaveReview",
    "accounts": "CreateAccount",
    "accounts/<str:id>/refund": "RefundAccount",
    "accounts/<str:id>/start": "StartTimer",
    "accounts/<str:id>/precheck": "Precheck",
    "accounts/<str:id>/resume": "ResumeTimer",
    "accounts/<str:id>/close": "CloseAccount",
    "accounts/<str:id>/lines": "AddLine",
    "accounts/<str:id>/remove-line": "RemoveLine",
    "accounts/<str:id>/payments": "AcceptPayment",
    "shifts/open": "OpenShift",
    "shifts/<str:id>/close": "CloseShift",
    "expenses": "AddExpense",
    "catalog/products": "SaveProduct",
    "inventory/receipts": "ReceiveBatch",
    "inventory/adjustments": "AdjustStock",
    "club/tariffs": "SaveTariff",
    "club/booths": "SaveBooth",
    "settings/payment-methods": "SaveMethod",
}
urlpatterns = [
    path("health", health),
    path("ready", ready),
    path("api/v1/auth/csrf", CsrfView.as_view()),
    path("api/v1/auth/login", LoginView.as_view()),
    path("api/v1/auth/logout", LogoutView.as_view()),
    path("api/v1/workspace", WorkspaceView.as_view()),
    path("api/v1/reports", ReportView.as_view()),
    path("api/v1/schema", SchemaView.as_view()),
    path("api/v1/access/users", EmployeeView.as_view()),
    path("api/v1/settings/review-links", ReviewView.as_view()),
    path("api/v1/settings/review-links/<str:id>/qr", ReviewQrView.as_view()),
    path("api/v1/accounts/<str:id>", AccountDetailView.as_view()),
    *[
        path(
            "api/v1/" + route,
            HistoryView.as_view(
                resource=resource,
                operation=COMMAND_ROUTES.get(route),
                http_method_names=["get", "post", "head", "options"]
                if route in COMMAND_ROUTES
                else ["get", "head", "options"],
            ),
        )
        for route, resource in {
            "accounts": "accounts",
            "shifts": "shifts",
            "payments": "payments",
            "expenses": "expenses",
            "audit": "audit",
            "refunds": "refunds",
            "inventory/batches": "batches",
            "transfers": "transfers",
        }.items()
    ],
    *[
        path("api/v1/" + route, CommandView.as_view(operation=operation))
        for route, operation in COMMAND_ROUTES.items()
        if route
        not in ("access/users", "settings/review-links", "accounts", "expenses")
    ],
]
