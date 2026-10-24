import { expect, it } from "vitest";
import { resolveTheme } from "./theme";
it("uses explicit theme preferences before the system fallback", () => {
  expect(resolveTheme("dark", false)).toBe("dark");
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme(null, true)).toBe("dark");
  expect(resolveTheme("invalid", false)).toBe("light");
});
