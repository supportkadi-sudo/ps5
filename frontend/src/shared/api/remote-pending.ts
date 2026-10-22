import type { HttpApi } from "./http";
import type { Command, CommandName, Schema } from "./types";
import type { PendingCommand } from "./pending";
export class RemotePendingCommands {
  constructor(
    private api: HttpApi,
    private actorId: string,
  ) {}
  async read() {
    const state = (
      await this.api.request<{ pending: PendingCommand | null }>(
        "/api/v1/commands/pending",
        {},
        "PendingState",
      )
    ).pending;
    if (state && state.actorId !== this.actorId)
      throw Error("Неверный владелец сохранённой команды");
    return state;
  }
  async prepare<K extends CommandName>(
    name: K,
    data: Schema[K],
    entityId?: string,
  ): Promise<Command> {
    if (await this.read()) throw Error("Сначала разрешите сохранённую команду");
    const command = structuredClone({
      name,
      data,
      entityId,
      key: crypto.randomUUID(),
    }) as Command;
    await this.api.request("/api/v1/commands/pending", {
      method: "POST",
      body: JSON.stringify({ command }),
    });
    return command;
  }
  complete(completeKey: string) {
    return this.api.request<void>("/api/v1/commands/pending", {
      method: "POST",
      body: JSON.stringify({ completeKey }),
    });
  }
}
