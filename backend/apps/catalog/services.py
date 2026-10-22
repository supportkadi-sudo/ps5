from apps.core.rules import management, require, snapshot, audit
from apps.catalog.models import Product, PaymentMethod
from apps.club.models import Booth, Tariff
from apps.inventory.models import Batch, StockMovement
from django.utils import timezone

CONFIG = {
    "SaveProduct": (
        Product,
        "product",
        {
            "name": "name",
            "category": "category",
            "salePrice": "sale_price",
            "defaultCost": "default_cost",
            "enabled": "enabled",
        },
    ),
    "SaveTariff": (Tariff, "tariff", {"name": "name", "hourlyRate": "hourly_rate"}),
    "SaveBooth": (
        Booth,
        "booth",
        {
            "name": "name",
            "console": "console",
            "tariffId": "tariff_id",
            "enabled": "enabled",
        },
    ),
    "SaveMethod": (
        PaymentMethod,
        "method",
        {"name": "name", "kind": "kind", "enabled": "enabled"},
    ),
}


def configure(actor, operation, data):
    management(actor)
    model, key, fields = CONFIG[operation]
    values = data[key]
    obj = (
        model.objects.select_for_update().get(pk=values["id"]) if values["id"] else None
    )
    before = snapshot(obj)
    # Method kind has financial meaning. Existing entries snapshot it, but changing it
    # would make the UI misleading; disable and create a new method instead.
    if obj and model is PaymentMethod:
        require(obj.kind == values["kind"], "Create a new method to change kind")
    attrs = {target: values[source] for source, target in fields.items()}
    if model is Booth:
        BoothTariff = Tariff.objects.select_for_update().get(pk=attrs["tariff_id"])
        attrs["tariff_id"] = BoothTariff.pk
    if obj is None:
        obj = model.objects.create(**attrs)
    else:
        for field, value in attrs.items():
            setattr(obj, field, value)
        obj.save()
    audit(actor, obj, operation, before)
    return obj


def receive(actor, data):
    management(actor)
    product = Product.objects.select_for_update().get(pk=data["productId"])
    batch = Batch.objects.create(
        product=product,
        received_at=timezone.now(),
        quantity=data["quantity"],
        remaining=data["quantity"],
        unit_cost=data["unitCost"],
    )
    StockMovement.objects.create(batch=batch, delta=batch.quantity, reason="receipt")
    audit(actor, batch, "ReceiveBatch", {})
    return batch


def adjust(actor, data):
    management(actor)
    batch = Batch.objects.get(pk=data["batchId"])
    Product.objects.select_for_update().get(pk=batch.product_id)
    batch = Batch.objects.select_for_update().get(pk=batch.pk)
    require(data["reason"].strip(), "Stock adjustment reason required")
    require(data["remaining"] <= batch.remaining, "Increases require a receipt")
    before = snapshot(batch)
    delta = data["remaining"] - batch.remaining
    batch.remaining = data["remaining"]
    batch.save(update_fields=["remaining"])
    StockMovement.objects.create(batch=batch, delta=delta, reason=data["reason"])
    audit(actor, batch, "AdjustStock", before, data["reason"])
    return batch
