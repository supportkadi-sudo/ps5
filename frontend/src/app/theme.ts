export type Theme = "light" | "dark";
const key = "playroom-theme";
export function resolveTheme(
  saved: string | null,
  prefersDark: boolean,
): Theme {
  return saved === "light" || saved === "dark"
    ? saved
    : prefersDark
      ? "dark"
      : "light";
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#10151f" : "#ffffff");
}
export function initializeTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(key);
  } catch {
    /* Browser storage may be disabled; the theme still works for this session. */
  }
  applyTheme(
    resolveTheme(
      saved,
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    ),
  );
}
export function saveTheme(theme: Theme) {
  applyTheme(theme);
  try {
    localStorage.setItem(key, theme);
  } catch {
    /* Keep the selected theme in this session when storage is unavailable. */
  }
}
