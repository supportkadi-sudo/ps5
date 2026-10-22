import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "rest_framework",
    *[
        "apps." + name
        for name in (
            "access",
            "club",
            "catalog",
            "inventory",
            "accounts",
            "payments",
            "shifts",
            "audit",
            "core",
        )
    ],
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB", "club"),
        "USER": os.getenv("POSTGRES_USER", "club"),
        "PASSWORD": os.environ["POSTGRES_PASSWORD"],
        "HOST": os.getenv("POSTGRES_HOST", "db"),
        "PORT": os.getenv("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 0,
    }
}
AUTH_USER_MODEL = "access.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation." + name}
    for name in (
        "UserAttributeSimilarityValidator",
        "MinimumLengthValidator",
        "CommonPasswordValidator",
        "NumericPasswordValidator",
    )
]
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication"
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "EXCEPTION_HANDLER": "apps.api.errors.exception_handler",
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}
TIME_ZONE = "Asia/Tashkent"
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_TRUSTED_ORIGINS = (
    os.getenv("CSRF_TRUSTED_ORIGINS", "").split(",")
    if os.getenv("CSRF_TRUSTED_ORIGINS")
    else []
)
SECURE_CONTENT_TYPE_NOSNIFF = True
APPEND_SLASH = False
CSRF_FAILURE_VIEW = "apps.api.errors.csrf_failure"

LOGIN_RATE_LIMIT = int(os.getenv("LOGIN_RATE_LIMIT", "5"))
LOGIN_RATE_WINDOW_SECONDS = int(os.getenv("LOGIN_RATE_WINDOW_SECONDS", "300"))
COMMAND_HASH_KEY = os.getenv("COMMAND_HASH_KEY", SECRET_KEY)
if not DEBUG and (len(SECRET_KEY) < 32 or SECRET_KEY.startswith("replace-with")):
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured(
        "Production requires a random DJANGO_SECRET_KEY of at least 32 characters"
    )
if not DEBUG and ("*" in ALLOWED_HOSTS or not all(ALLOWED_HOSTS)):
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured("Production requires explicit ALLOWED_HOSTS")
if LOGIN_RATE_LIMIT < 1 or LOGIN_RATE_WINDOW_SECONDS < 1:
    raise ValueError("Login rate limits must be positive")
SECURE_SSL_REDIRECT = os.getenv("SECURE_SSL_REDIRECT", "0") == "1"

# Independent club credentials; empty configuration fails closed.
P2P_WEBHOOK_SECRET = os.getenv("P2P_WEBHOOK_SECRET", "")
P2P_BOT_TOKEN = os.getenv("P2P_BOT_TOKEN", "")
P2P_BACKEND_URL = os.getenv("P2P_BACKEND_URL", "http://127.0.0.1:8000")


def _sender_ids(value):
    tokens = [x.strip() for x in value.split(",") if x.strip()]
    if any(not x.isascii() or not x.isdecimal() or int(x) <= 0 for x in tokens):
        raise ValueError("P2P sender allowlists require positive numeric IDs")
    return frozenset(map(int, tokens))


P2P_SOURCES = {
    source: {
        "sender_ids": _sender_ids(os.getenv(f"P2P_{source.upper()}_SENDER_IDS", "")),
        "connection_id": os.getenv(
            f"P2P_{source.upper()}_BUSINESS_CONNECTION_ID", ""
        ).strip(),
    }
    for source in ("uzcard", "humo")
}
if P2P_SOURCES["uzcard"]["sender_ids"] & P2P_SOURCES["humo"]["sender_ids"]:
    raise ValueError("Uzcard and Humo sender allowlists must be independent")
