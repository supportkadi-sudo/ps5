from django.db import connection, DatabaseError
from django.db.migrations.executor import MigrationExecutor
from django.http import JsonResponse
from rest_framework.views import APIView
from rest_framework.response import Response
from apps.core.commands import execute
from apps.api.contract import CONTRACT
from apps.api.read_models import workspace
from apps.api.reads import consistent_read


class CommandView(APIView):
    operation = None

    def post(self, request, id=""):
        return Response(
            execute(
                request.user,
                request.headers.get("Idempotency-Key"),
                self.operation,
                id,
                request.data,
            )
        )


class WorkspaceView(APIView):
    def get(self, request):
        with consistent_read():
            return Response(workspace(request.user))


class SchemaView(APIView):
    def get(self, request):
        return Response(CONTRACT)


def health(request):
    return JsonResponse({"status": "ok"})


def ready(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        executor = MigrationExecutor(connection)
        if executor.migration_plan(executor.loader.graph.leaf_nodes()):
            return JsonResponse({"status": "not_ready"}, status=503)
    except DatabaseError:
        return JsonResponse({"status": "not_ready"}, status=503)
    return JsonResponse({"status": "ready"})


class ReportView(APIView):
    def get(self, request):
        from apps.core.rules import management
        from apps.reports.services import period, report

        management(request.user)
        start, end = period(
            request.query_params.get("from"), request.query_params.get("to")
        )
        with consistent_read():
            return Response(report(start, end))
