from django.contrib.auth import authenticate, login, logout
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import AuthenticationFailed
from apps.api.contract import validate
from apps.access.rate_limit import reserve, release_success
from apps.access.services import user_dto


class CsrfView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        validate("LoginRequest", request.data)
        tokens = reserve(
            request.data["username"], request.META.get("REMOTE_ADDR", "unknown")
        )
        user = authenticate(request, **request.data)
        if user is None:
            raise AuthenticationFailed("Invalid credentials")
        release_success(tokens)
        login(request, user)
        return Response(
            {
                "user": user_dto(user),
                "csrfToken": get_token(request),
            }
        )


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response(status=204)
