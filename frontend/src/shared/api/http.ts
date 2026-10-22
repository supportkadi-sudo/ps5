import { assertSchema, assertPeriod } from "./validation";
import type { ClubApi, Command, Schema, Workspace, User } from "./types";
import type { paths } from "./schema";
// Only adapter changes when Django is available; UI calls the same ClubApi.
export class HttpApi implements ClubApi {
  private csrf = "";
  constructor(private baseUrl = "") {}
  private async request<T>(
    path: string,
    init: RequestInit = {},
    schema?: keyof Schema,
  ): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      ...init,
      credentials: "include",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": this.csrf,
        ...init.headers,
      },
    });
    if (response.status === 204 && response.ok) return undefined as T;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw Error(
        response.ok
          ? "Сервер вернул некорректный ответ. Проверьте результат операции перед повтором."
          : `HTTP ${response.status}: сервер недоступен или вернул некорректный ответ`,
      );
    }
    if (!response.ok) {
      const message =
        body &&
        typeof body === "object" &&
        "message" in body &&
        typeof body.message === "string"
          ? body.message
          : `HTTP ${response.status}`;
      throw Error(message);
    }
    if (schema) assertSchema(schema, body);
    return body as T;
  }

  async login(username: string, password: string): Promise<User> {
    this.csrf = (
      await this.request<Schema["Csrf"]>("/api/v1/auth/csrf", {}, "Csrf")
    ).csrfToken;
    const s = await this.request<Schema["Session"]>(
      "/api/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
        } satisfies Schema["LoginRequest"]),
      },
      "Session",
    );
    this.csrf = s.csrfToken;
    return s.user;
  }
  async logout() {
    await this.request<void>("/api/v1/auth/logout", { method: "POST" });
    this.csrf = "";
  }
  async load() {
    return this.request<Workspace>("/api/v1/workspace", {}, "Workspace");
  }
  async getReport(from: string, to: string) {
    assertPeriod(from, to);
    return this.request<Schema["Report"]>(
      "/api/v1/reports?" + new URLSearchParams({ from, to }),
      {},
      "Report",
    );
  }
  async execute(c: Command) {
    const routes: Record<Command["name"], keyof paths> = {
      CreateAccount: "/api/v1/accounts",
      StartTimer: "/api/v1/accounts/{id}/start",
      Precheck: "/api/v1/accounts/{id}/precheck",
      ResumeTimer: "/api/v1/accounts/{id}/resume",
      CloseAccount: "/api/v1/accounts/{id}/close",
      AddLine: "/api/v1/accounts/{id}/lines",
      RemoveLine: "/api/v1/accounts/{id}/remove-line",
      AcceptPayment: "/api/v1/accounts/{id}/payments",
      OpenShift: "/api/v1/shifts/open",
      CloseShift: "/api/v1/shifts/{id}/close",
      AddExpense: "/api/v1/expenses",
      SaveProduct: "/api/v1/catalog/products",
      ReceiveBatch: "/api/v1/inventory/receipts",
      AdjustStock: "/api/v1/inventory/adjustments",
      SaveTariff: "/api/v1/club/tariffs",
      SaveBooth: "/api/v1/club/booths",
      SaveMethod: "/api/v1/settings/payment-methods",
      SaveReview: "/api/v1/settings/review-links",
      SaveUser: "/api/v1/access/users",
    };
    return this.request<Workspace>(
      routes[c.name].replace("{id}", encodeURIComponent(c.entityId ?? "")),
      {
        method: "POST",
        headers: { "Idempotency-Key": c.key },
        body: JSON.stringify(c.data),
      },
      "Workspace",
    );
  }
}
