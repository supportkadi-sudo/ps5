import { CommandRejected } from "./errors";
import { assertSchema, assertPeriod } from "./validation";
import type { ClubApi, Command, Schema, Workspace, User } from "./types";
import type { paths } from "./schema";
// Same-origin sessions; no financial browser database or mock fallback.
export class HttpApi implements ClubApi {
  private csrf = "";
  constructor(private baseUrl = "") {}
  async request<T>(
    path: string,
    init: RequestInit = {},
    schema?: keyof Schema,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        ...init,
        credentials: "include",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": this.csrf,
          ...init.headers,
        },
      });
    } catch {
      throw Error(
        "Нет связи с сервером или истекло время ожидания. Проверьте результат и повторите исходную команду.",
      );
    }
    if (response.status === 204 && response.ok && !schema)
      return undefined as T;
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
      if ([400, 401, 403, 404, 405, 422].includes(response.status)) {
        assertSchema("Error", body);
        throw new CommandRejected(
          ([401, 403].includes(response.status)
            ? "Нет доступа: проверьте вход и права сотрудника. "
            : "Запрос отклонён: ") + message,
        );
      }
      const prefix =
        response.status === 409
          ? "Конфликт: данные изменились или команда требует сверки. "
          : "";
      throw Error(prefix + message);
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
    const w = await this.request<Workspace>(
      "/api/v1/workspace",
      {},
      "Workspace",
    );
    const actor = w.users[0];
    if (actor && actor.role !== "cashier") {
      w.users = (
        await this.request<Schema["EmployeeList"]>(
          "/api/v1/access/users",
          {},
          "EmployeeList",
        )
      ).items;
      if (!w.users.some((u) => u.id === actor.id)) w.users.push(actor);
      w.reviews = (
        await this.request<Schema["ReviewList"]>(
          "/api/v1/settings/review-links",
          {},
          "ReviewList",
        )
      ).items;
    }
    return w;
  }
  async getReport(from: string, to: string) {
    assertPeriod(from, to);
    return this.request<Schema["Report"]>(
      "/api/v1/reports?" + new URLSearchParams({ from, to }),
      {},
      "Report",
    );
  }
  async employee(data: Schema["SaveEmployee"], key: string) {
    return this.request<Schema["CommandResult"]>(
      "/api/v1/access/users",
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(data),
      },
      "CommandResult",
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
      ExpectTransfer: "/api/v1/accounts/{id}/expect-transfer",
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
    const ack = await this.request<Schema["CommandResult"]>(
      routes[c.name].replace("{id}", encodeURIComponent(c.entityId ?? "")),
      {
        method: "POST",
        headers: { "Idempotency-Key": c.key },
        body: JSON.stringify(c.data),
      },
      "CommandResult",
    );
    if (ack.operation !== c.name || (c.entityId && ack.entityId !== c.entityId))
      throw Error("Ответ не соответствует исходной команде. Требуется сверка.");
    try {
      return await this.load();
    } catch {
      throw Error(
        "Команда принята, но обновление данных не удалось. Повторите исходную команду для сверки.",
      );
    }
  }
}
