export const money = (n: number) =>
  new Intl.NumberFormat("ru-RU").format(n) + " сум";
export const date = (s: string) =>
  s
    ? new Date(s).toLocaleString("ru-RU", {
        timeZone: "Asia/Tashkent",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
export const status = {
  draft: "Не запущен",
  playing: "Идёт игра",
  awaiting_payment: "Ожидает оплаты",
  closed: "Закрыт",
  cancelled: "Отменён",
};
export const actionNames: Record<string, string> = {
  CreateAccount: "Создан счёт",
  StartTimer: "Таймер запущен",
  ResumeTimer: "Игра возобновлена",
  Precheck: "Сформирован предчек",
  AddLine: "Добавлен товар",
  RemoveLine: "Удалена позиция",
  AcceptPayment: "Принята оплата",
  CloseAccount: "Счёт закрыт",
  OpenShift: "Открыта смена",
  CloseShift: "Закрыта смена",
  AddExpense: "Записан расход",
  SaveProduct: "Изменён товар",
  ReceiveBatch: "Поступление партии",
  AdjustStock: "Корректировка склада",
  SaveTariff: "Изменён тариф",
  SaveBooth: "Изменена кабинка",
  SaveMethod: "Изменён способ оплаты",
  SaveReview: "Изменена ссылка отзывов",
  SaveUser: "Изменён сотрудник",
};
