from django.core.validators import URLValidator
from rest_framework.exceptions import ValidationError
from django.core.exceptions import ValidationError as URLValidationError
from apps.core.rules import management, require, audit, snapshot
from apps.club.models import ReviewLink


def save_review(actor, data):
    management(actor)
    values = data["review"]
    try:
        URLValidator(schemes=["https"])(values["url"])
    except URLValidationError:
        raise ValidationError("Review link must be an absolute HTTPS URL")
    obj = (
        ReviewLink.objects.select_for_update().get(pk=values["id"])
        if values["id"]
        else None
    )
    require(
        data["expectedVersion"] == (obj.version if obj else 0),
        "Stale review link version",
    )
    require(
        data["reason"].strip() and values["name"].strip(),
        "Name and change reason required",
    )
    before = snapshot(obj)
    if obj is None:
        obj = ReviewLink()
    else:
        obj.version += 1
    obj.name, obj.url, obj.enabled = (
        values["name"].strip(),
        values["url"],
        values["enabled"],
    )
    obj.save()
    audit(actor, obj, "SaveReview", before, data["reason"])
    return obj


def review_dto(obj):
    return dict(
        id=str(obj.pk),
        name=obj.name,
        url=obj.url,
        enabled=obj.enabled,
        version=obj.version,
    )
