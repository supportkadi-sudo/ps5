from django.contrib.auth import get_user_model
from django.http import HttpResponse
from rest_framework.views import APIView
from rest_framework.response import Response
from apps.api.views import CommandView
from apps.core.rules import management
from apps.access.services import user_dto
from apps.club.models import ReviewLink
from apps.club.reviews import review_dto
from rest_framework.exceptions import ValidationError


class EmployeeView(CommandView):
    operation = "SaveUser"

    def get(self, request):
        management(request.user)
        users = get_user_model().objects.order_by("id")
        if request.user.role == "manager":
            users = users.filter(role="cashier")
        return Response({"items": [user_dto(u) for u in users]})


class ReviewView(CommandView):
    operation = "SaveReview"

    def get(self, request):
        management(request.user)
        return Response(
            {"items": [review_dto(r) for r in ReviewLink.objects.order_by("id")]}
        )


class ReviewQrView(APIView):
    def get(self, request, id):
        import io
        import qrcode
        from qrcode.image.svg import SvgPathImage

        management(request.user)
        obj = ReviewLink.objects.get(pk=id, enabled=True)
        stream = io.BytesIO()
        try:
            qrcode.make(obj.url, image_factory=SvgPathImage).save(stream)
        except (qrcode.exceptions.DataOverflowError, ValueError):
            raise ValidationError("Review URL exceeds QR byte capacity")
        response = HttpResponse(stream.getvalue(), content_type="image/svg+xml")
        response["Content-Disposition"] = f'inline; filename="review-{obj.pk}.svg"'
        response["Content-Security-Policy"] = (
            "default-src 'none'; style-src 'unsafe-inline'"
        )
        response["Cache-Control"] = "no-store"
        return response
