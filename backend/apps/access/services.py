from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import connection
from rest_framework.exceptions import PermissionDenied, ValidationError
from django.core.exceptions import ValidationError as PasswordError
from apps.core.rules import require, audit
from apps.shifts.models import Shift


def user_dto(user):
    return dict(
        id=str(user.pk),
        name=(user.get_full_name() or user.username)[:150],
        role=user.role,
        username=user.username,
        isActive=user.is_active,
        version=user.version,
    )


def admin_actor(actor):
    # One lock serializes role/owner changes including the absent-user create case.
    with connection.cursor() as c:
        c.execute("SELECT pg_advisory_xact_lock(71001)")
    actor = (
        get_user_model().objects.select_for_update().get(pk=actor.pk, is_active=True)
    )
    if actor.role not in ("owner", "manager"):
        raise PermissionDenied("Employee administration requires management")
    return actor


def target_for(actor, user_id):
    target = get_user_model().objects.select_for_update().get(pk=user_id)
    if actor.role == "manager" and target.role != "cashier":
        raise PermissionDenied("Managers can administer cashiers only")
    return target


def set_password(user, password):
    try:
        validate_password(password, user)
    except PasswordError:
        raise ValidationError("Password does not meet password policy")
    user.set_password(password)


def save_employee(actor, data):
    actor = admin_actor(actor)
    values = data["user"]
    creating = values["id"] == ""
    target = (
        get_user_model()(username=data.get("username", ""))
        if creating
        else target_for(actor, values["id"])
    )
    if actor.role == "manager" and values["role"] != "cashier":
        raise PermissionDenied("Managers cannot grant management roles")
    require(
        data["expectedVersion"] == (0 if creating else target.version),
        "Stale employee version",
    )
    require(data["reason"].strip(), "Employee change reason required")
    before = {} if creating else user_dto(target)
    if not creating:
        require(
            not (
                target.is_active
                and target.role == "owner"
                and (not values["isActive"] or values["role"] != "owner")
                and get_user_model()
                .objects.filter(role="owner", is_active=True)
                .count()
                == 1
            ),
            "Cannot remove the last active owner",
        )
        if not values["isActive"]:
            require(
                not Shift.objects.filter(
                    cashier=target, closed_at__isnull=True
                ).exists(),
                "Close employee shift before disabling",
            )
        require(
            "password" not in data and "username" not in data,
            "Use password command; usernames are immutable",
        )
    target.first_name = values["name"].strip()
    target.last_name = ""
    target.role = values["role"]
    target.is_active = values["isActive"]
    if creating:
        require(
            target.username.strip() and "password" in data,
            "Username and initial password required",
        )
        target.full_clean(exclude=["password"])
        set_password(target, data["password"])
    else:
        target.version += 1
    target.save()
    audit(actor, target, "SaveUser", before, data["reason"], after=user_dto(target))
    return target


def reset_password(actor, user_id, data):
    actor = admin_actor(actor)
    target = target_for(actor, user_id)
    require(target.version == data["expectedVersion"], "Stale employee version")
    require(data["reason"].strip(), "Password reset reason required")
    before = user_dto(target)
    set_password(target, data["password"])
    target.version += 1
    target.save(update_fields=["password", "version"])
    audit(
        actor, target, "ResetPassword", before, data["reason"], after=user_dto(target)
    )
    return target


def change_password(actor, data):
    # Uses the same administrative lock ordering; never logs either password/hash.
    with connection.cursor() as c:
        c.execute("SELECT pg_advisory_xact_lock(71001)")
    target = (
        get_user_model().objects.select_for_update().get(pk=actor.pk, is_active=True)
    )
    require(target.version == data["expectedVersion"], "Stale employee version")
    if not target.check_password(data["oldPassword"]):
        raise PermissionDenied("Current password is incorrect")
    require(data["reason"].strip(), "Password change reason required")
    before = user_dto(target)
    set_password(target, data["newPassword"])
    target.version += 1
    target.save(update_fields=["password", "version"])
    audit(
        target, target, "ChangePassword", before, data["reason"], after=user_dto(target)
    )
    return target
