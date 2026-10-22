from getpass import getpass
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError


class Command(BaseCommand):
    help = "Provision a personal employee; password is prompted, never passed in argv."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument(
            "--role", required=True, choices=["owner", "manager", "cashier"]
        )

    def handle(self, username, role, **options):
        user = get_user_model()(username=username, role=role)
        password = getpass("Password: ")
        if password != getpass("Repeat password: "):
            raise CommandError("Passwords differ")
        try:
            validate_password(password, user)
        except ValidationError as exc:
            raise CommandError("; ".join(exc.messages))
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS("Employee created"))
