const zone = "Asia/Tashkent";
export function dayKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function dayLabel(day: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(day + "T00:00:00+05:00"));
}
export function timeLabel(value: string, createdAt: string) {
  const clock = new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
  return dayKey(value) === dayKey(createdAt)
    ? clock
    : dayLabel(dayKey(value)) + ", " + clock;
}
export function duration(minutes: number) {
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} ч${minutes % 60 ? ` ${minutes % 60} мин` : ""}`
    : `${minutes} мин`;
}
export function periodDates(period: string, now = new Date()) {
  if (period === "all") return { from: "", to: "" };
  const day = dayKey(
    new Date(now.getTime() - (period === "yesterday" ? 86400000 : 0)),
  );
  return { from: day, to: day };
}
