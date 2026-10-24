import { expect, it } from "vitest";
import { dayKey, duration, periodDates, timeLabel } from "./history-format";
it("uses Tashkent dates and labels sessions crossing midnight", () => {
  expect(dayKey("2026-10-23T19:01:00Z")).toBe("2026-10-24");
  expect(periodDates("today", new Date("2026-10-23T19:01:00Z"))).toEqual({
    from: "2026-10-24",
    to: "2026-10-24",
  });
  expect(periodDates("yesterday", new Date("2026-10-23T19:01:00Z"))).toEqual({
    from: "2026-10-23",
    to: "2026-10-23",
  });
  expect(periodDates("all")).toEqual({ from: "", to: "" });
  expect(timeLabel("2026-10-23T18:30:00Z", "2026-10-23T18:00:00Z")).toBe(
    "23:30",
  );
  expect(timeLabel("2026-10-23T20:30:00Z", "2026-10-23T18:00:00Z")).toContain(
    "24 октября",
  );
  expect(duration(135)).toBe("2 ч 15 мин");
});
