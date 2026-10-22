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

COMMAND_ROUTES = {
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
    *[
        path("api/v1/" + route, CommandView.as_view(operation=operation))
        for route, operation in COMMAND_ROUTES.items()
    ],
]
