from django.core.exceptions import (
    ObjectDoesNotExist,
    ValidationError as DjangoValidationError,
)
from django.db import IntegrityError
from rest_framework.views import exception_handler as drf_handler
from rest_framework.response import Response


def exception_handler(exc, context):
    if isinstance(exc, ObjectDoesNotExist):
        return Response(
            {"code": "not_found", "message": "Object not found", "fieldErrors": {}},
            status=404,
        )
    if isinstance(exc, (DjangoValidationError, ValueError)):
        return Response(
            {
                "code": "invalid_request",
                "message": "Invalid identifier or value",
                "fieldErrors": {},
            },
            status=400,
        )
    if isinstance(exc, IntegrityError):
        return Response(
            {
                "code": "conflict",
                "message": "Concurrent operation or database constraint conflict",
                "fieldErrors": {},
            },
            status=409,
        )
    response = drf_handler(exc, context)
    if response is not None:
        response.data = {
            "code": str(getattr(exc, "default_code", "request_error")),
            "message": str(getattr(exc, "detail", exc)),
            "fieldErrors": {},
        }
    return response


def csrf_failure(request, reason=""):
    from django.http import JsonResponse

    return JsonResponse(
        {
            "code": "csrf_failed",
            "message": "CSRF verification failed",
            "fieldErrors": {},
        },
        status=403,
    )
