import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from zoneinfo import ZoneInfo

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import KeyboardButton, Message, ReplyKeyboardMarkup, ReplyKeyboardRemove
from dotenv import load_dotenv
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Numeric, String, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("club_bot")

TOKEN = os.getenv("BOT_TOKEN", "").strip()
ADMIN_IDS = {int(value.strip()) for value in os.getenv("ADMIN_IDS", "").split(",") if value.strip().isdigit()}
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://club:club_password@localhost:5432/club_crm")
LOCAL_TZ = ZoneInfo("Asia/Tashkent")

if not TOKEN:
    raise RuntimeError("Set BOT_TOKEN in .env")
if not ADMIN_IDS:
    raise RuntimeError("Set at least one Telegram user ID in ADMIN_IDS")

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
DB = async_sessionmaker(engine, expire_on_commit=False)
router = Router()


class Base(DeclarativeBase):
    pass


class Booth(Base):
    __tablename__ = "booths"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Visit(Base):
    __tablename__ = "visits"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booth_id: Mapped[int] = mapped_column(ForeignKey("booths.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ProductSale(Base):
    __tablename__ = "product_sales"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Entry(StatesGroup):
    booth_name = State()
    booth_rate = State()
    backdated_start = State()
    product_name = State()
    product_price = State()
    sell_product = State()
    sell_quantity = State()


def is_admin(message: Message) -> bool:
    return bool(message.from_user and message.from_user.id in ADMIN_IDS)


def menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🕹 Кабинки"), KeyboardButton(text="🛒 Товары")],
            [KeyboardButton(text="➕ Добавить кабинку"), KeyboardButton(text="➕ Добавить товар")],
            [KeyboardButton(text="🧾 Продать товар"), KeyboardButton(text="📊 Отчёт за сегодня")],
        ],
        resize_keyboard=True,
    )


def money(value: Decimal | int | float) -> str:
    return f"{Decimal(value):,.0f}".replace(",", " ") + " сум"


def local_time(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(LOCAL_TZ).strftime("%H:%M")


async def get_open_visit(db, booth_id: int):
    result = await db.execute(select(Visit).where(Visit.booth_id == booth_id, Visit.ended_at.is_(None)))
    return result.scalar_one_or_none()


@router.message(CommandStart())
async def start(message: Message):
    if not is_admin(message):
        await message.answer("Этот бот доступен только сотрудникам клуба.")
        return
    await message.answer("Панель управления клубом. Выберите действие:", reply_markup=menu())


@router.message(Command("cancel"))
async def cancel(message: Message, state: FSMContext):
    await state.clear()
    if is_admin(message):
        await message.answer("Действие отменено.", reply_markup=menu())


@router.message(F.text == "➕ Добавить кабинку")
async def add_booth_start(message: Message, state: FSMContext):
    if not is_admin(message):
        return
    await state.set_state(Entry.booth_name)
    await message.answer("Введите название кабинки (например, PS5-1). Для отмены: /cancel")


@router.message(Entry.booth_name)
async def add_booth_name(message: Message, state: FSMContext):
    if not is_admin(message):
        return
    name = (message.text or "").strip()
    if not name or len(name) > 80:
        await message.answer("Название должно быть от 1 до 80 символов. Попробуйте ещё раз.")
        return
    await state.update_data(booth_name=name)
    await state.set_state(Entry.booth_rate)
    await message.answer("Введите стоимость за час в сумах, например 40000.")


@router.message(Entry.booth_rate)
async def add_booth_rate(message: Message, state: FSMContext):
    if not is_admin(message):
        return
    try:
        rate = Decimal((message.text or "").replace(" ", "").replace(",", "."))
        if rate <= 0:
            raise InvalidOperation
    except (InvalidOperation, ValueError):
        await message.answer("Нужна положительная сумма. Например: 40000")
        return
    data = await state.get_data()
    async with DB() as db:
        exists = (await db.execute(select(Booth).where(func.lower(Booth.name) == data["booth_name"].lower()))).scalar_one_or_none()
        if exists:
            await message.answer("Кабинка с таким названием уже есть.")
            return
        db.add(Booth(name=data["booth_name"], hourly_rate=rate))
        await db.commit()
    await state.clear()
    await message.answer(f"Кабинка «{data['booth_name']}» добавлена. Тариф: {money(rate)}/час.", reply_markup=menu())


@router.message(F.text == "🕹 Кабинки")
async def booths(message: Message):
    if not is_admin(message):
        return
    async with DB() as db:
        items = (await db.execute(select(Booth).where(Booth.active.is_(True)).order_by(Booth.id))).scalars().all()
        if not items:
            await message.answer("Кабинок пока нет. Добавьте первую кнопкой «➕ Добавить кабинку».")
            return
        lines = ["🕹 Кабинки:"]
        for booth in items:
            visit = await get_open_visit(db, booth.id)
            if visit:
                elapsed = datetime.now(timezone.utc) - visit.started_at.replace(tzinfo=timezone.utc) if visit.started_at.tzinfo is None else datetime.now(timezone.utc) - visit.started_at
                mins = max(0, int(elapsed.total_seconds() // 60))
                hours, minutes = divmod(mins, 60)
                lines.append(f"\n🔴 {booth.name} — занята с {local_time(visit.started_at)} ({hours} ч {minutes} мин)\nТариф: {money(booth.hourly_rate)}/час\nОстановить: /stop_{booth.id}")
            else:
                lines.append(
                    f"\n🟢 {booth.name} — свободна, {money(booth.hourly_rate)}/час"
                    f"\nНачать сейчас: /start_{booth.id}"
                    f"\nНачать задним числом: /startback_{booth.id}"
                )
    await message.answer("\n".join(lines))


@router.message(F.text.regexp(r"^/start_\d+$"))
async def start_visit(message: Message):
    if not is_admin(message):
        return
    booth_id = int(message.text.split("_", 1)[1])
    async with DB() as db:
        booth = await db.get(Booth, booth_id)
        if not booth or not booth.active:
            await message.answer("Кабинка не найдена.")
            return
        if await get_open_visit(db, booth_id):
            await message.answer("Эта кабинка уже занята.")
            return
        visit = Visit(booth_id=booth_id, started_at=datetime.now(timezone.utc))
        db.add(visit)
        await db.commit()
    await message.answer(f"Сеанс на кабинке «{booth.name}» начат в {local_time(visit.started_at)}.")


@router.message(F.text.regexp(r"^/startback_\d+$"))
async def start_visit_backdated(message: Message, state: FSMContext):
    if not is_admin(message):
        return
    booth_id = int(message.text.split("_", 1)[1])
    async with DB() as db:
        booth = await db.get(Booth, booth_id)
        if not booth or not booth.active:
            await message.answer("Кабинка не найдена.")
            return
        if await get_open_visit(db, booth_id):
            await message.answer("На этой кабинке уже идёт сеанс. Сначала завершите его.")
            return
    await state.update_data(backdated_booth_id=booth_id)
    await state.set_state(Entry.backdated_start)
    await message.answer(
        f"Введите время начала сеанса для «{booth.name}».\n"
        "Форматы: ЧЧ:ММ (сегодня) или ДД.ММ.ГГГГ ЧЧ:ММ.\n"
        "Например: 20:25 или 21.10.2026 20:25. Для отмены: /cancel"
    )


@router.message(Entry.backdated_start)
async def confirm_backdated_start(message: Message, state: FSMContext):
    if not is_admin(message):
        return
    text = (message.text or "").strip()
    try:
        if len(text) == 5:
            started_local = datetime.strptime(text, "%H:%M").replace(
                year=datetime.now(LOCAL_TZ).year,
                month=datetime.now(LOCAL_TZ).month,
                day=datetime.now(LOCAL_TZ).day,
                tzinfo=LOCAL_TZ,
            )
        else:
            started_local = datetime.strptime(text, "%d.%m.%Y %H:%M").replace(tzinfo=LOCAL_TZ)
    except ValueError:
        await message.answer("Не распознал время. Введите ЧЧ:ММ или ДД.ММ.ГГГГ ЧЧ:ММ.")
        return

    now_local = datetime.now(LOCAL_TZ)
    if started_local >= now_local:
        await message.answer("Время начала должно быть в прошлом. Введите время ещё раз.")
        return

    data = await state.get_data()
    booth_id = data["backdated_booth_id"]
    async with DB() as db:
        booth = await db.get(Booth, booth_id)
        if not booth or not booth.active:
            await state.clear()
            await message.answer("Кабинка не найдена или отключена.", reply_markup=menu())
            return
        if await get_open_visit(db, booth_id):
            await state.clear()
            await message.answer("На этой кабинке уже идёт сеанс. Задний запуск отменён.", reply_markup=menu())
            return
        visit = Visit(booth_id=booth_id, started_at=started_local.astimezone(timezone.utc))
        db.add(visit)
        await db.commit()

    await state.clear()
    await message.answer(
        f"Сеанс на кабинке «{booth.name}» записан с {started_local.strftime('%d.%m.%Y %H:%M')} "
        "(время Ташкента).",
        reply_markup=menu(),
    )


@router.message(F.text.regexp(r"^/stop_\d+$"))
async def stop_visit(message: Message):
    if not is_admin(message):
        return
    booth_id = int(message.text.split("_", 1)[1])
    async with DB() as db:
        booth = await db.get(Booth, booth_id)
        visit = await get_open_visit(db, booth_id)
        if not booth or not visit:
            await message.answer("Активный сеанс не найден.")
            return
        now = datetime.now(timezone.utc)
        started = visit.started_at.replace(tzinfo=timezone.utc) if visit.started_at.tzinfo is None else visit.started_at
        seconds = max(1, int((now - started).total_seconds()))
        billed_hours = max(1, int((Decimal(seconds) / Decimal(3600)).quantize(Decimal("1"), rounding=ROUND_CEILING)))
        visit.ended_at = now
        visit.amount = booth.hourly_rate * billed_hours
        await db.commit()
    await message.answer(
        f"Сеанс на «{booth.name}» завершён.\nНачало: {local_time(visit.started_at)} · конец: {local_time(now)}\n"
        f"К оплате: {money(visit.amount)} ({billed_hours} ч по тарифу, округление вверх)."
    )


@router.message(F.text == "➕ Добавить товар")
async def add_product_start(message: Message, state: FSMContext):
    if not is_admin(message):
        return
    await state.set_state(Entry.product_name)
    await message.answer("Введите название товара (например, Coca-Cola). Для отмены: /cancel")


@router.message(Entry.product_name)
async def add_product_name(message: Message, state: FSMContext):
    if not is_admin(message):
        return
    name = (message.text or "").strip()
    if not name or len(name) > 100:
        await message.answer("Название должно быть от 1 до 100 символов.")
        return
    await state.update_data(product_name=name)
    await state.set_state(Entry.product_price)
    await message.answer("Введите цену в сумах, например 12000.")


@router.message(Entry.product_price)
async def add_product_price(message: Message, state: FSMContext):
    if not is_admin(message):
        return
    try:
        price = Decimal((message.text or "").replace(" ", "").replace(",", "."))
        if price <= 0:
            raise InvalidOperation
    except (InvalidOperation, ValueError):
        await message.answer("Нужна положительная сумма. Например: 12000")
        return
    data = await state.get_data()
    async with DB() as db:
        exists = (await db.execute(select(Product).where(func.lower(Product.name) == data["product_name"].lower()))).scalar_one_or_none()
        if exists:
            await message.answer("Товар с таким названием уже есть.")
            return
        db.add(Product(name=data["product_name"], price=price))
        await db.commit()
    await state.clear()
    await message.answer(f"Товар «{data['product_name']}» добавлен: {money(price)}.", reply_markup=menu())


@router.message(F.text == "🛒 Товары")
async def products(message: Message):
    if not is_admin(message):
        return
    async with DB() as db:
        items = (await db.execute(select(Product).where(Product.active.is_(True)).order_by(Product.id))).scalars().all()
    if not items:
        await message.answer("Товаров пока нет. Добавьте первый товар кнопкой «➕ Добавить товар».")
        return
    await message.answer("🛒 Товары:\n" + "\n".join(f"{p.id}. {p.name} — {money(p.price)}" for p in items))


@router.message(F.text == "🧾 Продать товар")
async def sell_start(message: Message, state: FSMContext):
    if not is_admin(message):
        return
    async with DB() as db:
        items = (await db.execute(select(Product).where(Product.active.is_(True)).order_by(Product.id))).scalars().all()
    if not items:
        await message.answer("Сначала добавьте товар.")
        return
    await state.set_state(Entry.sell_product)
    await message.answer("Введите номер товара:\n" + "\n".join(f"{p.id}. {p.name} — {money(p.price)}" for p in items) + "\nДля отмены: /cancel")


@router.message(Entry.sell_product)
async def sell_choose(message: Message, state: FSMContext):
    if not is_admin(message):
        return
    if not (message.text or "").strip().isdigit():
        await message.answer("Введите номер товара из списка.")
        return
    async with DB() as db:
        product = await db.get(Product, int(message.text.strip()))
        if not product or not product.active:
            await message.answer("Активный товар с таким номером не найден.")
            return
        await state.update_data(product_id=product.id, product_name=product.name, product_price=str(product.price))
    await state.set_state(Entry.sell_quantity)
    await message.answer(f"Сколько продано «{product.name}»? Введите количество числом.")


@router.message(Entry.sell_quantity)
async def sell_finish(message: Message, state: FSMContext):
    if not is_admin(message):
        return
    text = (message.text or "").strip()
    if not text.isdigit() or int(text) < 1 or int(text) > 1000:
        await message.answer("Введите количество от 1 до 1000.")
        return
    data = await state.get_data()
    quantity = int(text)
    unit_price = Decimal(data["product_price"])
    async with DB() as db:
        db.add(ProductSale(product_id=data["product_id"], quantity=quantity, unit_price=unit_price))
        await db.commit()
    await state.clear()
    await message.answer(f"Продажа записана: {data['product_name']} × {quantity} = {money(unit_price * quantity)}.", reply_markup=menu())


@router.message(F.text == "📊 Отчёт за сегодня")
async def today_report(message: Message):
    if not is_admin(message):
        return
    now_local = datetime.now(LOCAL_TZ)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = now_local.astimezone(timezone.utc)
    async with DB() as db:
        visit_rows = (await db.execute(select(Visit.amount).where(Visit.ended_at >= start_utc, Visit.ended_at < end_utc, Visit.amount.is_not(None)))).scalars().all()
        sales = (await db.execute(select(ProductSale).where(ProductSale.created_at >= start_utc, ProductSale.created_at < end_utc))).scalars().all()
        open_count = (await db.execute(select(func.count()).select_from(Visit).where(Visit.ended_at.is_(None)))).scalar_one()
    sessions_total = sum((Decimal(x) for x in visit_rows), Decimal(0))
    products_total = sum((Decimal(s.unit_price) * s.quantity for s in sales), Decimal(0))
    await message.answer(
        f"📊 Сегодня, {now_local.strftime('%d.%m.%Y')}\n"
        f"Закрытых сеансов: {len(visit_rows)} — {money(sessions_total)}\n"
        f"Продаж товаров: {sum(s.quantity for s in sales)} шт. — {money(products_total)}\n"
        f"Всего записанной выручки: {money(sessions_total + products_total)}\n"
        f"Сейчас занято кабинок: {open_count}"
    )


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    bot = Bot(TOKEN)
    dp = Dispatcher()
    dp.include_router(router)
    try:
        await dp.start_polling(bot)
    finally:
        await bot.session.close()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
