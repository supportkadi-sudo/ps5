from django.core import signing
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import ValidationError


def page(queryset, field, actor, kind, params, filters, project):
    try:
        limit = int(params.get("limit", "50"))
    except (TypeError, ValueError):
        raise ValidationError("Invalid page limit")
    if not 1 <= limit <= 100:
        raise ValidationError("Page limit must be between 1 and 100")
    scope = dict(kind=kind, actor=str(actor.pk), role=actor.role, filters=filters)
    cursor = params.get("cursor")
    ceiling = timezone.now()
    if cursor:
        try:
            token = signing.loads(cursor, salt="club-history-v1", max_age=86400)
            if token["scope"] != scope:
                raise ValueError()
            ceiling = parse_datetime(token["ceiling"])
            at = parse_datetime(token["after"][0])
            pk = token["after"][1]
            if not ceiling or not at:
                raise ValueError()
        except (signing.BadSignature, KeyError, TypeError, ValueError):
            raise ValidationError("Invalid, expired or differently scoped cursor")
        queryset = queryset.filter(
            Q(**{field + "__lt": at}) | Q(**{field: at, "pk__lt": pk})
        )
    queryset = queryset.filter(**{field + "__lte": ceiling}).order_by(
        "-" + field, "-pk"
    )
    objects = list(queryset[: limit + 1])
    selected = objects[:limit]
    next_cursor = None
    if len(objects) > limit:
        last = selected[-1]
        next_cursor = signing.dumps(
            dict(
                scope=scope,
                ceiling=ceiling.isoformat(),
                after=[getattr(last, field).isoformat(), str(last.pk)],
            ),
            salt="club-history-v1",
            compress=True,
        )
    return dict(items=[project(obj) for obj in selected], nextCursor=next_cursor)
