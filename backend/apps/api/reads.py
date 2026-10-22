from contextlib import contextmanager
from django.db import transaction, connection


@contextmanager
def consistent_read():
    # A workspace spans many tables. One MVCC snapshot prevents a response from
    # mixing an old account version with new payments or restored inventory.
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        yield
